import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { AD_DEFAULTS, adRequestOptions, clampRemoteOverride, type AdConfig } from '../src/lib/ads/ad-config.ts';
import {
  canInitAds,
  canOfferRewarded,
  canShowBanner,
  canShowInterstitial,
  fullscreenReloadDelayMs,
  interstitialBlockReason,
  localDateKey,
  nextSessionState,
  rewardedBlockReason,
  type PolicyInput,
} from '../src/lib/ads/ad-policy.ts';
import { emptyAdState, type AdState } from '../src/lib/ads/ad-state.ts';
import { getUnitId, GOOGLE_TEST_UNIT_IDS, resetUnitIdWarnings } from '../src/lib/ads/ad-units.ts';
import {
  ADMOB_ANDROID_APP_ID_PLACEHOLDER,
  GOOGLE_SAMPLE_ANDROID_APP_ID,
  resolveAndroidAppId,
} from '../src/lib/ads/android-app-id.js';

const NOW = Date.parse('2026-06-15T15:00:00');

function state(patch: Partial<AdState> = {}): AdState {
  return {
    ...emptyAdState(NOW - 120_000),
    firstOpenAt: NOW - 86_400_000,
    sessionCount: 3,
    sessionStartedAt: NOW - 120_000,
    savedCount: 3,
    saveInterstitialCounter: 3,
    ...patch,
  };
}

function input(patch: Partial<PolicyInput> = {}, statePatch: Partial<AdState> = {}): PolicyInput {
  return {
    now: NOW,
    isPro: false,
    config: { ...AD_DEFAULTS },
    state: state(statePatch),
    suppressed: false,
    fromShare: false,
    ready: true,
    canRequestAds: true,
    platform: 'android',
    ...patch,
  };
}

test('session 1 cannot init ads; session 2 needs a saved article', () => {
  const config = { ...AD_DEFAULTS };
  const first = state({ sessionCount: 1, savedCount: 3 });
  assert.equal(canInitAds(first, config), false);
  assert.equal(canInitAds(state({ sessionCount: 2, savedCount: 0 }), config), false);
  assert.equal(canInitAds(state({ sessionCount: 2, savedCount: 1 }), config), true);
  assert.equal(canInitAds(state({ sessionCount: 2, savedCount: 1 }), config, { platform: 'web' }), false);
});

test('Pro blocks init, banners, interstitials, and rewarded offers', () => {
  const pro = input({ isPro: true });
  assert.equal(canInitAds(pro.state, pro.config, { isPro: true }), false);
  assert.equal(canShowBanner('shelf_banner', pro), false);
  assert.equal(canShowBanner('article_end_banner', pro), false);
  assert.equal(canShowInterstitial('save', pro), false);
  assert.equal(canOfferRewarded('ad_free', pro), false);
  assert.equal(canOfferRewarded('quiz_unlock', pro), false);
});

test('interstitial fires on the 3rd and 6th save only, and respects every other cap', () => {
  assert.equal(canShowInterstitial('save', input({}, { sessionCount: 2 })), false);
  assert.equal(canShowInterstitial('save', input({}, { savedCount: 2 })), false);
  assert.equal(canShowInterstitial('save', input({}, { sessionStartedAt: NOW - 30_000 })), false);

  for (const count of [1, 2, 4, 5]) {
    assert.equal(canShowInterstitial('save', input({}, { saveInterstitialCounter: count })), false, `save ${count}`);
  }
  assert.equal(canShowInterstitial('save', input({}, { saveInterstitialCounter: 3 })), true);
  assert.equal(canShowInterstitial('save', input({}, { saveInterstitialCounter: 6 })), true);

  assert.equal(canShowInterstitial('save', input({}, { lastFullscreenAt: NOW - 239_000 })), false);
  assert.equal(canShowInterstitial('save', input({}, { lastFullscreenAt: NOW - 241_000 })), true);

  assert.equal(
    canShowInterstitial('save', input({}, { fullscreenToday: { date: localDateKey(NOW), count: 3 } })),
    false,
  );
  assert.equal(
    canShowInterstitial('save', input({}, { fullscreenToday: { date: '1999-01-01', count: 3 } })),
    true,
  );
  assert.notEqual(localDateKey(NOW), '1999-01-01');

  assert.equal(canShowInterstitial('save', input({}, { lastRewardedClosedAt: NOW - 59_000 })), false);
  assert.equal(canShowInterstitial('save', input({}, { lastRewardedClosedAt: NOW - 61_000 })), true);
  assert.equal(canShowInterstitial('save', input({ fromShare: true })), false);
  assert.equal(canShowInterstitial('save', input({ suppressed: true })), false);
  assert.equal(canShowInterstitial('save', input({}, { adFreeUntil: NOW + 60_000 })), false);
  assert.equal(canShowInterstitial('back', input()), false);
});

