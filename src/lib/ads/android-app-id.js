/* global __dirname */
const fs = require('fs');
const path = require('path');

/** Placeholder kept in app.json until the owner pastes the real AdMob Android app ID. */
const ADMOB_ANDROID_APP_ID_PLACEHOLDER = 'ca-app-pub-XXXXXXXX~YYYYYYYY';

/** Google's public sample Android app ID. Safe for local, development, and preview builds. */
const GOOGLE_SAMPLE_ANDROID_APP_ID = 'ca-app-pub-3940256099942544~3347511713';

// Kept for a future iOS release. Android is the only ad target for now.
// const GOOGLE_SAMPLE_IOS_APP_ID = 'ca-app-pub-3940256099942544~1458002511';

/**
 * A build is live when ADS_MODE is live, or when the EAS profile is production
 * and ADS_MODE was not forced to test. Placeholders must not ship in a live build.
 */
function isLiveAdBuild(input) {
  if (input.adsMode === 'live') return true;
  if (input.adsMode === 'test') return false;
  return input.profile === 'production';
}

function firstRealId(fromEnv, fromConfig) {
  const envId = fromEnv?.trim() ?? '';
  if (envId && envId !== ADMOB_ANDROID_APP_ID_PLACEHOLDER) return envId;
  const configId = fromConfig?.trim() ?? '';
  if (configId && configId !== ADMOB_ANDROID_APP_ID_PLACEHOLDER) return configId;
  return '';
}

/**
 * Resolves the AdMob Android app ID that native config should use.
 * An invalid ID crashes the native SDK, so a live build must not keep the placeholder.
 *
 * 1. `ADMOB_ANDROID_APP_ID` when it is set to a real ID
 * 2. Otherwise the app.json value when it is not the placeholder
 * 3. Otherwise Google's sample ID when the build is not live
 * 4. Otherwise throw
 *
 * This file is plain JavaScript because Expo loads app.config.ts without transpiling
 * TypeScript dependencies.
 */
function resolveAndroidAppId(input) {
  const real = firstRealId(input.fromEnv, input.fromConfig);
  if (real) return real;
  if (!isLiveAdBuild(input)) return GOOGLE_SAMPLE_ANDROID_APP_ID;
  throw new Error('Set the real AdMob Android app ID before a production build');
}

// Kept for a future iOS release. Android is the only ad target for now.
// function resolveIosAppId(input) {
//   const real = firstRealId(input.fromEnv, input.fromConfig);
//   if (real) return real;
//   if (!isLiveAdBuild(input)) return GOOGLE_SAMPLE_IOS_APP_ID;
//   throw new Error('Set the real AdMob iOS app ID before a production build');
// }

function resolveMobileAdsAppIds(input) {
  return {
    androidAppId: resolveAndroidAppId({
      profile: input.profile,
      adsMode: input.adsMode,
      fromEnv: input.androidFromEnv,
      fromConfig: input.androidFromConfig,
    }),
    // Kept for a future iOS release. Android is the only ad target for now.
    // iosAppId: resolveIosAppId({
    //   profile: input.profile,
    //   adsMode: input.adsMode,
    //   fromEnv: input.iosFromEnv,
    //   fromConfig: input.iosFromConfig,
    // }),
  };
}

/**
 * Gradle reads the root `react-native-google-mobile-ads` block from app.json on disk.
 * The Expo plugin `androidAppId` is a different key. The iOS app id stays commented out.
 */
function withoutFullLineComments(source) {
  return source
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

/**
 * Writes the resolved Android app ID. The iOS id stays commented out for a future iOS release.
 * Gradle parses app.json with strict JSON, so the native-build rewrite also drops full-line comments.
 * `expo start` does not write that rewrite, and the Android placeholder in git stays unchanged.
 */
function applyRootMobileAdsAppIds(appJsonText, ids) {
  const withAndroid = replaceJsonString(appJsonText, 'android_app_id', ids.androidAppId);
  // Kept for a future iOS release. Android is the only ad target for now.
  // return replaceJsonString(withAndroid, 'ios_app_id', ids.iosAppId);
  return withoutFullLineComments(withAndroid);
}

function replaceJsonString(source, key, value) {
  const pattern = new RegExp(`("${key}"\\s*:\\s*")[^"]*(")`);
  if (!pattern.test(source)) {
    throw new Error(`app.json is missing "${key}"`);
  }
  return source.replace(pattern, `$1${value}$2`);
}

/** Native builds need the root IDs rewritten before Gradle or Xcode read app.json. */
function shouldSyncRootAppJson(env = process.env, argv = process.argv) {
  if (env.EAS_BUILD === 'true') return true;
  return /prebuild|run:android|run:ios/.test(argv.join(' '));
}

function defaultAppJsonPath() {
  return path.join(__dirname, '..', '..', '..', 'app.json');
}

/**
 * Writes the resolved IDs into the root block during EAS and local native builds.
 * `expo start` leaves the committed placeholders alone.
 * Returns true when the file changed.
 */
function syncRootMobileAdsAppIds(ids, options = {}) {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  if (!shouldSyncRootAppJson(env, argv)) return false;
  const file = options.file ?? defaultAppJsonPath();
  const source = fs.readFileSync(file, 'utf8');
  const next = applyRootMobileAdsAppIds(source, ids);
  if (next === source) return false;
  fs.writeFileSync(file, next);
  return true;
}

module.exports = {
  ADMOB_ANDROID_APP_ID_PLACEHOLDER,
  GOOGLE_SAMPLE_ANDROID_APP_ID,
  resolveAndroidAppId,
  resolveMobileAdsAppIds,
  applyRootMobileAdsAppIds,
  shouldSyncRootAppJson,
  syncRootMobileAdsAppIds,
};
