# Snag

A simple, polished desktop app to download video & audio from YouTube and 1000+ other
sites. Paste a link, pick exactly what you want — any video quality, any audio language,
or audio-only in MP3/M4A/Opus/WAV/FLAC — choose a folder, and go. Powered by
[yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://ffmpeg.org/).

## Features

- **Paste & analyze** — paste a link (or one-click the clipboard auto-detect) and see
  every available format.
- **Video** — full quality table (2160p → 144p, fps, codec, container, estimated size),
  choose MP4 / MKV / WebM.
- **Audio** — pick the audio language on multi-track videos, extract to MP3, M4A, Opus,
  WAV, FLAC, or keep the original.
- **Subtitles** — download or embed captions in any available language.
- **Queue** — line up several downloads; run 1–4 in parallel; live progress, speed, ETA,
  cancel / retry / open-file / show-in-folder.
- **Speed control both ways** — a Connection-boost setting (Normal / Fast / Turbo / Max
  parallel connections per download) to saturate fast internet lines, plus a bandwidth
  cap when you want downloads to stay polite.
- **Settings** — default folder, speed controls, filename pattern, format defaults,
  cover-art & metadata embedding, and a one-click yt-dlp updater.
- **Desktop notifications** when a download finishes (click to open the folder).
- **Browser handoff** — a [Chrome companion extension](extension/README.md) puts a
  download button on videos and in right-click menus; one click opens Snag's quick
  dialog via a `snag://` link with the video already analyzed. Snag can stay in the
  tray so downloads keep running with every window closed.

## Download engines

Packaged Snag builds include `yt-dlp` and `ffmpeg`, so installed and portable releases
work without system-wide tools. Development builds use copies found on `PATH`. To install
those locally:

```powershell
winget install yt-dlp
winget install ffmpeg
```

You can also point Snag at a specific `yt-dlp.exe` in Settings → Engine. The Update button
maintains a writable per-user copy instead of attempting to modify Program Files.

## Develop

```powershell
npm install
npm run dev        # hot-reloading dev app
npm run typecheck  # TypeScript check
npm run build      # compile main + preload + renderer to ./out
npm test           # run focused queue, arguments, and formatting tests
```

## Run it now (no install needed)

A ready-to-run build is in `dist/win-unpacked/` — just double-click **`Snag.exe`**.
Portable and installer artifacts are produced under `dist/`; neither needs separate
yt-dlp or ffmpeg installation.

## Building the Windows installer (NSIS)

```powershell
npm run dist       # NSIS installer + portable .exe in ./dist
npm run dist:dir   # unpacked app folder only (faster, used above)
```

> **One-time setup:** `npm run dist` needs to extract electron-builder's code-signing
> toolchain, which contains symbolic links. Creating those on Windows requires the
> "create symbolic links" privilege. If you see
> *"Cannot create symbolic link … A required privilege is not held by the client"*,
> do **one** of the following, then re-run `npm run dist`:
> - Turn on **Settings → Privacy & security → For developers → Developer Mode**, **or**
> - Run the command from a terminal opened as **Administrator**.
>
> `npm run dist:dir` (used to produce the portable build above) does **not** need this.

The installer creates desktop and Start-menu shortcuts.

## Browser extension (Snag for Chrome)

The [`extension/`](extension/README.md) folder contains an unpacked Chrome extension:
a floating download button on videos, a toolbar button, and right-click
page/video/link menus, all handing the page URL to the desktop app through
`snag://download` deep links. Install it from Snag via
**Settings → Browser integration → Install extension files**, then load the copied
folder with `chrome://extensions` → Developer mode → **Load unpacked**
(full steps in the extension README). In Settings you can also choose whether the
handoff opens the compact quick dialog or the full app.

## How it works

- **Main process** (`src/main`) locates and spawns `yt-dlp.exe` directly (no wrapper
  library), parses its JSON metadata and live progress, manages the download queue, and
  persists settings to a small JSON file in `%APPDATA%`.
- **Renderer** (`src/renderer`) is a React UI talking to the main process over a typed
  `contextBridge` preload API (`src/preload`, contract in `src/shared/types.ts`).
- **No browser data or accounts** — everything runs locally on your PC.
