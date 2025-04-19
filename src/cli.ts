#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import config, {
  getCallbackPort,
  clearConfig,
  clearTokens,
  SpotifyToken,
} from './config.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  getSpotifyToken,
  createSpotifyClient,
  getCurrentUserSpotify,
  getUserPlaylistsSpotify,
  SpotifyPlaylist,
} from "./spotify.js";
import { getYouTubeToken, createYouTubeClient } from "./youtube.js";
import { transferPlaylist } from "./transfer.js";
import { OAuth2Client } from "google-auth-library";
import { AxiosInstance } from "axios";

const program = new Command();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = resolve(__dirname, '../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

program
  .name("spotify-youtube-playlist-porter")
  .description("Transfer Spotify playlists to YouTube.")
  .version(version);

program
  .command("configure")
  .description("Set up Spotify and Google API credentials.")
  .action(async () => {
    console.log(chalk.blue("--- API Credential Setup ---"));
    console.log(
      chalk.yellow(
        "Credentials needed from Spotify Developer Dashboard and Google Cloud Console."
      )
    );
    console.log(
      chalk.yellow(
        "Ensure Redirect URIs match those in your API settings (defaults provided)."
      )
    );

    const answers = await inquirer.prompt([
      {
        name: "spotifyClientId",
        message: "Spotify Client ID:",
        default: config.get("spotifyClientId"),
      },
      {
        name: "spotifyClientSecret",
        message: "Spotify Client Secret:",
        default: config.get("spotifyClientSecret"),
      },
      {
        name: "spotifyRedirectUri",
        message: "Spotify Redirect URI:",
        default: config.get(
          "spotifyRedirectUri",
          "http://localhost:8888/spotify-callback"
        ),
      },
      {
        name: "googleClientId",
        message: "Google Client ID:",
        default: config.get("googleClientId"),
      },
      {
        name: "googleClientSecret",
        message: "Google Client Secret:",
        default: config.get("googleClientSecret"),
      },
      {
        name: "googleRedirectUri",
        message: "Google Redirect URI:",
        default: config.get(
          "googleRedirectUri",
          "http://localhost:8888/youtube-callback"
        ),
      },
      {
        name: "callbackPort",
        message: "Port for OAuth callback server:",
        default: config.get("callbackPort", 8888),
        filter: (input) => parseInt(input, 10) || 8888,
      },
    ]);

    if (
      !answers.spotifyClientId ||
      !answers.spotifyClientSecret ||
      !answers.googleClientId ||
      !answers.googleClientSecret
    ) {
      console.error(
        chalk.red("Error: All Client IDs and Secrets are required.")
      );
      return;
    }

    config.set("spotifyClientId", answers.spotifyClientId);
    config.set("spotifyClientSecret", answers.spotifyClientSecret);
    config.set("spotifyRedirectUri", answers.spotifyRedirectUri);
    config.set("googleClientId", answers.googleClientId);
    config.set("googleClientSecret", answers.googleClientSecret);
    config.set("googleRedirectUri", answers.googleRedirectUri);
    config.set("callbackPort", answers.callbackPort);

    console.log(chalk.green("\nConfiguration saved successfully!"));
    console.log(
      chalk.yellow('Use "reset-auth" to clear existing tokens if needed.')
    );
    console.log(`Config file location: ${config.path}`);
  });

program
  .command("reset-auth")
  .description("Clear stored Spotify and Google authentication tokens.")
  .action(() => {
    clearTokens();
  });

program
  .command("reset-all")
  .description("Clear ALL stored configuration and tokens.")
  .action(() => {
    clearConfig();
  });

program
  .command("transfer")
  .option("--all", "Transfer all playlists")
  .option(
    "-p, --playlist <ids...>",
    "Specify one or more Spotify playlist IDs to transfer"
  )
  .action(async (options) => {
    console.log(chalk.blue("--- Spotify to YouTube Playlist Transfer ---"));

    if (!config.get("spotifyClientId") || !config.get("googleClientId")) {
      console.error(chalk.red("API credentials not configured. Please run:"));
      console.error(chalk.yellow(`  ${program.name()} configure`));
      process.exit(1);
    }

    let spotifyToken: SpotifyToken;
    let youtubeAuth: OAuth2Client;
    let spotifyClient: AxiosInstance;
    let youtubeClient: AxiosInstance;

    try {
      console.log("\nAuthenticating with Spotify...");
      spotifyToken = await getSpotifyToken();
      spotifyClient = createSpotifyClient(spotifyToken);

      console.log("\nAuthenticating with Google (YouTube)...");
      youtubeAuth = await getYouTubeToken();
      youtubeClient = createYouTubeClient(youtubeAuth);
    } catch (error: any) {
      console.error(chalk.red("\nAuthentication failed:"), error.message);
      console.error(
        chalk.yellow(
          "Ensure credentials are correct and the callback server can run on port"
        ),
        getCallbackPort()
      );
      console.error(
        chalk.yellow('You might need to run "reset-auth" and try again.')
      );
      process.exit(1);
    }

    let spotifyUser;
    let allSpotifyPlaylists: SpotifyPlaylist[];
    try {
      spotifyUser = await getCurrentUserSpotify(spotifyClient);
      console.log(
        chalk.green(
          `\nLogged into Spotify as: ${spotifyUser.display_name} (${spotifyUser.id})`
        )
      );
      allSpotifyPlaylists = await getUserPlaylistsSpotify(
        spotifyClient,
        spotifyUser.id
      );
    } catch (error: any) {
      console.error(
        chalk.red("\nFailed to get Spotify user data:"),
        error.message
      );
      process.exit(1);
    }

    if (allSpotifyPlaylists.length === 0) {
      console.log(chalk.yellow("No Spotify playlists found for this user."));
      return;
    }

    let playlistsToTransfer: SpotifyPlaylist[] = [];

    if (options.all) {
      playlistsToTransfer = allSpotifyPlaylists;
      console.log(
        chalk.cyan(
          `Selected all ${playlistsToTransfer.length} playlists for transfer.`
        )
      );
    } else if (options.playlist && options.playlist.length > 0) {
      playlistsToTransfer = allSpotifyPlaylists.filter((p) =>
        options.playlist.includes(p.id)
      );
      const foundNames = playlistsToTransfer
        .map((p) => `"${p.name}"`)
        .join(", ");
      const notFoundIds = options.playlist.filter(
        (id: string) => !playlistsToTransfer.some((p) => p.id === id)
      );
      console.log(
        chalk.cyan(
          `Selected ${playlistsToTransfer.length} playlist(s) by ID: ${
            foundNames || "None found matching provided IDs"
          }`
        )
      );
      if (notFoundIds.length > 0) {
        console.log(
          chalk.yellow(
            `Warning: Could not find playlist IDs: ${notFoundIds.join(", ")}`
          )
        );
      }
    } else {
      const playlistChoices = allSpotifyPlaylists.map((p) => ({
        name: `${p.name} (${p.tracks.total} tracks, ID: ${p.id})`,
        value: p.id,
      }));
      const answers = await inquirer.prompt([
        {
          type: "checkbox",
          name: "selectedIds",
          message: "Select Spotify playlists to transfer:",
          choices: playlistChoices,
          validate: (input) =>
            input.length > 0 ? true : "Please select at least one playlist.",
          pageSize: 15,
        },
      ]);
      playlistsToTransfer = allSpotifyPlaylists.filter((p) =>
        answers.selectedIds.includes(p.id)
      );
    }

    if (playlistsToTransfer.length === 0) {
      console.log(chalk.yellow("No playlists selected for transfer. Exiting."));
      return;
    }

    console.log(
      chalk.blue(
        `\nStarting transfer for ${playlistsToTransfer.length} playlist(s)...`
      )
    );

    for (const playlist of playlistsToTransfer) {
      await transferPlaylist(spotifyClient, youtubeClient, playlist);
    }

    console.log(chalk.green("\n--- All selected transfers complete! ---"));
  });

if (
  process.argv.length <= 2 ||
  (process.argv.length > 2 &&
    !program.commands.some((c) => c.name() === process.argv[2]))
) {
  const args = [...process.argv];
  if (args.length <= 2) {
    args.push("--help");
  }
  program.parse(args);
} else {
  program.parse(process.argv);
}
