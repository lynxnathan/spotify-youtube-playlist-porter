import { AxiosInstance } from "axios";
import chalk from "chalk";
import {
  SpotifyPlaylist,
  getPlaylistTracksSpotify,
  SpotifyTrack,
} from "./spotify.js";
import {
  searchYouTubeVideo,
  createYouTubePlaylist,
  addVideoToYouTubePlaylist,
} from "./youtube.js";

export async function transferPlaylist(
  spotifyClient: AxiosInstance,
  youtubeClient: AxiosInstance,
  spotifyPlaylist: SpotifyPlaylist
): Promise<void> {
  console.log(
    chalk.magenta(
      `\nProcessing Spotify Playlist: "${spotifyPlaylist.name}" (ID: ${spotifyPlaylist.id})`
    )
  );

  let spotifyTracks: SpotifyTrack[] = await getPlaylistTracksSpotify(
      spotifyClient,
      spotifyPlaylist.id
    );

  if (spotifyTracks.length === 0) {
    console.log(
      chalk.yellow(
        `  Playlist "${spotifyPlaylist.name}" is empty or has no accessible tracks. Skipping.`
      )
    );
    return;
  }

  const newPlaylistTitle = `${spotifyPlaylist.name}`;
  const newPlaylistDescription =
    spotifyPlaylist.description ||
    `Migrated from Spotify: ${spotifyPlaylist.name}`;
  const youtubePlaylistId = await createYouTubePlaylist(
    youtubeClient,
    newPlaylistTitle,
    newPlaylistDescription
  );

  if (!youtubePlaylistId) {
    console.error(
      chalk.red(
        `  Failed to create YouTube playlist for "${spotifyPlaylist.name}". Skipping this playlist.`
      )
    );
    return;
  }

  let addedCount = 0;
  let notFoundCount = 0;
  let failedCount = 0;
  console.log(`  Attempting to transfer ${spotifyTracks.length} tracks...`);

  for (let i = 0; i < spotifyTracks.length; i++) {
    const item = spotifyTracks[i];
    if (!item?.track) continue;

    const track = item.track;
    const artistNames = track.artists.map((a) => a.name).join(", ");
    const searchLog = `[${i + 1}/${spotifyTracks.length}] "${
      track.name
    }" by ${artistNames}`;

    await new Promise((resolve) => setTimeout(resolve, 300));

    const youtubeVideo = await searchYouTubeVideo(
      youtubeClient,
      track.name,
      artistNames
    );

    if (youtubeVideo?.id?.videoId) {
      const success = await addVideoToYouTubePlaylist(
        youtubeClient,
        youtubePlaylistId,
        youtubeVideo.id.videoId
      );
      if (success) {
        addedCount++;
        console.log(
          chalk.gray(
            `    ${searchLog} -> Added: "${youtubeVideo.snippet.title}"`
          )
        );
      } else {
        failedCount++;
        console.log(
          chalk.yellow(`    ${searchLog} -> Found, but failed to add.`)
        );
      }
    } else {
      notFoundCount++;
      console.log(chalk.yellow(`    ${searchLog} -> Not found.`));
    }
  }

  console.log(
    chalk.magenta(`\nFinished processing "${spotifyPlaylist.name}".`)
  );
  console.log(chalk.green(`  Successfully added: ${addedCount} tracks`));
  console.log(chalk.yellow(`  Could not find: ${notFoundCount} tracks`));
  if (failedCount > 0) {
    console.log(
      chalk.red(`  Failed to add (found but error): ${failedCount} tracks`)
    );
  }
  console.log(
    chalk.cyan(
      `  Check the new YouTube playlist: https://www.youtube.com/playlist?list=${youtubePlaylistId}`
    )
  );
}
