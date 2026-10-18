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
- Settings with the theme control, a privacy and ads note, and a short about note

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

The native modules in this app (`expo-sqlite`, `expo-speech`, `expo-font`, `expo-file-system`, `expo-image`, `react-native-google-mobile-ads`) need a development build. Expo Go does not include the Google Mobile Ads SDK. Image files need `expo-file-system` in that build. Ads need a new native build after this module is added:

```bash
npx eas-cli@latest build --profile development --platform android
```

Do not run that command until you mean to start a build. Development and preview profiles request Google's test ads. Never put live ad unit IDs in a development build, and never click live ads.

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
3. If it is new, the app fetches the HTML once, then downloads the in-content images during that same fetch. The add screen labels that as network use. On iOS and Android the page request sends `User-Agent: DigestLocal/1.0 (offline article reader)`, `Accept: text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8`, and `Accept-Language: en`. Each image request sends that same user agent and an `Accept` header for image types, and sends no `Referer`. A 401 or 403 is retried once with `Referer` set to the article origin only (scheme and host). Web keeps the browser user agent and does not set a custom user agent. At most 30 images are saved, 8 MB each, with a 20 second timeout. Only an `image/*` response is stored. SVG and HTML are rejected. Tracking pixels (1×1 and 2×2), icon-sized images (both sides 32 pixels or less), icon and sprite URLs, and ad images are skipped.
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

## Privacy and ads

Saved articles stay on the device. DigestLocal has no account and no cloud library. Reading, listening, summaries, and quizzes use that saved copy.

From the second session, after at least one article is saved, the app can load ads with Google AdMob and the User Messaging Platform (UMP) consent form. The first session does not initialize either SDK and does not show ads. Requests ask for non-personalized ads. Article text, saved links, and quiz results are not sent with an ad request.

Settings links to the privacy policy at https://derugithub.github.io/Privacy-policy/digestlocal/ and to support at movadmob@gmail.com.

A rewarded ad can turn off banners and full-screen ads for 1 hour. Passes stack up to 3 hours, with at most 6 passes on a local day. After a pass expires, the next interstitial waits 5 minutes. Banners can return as soon as the pass ends. The quiz shows the score first. An optional rewarded ad can then add the next 3 unanswered questions, up to 8 in the set. That offer is limited to 8 rewards a day. The first 3 questions stay free.

A build-time flag, `EXPO_PUBLIC_PRO_ENABLED` or `extra.proEnabled`, defaults to off. While it is off, Settings does not offer a purchase and the stored entitlement is ignored. The entitlement module remains in the project for a later build that turns the flag on. Google Play Billing is not connected.

Contributors should use test ads only. `__DEV__` and the `development` and `preview` EAS profiles set test mode, which requests Google's `TestIds` ad units. Do not click live ads, and do not ask testers to click them. The privacy policy URL, the support email, and the developer domain are set.

The real AdMob IDs are set. Every build uses the real Android app ID `ca-app-pub-4342572133101591~7238447832`, as Google recommends together with test ad units. Only `production` (`ADS_MODE=live`) requests these units:

| Placement | Where | Unit ID |
| --- | --- | --- |
| `shelf_banner` | Anchored banner under the shelf | `ca-app-pub-4342572133101591/5889882153` |
| `article_end_banner` | Inline banner at the end of an article | `ca-app-pub-4342572133101591/7526222443` |
| `save_interstitial` | Interstitial after a save | `ca-app-pub-4342572133101591/3978034680` |
| `study_rewarded` | Rewarded ad (ad-free pass, quiz questions, extra speeds) | `ca-app-pub-4342572133101591/3387841891` |

The app ID is in `app.json` (the config plugin `androidAppId` and the root `react-native-google-mobile-ads.android_app_id`) and in the `production` env of `eas.json` as `ADMOB_ANDROID_APP_ID`. The unit IDs are in `src/lib/ads/production-unit-ids.js`. `docs/monetization/app-ads.txt` has the real publisher line.

`docs/monetization/` has the Play Data safety notes, the placement table, and an `app-ads.txt` template. The template has to be hosted at the root of the developer domain, not only inside this repository.

## EAS builds

`eas.json` defines:

- `development`: `developmentClient`, `distribution: internal`, and `ADS_MODE=test`
- `preview`: `distribution: internal` and `ADS_MODE=test`
- `production`: `autoIncrement`, `ADS_MODE=live`, `ADMOB_ANDROID_APP_ID`, and `buildArtifactPaths` for the R8 `mapping.txt`

`cli.appVersionSource` is `remote`, so EAS keeps the Android `versionCode` on its servers. Each `production` build increments it. `app.json` has no `versionCode`. The version name stays `1.0.0`.

