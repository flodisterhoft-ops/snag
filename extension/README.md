# Snag for Chrome

Companion extension for the [Snag](../README.md) downloader. It adds:

- A translucent **download button** over supported, visible HTML5 video players
- An animated in-page picker for quality, file type, audio tracks, and live progress
- A **toolbar button** that sends the current page to Snag
- **Right-click menus**: download this page / this video / a link with Snag
- A per-site off switch: right-click → *Show/hide Snag button on this site*

The in-page picker talks only to the running Snag app on localhost; the
extension itself downloads nothing. `snag://` remains a fallback when Snag is
not running. Per-site preferences are stored locally in Chrome and are not
synced to a Google account.

## Install (unpacked)

Chrome only allows store extensions to install normally, so this one loads in
developer mode — a one-time, ~30-second setup:

1. Install and launch the **Snag** desktop app first. Snag automatically prepares
   a stable extension folder; its exact path appears under *Settings → Browser
   integration*. Repository builds can use this `extension` folder directly.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**, navigate to the path shown by Snag, and select the
   folder that directly contains `manifest.json`.
5. Reload video tabs that were already open so Chrome injects the new extension.

With Snag running, the overlay expands into the picker without opening another
window. If Snag is closed and you choose the fallback, Chrome may ask *"Open
Snag?"* before launching the desktop app.

> **Notes**
> - The first **Load unpacked** is required by Chrome. After that, installed Snag
>   releases refresh the stable folder on startup and the extension reloads
>   itself when it detects the new app version. Repository-folder development
>   builds still need a manual reload after source edits.
> - Chrome may occasionally show a "disable developer mode extensions" notice
>   at startup. It's dismissible and harmless.
> - The button is translucent until hovered, is hidden in fullscreen, and sends
>   the **page or iframe URL**, not the video's often-useless `blob:` source.
>   Whether the page can be downloaded is decided by yt-dlp.
> - The overlay appears on normal, visible HTML video players at least 250 x 140
>   pixels. Browser-protected pages and players hidden inside closed shadow DOMs
>   cannot be modified by an extension. DRM, sandboxed frames, and site CSS may
>   also block the overlay or download. The toolbar and right-click actions are
>   fallbacks on those sites.
> - Per-site show/hide choices use `chrome.storage.local`; they stay in that
>   browser profile and are not synced to a Google account.
> - Works in Edge/Brave/other Chromium browsers the same way (`edge://extensions` etc.).
