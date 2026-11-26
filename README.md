# Oeuvre

A Mac music player for listening to and organizing your own work. It plays audio files from folders on your Mac (MP3, AAC/M4A, WAV, FLAC), keeps a **Portfolio** of work samples you can export as MP3s and **Projects** (as many collections as you like) that export as WAVs, and builds **Setlists** with scores you can open while you listen or practice.

Oeuvre never moves, renames or edits your audio files.

---

## Install

1. Download `Oeuvre-<version>-mac-arm64.zip` from the [latest release](https://github.com/guitarherofree/oeuvre/releases/latest). The repository is private, so you need to be signed in to GitHub.
2. Double-click the zip, then drag **Oeuvre** into **Applications**. Your home folder's `Applications` works too.
3. Open Oeuvre. The app is self-signed rather than notarized by Apple, so the first time macOS says it can't verify the developer:
   - Open **System Settings › Privacy & Security**, scroll to *“Oeuvre” was blocked…*, and click **Open Anyway**.
   - You only do this once. Updates installed from inside Oeuvre don't ask again.

Requires an Apple silicon Mac running macOS 12 or later.

## First run

- **Add your music:** click **Add Folder…**, or drag folders from Finder into the window. You can add as many source folders as you like.
- **Updates:** the first time Oeuvre checks for updates, it asks for a GitHub token, because the repository is private. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with:
  - *Repository access*: Only select repositories › `guitarherofree/oeuvre`
  - *Permissions*: Contents › **Read-only**

  Paste it into Oeuvre. It's stored in your macOS Keychain under “Oeuvre GitHub Token”.

## Using Oeuvre

| Area | What it does |
| --- | --- |
| **Oeuvre** | Every piece from your checked source folders, listed by name, newest first: names that start with a year put 2026 above 2014. Search by title, folder, format or tags. Double-click a piece to play it and everything after it. |
| **Sources** (sidebar, and the **Sources** menu in the menu bar) | Each folder has a check mark. Unchecking a folder hides its pieces without removing it. Add and remove folders here. Removing a folder only removes it from Oeuvre. |
| **Portfolio** | Your work samples, newest first. The **Newest first / Oldest first** button (or a click on the Title column) flips the order, and Oeuvre remembers your choice. Check pieces, then **Export as MP3s…** (into a folder) or **Export as ZIP…**. Pieces that aren't MP3 are converted to 320 kbps MP3 during export; MP3s are copied unchanged. |
| **Projects** | Collections you make yourself. **Add Project** in the sidebar (or ⇧⌘N) creates **Collection 001**, then **Collection 002**, and so on: each new one is one past the highest existing number. Click a project's name to rename it; the trash button deletes it (its pieces stay in your library). Click the square at the top (or drop an image on it) to set the collection's artwork, and fill in **Description** and **Credits** under *About this collection* at the bottom; both save as you type. Each project works like Portfolio but exports **WAV**: **Export as WAVs…** into a folder, or **Export as ZIP…** named after the project. WAV pieces are copied unchanged. FLAC keeps its own sample rate and bit depth. MP3 and AAC are decoded at their own sample rate to 24-bit WAV. |
| **Setlists** | One per show, with a name, date and venue. Pieces stay in running order: drag a row by its ⠿ handle to move it, or select it and press ⌥↑ / ⌥↓. Drag pieces from Oeuvre or Portfolio onto a setlist to add them. The *Starts* column shows when each piece begins in the set. |
| **Scores** | In a setlist, click **Attach…** on a piece, or right-click any piece and choose **Attach Score…**. You can attach PDFs, images (PNG, JPG, HEIC…) or any other file. PDFs and images open inside Oeuvre while the music keeps playing. Other files, such as MuseScore or Sibelius scores, open in their own app. You can also drop files onto an open score to attach them. |
| **Player** | Play/pause, previous/next, seek, volume, shuffle, repeat (all or one), queue. The score button opens the current piece's score. |

Right-click any piece for **Play Next**, **Add to Queue**, **Add to Portfolio**, **Add to Project ›** (a check mark shows the projects that already have them), **Add to Setlist**, **Attach Score…** and **Show in Finder**. You can also drag pieces onto Portfolio, a project or a setlist in the sidebar, or onto **Add Project** to start a new project with them.

Closing the window keeps the music playing, like Spotify. Quit with ⌘Q.

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Space | Play / pause |
| ⌘→ / ⌘← | Next / previous |
| ⌘↑ / ⌘↓ | Volume up / down |
| ⌘S | Shuffle on/off |
| ⌘R | Cycle repeat: off → all → one |
| ⌘F | Search |
| ⌘1 / ⌘2 | Oeuvre / Portfolio |
| ⌘N | New setlist |
| ⇧⌘N | Add project |
| ⌘O | Add source folder |
| ⌥⌘Q | Show queue |
| ⌥⌘S | Show the current piece's score |
| ⌘[ / ⌘] | Back / forward |
| In a score: ← → or Page Up/Down | Previous / next page |
| In a score: ⌘+ ⌘− ⌘0 | Zoom in / out / fit width |
| In a list: ↑ ↓, Return, Delete | Move, play, remove from Portfolio/setlist |
| In a setlist: ⌥↑ / ⌥↓ | Move the selected piece up / down |

## Where your data lives

Everything is in `~/Library/Application Support/Oeuvre/`. To open that folder, use **Help › Show Oeuvre Data in Finder**.

| File | Contents |
| --- | --- |
| `library.json` | Source folders, whether each is checked, and a cache of each piece's duration and tags so launch is fast. Folders are rescanned on launch and watched for changes. |
| `collections.json` | Portfolio, projects, setlists, and which scores belong to which piece. |
| `state.json` | Volume, shuffle/repeat, queue and position, window size, and when updates were last checked. |
| `scores/` | Oeuvre's own copies of imported scores, so a score keeps working if you move or delete the original. |
| `Cache/artwork/` | Artwork read from your files, plus `cover.jpg` / `folder.jpg` images found in your folders. |

If you rename or move a file within a source folder, Oeuvre matches it by name and size. Its Portfolio, setlist and score links stay intact. To back up your Oeuvre setup, copy this folder.

## Customizing

There's no settings screen. Change these two files, then rebuild (`npm start` to try it, or publish a release):

- **`src/renderer/theme.css`**: every color (accent green, backgrounds, text), the fonts, corner radius and row height.
- **`src/config.mjs`**: the sort direction for Oeuvre and the starting direction for Portfolio and projects, the audio file types scanned, MP3 export bitrate, the bit depth for WAVs made from MP3/AAC, folder-artwork file names, how long "previous" waits before restarting a piece, which GitHub repository updates come from, and how often Oeuvre checks automatically (on launch, then every 24 hours).

## Development

You need [Node.js 22+](https://nodejs.org) and npm.

```sh
npm install         # once
npm start           # build the interface and run Oeuvre from source
npm test            # library scanning, relinking, MP3/ZIP export
npm run test:e2e    # drives the real app end to end and saves screenshots to test/.tmp/shots
npm run dist:mac    # on a Mac: builds, ad-hoc signs and zips out/Oeuvre-<version>-mac-arm64.zip
```

When running from source, Oeuvre uses its own data folder name (`~/Library/Application Support/Oeuvre`), same as the app. Set `OEUVRE_USER_DATA=/some/folder` to keep a separate test library.

### Project layout

```
src/config.mjs          behaviour you can change (see Customizing)
src/main/               the app process: library scanning, collections, export, updates, menus
src/preload/            the bridge the window is allowed to use
src/renderer/           the interface (Preact): views, player, score viewer, styles
scripts/                renderer build, Mac packaging, release notes
test/                   unit tests and the end-to-end walkthrough
.github/workflows/      release build on GitHub's Mac runners
```

## Releasing an update

1. Add a section to `CHANGELOG.md`:
   ```md
   ## 1.1.0
   - What changed
   ```
2. Commit, then tag and push:
   ```sh
   git tag v1.1.0
   git push origin main v1.1.0
   ```
3. The **Release** workflow builds the app on an Apple silicon Mac, signs it ad hoc, and publishes `Oeuvre-1.1.0-mac-arm64.zip` with your changelog section as the release notes. You can also run it by hand from the repository's **Actions** tab.

Oeuvre picks up the release on its next daily check, or right away with **Oeuvre › Check for Updates…**. Download & Install replaces the app and reopens it, with no Terminal involved.

Private repositories get a monthly allowance of GitHub Actions minutes, and macOS minutes count 10× against it. Each release build takes about 5 minutes.

## Troubleshooting

- **“Oeuvre can't write to …” when installing an update:** Oeuvre has to be in a folder you can write to, such as Applications. Move it there, open it from there, and try again.
- **“macOS is running Oeuvre from a temporary location”:** you opened it straight from Downloads. Move it to Applications first.
- **A source shows “Not found”:** the folder was moved or is on a disconnected drive. Its pieces come back when the folder is available again.
- **A piece won't play:** check that the file opens in QuickTime Player. Oeuvre skips files it can't decode and tells you which one.
- **Change or remove the GitHub token:** open Check for Updates and choose **Change Token…**. You can also delete “Oeuvre GitHub Token” in Keychain Access.
