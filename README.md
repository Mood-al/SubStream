# SubStream — Subtitles Overlay (Chrome Extension)

SubStream adds **subtitles in any language** on top of almost any streaming site (anything that plays video in the browser). You can either **search and download subtitles from SubDL**, or **load your own subtitle files** — then fine‑tune timing and styling until it’s perfect.

## Features

- **Works on any site with a video player**
  - Displays an on-screen subtitle overlay
  - Stays visible in **fullscreen**
  - Survives most **page reloads / SPA navigation**
- **SubDL search built-in**
  - Search by **Title**, **IMDB ID**, or **TMDB ID**
  - Optional **Season / Episode** filtering
  - Choose a subtitle **language** and load it instantly
- **Local subtitle loading**
  - Load a single `.srt` / `.sub` / `.vtt` file (drag & drop or browse)
  - Load a **whole folder/season** of subtitle files
  - Built-in library list to quickly switch between files
- **Auto-advance episodes**
  - When you load a folder, SubStream can **auto-load the next file** when the current video ends (or when the video source changes)
- **Timing controls**
  - Quick nudges: **±0.5s** and **±1.0s**
  - Set a custom offset in **milliseconds**
  - **Sync Now**: tell it “this subtitle timestamp matches *right now*” and it calculates the offset
  - Save offsets per show (e.g. “Breaking Bad S3”) and reuse them later
- **Subtitle style controls**
  - Font size
  - Subtitle position (distance from bottom)
  - Background opacity
- **Quick enable/disable**
  - Toggle subtitles on/off without unloading them
  - Clear the active subtitle at any time

## How to use

1. Open your streaming site and start playing a video.
2. Click the **SubStream** extension icon.
3. Pick one of these:
   - **Search tab**: add your SubDL API key in **Settings**, then search and click **Load**
   - **Local tab**: drop a subtitle file, or load a whole folder
4. If subtitles are early/late, use the **Timing tab** to nudge or sync.

## Install (developer / local)

1. Download or clone this repo.
2. Open Chrome (or Chromium) and go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the project folder (`arabic-subs-extension`).

## SubDL API key

SubStream uses SubDL for subtitle searching/downloading. Add your key in the extension popup:

- Go to **Settings** → **SubDL API Key** → **Save**
- The link in Settings takes you to SubDL’s API page.

## Permissions (why they’re needed)

- **storage**: save your API key, offsets, settings, and the currently loaded subtitle
- **activeTab / tabs / scripting**: inject the subtitle overlay into the current tab (and keep it working on modern streaming sites)
- **Host permissions**
  - `https://api.subdl.com/*` and `https://dl.subdl.com/*`: search/download subtitles from SubDL
  - `https://*/*`: allow the extension to run on streaming sites you use

## Privacy notes

- Your subtitle files and settings are stored locally in Chrome.
- When you use the **Search** feature, the extension sends your search query to **SubDL** (and downloads the subtitle from SubDL).
- SubStream does **not** require an account and does not intentionally track browsing history.

## License

MIT (see `LICENSE`).

