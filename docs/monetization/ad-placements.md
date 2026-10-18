# Ad placements and caps

Defaults live in `src/lib/ads/ad-config.ts` (`AD_DEFAULTS`). Remote JSON, when `remoteConfigUrl` is set, may only make caps stricter or equal, except `sessionGapMinutes`, which can be set from 1 minute to 24 hours. Back-nav, app open, native, and collapsible stay off because they are not implemented.

## Defaults

| Key | Value |
| --- | --- |
| adsEnabled | true |
| requestNonPersonalizedAdsOnly | true |
| sessionGapMinutes | 30 |
| minSessionForAds | 2 |
| minSavedForAds | 1 |
| minSessionForInterstitial | 3 |
| minSavedForInterstitial | 3 |
| minSecondsIntoSessionForInterstitial | 90, not enforced |
| interstitialEveryNSaves | 3 |
| fullscreenCooldownSec | 240 |
| fullscreenDailyCap | 3 |
| afterRewardedCooldownSec | 120 |
| rewardedDailyCap | 15 |
| adFreePassHours | 1 |
| adFreePassPerDay | 6 |
| adFreePassMaxHours | 3 |
| afterAdFreeCooldownSec | 300 |
| quizFreeQuestionCap | 3 |
| quizRewardQuestions | 3 |
| extraSpeedsHours | 24 |
| quizUnlockPerDay | 8 |
| shelfBannerEnabled | true |
| articleEndBannerEnabled | true |
| saveInterstitialEnabled | true |
| backNavInterstitialEnabled | false |
| appOpenEnabled | false |
| shelfFormat | banner |
| paywallEnabled | false |
| remoteConfigUrl | empty |

Session 1 does not gather consent, initialize the Mobile Ads SDK, or show ads. Every cold start counts as a new session. A warm resume, when the process stayed alive, starts a new session only after `sessionGapMinutes` in the background (default 30). Remote config may set that gap as low as 1 minute.

Every ad request sets `requestNonPersonalizedAdsOnly` and nothing else. Article text, saved links, and quiz results are not attached.

## Global gate

A placement can render only when all of these are true: the SDK is ready, UMP says ads can be requested, the ad-free pass is not active, nothing is suppressing ads, and `adsEnabled` is true. `EXPO_PUBLIC_PRO_ENABLED` and `extra.proEnabled` default to off. When that flag is on and the entitlement is owned, ads stay off. The shipped UI does not mention a purchase.

Suppression reasons:

| Reason | While |
| --- | --- |
| listen | Listen status is playing or paused |
| quiz | After the first quiz answer, until the score screen |
| fetch | `/add` is downloading a page |
| add-sheet | `/add` is editing or previewing |

While any reason is active, banners unmount and interstitials do not show.

## Placements

| Placement | Screen | Format | Rule | Launch |
| --- | --- | --- | --- | --- |
| shelf_banner | Shelf, bottom, outside the list, inside the bottom safe area | Large anchored adaptive banner (`BannerAdSize.LARGE_ANCHORED_ADAPTIVE_BANNER` in react-native-google-mobile-ads 17.2; `ANCHORED_ADAPTIVE_BANNER` is deprecated) | Shelf has at least one article. Hidden while search has no hits or the keyboard is open. 16 dp above the banner. Labelled Advertisement, with a divider. | On from session 2 |
| article_end_banner | Article, Read mode, after the last paragraph | Inline adaptive banner, width of the article column, max height 250 | Mounts when the reader is within one viewport of the end and the article is at least two viewports tall. 24 dp below the banner, above the mode bar's clearance. Not shown in Listen or Study. | On from session 2 |
| save_interstitial | After a successful Keep on this device | Interstitial | Every 3rd save made in session 3 or later, plus the full-screen caps below. Saves in sessions 1 and 2 do not move the counter. Never from a share intent. Never on Discard. Preloaded once the SDK is ready, and shown only if already loaded. | On from session 3 |
| study_rewarded | Study quiz score, Listen speed, and Settings | Rewarded | Opt-in, never automatic. After the score screen, one offer can add the next 3 unanswered questions (free cap stays 3, maximum 8). If none remain, a fresh set is offered only when the generator can make questions that are not the previous set. Also unlocks 1.5× and 2× listening speeds for 24 hours, or a 1 hour ad-free pass that stacks to 3 hours. 0.9× to 1.3× stay free. Preloaded once the SDK is ready. | On from session 2 |
| Back navigation | Article back button | — | Not implemented. `backNavInterstitialEnabled` stays false. | Off |
| App open, native, collapsible | — | — | Not implemented. Flags stay off. | Off |

## Full-screen caps

An interstitial also requires session count at least 3, at least 3 saved articles, at least 240 seconds since the previous full-screen ad, fewer than 3 full-screen ads on the local day, at least 120 seconds since a rewarded ad closed, and 300 seconds after an ad-free pass expires. Banners are not held for those 300 seconds. There is no minimum time into the session. If the Mobile Ads SDK cannot request ads, or init fails five times, the next try waits until the app returns to the foreground. A banner that fails to load retries with backoff instead of staying hidden.

Rewarded shows share a ceiling of 15 per local day, which is 6 ad-free passes, 8 quiz rewards, and 1 extra-speeds unlock. Ad-free passes and quiz rewards also have those per-kind caps. A pass that is already running can be extended until 3 hours remain. The reward is applied only from the earned-reward callback, and it is applied whenever that callback fires. Quiz reward offers shown and accepted are counted locally for the dev and preview Settings readout.

## Test ads

`__DEV__` and any build whose `extra.adsMode` is not `live` use Google's `TestIds`. Development and preview EAS profiles set `ADS_MODE=test`. Only `production` (`ADS_MODE=live`) requests the real units in `src/lib/ads/production-unit-ids.js`: `shelf_banner` `ca-app-pub-4342572133101591/5889882153`, `article_end_banner` `ca-app-pub-4342572133101591/7526222443`, `save_interstitial` `ca-app-pub-4342572133101591/3978034680`, `study_rewarded` `ca-app-pub-4342572133101591/3387841891`. `app.config.ts` stops a live build if any of them is missing. Every build, test mode included, uses the real AdMob Android app ID `ca-app-pub-4342572133101591~7238447832`.
