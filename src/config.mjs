// Oeuvre configuration.
//
// Oeuvre has no settings screen: change behaviour here, then rebuild
// (`npm start` to try it, or push a version tag to publish a release).
// Colors live in src/renderer/theme.css.

const config = {
  appName: 'Oeuvre',

  library: {
    // Audio file extensions scanned in source folders (lowercase, no dot).
    audioExtensions: ['mp3', 'm4a', 'aac', 'wav', 'flac'],
    // Oeuvre lists pieces by name, newest first: names that start with a year put
    // 2026 before 2014. Numbers compare naturally ("No. 10" is above "No. 2").
    // Set sortDescending to false for A→Z / oldest first.
    sortBy: 'title',
    sortDescending: true,
    // Image files used as artwork when a piece has none embedded.
    folderArtworkNames: ['cover', 'folder', 'front', 'artwork', 'album'],
    // Seconds to wait after a change in a watched folder before rescanning it.
    rescanDelaySeconds: 1.5,
  },

  playback: {
    // "Previous" restarts the current piece if it has played longer than this.
    previousRestartsAfterSeconds: 3,
    // Remember the queue and position between launches.
    restoreSessionOnLaunch: true,
  },

  portfolio: {
    // Portfolio starts newest first; its flip button reverses this and is remembered.
    sortDescending: true,
  },

  project: {
    // Same as Portfolio, but exports WAV files.
    sortDescending: true,
  },

  export: {
    // Bitrate used when a Portfolio piece is converted to MP3 during export.
    mp3BitrateKbps: 320,
    // Project exports WAV. WAV files are copied as they are; FLAC keeps its own sample
    // rate and bit depth; MP3/AAC are decoded at their sample rate to this bit depth.
    wavBitDepthFromLossy: 24,
  },

  scores: {
    pdfExtensions: ['pdf'],
    imageExtensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif'],
    // Any other file type is attached and opened in its default app.
  },

  updates: {
    owner: 'guitarherofree',
    repo: 'oeuvre',
    checkAutomatically: true,
    checkOnLaunchAfterSeconds: 8,
    checkEveryHours: 24,
    // Release assets are named Oeuvre-<version>-mac-<arch>.zip
    assetPattern: (version, arch) => `Oeuvre-${version}-mac-${arch}.zip`,
  },
};

export default config;
