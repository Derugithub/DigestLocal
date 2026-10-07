# DigestLocal

## Overview

DigestLocal is an Expo React Native app for offline reading. You paste a public URL, the app downloads that page once, extracts the article text, and stores it in a SQLite database on the device. After that, reading, text-to-speech, summaries, and quizzes use the saved copy.

There is no account, no custom backend, and no cloud sync.

## Features

- Library of saved articles, with title, site, and saved date
- Empty shelf state with a control to paste a URL
- One-time fetch of a public HTML page, with a visible label while the network is in use
- Readability-style extraction into local plain text
- Reader with the saved article
- Listen mode using the operating system speech synthesizer (`expo-speech`), with play and pause
- On-device extractive summary and multiple-choice quiz (`heuristic-v1`), stored on the article
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

The native modules in this app (`expo-sqlite`, `expo-speech`, `expo-font`) are part of the Expo SDK. A development build is the intended install path because the project includes `expo-dev-client`.

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

1. Paste an `http` or `https` URL.
2. If that URL is already stored, DigestLocal opens the saved article and does not contact the network.
3. If it is new, the app fetches the HTML once. The add screen labels that request as network use.
4. `@mozilla/readability` extracts the article. A paragraph fallback runs when Readability does not return enough text.
5. The title, site, text, URL, and timestamp are written to SQLite. Saving the preview does not start another request.

The app does not run scripts from the page. It stores the text returned in the HTML. Browsers may block the fetch because of CORS. iOS and Android fetch the page directly. Some sites refuse non-browser clients or return a shell that has no article text.

## Local data

The database file is `digestlocal.db`, opened with `expo-sqlite`.

`articles`

| Column | Role |
| --- | --- |
| `id` | Text primary key |
| `url` | Saved URL, unique |
| `title` | Extracted title |
| `site` | Host name |
| `content` | Article text |
| `saved_at` | Unix time in milliseconds |
| `summary` | Extractive summary, null until generated |
| `quiz_json` | Quiz JSON, null until generated |

Theme choice is stored separately with `expo-sqlite/kv-store`. Nothing in this schema is synced.

## Summary and quiz

`src/lib/study.ts` exports `getStudyEngine()`. The current engine, `heuristic-v1`, ranks sentences on the device and writes a short extractive summary plus up to four multiple-choice questions. Generating either result stores both on the article. A later on-device model can replace `getStudyEngine()`; screens already persist whatever summary string and quiz JSON the engine returns.

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

## Project structure

```text
src/app/            Library, add, reader, and settings routes
src/components/     Shared UI, listen, and study panels
src/lib/            SQLite, fetch, extraction, and the study engine
src/theme/          Light and dark palettes
tests/              Extraction, URL, and study tests
eas.json            EAS build profiles
.github/workflows/  Manual Android EAS build
```

## License

MIT. See [LICENSE](LICENSE).
