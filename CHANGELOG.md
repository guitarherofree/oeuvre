# Changelog

Each `## <version>` section becomes the release notes Oeuvre shows in **Check for Updates…**.

## 1.3.0

- The single Project tab is replaced by **Projects**: choose **Add Project** in the sidebar (or ⇧⌘N) to make as many collections as you like.
  - New projects are named **Collection 001**, **Collection 002**, …, one past the highest existing number. Click a project's name to rename it.
  - Each project works like Portfolio and exports **WAV** (individual files or a ZIP named after the project).
  - Add pieces by right-clicking › **Add to Project** (a check mark shows which projects already have them), by dragging them onto a project in the sidebar, or by dropping them on **Add Project** to start a new one.
- Anything you had in the old Project tab is now **Collection 001**.

## 1.2.0

- New **Project** tab. It works like Portfolio: add pieces by right-clicking or dragging them onto Project in the sidebar, check pieces, flip newest/oldest first. It exports **WAV** files, individually or as one ZIP.
  - WAV pieces are copied unchanged.
  - FLAC keeps its own sample rate and bit depth.
  - MP3 and AAC are decoded at their own sample rate to 24-bit WAV.
- File menu: Export Project as ZIP… / as WAV Files…. View menu: Project (⌘3).

## 1.1.0

- **Oeuvre** now lists pieces by name, newest first: names that start with a year put 2026 above 2014. The Title column shows the direction.
- **Portfolio** has a **Newest first / Oldest first** button that flips the order (clicking the Title column does the same). Oeuvre remembers your choice.
- **Setlists**: every row now shows a drag handle, and you can also move a selected piece with ⌥↑ / ⌥↓. Dragging pieces from Oeuvre onto a setlist in the sidebar still adds them.

## 1.0.0

First release.

- **Oeuvre**: every piece from your source folders, always sorted by title, with search.
- **Sources**: add and remove folders; check or uncheck each one to show or hide its pieces (also in the menu bar).
- **Playback**: play/pause, previous/next, seek, volume, shuffle, repeat all/one, and a queue (Play Next / Add to Queue). Media keys and Now Playing work.
- **Portfolio**: collect work samples and export the checked ones as MP3 files or one ZIP. Non-MP3s are converted at 320 kbps.
- **Setlists**: running order with drag-to-reorder, show date and venue, start time for each piece, and scores attached to pieces.
- **Scores**: PDFs and images open inside Oeuvre while you listen; any other file opens in its own app.
- **Updates**: Check for Updates reads this repository's releases and installs them without Terminal. Checks on launch and daily.
