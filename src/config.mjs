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
    // Pieces are always listed by title (natural order: "Étude 2" before "Étude 10").
    sortBy: 'title',
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

  export: {
    // Bitrate used when a Portfolio piece is converted to MP3 during export.
    mp3BitrateKbps: 320,
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
