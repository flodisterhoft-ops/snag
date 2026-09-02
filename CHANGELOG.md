# Changelog

Every published Snag update is recorded here. The same release notes are shown
inside Snag before an update is installed.

## 1.8.5 — 2026-09-01

- Trim before downloading: **Download only a section** shows an in-app preview player with draggable in/out handles, exact timecode fields, frame nudges, and a precise-cut option, then downloads just that range (file names carry the time range).
- Signed-in downloads: **Settings → Browser → Use my browser logins** lets age-restricted, members-only, and subscriber videos download. The Snag extension exports the logins of supported sites to Snag over the paired local connection; Firefox and a cookies.txt file are the other sources. Nothing leaves the machine and **Forget saved logins** deletes the export.
- SponsorBlock: per category, keep, mark as a chapter, or cut sponsors, self-promotion, intros, outros, previews, interaction reminders, non-music sections, and filler.
- Queue: pause and resume (partial files continue where they stopped), drag cards to reorder the download order, Pause all / Resume all, and **Open when done**.
- Paste several links at once and queue them all with your defaults; the finished files name the jobs.
- Finished-download toasts now have **Open** and **Show in folder** buttons.
- Clipboard watch: a link copied anywhere while Snag is open is offered immediately, and video links are analyzed ahead of time.
- Global shortcut Ctrl+Shift+D analyzes the clipboard link from anywhere.
- yt-dlp updates itself quietly in the background (never during a download); turn it off under Engine.
- Light theme (System / Dark / Light under General) and the quick dialog remembers the size you resize it to.
- One-button Chrome extension setup: **Install in Chrome** (or Edge/Brave, whichever is your default browser) prepares everything, copies the folder path, opens the browser's extensions page, and shows a live checklist that turns green by itself once the extension connects. The first-launch prompt uses the same flow. A `pack:extension` script and the `CHROME_WEB_STORE_PUBLISHED` switch prepare a fully automatic install once the extension is published in the Chrome Web Store.
- Reorganize Settings into six short tabs (General, Speed, Files, Languages, Browser, Engine) instead of one long page; links from the extension and from notices open the right tab.
- Chrome panel: it now stays pinned where it opened instead of drifting with the page and vanishing when you scroll, and no longer jumps around while YouTube finishes laying out the page.
- Chrome button: it avoids covering player controls (YouTube Shorts keeps mute, captions, and more in the top-right corner) by moving down the video edge when something clickable is underneath, waits for the player to hold still before appearing, and stays inside the visible part of a partly scrolled video.
- Faster panel: the video title and thumbnail show instantly from the page, hovering the button starts the analysis, and analyses are shared between the extension, the quick dialog, and the app for ten minutes so a second look at the same video is immediate.
- The extension's background timer now idles on pages without a video.
- Detect when Snag was started inside another app's sandbox (for example from a terminal embedded in an AI assistant). Windows silently keeps such a session's files in that app's private folder, so the Chrome extension folder Snag showed did not exist for Chrome and `snag://` links never reached the real registry. Snag now shows the folder Chrome can actually open, explains what happened, and offers **Restart Snag normally**; a normal restart also imports the settings, download history, and pairing token from the sandboxed session and keeps any extension copy Chrome loaded from there up to date.
- Show whether the Chrome extension is connected (with its last heartbeat) directly in Settings, add **Open extensions page** and **Show folder** shortcuts, and copy the folder path through the app so it works even when the window is not focused.
- Open the extensions page in Microsoft Edge or Brave when Google Chrome is not installed.
- Stop the extension setup prompt from reappearing after **Not now** every time a setting changes.
- Let the custom yt-dlp path contain spaces again (it was trimmed on every keystroke), and stop **Custom** file-name patterns from silently gaining a trailing space in every file name.
- Keep the speed-limit field editable while typing; the value is applied when you leave the field.
- Home and the quick dialog now follow a changed default folder until you pick a different one.
- Close the quick download dialog with Esc; stack its folder and download controls so the path stays readable.
- Attach the folder picker to the window that opened it instead of a possibly hidden window.
- Analyze playlist links faster by probing the playlist alongside the video.
- Do not grant cross-origin access on the local API to anything but the extension, so websites cannot detect Snag.
- Re-validate settings on every save, let long Settings descriptions wrap, and remove leftover styles from earlier designs.

## 1.8.4 — 2026-07-26