test('rewarded caps: one ad-free pass per 24 hours, three quiz unlocks a day, six rewarded shows a day', () => {
  const fresh = input({ state: state({ sessionCount: 2, savedCount: 1, saveInterstitialCounter: 0 }) });
  assert.equal(canOfferRewarded('ad_free', fresh), true);
  assert.equal(canOfferRewarded('quiz_unlock', fresh), true);

  const duringPass = input({}, { adFreeUntil: NOW + 60 * 60 * 1000 });
  assert.equal(canOfferRewarded('ad_free', duringPass), false);

  const afterPass = input({}, { adFreeUntil: NOW - 1000 });
  assert.equal(canOfferRewarded('ad_free', afterPass), true);

  const quizCap = input({}, { quizUnlocksToday: { date: localDateKey(NOW), count: 3 } });
  assert.equal(canOfferRewarded('quiz_unlock', quizCap), false);
  assert.equal(canOfferRewarded('ad_free', quizCap), true);

  const quizYesterday = input({}, { quizUnlocksToday: { date: '1999-01-01', count: 3 } });
  assert.equal(canOfferRewarded('quiz_unlock', quizYesterday), true);

  const daily = input({}, { rewardedToday: { date: localDateKey(NOW), count: 6 } });
  assert.equal(canOfferRewarded('ad_free', daily), false);
  assert.equal(canOfferRewarded('quiz_unlock', daily), false);

  const underDaily = input({}, { rewardedToday: { date: localDateKey(NOW), count: 5 } });
  assert.equal(canOfferRewarded('ad_free', underDaily), true);
  assert.equal(canOfferRewarded('quiz_unlock', underDaily), true);
});

test('remote overrides only get stricter, and unimplemented formats stay off', () => {
  const clamped = clampRemoteOverride({
    fullscreenDailyCap: 10,
    interstitialEveryNSaves: 2,
    minSessionForAds: 1,
    adsEnabled: false,
    requestNonPersonalizedAdsOnly: false,
    backNavInterstitialEnabled: true,
    appOpenEnabled: true,
    shelfFormat: 'native',
    paywallEnabled: true,
    shelfBannerEnabled: false,
    rewardedDailyCap: 4,
    quizFreeQuestionCap: 8,
  });
  assert.equal(clamped.fullscreenDailyCap, AD_DEFAULTS.fullscreenDailyCap);
  assert.equal(clamped.interstitialEveryNSaves, AD_DEFAULTS.interstitialEveryNSaves);
  assert.equal(clamped.minSessionForAds, AD_DEFAULTS.minSessionForAds);
  assert.equal(clamped.adsEnabled, false);
  assert.equal(clamped.requestNonPersonalizedAdsOnly, true);
  assert.equal(clamped.backNavInterstitialEnabled, false);
  assert.equal(clamped.appOpenEnabled, false);
  assert.equal(clamped.shelfFormat, 'banner');
  assert.equal(clamped.paywallEnabled, true);
  assert.equal(clamped.shelfBannerEnabled, false);
  assert.equal(clamped.rewardedDailyCap, 4);
  assert.equal(clamped.quizFreeQuestionCap, AD_DEFAULTS.quizFreeQuestionCap);

  const stricter = clampRemoteOverride({
    fullscreenDailyCap: 1,
    interstitialEveryNSaves: 5,
    minSessionForAds: 4,
  });
  assert.equal(stricter.fullscreenDailyCap, 1);
  assert.equal(stricter.interstitialEveryNSaves, 5);
  assert.equal(stricter.minSessionForAds, 4);

  assert.throws(() => clampRemoteOverride('nope'), /JSON object/);
});

test('ad requests carry only the non-personalized flag', () => {
  const options = adRequestOptions({ ...AD_DEFAULTS } satisfies AdConfig);
  assert.deepEqual(options, { requestNonPersonalizedAdsOnly: true });
  assert.equal('contentUrl' in options, false);
  assert.equal('keywords' in options, false);
  assert.equal('neighboringContentUrls' in options, false);
});

test('getUnitId uses Google test ids in test mode and disables placeholder live ids', () => {
  resetUnitIdWarnings();
  const source = readFileSync('node_modules/react-native-google-mobile-ads/src/TestIds.ts', 'utf8');
  assert.match(source, /ADAPTIVE_BANNER: 'ca-app-pub-3940256099942544\/9214589741'/);
  assert.match(source, /INTERSTITIAL: 'ca-app-pub-3940256099942544\/1033173712'/);
  assert.match(source, /REWARDED: 'ca-app-pub-3940256099942544\/5224354917'/);

  assert.equal(getUnitId('shelf_banner', { testMode: true, platform: 'android' }), GOOGLE_TEST_UNIT_IDS.android.shelf_banner);
  assert.equal(
    getUnitId('article_end_banner', { testMode: true, platform: 'android' }),
    GOOGLE_TEST_UNIT_IDS.android.article_end_banner,
  );
  assert.equal(
    getUnitId('save_interstitial', { testMode: true, platform: 'android' }),
    GOOGLE_TEST_UNIT_IDS.android.save_interstitial,
  );
  assert.equal(getUnitId('study_rewarded', { testMode: true, platform: 'android' }), GOOGLE_TEST_UNIT_IDS.android.study_rewarded);
  assert.equal(
    getUnitId('shelf_banner', {
      testMode: true,
      testIds: { shelf_banner: 'from-library' },
    }),
    'from-library',
  );
  assert.equal(getUnitId('shelf_banner', { testMode: false }), null);
  assert.equal(getUnitId('save_interstitial', { testMode: false }), null);
});

