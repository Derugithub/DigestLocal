/**
 * Central ad caps. Remote overrides can only make these stricter or equal,
 * and unimplemented formats stay off. See docs/monetization/ad-placements.md.
 */
export const AD_DEFAULTS = {
  adsEnabled: true,
  requestNonPersonalizedAdsOnly: true,
  sessionGapMinutes: 30,
  minSessionForAds: 2,
  minSavedForAds: 1,
  minSessionForInterstitial: 3,
  minSavedForInterstitial: 3,
  minSecondsIntoSessionForInterstitial: 90,
  interstitialEveryNSaves: 3,
  fullscreenCooldownSec: 240,
  fullscreenDailyCap: 3,
  afterRewardedCooldownSec: 60,
  rewardedDailyCap: 6,
  adFreePassHours: 24,
  adFreePassPerDay: 1,
  quizFreeQuestionCap: 5,
  quizUnlockPerDay: 3,
  shelfBannerEnabled: true,
  articleEndBannerEnabled: true,
  saveInterstitialEnabled: true,
  backNavInterstitialEnabled: false,
  appOpenEnabled: false,
  shelfFormat: 'banner' as 'banner' | 'native' | 'collapsible',
  paywallEnabled: false,
  remoteConfigUrl: '',
} as const;

export type AdConfig = {
  adsEnabled: boolean;
  requestNonPersonalizedAdsOnly: boolean;
  sessionGapMinutes: number;
  minSessionForAds: number;
  minSavedForAds: number;
  minSessionForInterstitial: number;
  minSavedForInterstitial: number;
  minSecondsIntoSessionForInterstitial: number;
  interstitialEveryNSaves: number;
  fullscreenCooldownSec: number;
  fullscreenDailyCap: number;
  afterRewardedCooldownSec: number;
  rewardedDailyCap: number;
  adFreePassHours: number;
  adFreePassPerDay: number;
  quizFreeQuestionCap: number;
  quizUnlockPerDay: number;
  shelfBannerEnabled: boolean;
  articleEndBannerEnabled: boolean;
  saveInterstitialEnabled: boolean;
  backNavInterstitialEnabled: boolean;
  appOpenEnabled: boolean;
  shelfFormat: 'banner' | 'native' | 'collapsible';
  paywallEnabled: boolean;
  remoteConfigUrl: string;
};

/** Placeholder. Replace with the hosted privacy policy before release. */
export const PRIVACY_POLICY_URL = 'https://derugithub.github.io/privacy';

/**
 * Placeholder. app-ads.txt must be served at the root of this domain
 * (the Play Console developer website), not under a project path.
 */
export const DEVELOPER_DOMAIN = 'https://derugithub.github.io';

export const REMOTE_CONFIG_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Hashed test-device ids. `EMULATOR` is the classic Android alias
 * (`TestDeviceIds.EMULATOR` in react-native-google-mobile-ads 17.2).
 * Add a physical device hash from logcat before requesting ads on that device:
 * `Use RequestConfiguration.Builder.setTestDeviceIds(Arrays.asList("HASH"))`.
 */
export const TEST_DEVICE_IDENTIFIERS: readonly string[] = ['EMULATOR'];

export function adConfigFromDefaults(): AdConfig {
  return { ...AD_DEFAULTS };
}

/**
 * The only fields ever sent on an ad request.
 * Article text, saved URLs, contentUrl, neighboringContentUrls, and keywords are never included.
 */
export function adRequestOptions(config: AdConfig): { requestNonPersonalizedAdsOnly: boolean } {
  return { requestNonPersonalizedAdsOnly: config.requestNonPersonalizedAdsOnly };
}

type NumericKey =
  | 'sessionGapMinutes'
  | 'minSessionForAds'
  | 'minSavedForAds'
  | 'minSessionForInterstitial'
  | 'minSavedForInterstitial'
  | 'minSecondsIntoSessionForInterstitial'
  | 'interstitialEveryNSaves'
  | 'fullscreenCooldownSec'
  | 'fullscreenDailyCap'
  | 'afterRewardedCooldownSec'
  | 'rewardedDailyCap'
  | 'adFreePassHours'
  | 'adFreePassPerDay'
  | 'quizFreeQuestionCap'
  | 'quizUnlockPerDay';

