import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AD_DEFAULTS, adRequestOptions, clampRemoteOverride, PRIVACY_POLICY_URL, SUPPORT_EMAIL, type AdConfig } from '../src/lib/ads/ad-config.ts';
import {
  canInitAds,
  canOfferRewarded,
  canShowBanner,
  canShowInterstitial,
  formatAdFreeRemaining,
  fullscreenReloadDelayMs,
  grantRewardedReward,
  interstitialBlockReason,
  localDateKey,
  nextAdFreeUntil,
  nextSaveInterstitialCounter,
  nextSessionState,
  rewardedBlockReason,
  type PolicyInput,
} from '../src/lib/ads/ad-policy.ts';
import { emptyAdState, sanitizeAdState, type AdState } from '../src/lib/ads/ad-state.ts';
import { isProEnabledFrom } from '../src/lib/pro-flag-value.ts';
import { planQuizOffer } from '../src/lib/quiz-reward.ts';
import {
  getUnitId,
  GOOGLE_TEST_UNIT_IDS,
  LIVE_AD_UNITS_ENABLED,
  PRODUCTION_UNIT_IDS,
  resetUnitIdWarnings,
  usesTestUnits,
} from '../src/lib/ads/ad-units.ts';
import {
  ADMOB_ANDROID_APP_ID,
  ADMOB_ANDROID_APP_ID_PLACEHOLDER,
  applyRootMobileAdsAppIds,
  isLiveAdBuild,
  resolveAndroidAppId,
  resolveMobileAdsAppIds,
  syncRootMobileAdsAppIds,
} from '../src/lib/ads/android-app-id.js';
import { assertProductionUnitIds, checkLiveAdUnits, missingProductionUnits } from '../src/lib/ads/production-unit-ids.js';

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
  assert.equal(canOfferRewarded('extra_speeds', pro), false);
});

test('interstitial fires on the 3rd and 6th save only, and respects every other cap', () => {
  assert.equal(canShowInterstitial('save', input({}, { sessionCount: 2 })), false);
  assert.equal(canShowInterstitial('save', input({}, { savedCount: 2 })), false);
  assert.equal(canShowInterstitial('save', input({}, { sessionStartedAt: NOW - 30_000 })), true);

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

  assert.equal(canShowInterstitial('save', input({}, { lastRewardedClosedAt: NOW - 119_000 })), false);
  assert.equal(canShowInterstitial('save', input({}, { lastRewardedClosedAt: NOW - 121_000 })), true);
  assert.equal(canShowInterstitial('save', input({}, { adFreeUntil: NOW - 4 * 60 * 1000 })), false);
  assert.equal(canShowInterstitial('save', input({}, { adFreeUntil: NOW - 6 * 60 * 1000 })), true);
  assert.equal(canShowBanner('shelf_banner', input({}, { adFreeUntil: NOW - 4 * 60 * 1000 })), true);
  assert.equal(canShowBanner('shelf_banner', input({}, { adFreeUntil: NOW + 60_000 })), false);
  assert.equal(canShowInterstitial('save', input({ fromShare: true })), false);
  assert.equal(canShowInterstitial('save', input({ suppressed: true })), false);
  assert.equal(canShowInterstitial('save', input({}, { adFreeUntil: NOW + 60_000 })), false);
  assert.equal(canShowInterstitial('back', input()), false);
});