test('Android app id falls back to the sample outside production and throws in production', () => {
  assert.equal(
    resolveAndroidAppId({ profile: 'preview', fromConfig: ADMOB_ANDROID_APP_ID_PLACEHOLDER }),
    GOOGLE_SAMPLE_ANDROID_APP_ID,
  );
  assert.equal(
    resolveAndroidAppId({ profile: 'local', fromEnv: ADMOB_ANDROID_APP_ID_PLACEHOLDER, fromConfig: ADMOB_ANDROID_APP_ID_PLACEHOLDER }),
    GOOGLE_SAMPLE_ANDROID_APP_ID,
  );
  assert.equal(
    resolveAndroidAppId({ profile: 'production', fromEnv: 'ca-app-pub-123~456' }),
    'ca-app-pub-123~456',
  );
  assert.equal(
    resolveAndroidAppId({ profile: 'production', fromConfig: 'ca-app-pub-9~8' }),
    'ca-app-pub-9~8',
  );
  assert.throws(
    () => resolveAndroidAppId({ profile: 'production', fromConfig: ADMOB_ANDROID_APP_ID_PLACEHOLDER }),
    /real AdMob Android app ID/,
  );
});

test('a cold start is session 1, and 30 minutes in the background starts the next session', () => {
  const config = { ...AD_DEFAULTS };
  const first = nextSessionState(emptyAdState(NOW), { type: 'launch' }, config, NOW);
  assert.equal(first.sessionCount, 1);
  assert.equal(first.firstOpenAt, NOW);

  const backgrounded = nextSessionState(first, { type: 'background' }, config, NOW + 60_000);
  const soon = nextSessionState(backgrounded, { type: 'active' }, config, NOW + 60_000 + 29 * 60 * 1000);
  assert.equal(soon.sessionCount, 1);
  assert.equal(soon.lastBackgroundAt, null);

  const later = nextSessionState(backgrounded, { type: 'active' }, config, NOW + 60_000 + 30 * 60 * 1000);
  assert.equal(later.sessionCount, 2);
  assert.equal(later.sessionStartedAt, NOW + 60_000 + 30 * 60 * 1000);
});

test('session count persists across a cold start only after a recorded 30 minute background', () => {
  const config = { ...AD_DEFAULTS };
  const first = nextSessionState(emptyAdState(NOW), { type: 'launch' }, config, NOW);

  const killedWhileActive = nextSessionState(first, { type: 'launch' }, config, NOW + 5 * 60 * 1000);
  assert.equal(killedWhileActive.sessionCount, 1);
  assert.equal(killedWhileActive.sessionStartedAt, first.sessionStartedAt);

  const left = nextSessionState(first, { type: 'background' }, config, NOW + 60_000);
  const briefColdStart = nextSessionState(left, { type: 'launch' }, config, NOW + 60_000 + 10 * 60 * 1000);
  assert.equal(briefColdStart.sessionCount, 1);

  const longColdStart = nextSessionState(left, { type: 'launch' }, config, NOW + 60_000 + 30 * 60 * 1000);
  assert.equal(longColdStart.sessionCount, 2);
  assert.equal(longColdStart.lastBackgroundAt, null);

  const secondBackground = nextSessionState(left, { type: 'background' }, config, NOW + 60_000 + 30 * 60 * 1000);
  assert.equal(secondBackground.lastBackgroundAt, left.lastBackgroundAt);
  const resume = nextSessionState(secondBackground, { type: 'active' }, config, NOW + 60_000 + 30 * 60 * 1000);
  assert.equal(resume.sessionCount, 2);
});

test('interstitial and rewarded block reasons name the cap that failed', () => {
  assert.equal(interstitialBlockReason('save', input({}, { sessionCount: 2 })), 'session 2 is below 3');
  assert.equal(
    interstitialBlockReason('save', input({}, { sessionStartedAt: NOW - 30_000 })),
    '30s into session, need 90s',
  );
  assert.equal(interstitialBlockReason('save', input({}, { saveInterstitialCounter: 4 })), 'save 4 is not a multiple of 3');
  assert.equal(interstitialBlockReason('save', input()), null);
  assert.equal(interstitialBlockReason('save', input({ fromShare: true })), 'opened from a share');

  assert.equal(
    rewardedBlockReason('quiz_unlock', input({}, { quizUnlocksToday: { date: localDateKey(NOW), count: 3 } })),
    'quiz unlock daily cap 3',
  );
  assert.equal(rewardedBlockReason('ad_free', input({}, { adFreeUntil: NOW + 60_000 })), 'ad-free pass already used in the last 24h');
  assert.equal(rewardedBlockReason('quiz_unlock', input()), null);
});

test('fullscreen reload backs off and then caps', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((attempt) => fullscreenReloadDelayMs(attempt)),
    [2_000, 4_000, 8_000, 16_000, 30_000, 30_000],
  );
});