const NUMERIC_RULES: {
  key: NumericKey;
  /** Higher means fewer or later ads, except where noted. */
  stricter: 'higher' | 'lower';
  min: number;
  max: number;
}[] = [
  { key: 'sessionGapMinutes', stricter: 'higher', min: 30, max: 24 * 60 },
  { key: 'minSessionForAds', stricter: 'higher', min: 2, max: 30 },
  { key: 'minSavedForAds', stricter: 'higher', min: 1, max: 100 },
  { key: 'minSessionForInterstitial', stricter: 'higher', min: 3, max: 30 },
  { key: 'minSavedForInterstitial', stricter: 'higher', min: 3, max: 100 },
  { key: 'minSecondsIntoSessionForInterstitial', stricter: 'higher', min: 90, max: 3600 },
  { key: 'interstitialEveryNSaves', stricter: 'higher', min: 2, max: 20 },
  { key: 'fullscreenCooldownSec', stricter: 'higher', min: 240, max: 3600 },
  { key: 'afterRewardedCooldownSec', stricter: 'higher', min: 60, max: 3600 },
  { key: 'fullscreenDailyCap', stricter: 'lower', min: 0, max: 5 },
  { key: 'rewardedDailyCap', stricter: 'lower', min: 0, max: 6 },
  { key: 'adFreePassHours', stricter: 'lower', min: 1, max: 24 },
  { key: 'adFreePassPerDay', stricter: 'lower', min: 0, max: 1 },
  { key: 'quizFreeQuestionCap', stricter: 'lower', min: 1, max: 5 },
  { key: 'quizUnlockPerDay', stricter: 'lower', min: 0, max: 3 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Applies a remote JSON object onto the defaults.
 * Caps move only toward stricter-or-equal values, then into the sane range.
 * Unimplemented surfaces (back-nav, app open, native, collapsible) stay off.
 * Personalized ads cannot be turned on from remote config.
 */
export function clampRemoteOverride(input: unknown, defaults: AdConfig = adConfigFromDefaults()): AdConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Remote ad config must be a JSON object.');
  }
  const source = input as Record<string, unknown>;
  const next: AdConfig = { ...defaults };

  for (const rule of NUMERIC_RULES) {
    const raw = source[rule.key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const rounded = rule.stricter === 'higher' ? Math.ceil(raw) : Math.floor(raw);
    const baseline = defaults[rule.key];
    const stricterValue = rule.stricter === 'higher' ? Math.max(rounded, baseline) : Math.min(rounded, baseline);
    next[rule.key] = clamp(stricterValue, rule.min, rule.max);
  }

  if (typeof source.adsEnabled === 'boolean') {
    next.adsEnabled = defaults.adsEnabled ? source.adsEnabled : false;
  }
  next.requestNonPersonalizedAdsOnly = true;

  if (typeof source.shelfBannerEnabled === 'boolean') {
    next.shelfBannerEnabled = defaults.shelfBannerEnabled ? source.shelfBannerEnabled : false;
  }
  if (typeof source.articleEndBannerEnabled === 'boolean') {
    next.articleEndBannerEnabled = defaults.articleEndBannerEnabled ? source.articleEndBannerEnabled : false;
  }
  if (typeof source.saveInterstitialEnabled === 'boolean') {
    next.saveInterstitialEnabled = defaults.saveInterstitialEnabled ? source.saveInterstitialEnabled : false;
  }

  next.backNavInterstitialEnabled = false;
  next.appOpenEnabled = false;
  next.shelfFormat = 'banner';

  if (typeof source.paywallEnabled === 'boolean') {
    next.paywallEnabled = source.paywallEnabled;
  }

  next.remoteConfigUrl = defaults.remoteConfigUrl;
  return next;
}
