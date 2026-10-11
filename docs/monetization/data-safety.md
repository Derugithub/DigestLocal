# Play Data safety notes for DigestLocal ads

Source: [Play data disclosure for the Google Mobile Ads SDK](https://developers.google.com/admob/android/privacy/play-data-disclosure).

DigestLocal does not run its own analytics or crash SDK. The notes below are for the Google Mobile Ads SDK and the User Messaging Platform (UMP), which start on session 2 for people who are not Pro.

## Collected and shared

The Google Mobile Ads SDK collects and shares the following, for advertising, analytics, and fraud prevention. Data is encrypted in transit.

| Play category | Data | Notes |
| --- | --- | --- |
| Location | Approximate location | Derived from IP address |
| App activity | App interactions | Ad views and taps |
| App info and performance | Diagnostics | SDK diagnostics |
| Device or other IDs | Device or other IDs | Advertising ID and app set ID |

Users can reset or delete the advertising ID in Android settings.

## Not collected

Article text, saved URLs, titles, summaries, and quiz results stay on the device. They are not sent to AdMob. Ad requests do not include `contentUrl`, `neighboringContentUrls`, or `keywords`. The app requests non-personalized ads by default.

The page fetch goes to the site the user chose. DigestLocal's developer does not receive that page.

## Play Console declarations

| Declaration | Answer |
| --- | --- |
| Ads | Yes, the app contains ads |
| Advertising ID | Yes, for advertising |
| Target audience | 18+. Not Designed for Families |
| News app | No |
| Account required | No |

Pro removes ads and does not initialize the ad SDK, so a Pro-only session does not contact an ad network. Billing is not connected in this build, so do not declare purchase history until a Play Billing provider ships.

Confirm the disclosure against the current Google guide before submitting the Data safety form. Do not submit that form from this repository change.
