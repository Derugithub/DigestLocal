# DigestLocal

## Overview

DigestLocal is an Expo React Native app for offline reading. You paste a public URL, the app downloads that page and its article images once, extracts the article, and stores the text in a SQLite database on the device. Images are saved as files under the app's document directory. After that, reading, text-to-speech, summaries, and quizzes use the saved copy and do not download images again.

There is no account, no custom backend, and no cloud sync. You can also share a link from another app.

## Features

- Library of saved articles, with title, site, and saved date
- Search over the saved title, the site name, and the plain-text body
- Share a link from another app into the add screen
- Empty shelf state with a control to paste a URL
- One-time fetch of a public HTML page, with a visible label while the network is in use
- Readability-style extraction into sanitized HTML for the reader, plus plain text for listening, study, search, and word counts
- Reader that keeps headings, lists, quotes, inline formatting, and in-content images with captions
- Listen mode using the operating system speech synthesizer (`expo-speech`), with play and pause
- On-device extractive summary and concept quiz (`heuristic-v2`), stored on the article
- A study-engine interface so a later on-device model can replace the heuristic without changing storage
- Light, dark, and system themes
- Settings with the theme control, a short about note, and a network-use note

## Requirements

- Node.js 20 or newer (the manual EAS workflow uses Node.js 24)
- npm
- An Expo development build, or Expo web, for day-to-day work
- For an EAS build: an Expo account, `eas init` to link a project, and a repository secret named `EXPO_TOKEN`

This project targets Expo SDK 57.

## Getting started

```bash
npm ci
npx expo start
```

- `w` opens the web app
- Android and iOS development builds use the `development` profile in `eas.json`
- `expo-dev-client` is the first plugin in `app.json`

The native modules in this app (`expo-sqlite`, `expo-speech`, `expo-font`, `expo-file-system`, `expo-image`) are part of the Expo SDK. A development build is the intended install path because the project includes `expo-dev-client`. Image files need `expo-file-system` in that build.

## Scripts

| Script | Command |
| --- | --- |
| Start | `npm start` |
| Web | `npm run web` |
| Android | `npm run android` |
| iOS | `npm run ios` |
| Tests | `npm test` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Expo Doctor | `npx expo-doctor` |

## Saving a page

1. Tap **Paste a URL**. The add screen opens first, then DigestLocal reads the clipboard with `expo-clipboard`. Opening the screen first keeps Android's first "pasted from clipboard" notice from dropping the navigation and returning to the shelf. An `http` or `https` link fills the URL field, so **Fetch page** is one more tap. If the clipboard is empty or has no link, the add screen says so and focuses the field for typing.
2. If that URL is already stored, DigestLocal opens the saved article and does not contact the network.
3. If it is new, the app fetches the HTML once, then downloads the in-content images during that same fetch. The add screen labels that as network use. On iOS and Android the page request sends `User-Agent: DigestLocal/1.0 (offline article reader)`, `Accept: text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8`, and `Accept-Language: en`. Each image request sends that same user agent, an `Accept` header for image types, and `Referer` set to the article URL. Web keeps the browser user agent and does not set a custom user agent or referrer. At most 30 images are saved, 8 MB each, with a 20 second timeout. Only an `image/*` response is stored. SVG and HTML are rejected. Tracking pixels (1×1 and 2×2), icon-sized images (both sides 32 pixels or less), icon and sprite URLs, and ad images are skipped.
4. `@mozilla/readability` extracts the article. A fallback runs when Readability does not return enough text. The saved copy keeps sanitized HTML (headings, lists, quotes, bold, italic, links, code, and figures with captions) and a plain-text copy. Captions are included in the plain text. Alt text is not. Scripts, styles, and ad blocks are removed. The reader draws the HTML with native views, not a web view. Each image stays in its original position, scales to the content width, and keeps its aspect ratio. If a file is missing or fails to decode, the reader shows "Image unavailable" and the alt text, and still shows the caption.
5. The title, site, plain text, HTML, URL, and timestamp are written to SQLite when you tap **Keep on this device**. Image files are already in the document directory from the fetch, one folder per article (`articles/<id>/`). The HTML refers to them as `digest-image:<filename>`, not a `file://` path. Saving the preview does not start another request. Leaving the add screen or tapping **Discard** before keep deletes that folder. Removing an article deletes its folder too.

Listening, summaries, quizzes, and library word counts keep using the plain text. Articles saved before structured HTML existed have an empty HTML column and still open as plain paragraphs.

The app does not run scripts from the page. Browsers may block the fetch because of CORS. iOS and Android fetch the page directly. Some sites refuse non-browser clients or return a shell that has no article text.

## Search

Shelf search matches a saved article when the query is a substring of any of these:

- the title
- the site name
- the plain-text body in `articles.content`

