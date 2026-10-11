# Ad placements and caps

Defaults live in `src/lib/ads/ad-config.ts` (`AD_DEFAULTS`). Remote JSON, when `remoteConfigUrl` is set, may only make caps stricter or equal. Back-nav, app open, native, and collapsible stay off because they are not implemented.

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
| minSecondsIntoSessionForInterstitial | 90 |
| interstitialEveryNSaves | 3 |
| fullscreenCooldownSec | 240 |
| fullscreenDailyCap | 3 |
| afterRewardedCooldownSec | 60 |
| rewardedDailyCap | 6 |
| adFreePassHours | 24 |
| adFreePassPerDay | 1 |
| quizFreeQuestionCap | 5 |
| quizUnlockPerDay | 3 |
| shelfBannerEnabled | true |
| articleEndBannerEnabled | true |
| saveInterstitialEnabled | true |
| backNavInterstitialEnabled | false |
| appOpenEnabled | false |
| shelfFormat | banner |
| paywallEnabled | false |
| remoteConfigUrl | empty |

Session 1 does not gather consent, initialize the Mobile Ads SDK, or show ads. A new session starts on a cold start after at least 30 minutes away, or when the app returns to the foreground after at least 30 minutes in the background.

Every ad request sets `requestNonPersonalizedAdsOnly` and nothing else. Article text, saved links, and quiz results are not attached.

## Global gate

A placement can render only when all of these are true: not Pro, the SDK is ready, UMP says ads can be requested, the ad-free pass is not active, nothing is suppressing ads, and `adsEnabled` is true.

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
| save_interstitial | After a successful Keep on this device | Interstitial | Every 3rd successful save, plus the full-screen caps below. Never from a share intent. Never on Discard. Shown only if already loaded. | On from session 3 |
| study_rewarded | Study score screen, and Settings | Rewarded | Opt-in. Unlocks the rest of that article's quiz, or a 24 hour ad-free pass. | On from session 2 |
| Back navigation | Article back button | — | Not implemented. `backNavInterstitialEnabled` stays false. | Off |
| App open, native, collapsible | — | — | Not implemented. Flags stay off. | Off |

## Full-screen caps

An interstitial also requires session count at least 3, at least 3 saved articles, at least 90 seconds into the session, at least 240 seconds since the previous full-screen ad, fewer than 3 full-screen ads on the local day, and at least 60 seconds since a rewarded ad closed.

Rewarded shows count toward 6 per local day. Quiz unlocks are also capped at 3 per day. The ad-free pass is once per 24 hours.

## Test ads

`__DEV__` and any build whose `extra.adsMode` is not `live` use Google's `TestIds`. Development and preview EAS profiles set `ADS_MODE=test`. Live unit IDs in `src/lib/ads/ad-units.ts` are placeholders. If a live build still contains `XXXXXXXX`, that placement stays off.