test('rewarded caps: six 1-hour passes a day, eight quiz rewards a day, and a shared ceiling of 15', () => {
  const fresh = input({ state: state({ sessionCount: 2, savedCount: 1, saveInterstitialCounter: 0 }) });
  assert.equal(canOfferRewarded('ad_free', fresh), true);
  assert.equal(canOfferRewarded('quiz_unlock', fresh), true);

  const duringPass = input({}, { adFreeUntil: NOW + 60 * 60 * 1000 });
  assert.equal(canOfferRewarded('ad_free', duringPass), true);
  assert.equal(canOfferRewarded('quiz_unlock', duringPass), true);

  const atStackCap = input({}, { adFreeUntil: NOW + 3 * 60 * 60 * 1000 });
  assert.equal(canOfferRewarded('ad_free', atStackCap), false);

  const afterPass = input({}, { adFreeUntil: NOW - 1000 });
  assert.equal(canOfferRewarded('ad_free', afterPass), true);

  const quizCap = input({}, { quizUnlocksToday: { date: localDateKey(NOW), count: 8 } });
  assert.equal(canOfferRewarded('quiz_unlock', quizCap), false);
  assert.equal(canOfferRewarded('ad_free', quizCap), true);

  const quizUnderCap = input({}, { quizUnlocksToday: { date: localDateKey(NOW), count: 7 } });
  assert.equal(canOfferRewarded('quiz_unlock', quizUnderCap), true);

  const quizYesterday = input({}, { quizUnlocksToday: { date: '1999-01-01', count: 8 } });
  assert.equal(canOfferRewarded('quiz_unlock', quizYesterday), true);

  const passesToday = input({}, { adFreePassesToday: { date: localDateKey(NOW), count: 6 } });
  assert.equal(canOfferRewarded('ad_free', passesToday), false);
  assert.equal(canOfferRewarded('quiz_unlock', passesToday), true);
  const passesYesterday = input({}, { adFreePassesToday: { date: '1999-01-01', count: 6 } });
  assert.equal(canOfferRewarded('ad_free', passesYesterday), true);

  const daily = input({}, { rewardedToday: { date: localDateKey(NOW), count: 15 } });
  assert.equal(canOfferRewarded('ad_free', daily), false);
  assert.equal(canOfferRewarded('quiz_unlock', daily), false);

  const underDaily = input({}, { rewardedToday: { date: localDateKey(NOW), count: 14 } });
  assert.equal(canOfferRewarded('ad_free', underDaily), true);
  assert.equal(canOfferRewarded('quiz_unlock', underDaily), true);
  assert.equal(canOfferRewarded('extra_speeds', underDaily), true);

  assert.equal(canOfferRewarded('extra_speeds', fresh), true);
  assert.equal(canOfferRewarded('extra_speeds', duringPass), true);
  assert.equal(canOfferRewarded('extra_speeds', input({ suppressed: true })), true);
  assert.equal(canOfferRewarded('quiz_unlock', input({ suppressed: true })), false);
  const speedsOn = input({}, { extraSpeedsUntil: NOW + 60 * 60 * 1000 });
  assert.equal(canOfferRewarded('extra_speeds', speedsOn), false);
  assert.equal(canOfferRewarded('extra_speeds', input({}, { extraSpeedsUntil: NOW - 1000 })), true);
  assert.equal(canOfferRewarded('extra_speeds', daily), false);
});

