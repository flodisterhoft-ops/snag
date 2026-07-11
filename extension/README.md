# Snag for Chrome

Companion extension for the [Snag](../README.md) downloader. It adds:

- A **download button** floating over videos on any site (always visible, top-right corner)
- A **toolbar button** that sends the current page to Snag
- **Right-click menus**: download this page / this video / a link with Snag
- A per-site off switch: right-click → *Show/hide Snag button on this site*

Everything is handed to the Snag desktop app through `snag://` links — the
extension itself downloads nothing, so it stays tiny and never needs updating
in step with the app.

## Install (unpacked)

Chrome only allows store extensions to install normally, so this one loads in
developer mode — a one-time, ~30-second setup:

1. Install and launch the **Snag** desktop app first (it registers the
   `snag://` link type). In Snag: *Settings → Browser integration → Install
   extension files*, or just use this folder directly.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and pick this folder.

The first time you click a Snag button, Chrome asks *"Open Snag?"* — tick
*Always allow* and it never asks again.

> **Notes**
> - Chrome may occasionally show a "disable developer mode extensions" notice
>   at startup. It's dismissible and harmless.
> - The button sends the **page URL** to Snag; whether the video can actually be
>   downloaded is decided by yt-dlp (over 1000 sites supported).
> - Works in Edge/Brave/other Chromium browsers the same way (`edge://extensions` etc.).