`.github/workflows/build.yml` is a manual workflow (`workflow_dispatch` only). It checks out the repo, uses Node.js 24, sets up EAS with npm and `eas-cache: false`, runs `npm ci`, and starts an Android build:

```bash
eas build --platform android --profile <preview|development|production> --non-interactive --no-wait
```

The workflow needs the `EXPO_TOKEN` secret. The EAS project id is in `app.json` under `extra.eas.projectId`. `app.config.ts` stops any build whose AdMob Android app ID is missing, a placeholder, or Google's sample ID, and stops a live build when a placement in `src/lib/ads/production-unit-ids.js` has no real unit ID.

`react-native-google-mobile-ads` 17.2.0 reads a root-level `react-native-google-mobile-ads` object in `app.json` while Android configures. That object sits next to `expo`. Its `android_app_id` is what the library's Gradle script turns into `googleMobileAdsJson`. `app.config.ts` resolves the Android app ID for the Expo plugin: `ADMOB_ANDROID_APP_ID` when set, otherwise the plugin value in `app.json`. It is the real ID in every mode. The sample iOS app ID is commented out and kept for a future iOS release. Android is the only ad target for now. EAS Build and local `prebuild` / `run:android` / `run:ios` write the resolved Android ID into the root block before Gradle reads the file, and that rewrite drops the commented iOS lines so Gradle can parse `app.json`. Do not commit that rewrite.

Splash background colors are `#F7F2EA` in light mode and `#2A2A2A` in dark mode. Those colors, and the share target, are native configuration. They show up on the next EAS or development build. Search is JavaScript and does not add a native module. Article images add `expo-file-system`. `expo-image` was already a dependency and has to be in the binary to draw the files. A build from before those modules were linked cannot store or show images. The save flow still keeps the text if file storage throws.

## Local Android build

`.github/workflows/local-build.yml` builds Android on the GitHub-hosted Ubuntu runner with `eas build --local`. The build runs on that runner, so it leaves the Expo account's EAS cloud build quota unused. The workflow runs only when someone starts it from the Actions tab.

1. Open the **Actions** tab.
2. Choose **Local Android build**.
3. Choose **Run workflow**.
4. Select a profile: `development`, `preview`, or `production`. The default is `preview`.
5. When the run succeeds, open the run and download the file under **Artifacts**.

The workflow reads `eas.json` and writes `./build-output/app-<profile>.apk`, or `.aab` when that profile builds an Android App Bundle. In this repository, `development` and `preview` are APKs. `production` is an AAB.

It uses the same `EXPO_TOKEN` secret as `.github/workflows/build.yml`. EAS downloads the Android keystore from the Expo account with that token. The selected profile's `env` in `eas.json`, including `ADS_MODE`, is applied by the EAS CLI. The workflow uploads the app file only. The R8 `mapping.txt` is embedded in the AAB, so Play reads it from the bundle.

## Release build settings

- R8: `expo-build-properties` sets `enableMinifyInReleaseBuilds` and `enableShrinkResourcesInReleaseBuilds`. The only extra keep rule is `-keep class com.google.android.gms.internal.consent_sdk.** { *; }` for the UMP consent SDK. Expo modules, Reanimated, Worklets, Screens, and Google Mobile Ads ship their own consumer rules. Release builds write `android/app/build/outputs/mapping/release/mapping.txt`. The `production` profile lists it in `buildArtifactPaths`, so an EAS cloud build offers it as an extra download. For a manual upload, Play Console has it under App bundle explorer, the version, Downloads, ReTrace mapping file.
- Edge-to-edge: Expo SDK 57 draws edge-to-edge by default. There are no status or navigation bar colours in `app.json` or code. `expo-system-ui` sets the root background, and `expo-status-bar` icons follow the theme. Screens pad all four safe-area insets, and the Pro sheet uses translucent system bars with insets.
- Large screens: `orientation` is `default`, with no orientation lock. Content is capped at 720 px and centred. The Pro sheet is capped at 560 px and scrolls only when the window is too short.

## Project structure

```text
src/app/            Library, add, reader, settings, and the native share redirect
src/components/     Shared UI, listen, study, incoming share, and the ad banner
src/lib/            SQLite, fetch, extraction, the study engine, ads, and the entitlement flag
src/lib/ads/        Ad policy, consent, AdMob app ID resolution, and production unit IDs
src/theme/          Light and dark palettes
docs/monetization/  Ad placement notes, Data safety notes, and the app-ads.txt template
tests/              Extraction, URL, study, ad-policy, and AdMob config tests
eas.json            EAS build profiles
.github/workflows/  Manual Android EAS builds (cloud and local)
```

## License

MIT. See [LICENSE](LICENSE).
