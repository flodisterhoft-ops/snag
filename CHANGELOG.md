# Changelog

Every published Snag update is recorded here. The same release notes are shown
inside Snag before an update is installed.

## 1.8.7 — 2026-09-02

- Queue cards read cleaner: the status word (Completed, Downloading, Paused, …) sits on the right above the buttons, and finished downloads no longer list the file path under the title; the "Show in folder" button's tooltip still shows where the file went.
- Chrome extension: the Share button in the panel opens a small chooser that slides out beside the panel (to the left when the panel sits at the window edge), listing Telegram, the Windows share panel, and your own apps with their logos, instead of a row of chips inside the panel.
- Settings: every format and engine option shows a short explanation the moment the pointer rests on it, and the recommended option (Built-in, MP4, MP3) carries a small green star inside its button instead of a caption above.
- Fix: the Windows share panel never opened from the Share buttons ("Windows could not open the Share panel for this file"); the helper script used a path command that Windows PowerShell 5.1 rejects. The message now also says when the file is gone or the file type has no Share entry.
- The share-app menu in the queue and on the Download page is no longer cut off at the bottom of the window or the list: it floats above everything and opens upward when there is no room below.
- Settings: the share apps are compact rows (logo, name, switch) with a centered "Add an app" button instead of wide cards with descriptions; "Recommended" is a green caption above the suggested download engine, video container, and audio format instead of a tag inside the button; the naming pattern presets and the file-name preview share one line.
- Simpler Download page: everything sits in one card that fits the window without scrolling. The quality table shows every resolution as a row and the MP4, MKV, and WebM file sizes side by side, so you click the size you want; **All formats** still opens the detailed stream table. Options moved to a side column as check rows (Trim, Subtitles, Whole playlist, Open when done, Share when done) with the save folder and one large Download button underneath; the chosen quality, container, and size are summarized above the button.
- **Share buttons everywhere, with your own apps.** Next to Download on the Download page, in the quick dialog, and in the Chrome panel there is a small Share button: the file downloads and is then handed to a share app. The queue's Share button does the same for finished files. **Settings → General → Sharing & playback** lists the apps: Telegram (when installed), the Windows share panel (Phone Link, Bluetooth, Mail, WhatsApp, …), and any program you add yourself; with more than one enabled and "Ask which app every time" on, a row of apps slides out first.
- **Play button in the queue.** Finished downloads get a Play button that opens the file in VLC when it is installed, otherwise in the Windows default player; "Open when done" uses the same player.
- The quick dialog uses the same table and keeps its Download button in view while the list scrolls.
- Chrome extension: every YouTube thumbnail (recommendations, search results, the home grid, playlists) gets a small Snag button in its top-left corner while you hover it, so any video can be downloaded without opening it. Links to YouTube videos on other sites get the same button.
- Chrome extension: the button on a player no longer slides under YouTube's fixed top bar when you scroll, and it goes below the whole group of overlay controls (mute, captions) instead of squeezing in between them; a corner without controls (Shorts) keeps it in the top-right corner.
- Chrome extension: when Snag is not running, the panel starts it (`snag://open`, Chrome may ask once to allow it) and continues by itself once the app is up, instead of stopping at an "Open Snag" button.
- Chrome extension: pressing Download makes the thumbnail fly into a small progress toast in the bottom-right corner of the page (speed, ETA, percent, cancel), which turns into a green check when the file is saved and fades away; the panel closes right away.
- Fix: the local connection between the Chrome extension and Snag was broken in 1.8.5 (every request stalled), so the in-page panel kept saying "Snag isn't running" even while it was; the extension talks to Snag again and reloads itself once it sees this version. It now also reloads whenever Snag refreshes the extension folder, not only on a version change.
- Chrome extension: the picker panel is back to its normal size (only the corner progress toast grows on wide screens). It now opens from the button that was clicked and stays attached to that spot on the page: it scrolls with the page and folds away once it has scrolled out of view, leaving the plain button.
- Faster reading of YouTube links: analysis asks the default player clients first (about a third quicker) and only falls back to the wider client set when that fails, and hovering a video card for a moment already starts reading it so the panel is usually ready when clicked. Dubbed audio tracks are unaffected (verified on a 24-language video).
- Chrome extension: on YouTube's home page and sidebars the card's own button (top-left) now stays put for the whole hover, including while the inline preview plays; the preview no longer gets a second button that appeared late, jumped to the bottom-right corner, or flickered between spots. Card-sized links are no longer mistaken for overlay controls. The buttons are round now, in the style of YouTube's own overlay buttons, with the green arrow kept.
- Chrome extension: the button keeps its home in the top-right corner. When a player shows controls there (mute and captions on hover previews), it moves left to sit beside them instead of dropping below, and it is placed by the visible part of a cropped preview rather than the hidden video box. The panel and the progress toast grow with the screen (up to 1.6x on wide 4K desktops), and the toast names the finishing step ("Merging video and audio", "Converting audio", "Embedding subtitles", ...), as does the queue.
- Fix: finished files whose names contain an en dash or other non-ASCII characters (many YouTube titles) could not be opened, played, or shared from the queue, because yt-dlp reported the file name in the Windows code page and characters were lost. yt-dlp now writes UTF-8, and Snag repairs the stored names of earlier downloads on start. Error messages in the queue wrap instead of being cut off.
- Settings, clearer: the download engine and connection boost explain themselves and show the live connection count, video and audio formats are one-line choices with a “recommended” tag and a tooltip per option, preferred audio languages use the same pill-and-drawer picker as subtitles, share apps are cards with their logos (custom apps show their own icon and the picker opens in the Start Menu, resolving shortcuts), and the player can be switched between VLC and the Windows player.
- The share menus in the queue and on the Download page are stacked lists with app logos and an “Add an app…” entry.
- Settings: the save-folder button sits on its row, the redundant "Maximum speed" preset is gone (the Normal/Fast/Turbo/Max choice covers it), preferred languages list English, German, and Russian first, and the default subtitle language is a pill that opens a language drawer instead of a text field.
- **aria2 download engine** (Settings → Speed → Download engine): Snag now bundles aria2c and can fetch plain files (Vimeo, X, direct links, hosts that cap each connection) with up to 16 connections at once, following the Connection boost setting. Speed limit, cookies, pause and resume, and the progress display keep working; YouTube-style DASH and HLS streams stay on the built-in engine, which already downloads those in parallel.
- Taskbar and tray: Snag's taskbar button shows a progress bar and a numbered badge while downloads run (paused downloads show the yellow paused bar), and the tray icon gets a dot.

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
