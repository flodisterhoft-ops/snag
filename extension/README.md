# Snag for Chrome

Companion extension for the [Snag](../README.md) downloader. It adds:

- A translucent **download button** over supported, visible HTML5 video players
- An animated in-page picker for quality, file type, audio tracks, and live progress
- A **toolbar button** that sends the current page to Snag
- **Right-click menus**: download this page / this video / a link with Snag
- A per-site off switch: right-click → *Show/hide Snag button on this site*
- Optional **signed-in downloads**: when enabled in Snag (*Settings → Browser → Use my browser
  logins*), the extension exports your cookies for YouTube/Google, X, Vimeo, Twitch, Patreon,
  Reddit, Dailymotion, Instagram, Facebook, and TikTok to the paired Snag app every 30 minutes
  (the `cookies` permission). Nothing is sent anywhere else; Snag keeps one local file and
  deletes it when you turn the option off or click *Forget saved logins*.

The in-page picker talks only to the running Snag app on localhost; the
extension itself downloads nothing. `snag://` remains a fallback when Snag is
not running. Per-site preferences are stored locally in Chrome and are not
synced to a Google account.

## Install

1. Install and launch the **Snag** desktop app.
2. Click **Install in Chrome** on the first-launch prompt or under *Settings → Browser*. Snag
   prepares a stable extension folder, copies its path, and opens your default Chromium
   browser's extensions page (Chrome, Edge, or Brave).
3. Turn on **Developer mode** (top-right), click **Load unpacked**, paste the path, confirm.
   Snag shows a live checklist and confirms as soon as the extension connects.
4. Reload video tabs that were already open so Chrome injects the new extension.

Repository builds can load this `extension` folder directly the same way.

## Publishing to the Chrome Web Store (optional, makes the install one click)

Chrome only installs extensions automatically when they come from the Web Store. To offer that:

1. Run `npm run pack:extension` — it writes `dist/snag-chrome-extension-<version>.zip` with the
   manifest `key` kept, so the store assigns the same pinned ID Snag already trusts.
2. Upload the zip at <https://chrome.google.com/webstore/devconsole> (one-time developer fee).
3. After it is published, set `CHROME_WEB_STORE_PUBLISHED` to `true` in
   `src/shared/browserIntegration.ts` and release Snag. From then on **Install in Chrome**
   registers the extension with Chrome (per-user registry entry) and opens the store page; Chrome
   downloads it by itself and only asks the user once to enable it. Pairing needs no token because
   the pinned ID is what Snag's local API trusts.

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
> - If the browser reports that the folder Snag shows does not exist, Snag was started inside
>   another app's sandbox and Windows redirected its files. Snag's Settings screen shows the
>   real folder and a **Restart Snag normally** button; a normal start from the Start menu
>   fixes the paths and the `snag://` registration.
