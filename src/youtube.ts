import axios, { AxiosInstance } from "axios";
import http from "http";
import url from "url";
import open from "open";
import { OAuth2Client } from "google-auth-library";
import {
  saveGoogleToken,
  loadGoogleToken,
  getGoogleCredentials,
  deleteGoogleToken,
  getCallbackPort,
} from "./config.js";

export interface YouTubeVideo {
  id: { videoId: string };
  snippet: { title: string; channelTitle: string };
}

export interface YouTubePlaylist {
  id: string;
  snippet: { title: string; description: string };
  status: { privacyStatus: string };
}

export interface YouTubePlaylistItem {
  id: string;
  snippet: {
    playlistId: string;
    resourceId: {
      kind: string;
      videoId: string;
    };
    title: string;
  };
}

async function getYouTubeAuthorizationCode(
  oAuth2Client: OAuth2Client,
  port: number
): Promise<string> {
  const creds = getGoogleCredentials();
  if (!creds.scopes || !creds.redirectUri) {
    throw new Error(
      "Google scopes or redirect URI missing from configuration."
    );
  }

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: creds.scopes,
  });

  console.log("\nPlease authorize this app with Google (YouTube):");
  console.log(authUrl);
  await open(authUrl);

  return new Promise((resolve, reject) => {
    const server = http
      .createServer(async (req, res) => {
        const query = url.parse(req.url!, true).query;
        const requestPath = url.parse(req.url!, true).pathname;

        if (requestPath !== url.parse(creds.redirectUri!, true).pathname) {
          res.writeHead(404);
          res.end();
          return;
        }

        if (query.error) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end(`Authorization failed: ${query.error}`);
          reject(new Error(`Google Authorization failed: ${query.error}`));
          server.close();
          return;
        }

        if (!query.code) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Invalid request parameters (missing code).");
          reject(new Error("Missing Google authorization code."));
          server.close();
          return;
        }

        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Google authentication successful! You can close this window.");
        resolve(query.code as string);
        server.close();
      })
      .listen(port, () => {
        console.log(
          `\nWaiting for Google authorization callback on http://localhost:${port}...`
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

export async function getYouTubeToken(): Promise<OAuth2Client> {
  const creds = getGoogleCredentials();
  const port = getCallbackPort();
  if (!creds.clientId || !creds.clientSecret || !creds.redirectUri) {
    throw new Error("Google API credentials missing. Run configuration setup.");
  }

  const oAuth2Client = new OAuth2Client(
    creds.clientId,
    creds.clientSecret,
    creds.redirectUri
  );

  const token = loadGoogleToken();

  if (token) {
    console.log("Using existing Google token from config.");
    oAuth2Client.setCredentials(token);

    if (token.expiry_date && Date.now() >= token.expiry_date) {
      console.log("Google token might be expired, attempting refresh...");
      try {
        const { credentials } = await oAuth2Client.refreshAccessToken();
        oAuth2Client.setCredentials(credentials);
        saveGoogleToken(credentials);
        console.log("Google token refreshed.");
      } catch (refreshError: any) {
        console.error("Error refreshing Google token:", refreshError.message);
        deleteGoogleToken();
        throw new Error(
          "Failed to refresh Google token. Please re-authenticate."
        );
      }
    }
    return oAuth2Client;
  } else {
    console.log("No valid Google token found. Starting authentication flow...");
    const code = await getYouTubeAuthorizationCode(oAuth2Client, port);
    try {
      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);
      saveGoogleToken(tokens);
      console.log("Google token obtained and saved.");
      return oAuth2Client;
    } catch (error: any) {
      console.error(
        "Error exchanging Google code for token:",
        error.response?.data ?? error.message
      );
      throw new Error("Could not get Google token.");
    }
  }
}

export function createYouTubeClient(auth: OAuth2Client): AxiosInstance {
  const client = axios.create({
    baseURL: "https://www.googleapis.com/youtube/v3",
  });

  client.interceptors.request.use(
    async (config) => {
      try {
        const accessToken = await auth.getAccessToken();
        if (!accessToken.token) {
          throw new Error(
            "Failed to get access token from Google Auth object."
          );
        }
        config.headers.Authorization = `Bearer ${accessToken.token}`;
      } catch (error) {
        console.error("Error getting access token for YouTube request:", error);
        throw new Error("YouTube client authorization failed.");
      }
      return config;
    },
    (error: Error) => {
      return Promise.reject(error);
    }
  );

  return client;
}

export async function searchYouTubeVideo(
  client: AxiosInstance,
  trackName: string,
  artistName: string
): Promise<YouTubeVideo | null> {
  const query = `${trackName} ${artistName}`;
  console.log(`Searching YouTube for: "${query}"`);
  try {
    const response = await client.get("/search", {
      params: {
        part: "snippet",
        q: query,
        type: "video",
        videoCategoryId: "10",
        maxResults: 5,
      },
    });

    if (response.data.items && response.data.items.length > 0) {
      const bestResult = response.data.items[0] as YouTubeVideo;
      console.log(`  Found: "${bestResult.snippet.title}" (ID: ${bestResult.id.videoId})`);
      return bestResult;
    } else {
      console.log(`  No relevant video found for "${query}".`);
      return null;
    }
  } catch (error: any) {
    console.error(
      `Error searching YouTube for "${query}":`,
      error.response?.data?.error?.message ?? error.message
    );
    return null;
  }
}

export async function createYouTubePlaylist(
  client: AxiosInstance,
  title: string,
  description: string
): Promise<string | null> {
  console.log(`Creating YouTube playlist: "${title}"`);
  try {
    const response = await client.post<{ id: string }>(
      "/playlists",
      {
        snippet: {
          title: title,
          description:
            description || `Playlist migrated from Spotify - ${title}`,
        },
        status: {
          privacyStatus: "private",
        },
      },
      {
        params: {
          part: "snippet,status",
        },
      }
    );
    const playlistId = response.data.id;
    console.log(`  Created playlist with ID: ${playlistId}`);
    return playlistId;
  } catch (error: any) {
    console.error(
      `Error creating YouTube playlist "${title}":`,
      error.response?.data?.error?.message ?? error.message
    );
    return null;
  }
}

export async function addVideoToYouTubePlaylist(
  client: AxiosInstance,
  playlistId: string,
  videoId: string
): Promise<boolean> {
  try {
    await client.post<YouTubePlaylistItem>(
      "/playlistItems",
      {
        snippet: {
          playlistId: playlistId,
          resourceId: {
            kind: "youtube#video",
            videoId: videoId,
          },
        },
      },
      {
        params: {
          part: "snippet",
        },
      }
    );
    return true;
  } catch (error: any) {
    const errorDetails = error.response?.data?.error?.errors?.[0];
    if (
      errorDetails?.reason === "duplicate" ||
      errorDetails?.reason === "playlistItemDuplicate"
    ) {
      console.warn(`  Video ID ${videoId} already exists in playlist ${playlistId}. Skipping.`);
      return true;
    }
    if (
      errorDetails?.reason === "forbidden" &&
      error.response?.data?.error?.message?.includes(
        "video owner has disabled comments"
      )
    ) {
      console.warn(
        `  Error adding video ID ${videoId} (may be due to disabled comments or other issue). Skipping.`
      );
      return false;
    }
    console.error(
      `Error adding video ID ${videoId} to playlist ${playlistId}:`,
      errorDetails?.message ?? error.message
    );
    return false;
  }
}