Title and site stay in the list query and are matched in memory with `toLowerCase`, so that check is case-insensitive for the letters JavaScript folds. The body is not loaded with the list. A SQLite `LIKE` on `content` returns the matching ids. `%`, `_`, and `\` in the query are escaped and matched as literal characters. SQLite `LIKE` is case-insensitive for Latin letters.

Search does not look at `content_html`, `summary`, or `quiz_json`.

`expo-sqlite` includes FTS5. DigestLocal uses `LIKE` so a query can match the middle of a word, which is how title and site search already worked, and so the plain-text column does not need a second index.

## Share a link

From another app, share text to DigestLocal. The add screen opens with the first `http` or `https` URL from that share already in the field. **Fetch page** and **Keep on this device** then work the same way as **Paste a URL**. If the share has no link, the add screen says so and focuses the field. Cold start and warm start both land on that screen.

Android registers `android.intent.action.SEND` for `text/plain`. iOS adds a share extension for text, web URLs, and web pages. Both come from the `expo-share-intent` config plugin (SDK 57). The extension only hands the text to DigestLocal. It does not download the page. Sharing needs a new native build. Expo Go cannot receive the share.

`expo-clipboard` is a native module. Install a new development build before **Paste a URL** can read the clipboard. On an older build the button checks for `ExpoClipboard` first and does not import the package, so Metro does not log `Cannot find native module 'ExpoClipboard'`. It opens the add screen, says the clipboard could not be read, and focuses the field. Search and the text layout load from Metro. Saving and showing article images needs `expo-file-system` and `expo-image` in the native binary.

## Local data

The database file is `digestlocal.db`, opened with `expo-sqlite`.

`articles`

| Column | Role |
| --- | --- |
| `id` | Text primary key |
| `url` | Saved URL, unique |
| `title` | Extracted title |
| `site` | Host name |
| `content` | Plain article text, used for listening, study, search, and word counts |
| `content_html` | Sanitized article HTML for the reader. Null on articles saved before this column existed |
| `saved_at` | Unix time in milliseconds |
| `summary` | Extractive summary, null until generated |
| `quiz_json` | Quiz JSON, null until generated |

Theme choice is stored separately with `expo-sqlite/kv-store`. Nothing in this schema is synced.

Article images are not in this database. They are files in the app document directory, under `articles/<id>/`, written with `expo-file-system` during the same fetch as the page. A failed image download is stored as `digest-image:missing` so the reader can show a fallback without requesting that URL later. If the file module is unavailable, the article text is still saved and those images show as unavailable.

## Summary and quiz

`src/lib/study.ts` exports `getStudyEngine()`. The current engine, `heuristic-v2`, ranks sentences on the device and writes a short extractive summary plus a multiple-choice quiz. The number of questions follows how many main points the article has, from 2 up to 8 when the text supports it. Questions ask why something is so, what an idea means, how ideas relate, or which statement is a main point. They are not fill-in-the-blank or “which passage appears” checks. Generating either result stores both on the article. The engine does not call a language model. A later on-device model can replace `getStudyEngine()`; screens already persist whatever summary string and quiz JSON the engine returns.

## Listening

Listen mode speaks the saved text with `expo-speech`. Playback is split into passages so pause and resume have a place to continue. Pause stops the current utterance. Resume starts again at the current passage. Android does not offer a native pause API for `expo-speech`, so resume repeats that passage. iOS devices in silent mode will not play speech.

## Themes

Settings offers System, Light, and Dark. System follows the device color scheme. The choice is kept on device.

## EAS builds

`eas.json` defines:

- `development`: `developmentClient` and `distribution: internal`
- `preview`: `distribution: internal`
- `production`: `autoIncrement`

`.github/workflows/build.yml` is a manual workflow (`workflow_dispatch` only). It checks out the repo, uses Node.js 24, sets up EAS with npm and `eas-cache: false`, runs `npm ci`, and starts an Android build:

```bash
eas build --platform android --profile <preview|development|production> --non-interactive --no-wait
```

The workflow needs the `EXPO_TOKEN` secret. This repository does not contain an EAS project id. Run `eas init` and link the project before a non-interactive build can succeed.

Splash background colors are `#F7F2EA` in light mode and `#2A2A2A` in dark mode. Those colors, and the share target, are native configuration. They show up on the next EAS or development build. Search is JavaScript and does not add a native module. Article images add `expo-file-system`. `expo-image` was already a dependency and has to be in the binary to draw the files. A build from before those modules were linked cannot store or show images. The save flow still keeps the text if file storage throws.

## Project structure

```text
src/app/            Library, add, reader, settings, and the native share redirect
src/components/     Shared UI, listen, study, and incoming share
src/lib/            SQLite, fetch, extraction, and the study engine
src/theme/          Light and dark palettes
tests/              Extraction, URL, and study tests
eas.json            EAS build profiles
.github/workflows/  Manual Android EAS build
```

## License

MIT. See [LICENSE](LICENSE).
