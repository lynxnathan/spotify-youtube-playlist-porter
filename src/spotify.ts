import axios, { AxiosInstance } from "axios";
import http from "http";
import url from "url";
import open from "open";
import {
  saveSpotifyToken,
  loadSpotifyToken,
  getSpotifyCredentials,
  SpotifyToken,
  deleteSpotifyToken,
  getCallbackPort,
} from "./config.js";

export interface SpotifyUser {
  id: string;
  display_name: string;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string;
  owner: { id: string; display_name: string };
  tracks: { href: string; total: number };
}

export interface SpotifyTrack {
  track: {
    id: string;
    name: string;
    artists: { name: string }[];
    album: { name: string };
    duration_ms: number;
  } | null;
}

async function getSpotifyAuthorizationCode(port: number): Promise<string> {
  const creds = getSpotifyCredentials();
  if (!creds.clientId || !creds.redirectUri || !creds.scopes) {
    throw new Error("Spotify API credentials missing in configuration.");
  }

  const state = Math.random().toString(36).substring(7);
  const authUrl =
    "https://accounts.spotify.com/authorize?" +
    new URLSearchParams({
      response_type: "code",
      client_id: creds.clientId!,
      scope: creds.scopes!,
      redirect_uri: creds.redirectUri!,
      state: state,
    }).toString();

  console.log("\nPlease authorize this app with Spotify:");
  console.log(authUrl);
  await open(authUrl);

  return new Promise((resolve, reject) => {
    const server = http
      .createServer(async (req, res) => {
        const query = url.parse(req.url ?? "", true).query;
        const requestPath = url.parse(req.url ?? "", true).pathname;

        if (requestPath !== url.parse(creds.redirectUri!, true).pathname) {
          res.writeHead(404);
          res.end();
          return;
        }

        if (query.error) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end(`Authorization failed: ${query.error}`);
          reject(new Error(`Spotify Authorization failed: ${query.error}`));
          server.close();
          return;
        }

        if (!query.code || query.state !== state) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Invalid request parameters.");
          reject(new Error("Invalid state parameter or missing code."));
          server.close();
          return;
        }

        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(
          "Spotify authentication successful! You can close this window."
        );
        resolve(query.code as string);
        server.close();
      })
      .listen(port, () => {
        console.log(
          `\nWaiting for Spotify authorization callback on http://localhost:${port}...`
        );
      });

    server.on("error", (err) => {
      reject(new Error(`Callback server error: ${err.message}`));
      server.close();
    });

    setTimeout(() => {
      reject(new Error("Authorization timed out."));
      server.close();
    }, 60 * 1000);
  });
}

async function exchangeSpotifyCodeForToken(
  code: string
): Promise<SpotifyToken> {
  const creds = getSpotifyCredentials();
  if (!creds.clientId || !creds.clientSecret || !creds.redirectUri) {
    throw new Error("Spotify API credentials missing for token exchange.");
  }
  try {
    const response: any = await axios.post<SpotifyToken>(
      "https://accounts.spotify.com/api/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: creds.redirectUri!,
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:
            "Basic " +
            Buffer.from(creds.clientId + ":" + creds.clientSecret).toString(
              "base64"
            ),
        },
      }
    );

    const token = response.data;
    token.expires_at = Date.now() + token.expires_in * 1000;
    return token;
  } catch (error: any) {
    console.error(
      "Error exchanging Spotify code for token:",
      error.response?.data ?? error.message
    );
    throw new Error("Could not get Spotify token.");
  }
}

async function refreshSpotifyToken(
  refreshToken: string
): Promise<SpotifyToken> {
  const creds = getSpotifyCredentials();
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error("Spotify API credentials missing for token refresh.");
  }
  try {
    console.log("Refreshing Spotify token...");
    const response: any = await axios.post<SpotifyToken>(
      "https://accounts.spotify.com/api/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:
            "Basic " +
            Buffer.from(creds.clientId + ":" + creds.clientSecret).toString(
              "base64"
            ),
        },
      }
    );

    const token = response.data;
    token.refresh_token = refreshToken;
    token.expires_at = Date.now() + token.expires_in * 1000;
    console.log("Spotify token refreshed successfully.");
    return token;
  } catch (error: any) {
    console.error(
      "Error refreshing Spotify token:",
      error.response?.data ?? error.message
    );
    throw new Error("Could not refresh Spotify token. Please re-authenticate.");
  }
}

