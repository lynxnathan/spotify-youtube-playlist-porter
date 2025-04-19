import * as Conf from "conf";
import { Credentials } from "google-auth-library";

export interface SpotifyToken {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
  expires_at?: number;
}

interface ConfigSchema {
  spotifyClientId?: string;
  spotifyClientSecret?: string;
  spotifyRedirectUri?: string;
  spotifyScopes?: string;
  spotifyToken?: SpotifyToken;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri?: string;
  googleScopes?: string[];
  googleToken?: Credentials;
  callbackPort?: number;
}

const schema: Conf.Schema<ConfigSchema> = {
  spotifyClientId: { type: "string" },
  spotifyClientSecret: { type: "string" },
  spotifyRedirectUri: {
    type: "string",
    default: "http://localhost:8888/spotify-callback",
  },
  spotifyScopes: {
    type: "string",
    default:
      "playlist-read-private playlist-read-collaborative user-read-private",
  },
  spotifyToken: {
    type: "object",
    properties: {
      access_token: { type: "string" },
      refresh_token: { type: "string" },
      expires_in: { type: "number" },
      token_type: { type: "string" },
      scope: { type: "string" },
      expires_at: { type: "number" },
    },
  },
  googleClientId: { type: "string" },
  googleClientSecret: { type: "string" },
  googleRedirectUri: {
    type: "string",
    default: "http://localhost:8888/youtube-callback",
  },
  googleScopes: {
    type: "array",
    items: { type: "string" },
    default: ["https://www.googleapis.com/auth/youtube.force-ssl"],
  },
  googleToken: {
    type: "object",
    properties: {
      access_token: { type: "string" },
      refresh_token: { type: "string" },
      scope: { type: "string" },
      token_type: { type: "string" },
      expiry_date: { type: "number" },
    },
  },
  callbackPort: { type: "number", default: 8888 },
};

const config = new Conf.default<ConfigSchema>({
  projectName: "spotify-youtube-playlist-porter",
  schema: schema,
});

export default config;

export function getSpotifyCredentials() {
  return {
    clientId: config.get("spotifyClientId"),
    clientSecret: config.get("spotifyClientSecret"),
    redirectUri: config.get("spotifyRedirectUri"),
    scopes: config.get("spotifyScopes"),
  };
}

export function getGoogleCredentials() {
  return {
    clientId: config.get("googleClientId"),
    clientSecret: config.get("googleClientSecret"),
    redirectUri: config.get("googleRedirectUri"),
    scopes: config.get("googleScopes"),
  };
}

export function getCallbackPort(): number {
  return config.get("callbackPort", 8888);
}

export function saveSpotifyToken(token: SpotifyToken): void {
  config.set("spotifyToken", token);
  console.log("Spotify token saved.");
}

export function loadSpotifyToken(): SpotifyToken | undefined {
  return config.get("spotifyToken");
}

export function deleteSpotifyToken(): void {
  config.delete("spotifyToken");
  console.log("Spotify token deleted.");
}

export function saveGoogleToken(token: Credentials): void {
  config.set("googleToken", token);
  console.log("Google token saved.");
}

export function loadGoogleToken(): Credentials | undefined {
  return config.get("googleToken");
}

export function deleteGoogleToken(): void {
  config.delete("googleToken");
  console.log("Google token deleted.");
}

export function clearConfig(): void {
  const configPath = config.path;
  config.clear();
  console.log("Configuration and tokens cleared.");
  console.log(`Config file location was: ${configPath}`);
}

export function clearTokens(): void {
  config.delete("spotifyToken");
  config.delete("googleToken");
  console.log("Authentication tokens cleared.");
}