- Regenerate the Chrome extension's identity key so it is held by the Snag project rather than an outside contributor. The extension's pinned ID changes as a result.
- If Chrome is open when Snag updates, the extension switches to its new identity automatically — you may just see a leftover disabled "Snag for Chrome" entry in `chrome://extensions`, which is safe to remove.
- If Chrome was closed during the update and the extension shows an error on the next launch, remove the old entry and use **Load unpacked** on Snag's extension folder once (Snag's Settings screen shows the folder location). Pairing keeps working either way; per-site disable preferences reset.

## 1.8.3 — 2026-07-12

- Replace the Chrome audio picker’s full language list with a clean preferred-language prompt for new users.
- Open Snag’s Settings directly from that prompt and show only configured preferred languages afterward.

## 1.8.2 — 2026-07-12

- Make download buttons on large YouTube homepage hover previews analyze the linked video instead of the homepage.
- Canonicalize YouTube preview links to avoid unnecessary playlist analysis.
- Keep repeated browser handoffs moving even when the same URL is sent twice.
- Release the hidden quick-download window after ten idle minutes to reduce background memory use.
- Validate saved settings without overwriting deliberately empty language selections.
- Let the Chrome extension start Snag and hand the video to the app without opening duplicate pickers.
- Restrict local API pairing to Snag's pinned Chrome extension ID. Existing users may need to load Snag's refreshed extension folder once because Chrome treats the pinned identity as a new extension.

## 1.8.1 — 2026-07-12

- Open MKV downloads as playable Telegram media without re-encoding or changing the original file.
- Prevent rapid duplicate Telegram share requests.
- Prefetch YouTube format details when the in-video button appears so the quality picker opens much faster when clicked.

## 1.8.0 — 2026-07-12

- Redesign the Chrome quality picker into a compact single-decision panel: a quality list with inline MP4/MKV/WEBM chips, a sliding Video/Audio toggle, and a Download button that collapses into in-place progress.
- Default the video container automatically — MKV when merging multiple audio languages, MP4 otherwise — instead of asking every time.
- Add a Cancel action to the in-page download progress view.
- Move audio-language preferences out of the picker and into Settings as selectable pills, applied automatically whenever a video offers those languages.

## 1.7.2 — 2026-07-11

- Restore the update dialog after it is hidden while a download continues.
- Recover completed installers from the updater cache after Snag restarts.
- Revalidate cached update versions so a rapid follow-up release is not mistaken for the latest one.
- Record updater activity in `updater.log` for easier diagnosis.

## 1.7.1 — 2026-07-11

- Compact Chrome file-type tiles into two lines with size as the primary text.
- Move the Download action beside the Video/Audio toggle and fill the remaining width.
- Show only the top three quality sections initially, with lower tiers behind More qualities.

## 1.7.0 — 2026-07-11

- Detect the Chrome extension through an authenticated heartbeat.
- Prompt first-time users with guided setup, Not now, and Don’t show again choices.
- Add separate Clear list and confirmed Delete downloaded files queue actions.
- Add per-download permanent deletion with confirmation.
- Add Windows file sharing so Telegram, WhatsApp, and other registered share targets can receive the actual downloaded file.

## 1.6.3 — 2026-07-11

- Prepare the stable Chrome-extension folder automatically on first app launch.
- Refresh it on every later launch, without a Settings button press.
- Clarify that Chrome's Load unpacked approval is required only once.

## 1.6.2 — 2026-07-11

- Show each release's “What’s new” notes in the in-app update dialog.
- Add automatic Chrome-extension reloads after future Snag app upgrades.
- Package this changelog with the desktop application.

## 1.6.1 — 2026-07-11

- Group MP4, MKV, and WebM choices inside full-width quality cards.
- Make the Chrome Download button match the quality-card width.

## 1.6.0 — 2026-07-11

- Morph the Chrome button into an in-page quality picker.
- Add live download percentage, speed, ETA, processing, and completion states.
- Recommend MP4 normally and MKV for multiple audio tracks.
- Only mark a file “Smallest” when the difference is meaningful.

## 1.5.3 — 2026-07-11

- Restore the missing Windows notification-area icon with a packaged fallback.

## 1.5.2 — 2026-07-11

- Repair Chrome pairing, YouTube overlay stability, language favorites, and accessibility.

## 1.5.1 — 2026-07-11

- Add direct X/Twitter feed-video support.
