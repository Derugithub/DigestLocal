# Play Data safety notes for DigestLocal ads

Source: [Play data disclosure for the Google Mobile Ads SDK](https://developers.google.com/admob/android/privacy/play-data-disclosure).

DigestLocal does not run its own analytics or crash SDK. The notes below are for the Google Mobile Ads SDK and the User Messaging Platform (UMP), which start on session 2. Support mail for the store listing and the in-app contact link is movadmob@gmail.com.

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

This build does not include purchase billing, so do not declare purchase history. The ad SDK is not initialized on session 1. A build flag can suppress ads when an entitlement is both enabled and owned; that flag defaults to off, and this listing should not describe a purchase.

Confirm the disclosure against the current Google guide before submitting the Data safety form. Do not submit that form from this repository change.