export async function getSpotifyToken(): Promise<SpotifyToken> {
  let token = loadSpotifyToken();
  const port = getCallbackPort();

  if (token) {
    if (token.expires_at && Date.now() >= token.expires_at) {
      if (token.refresh_token) {
        console.log("Attempting to refresh expired Spotify token...");
        try {
          token = await refreshSpotifyToken(token.refresh_token);
          saveSpotifyToken(token);
        } catch (refreshError) {
          console.warn(
            "Spotify token refresh failed, attempting full re-auth.",
            refreshError
          );
          deleteSpotifyToken();
          token = undefined;
        }
      } else {
        console.log(
          "Spotify token expired, no refresh token. Re-authenticating."
        );
        deleteSpotifyToken();
        token = undefined;
      }
    } else {
      console.log("Using existing Spotify token from config.");
      return token;
    }
  }

  if (!token) {
    console.log(
      "No valid Spotify token found. Starting authentication flow..."
    );
    const creds = getSpotifyCredentials();
    if (
      !creds.clientId ||
      !creds.clientSecret ||
      !creds.redirectUri ||
      !creds.scopes
    ) {
      throw new Error(
        "Spotify API credentials missing. Run configuration setup."
      );
    }
    const code = await getSpotifyAuthorizationCode(port);
    token = await exchangeSpotifyCodeForToken(code);
    saveSpotifyToken(token);
  }

  return token;
}

export function createSpotifyClient(token: SpotifyToken): AxiosInstance {
  const client = axios.create({
    baseURL: "https://api.spotify.com/v1",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  });

  return client;
}

export async function getCurrentUserSpotify(
  client: AxiosInstance
): Promise<SpotifyUser> {
  try {
    const response = await client.get<SpotifyUser>("/me");
    return response.data;
  } catch (error: any) {
    console.error(
      "Error fetching Spotify user profile:",
      error.response?.data ?? error.message
    );
    throw new Error("Could not fetch Spotify user profile.");
  }
}

export async function getUserPlaylistsSpotify(
  client: AxiosInstance,
  userId: string
): Promise<SpotifyPlaylist[]> {
  let playlists: SpotifyPlaylist[] = [];
  let url: string | null = `/users/${userId}/playlists?limit=50`;

  console.log("Fetching your Spotify playlists...");
  try {
    while (url) {
      const response: {
        data: {
          items: SpotifyPlaylist[];
          next: string | null;
        };
      } = await client.get<{
        items: SpotifyPlaylist[];
        next: string | null;
      }>(url);
      playlists = playlists.concat(response.data.items);
      url = response.data.next;
      if (url) {
        url = url.replace(client.defaults.baseURL!, "");
        console.log(`Fetching next page of playlists...`);
      }
    }
    console.log(`Found ${playlists.length} playlists.`);
    return playlists;
  } catch (error: any) {
    console.error(
      "Error fetching Spotify playlists:",
      error.response?.data ?? error.message
    );
    throw new Error("Could not fetch Spotify playlists.");
  }
}

export async function getPlaylistTracksSpotify(
  client: AxiosInstance,
  playlistId: string
): Promise<SpotifyTrack[]> {
  let tracks: SpotifyTrack[] = [];
  let url:
    | string
    | null = `/playlists/${playlistId}/tracks?fields=items(track(id,name,artists(name),album(name),duration_ms)),next&limit=100`;

  console.log(`Fetching tracks for playlist ID: ${playlistId}...`);
  try {
    while (url) {
      const response: {
        data: {
          items: SpotifyTrack[];
          next: string | null;
        };
      } = await client.get<{
        items: SpotifyTrack[];
        next: string | null;
      }>(url);
      const validItems = response.data.items.filter(
        (item: SpotifyTrack) => item.track !== null
      );
      tracks = tracks.concat(validItems);
      url = response.data.next;
      if (url) {
        url = url.replace(client.defaults.baseURL!, "");
        console.log(`Fetching next page of tracks...`);
      }
    }
    console.log(`Found ${tracks.length} valid tracks.`);
    
    return tracks;
  } catch (error: any) {
    console.error(
      `Error fetching tracks for playlist ${playlistId}:`,
      error.response?.data ?? error.message
    );
    throw new Error(`Could not fetch tracks for playlist ${playlistId}.`);
  }
}