test('remote overrides only get stricter, and unimplemented formats stay off', () => {
  const clamped = clampRemoteOverride({
    fullscreenDailyCap: 10,
    interstitialEveryNSaves: 2,
    minSessionForAds: 1,
    adsEnabled: false,
    requestNonPersonalizedAdsOnly: true,
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
  assert.equal(clamped.requestNonPersonalizedAdsOnly, AD_DEFAULTS.requestNonPersonalizedAdsOnly);
  assert.equal(clamped.requestNonPersonalizedAdsOnly, false);
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
  assert.deepEqual(options, { requestNonPersonalizedAdsOnly: false });
  assert.deepEqual(adRequestOptions({ ...AD_DEFAULTS, requestNonPersonalizedAdsOnly: true }), {
    requestNonPersonalizedAdsOnly: true,
  });
  assert.equal('contentUrl' in options, false);
  assert.equal('keywords' in options, false);
  assert.equal('neighboringContentUrls' in options, false);
});

test('getUnitId uses Google test ids in every mode while real units are commented out', () => {
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
    getUnitId('shelf_banner', { testMode: true, platform: 'ios' }),
    GOOGLE_TEST_UNIT_IDS.android.shelf_banner,
  );
  assert.equal(
    getUnitId('shelf_banner', {
      testMode: true,
      testIds: { shelf_banner: 'from-library' },
    }),
    'from-library',
  );
  for (const placement of ['shelf_banner', 'article_end_banner', 'save_interstitial', 'study_rewarded'] as const) {
    assert.equal(getUnitId(placement, { testMode: false, liveUnitsEnabled: false }), GOOGLE_TEST_UNIT_IDS.android[placement]);
    if (LIVE_AD_UNITS_ENABLED) {
      // Public release: a live build requests the real unit.
      assert.equal(getUnitId(placement, { testMode: false }), PRODUCTION_UNIT_IDS?.[placement]);
      continue;
    }
    // Closed testing: a live (production) build still resolves every placement to a Google test unit.
    assert.equal(getUnitId(placement, { testMode: false }), GOOGLE_TEST_UNIT_IDS.android[placement]);
    assert.equal(getUnitId(placement, { testMode: false, liveUnitsEnabled: true }), GOOGLE_TEST_UNIT_IDS.android[placement]);
    assert.equal(
      getUnitId(placement, { testMode: false, testIds: { [placement]: 'from-library' } }),
      'from-library',
    );
  }
});

test('real ad units stay commented out during closed testing, and production builds still pass', (t) => {
  if (LIVE_AD_UNITS_ENABLED) {
    t.diagnostic('real ad units are enabled (public release)');
    assert.deepEqual(missingProductionUnits(), []);
    assert.doesNotThrow(() => checkLiveAdUnits(true));
    assert.equal(usesTestUnits(false), false);
    return;
  }
  assert.equal(LIVE_AD_UNITS_ENABLED, false);
  assert.equal(PRODUCTION_UNIT_IDS, null);
  assert.equal(usesTestUnits(false), true);
  assert.equal(usesTestUnits(true), true);

  // The production build check is skipped while live units are off, so production builds succeed.
  assert.doesNotThrow(() => checkLiveAdUnits(true));
  assert.doesNotThrow(() => checkLiveAdUnits(false));

  // The real IDs are kept in the file, commented out, next to the re-enable steps.
  const source = readFileSync('src/lib/ads/production-unit-ids.js', 'utf8');
  assert.match(source, /^const PRODUCTION_UNIT_IDS = null;$/m);
  assert.match(source, /^\/\/ {3}shelf_banner: 'ca-app-pub-4342572133101591\/5889882153',$/m);
  assert.match(source, /^\/\/ {3}article_end_banner: 'ca-app-pub-4342572133101591\/7526222443',$/m);
  assert.match(source, /^\/\/ {3}save_interstitial: 'ca-app-pub-4342572133101591\/3978034680',$/m);
  assert.match(source, /^\/\/ {3}study_rewarded: 'ca-app-pub-4342572133101591\/3387841891',$/m);
  assert.match(source, /To turn on real ads at the public release/);
});

test('once real units are enabled, a live build stops when one is missing or a test unit', () => {
  const real = {
    shelf_banner: 'ca-app-pub-4342572133101591/5889882153',
    article_end_banner: 'ca-app-pub-4342572133101591/7526222443',
    save_interstitial: 'ca-app-pub-4342572133101591/3978034680',
    study_rewarded: 'ca-app-pub-4342572133101591/3387841891',
  };
  assert.deepEqual(missingProductionUnits(real), []);
  assert.doesNotThrow(() => checkLiveAdUnits(true, true, real));
  const broken = {
    ...real,
    article_end_banner: 'ca-app-pub-XXXXXXXX/XXXXXXXX',
    study_rewarded: GOOGLE_TEST_UNIT_IDS.android.study_rewarded,
  };
  assert.deepEqual(missingProductionUnits(broken), ['article_end_banner', 'study_rewarded']);
  assert.throws(() => assertProductionUnitIds(broken), /Missing: article_end_banner, study_rewarded/);
  assert.throws(() => checkLiveAdUnits(true, true, broken), /Missing: article_end_banner, study_rewarded/);
  assert.doesNotThrow(() => checkLiveAdUnits(false, true, broken));
  assert.throws(() => checkLiveAdUnits(true, true, null), /Missing: shelf_banner, article_end_banner, save_interstitial, study_rewarded/);
});

test('every build mode uses the real Android app id, and a missing or sample id throws', () => {
  assert.equal(ADMOB_ANDROID_APP_ID, 'ca-app-pub-4342572133101591~7238447832');
  for (const input of [
    { profile: 'local' },
    { profile: 'development', adsMode: 'test' },
    { profile: 'preview', adsMode: 'test' },
    { profile: 'production', adsMode: 'live' },
  ]) {
    assert.equal(resolveAndroidAppId({ ...input, fromConfig: ADMOB_ANDROID_APP_ID }), ADMOB_ANDROID_APP_ID);
    assert.equal(
      resolveAndroidAppId({ ...input, fromEnv: ADMOB_ANDROID_APP_ID, fromConfig: ADMOB_ANDROID_APP_ID_PLACEHOLDER }),
      ADMOB_ANDROID_APP_ID,
    );
    assert.throws(() => resolveAndroidAppId({ ...input, fromConfig: ADMOB_ANDROID_APP_ID_PLACEHOLDER }), /real AdMob Android app ID/);
    assert.throws(() => resolveAndroidAppId(input), /real AdMob Android app ID/);
  }
  const sample = ['ca-app-pub-3940256099942544', '3347511713'].join('~');
  assert.throws(() => resolveAndroidAppId({ profile: 'preview', adsMode: 'test', fromConfig: sample }), /not a real AdMob Android app ID/);
  assert.throws(() => resolveAndroidAppId({ profile: 'production', fromEnv: 'ca-app-pub-123~456' }), /not a real AdMob Android app ID/);

  assert.equal(isLiveAdBuild({ profile: 'production' }), true);
  assert.equal(isLiveAdBuild({ profile: 'production', adsMode: 'test' }), false);
  assert.equal(isLiveAdBuild({ profile: 'preview', adsMode: 'live' }), true);
  assert.equal(isLiveAdBuild({ profile: 'preview', adsMode: 'test' }), false);
});

test('app.json and eas.json carry the real app id, and native builds keep iOS ads commented out', () => {
  const source = readFileSync('app.json', 'utf8');
  assert.match(source, /\/\/ Kept for a future iOS release\. Android is the only ad target for now\./);
  assert.match(source, /\/\/ "iosAppId": "ca-app-pub-3940256099942544~1458002511"/);
  assert.match(source, /\/\/ "ios_app_id": "ca-app-pub-3940256099942544~1458002511"/);
  assert.match(source, new RegExp(`"androidAppId": "${ADMOB_ANDROID_APP_ID}"`));
  assert.match(source, new RegExp(`"android_app_id": "${ADMOB_ANDROID_APP_ID}"`));
  const eas = JSON.parse(readFileSync('eas.json', 'utf8')) as {
    build: Record<string, { env?: Record<string, string>; buildArtifactPaths?: string[] }>;
  };
  assert.equal(eas.build.production.env?.ADMOB_ANDROID_APP_ID, ADMOB_ANDROID_APP_ID);
  assert.equal(eas.build.production.env?.ADS_MODE, 'live');
  assert.equal(eas.build.preview.env?.ADS_MODE, 'test');
  assert.equal(eas.build.development.env?.ADS_MODE, 'test');
  // buildArtifactPaths must stay unset: with `eas build --local --output` the extra artifact
  // (mapping.txt) is written to the --output path and replaces the .aab.
  for (const [name, profile] of Object.entries(eas.build)) {
    assert.equal(profile.buildArtifactPaths, undefined, `build.${name} must not set buildArtifactPaths`);
  }

  const ids = resolveMobileAdsAppIds({
    profile: 'preview',
    adsMode: 'test',
    androidFromConfig: ADMOB_ANDROID_APP_ID,
  });
  assert.deepEqual(ids, { androidAppId: ADMOB_ANDROID_APP_ID });
  const rewritten = applyRootMobileAdsAppIds(source, ids);
  const parsed = JSON.parse(rewritten) as {
    expo: { plugins: unknown[] };
    'react-native-google-mobile-ads': { android_app_id?: string; ios_app_id?: string };
  };
  assert.equal(parsed['react-native-google-mobile-ads'].android_app_id, ADMOB_ANDROID_APP_ID);
  assert.equal(parsed['react-native-google-mobile-ads'].ios_app_id, undefined);
  assert.doesNotMatch(rewritten, /iosAppId|ios_app_id/);

  const dir = mkdtempSync(path.join(tmpdir(), 'digestlocal-ads-'));
  const file = path.join(dir, 'app.json');
  writeFileSync(file, source);
  assert.equal(syncRootMobileAdsAppIds(ids, { env: {}, argv: ['node', 'expo', 'start'], file }), false);
  assert.equal(readFileSync(file, 'utf8'), source);
  assert.equal(syncRootMobileAdsAppIds(ids, { env: { EAS_BUILD: 'true' }, argv: ['node'], file }), true);
  const written = readFileSync(file, 'utf8');
  assert.match(written, new RegExp(`"android_app_id": "${ADMOB_ANDROID_APP_ID}"`));
  assert.doesNotMatch(written, /iosAppId|ios_app_id/);
  assert.equal(JSON.parse(written)['react-native-google-mobile-ads'].android_app_id, ADMOB_ANDROID_APP_ID);
  assert.equal(syncRootMobileAdsAppIds(ids, { env: { EAS_BUILD: 'true' }, argv: ['node'], file }), false);
  rmSync(dir, { recursive: true, force: true });
});

test('every cold start is a new session', () => {
  const config = { ...AD_DEFAULTS };
  const first = nextSessionState(emptyAdState(NOW), { type: 'launch' }, config, NOW);
  assert.equal(first.sessionCount, 1);
  assert.equal(first.firstOpenAt, NOW);

  const killedWhileActive = nextSessionState(first, { type: 'launch' }, config, NOW + 5_000);
  assert.equal(killedWhileActive.sessionCount, 2);
  assert.equal(killedWhileActive.sessionStartedAt, NOW + 5_000);

  const left = nextSessionState(killedWhileActive, { type: 'background' }, config, NOW + 60_000);
  const briefColdStart = nextSessionState(left, { type: 'launch' }, config, NOW + 61_000);
  assert.equal(briefColdStart.sessionCount, 3);
  assert.equal(briefColdStart.lastBackgroundAt, null);
});

test('a warm resume keeps the session until the background gap', () => {
  const config = { ...AD_DEFAULTS };
  const first = nextSessionState(emptyAdState(NOW), { type: 'launch' }, config, NOW);
  const backgrounded = nextSessionState(first, { type: 'background' }, config, NOW + 60_000);
  const soon = nextSessionState(backgrounded, { type: 'active' }, config, NOW + 60_000 + 29 * 60 * 1000);
  assert.equal(soon.sessionCount, 1);
  assert.equal(soon.lastBackgroundAt, null);

  const later = nextSessionState(backgrounded, { type: 'active' }, config, NOW + 60_000 + 30 * 60 * 1000);
  assert.equal(later.sessionCount, 2);
  assert.equal(later.sessionStartedAt, NOW + 60_000 + 30 * 60 * 1000);

  const secondBackground = nextSessionState(backgrounded, { type: 'background' }, config, NOW + 60_000 + 30 * 60 * 1000);
  assert.equal(secondBackground.lastBackgroundAt, backgrounded.lastBackgroundAt);
  const resume = nextSessionState(secondBackground, { type: 'active' }, config, NOW + 60_000 + 30 * 60 * 1000);
  assert.equal(resume.sessionCount, 2);
});

test('remote config can set the warm-resume gap below 30 minutes', () => {
  const shortened = clampRemoteOverride({ sessionGapMinutes: 10 });
  assert.equal(shortened.sessionGapMinutes, 10);
  assert.equal(clampRemoteOverride({ sessionGapMinutes: 0 }).sessionGapMinutes, 1);
  assert.equal(clampRemoteOverride({ sessionGapMinutes: 24 * 60 + 5 }).sessionGapMinutes, 24 * 60);

  const first = nextSessionState(emptyAdState(NOW), { type: 'launch' }, shortened, NOW);
  const backgrounded = nextSessionState(first, { type: 'background' }, shortened, NOW + 1_000);
  const early = nextSessionState(backgrounded, { type: 'active' }, shortened, NOW + 1_000 + 9 * 60 * 1000);
  assert.equal(early.sessionCount, 1);
  const after = nextSessionState(backgrounded, { type: 'active' }, shortened, NOW + 1_000 + 10 * 60 * 1000);
  assert.equal(after.sessionCount, 2);
});

test('interstitial and rewarded block reasons name the cap that failed', () => {
  assert.equal(interstitialBlockReason('save', input({}, { sessionCount: 2 })), 'session 2 is below 3');
  assert.equal(interstitialBlockReason('save', input({}, { sessionStartedAt: NOW - 30_000 })), null);
  assert.equal(interstitialBlockReason('save', input({}, { saveInterstitialCounter: 4 })), 'save 4 is not a multiple of 3');
  assert.equal(interstitialBlockReason('save', input()), null);
  assert.equal(interstitialBlockReason('save', input({ fromShare: true })), 'opened from a share');

  assert.equal(
    rewardedBlockReason('quiz_unlock', input({}, { quizUnlocksToday: { date: localDateKey(NOW), count: 8 } })),
    'quiz unlock daily cap 8',
  );
  assert.equal(rewardedBlockReason('ad_free', input({}, { adFreeUntil: NOW + 60_000 })), null);
  assert.equal(
    rewardedBlockReason('ad_free', input({}, { adFreePassesToday: { date: localDateKey(NOW), count: 6 } })),
    'ad-free pass daily cap 6',
  );
  assert.equal(
    interstitialBlockReason('save', input({}, { adFreeUntil: NOW - 4 * 60 * 1000 })),
    'interstitial waits 300s after the ad-free pass',
  );
  assert.equal(rewardedBlockReason('quiz_unlock', input()), null);
  assert.equal(
    rewardedBlockReason('extra_speeds', input({}, { extraSpeedsUntil: NOW + 60_000 })),
    'extra speeds already unlocked',
  );
});

test('the save interstitial counter ignores saves before session 3', () => {
  const config = { ...AD_DEFAULTS };
  assert.equal(nextSaveInterstitialCounter(state({ sessionCount: 1, saveInterstitialCounter: 4 }), config), 4);
  assert.equal(nextSaveInterstitialCounter(state({ sessionCount: 2, saveInterstitialCounter: 0 }), config), 0);
  assert.equal(nextSaveInterstitialCounter(state({ sessionCount: 3, saveInterstitialCounter: 2 }), config), 3);
});

test('ad-free passes stack to 3 hours and quiz rewards add 3 questions', () => {
  const config = { ...AD_DEFAULTS };
  const hour = 60 * 60 * 1000;
  assert.equal(nextAdFreeUntil(null, NOW, config), NOW + hour);
  assert.equal(nextAdFreeUntil(NOW + 90 * 60 * 1000, NOW, config), NOW + 90 * 60 * 1000 + hour);
  assert.equal(nextAdFreeUntil(NOW + 2.5 * hour, NOW, config), NOW + 3 * hour);
  assert.equal(formatAdFreeRemaining(NOW + hour, NOW), '1 hour left');
  assert.equal(formatAdFreeRemaining(NOW + 90 * 60 * 1000, NOW), '1 hour 30 minutes left');
  assert.equal(formatAdFreeRemaining(NOW - 1000, NOW), null);

  let rewarded = emptyAdState(NOW);
  rewarded = grantRewardedReward(rewarded, 'ad_free', NOW, config);
  rewarded = grantRewardedReward(rewarded, 'ad_free', NOW, config);
  rewarded = grantRewardedReward(rewarded, 'ad_free', NOW, config);
  assert.equal(rewarded.adFreeUntil, NOW + 3 * hour);
  assert.equal(rewarded.adFreePassesToday.count, 3);

  const capped = grantRewardedReward({ ...rewarded, adFreeUntil: NOW + 3 * hour }, 'ad_free', NOW, config);
  assert.equal(capped.adFreeUntil, NOW + 3 * hour);

  const quiz = grantRewardedReward(emptyAdState(NOW), 'quiz_unlock', NOW, config, {
    articleId: 'article-1',
    quizQuestionCount: 8,
  });
  assert.equal(quiz.quizExtra['article-1'], 3);
  assert.equal(quiz.quizOffersAccepted, 1);
  const more = grantRewardedReward(quiz, 'quiz_unlock', NOW, config, {
    articleId: 'article-1',
    quizQuestionCount: 8,
  });
  assert.equal(more.quizExtra['article-1'], 5);
  const fresh = grantRewardedReward(more, 'quiz_unlock', NOW, config, {
    articleId: 'article-1',
    quizQuestionCount: 8,
    quizFresh: true,
  });
  assert.equal(fresh.quizExtra['article-1'], 0);
  assert.equal(fresh.quizUnlocksToday.count, 3);
  assert.equal(fresh.quizOffersAccepted, 3);

  assert.deepEqual(
    planQuizOffer({
      questionCount: 8,
      capApplies: true,
      freeCap: 3,
      extra: 0,
      rewardQuestions: 3,
      freshAvailable: false,
    }),
    { kind: 'extend', add: 3 },
  );
  assert.deepEqual(
    planQuizOffer({
      questionCount: 4,
      capApplies: true,
      freeCap: 3,
      extra: 0,
      rewardQuestions: 3,
      freshAvailable: false,
    }),
    { kind: 'extend', add: 1 },
  );
  assert.deepEqual(
    planQuizOffer({
      questionCount: 8,
      capApplies: true,
      freeCap: 3,
      extra: 5,
      rewardQuestions: 3,
      freshAvailable: false,
    }),
    { kind: 'hide' },
  );
  assert.deepEqual(
    planQuizOffer({
      questionCount: 8,
      capApplies: true,
      freeCap: 3,
      extra: 5,
      rewardQuestions: 3,
      freshAvailable: true,
    }),
    { kind: 'fresh' },
  );

  const migrated = sanitizeAdState({ quizUnlocks: ['article-1'], quizOffersShown: 2, quizOffersAccepted: 1 });
  assert.equal(migrated.quizExtra['article-1'], 8);
  assert.equal(migrated.quizOffersShown, 2);
  assert.equal(migrated.quizOffersAccepted, 1);
});

test('the entitlement flag and public contact details default off the old placeholders', () => {
  assert.equal(isProEnabledFrom({}, {}), false);
  assert.equal(isProEnabledFrom({ EXPO_PUBLIC_PRO_ENABLED: 'true' }, { proEnabled: false }), true);
  assert.equal(isProEnabledFrom({}, { proEnabled: true }), true);
  assert.equal(isProEnabledFrom({ EXPO_PUBLIC_PRO_ENABLED: '0' }, { proEnabled: true }), false);
  assert.equal(PRIVACY_POLICY_URL, 'https://derugithub.github.io/Privacy-policy/digestlocal/');
  assert.equal(SUPPORT_EMAIL, 'movadmob@gmail.com');
});

test('remote config cannot loosen the new pass and quiz caps', () => {
  const clamped = clampRemoteOverride({
    adFreePassHours: 24,
    adFreePassPerDay: 10,
    adFreePassMaxHours: 10,
    afterAdFreeCooldownSec: 60,
    quizUnlockPerDay: 20,
    afterRewardedCooldownSec: 30,
    rewardedDailyCap: 40,
  });
  assert.equal(clamped.adFreePassHours, 1);
  assert.equal(clamped.adFreePassPerDay, AD_DEFAULTS.adFreePassPerDay);
  assert.equal(clamped.adFreePassMaxHours, 3);
  assert.equal(clamped.afterAdFreeCooldownSec, 300);
  assert.equal(clamped.quizUnlockPerDay, AD_DEFAULTS.quizUnlockPerDay);
  assert.equal(clamped.afterRewardedCooldownSec, 120);
  assert.equal(clamped.rewardedDailyCap, AD_DEFAULTS.rewardedDailyCap);
});

test('fullscreen reload backs off and then caps', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((attempt) => fullscreenReloadDelayMs(attempt)),
    [2_000, 4_000, 8_000, 16_000, 30_000, 30_000],
  );
});
