<div align="center">

<img src="docs/logo.png" width="110" alt="Snag logo" />

# Snag

**Paste a link. Pick your quality. Done.**

A fast, beautiful video & audio downloader for Windows — powered by
[yt-dlp](https://github.com/yt-dlp/yt-dlp), works with YouTube and 1000+ other sites.

[![Latest release](https://img.shields.io/github/v/release/flodisterhoft-ops/snag?color=c6f24d&label=download)](https://github.com/flodisterhoft-ops/snag/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/flodisterhoft-ops/snag/total?color=c6f24d)](https://github.com/flodisterhoft-ops/snag/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4)

[**⬇ Download the latest release**](https://github.com/flodisterhoft-ops/snag/releases/latest)
&nbsp;·&nbsp;
[Browser extension](#-snag-for-chrome)
&nbsp;·&nbsp;
[FAQ](#-faq)

<a href="https://www.buymeacoffee.com/flodisterhoft"><img src="https://img.shields.io/badge/☕%20Buy%20me%20a%20coffee-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="Buy Me A Coffee"></a>

<br/>

<img src="docs/home.png" width="850" alt="Snag — analyze a video and pick any quality" />

</div>

---

## ✨ Why Snag?

- **Every quality, every format.** Full quality table from 4K60 down to 144p with codec,
  container, and size — or audio-only as MP3, M4A, Opus, WAV, FLAC.
- **One click from Chrome.** A little download button floats on every video; click it and
  Snag's quick dialog pops up with the video already analyzed.
- **Genuinely fast.** Up to 16 parallel connections per download, a one-click
  *Maximum speed* preset, live speed in MB/s **and** Mbps.
- **Multi-language audio & subtitles.** Pick the audio track on multi-language videos;
  download or embed captions.
- **Playlists.** Grab a single video or the whole playlist into its own folder.
- **Stays out of your way.** Runs in the tray, download queue with pause/cancel/retry,
  desktop notification when done.
- **No ads, no accounts, no telemetry.** 100% local, open source, MIT licensed.

<div align="center">
<img src="docs/queue.png" width="850" alt="Download queue with live progress" />
</div>

## 📦 Install

1. Grab the **Setup installer** (recommended — enables the browser handoff) or the
   **portable exe** from the
   [latest release](https://github.com/flodisterhoft-ops/snag/releases/latest).
2. Run it. That's it — **yt-dlp and ffmpeg are bundled**, nothing else to install.

> **Windows SmartScreen may warn you** ("Windows protected your PC") because Snag is a
> free open-source app without a paid code-signing certificate. Click
> **More info → Run anyway**. The source code is all here if you want to check or build
> it yourself.

## 🧩 Snag for Chrome

The companion extension puts Snag one click away on any video site:

- A **translucent download button** in the corner of every video
- **Right-click menus** — download this page, this video, or any link
- A **toolbar button** to send the current tab to Snag

Click any of them and the quick dialog appears — video analyzed, quality picker ready:

<div align="center">
<img src="docs/quick.png" width="420" alt="Quick download dialog opened from the browser" />
</div>

**Install (one-time, ~30 seconds):** Chrome only auto-installs store extensions, so this
one loads in developer mode:

1. In Snag: **Settings → Browser integration → Install extension files** (copies the
   extension to a stable folder and shows these same steps).
2. Open `chrome://extensions`, switch on **Developer mode** (top-right).
3. Click **Load unpacked** and pick the copied folder.
4. First click: Chrome asks *"Open Snag?"* — tick **Always allow**.

Works the same in Edge and Brave. Full details in [extension/README.md](extension/README.md).

## ⚙️ Make it yours

<div align="center">
<img src="docs/settings.png" width="850" alt="Settings — speed presets, formats, browser integration" />
</div>

Default folder and filename pattern, parallel downloads, connection boost, bandwidth cap,
preferred containers/formats, subtitle defaults, tray behavior, quick dialog vs. full app
handoff — plus a built-in updater that checks for new Snag and yt-dlp releases about once
a day and prompts you (update now or later, your call).

## 🔨 Build from source

```powershell
git clone https://github.com/flodisterhoft-ops/snag.git
cd snag
npm install
npm run dev        # hot-reloading dev app
npm test           # unit tests
npm run dist       # installer + portable exe in ./dist
```

Dev builds use `yt-dlp`/`ffmpeg` from your PATH (`winget install yt-dlp ffmpeg`);
packaged builds bundle both. `npm run dist` needs Windows **Developer Mode** (or an
admin terminal) once, so electron-builder can extract its toolchain.

## ❓ FAQ

**Is this legal?**
Snag is a tool, like a browser's save button. Only download content you have the right to
save — your own uploads, Creative Commons, public domain, or where the creator allows it.
Respect each site's terms of service.

**Why does SmartScreen/my antivirus flag it?**
Snag is unsigned (code-signing certificates cost hundreds of dollars a year). The app is
open source — audit it, build it yourself, or check the release binaries with VirusTotal.

**A video fails to download?**
Sites change constantly; yt-dlp updates almost weekly to keep up. Snag will prompt you
when a yt-dlp update is available — or force it via **Settings → Engine → Update**.

**Where are playlists saved?**
In a subfolder named after the playlist, inside your chosen folder.

**Does it work on Mac/Linux?**
Not yet — Snag is currently Windows-only. The core is Electron, so ports are possible;
open an issue if you're interested.

## ☕ Support

Snag is free and always will be. If it saves you time, a coffee keeps the updates coming:

<a href="https://www.buymeacoffee.com/flodisterhoft"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="45"></a>

## 📄 License

[MIT](LICENSE) — do whatever you like, no warranty.
Downloads are powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) and
[ffmpeg](https://ffmpeg.org/); see [THIRD_PARTY_TOOLS](build/tools/THIRD_PARTY_TOOLS.txt)
for their licenses.
