/** Placeholder kept in app.json until the owner pastes the real AdMob Android app ID. */
const ADMOB_ANDROID_APP_ID_PLACEHOLDER = 'ca-app-pub-XXXXXXXX~YYYYYYYY';

/** Google's public sample Android app ID. Safe for local, development, and preview builds. */
const GOOGLE_SAMPLE_ANDROID_APP_ID = 'ca-app-pub-3940256099942544~3347511713';

/**
 * Resolves the AdMob Android app ID that the config plugin writes into the manifest.
 * An invalid ID crashes the native SDK, so a production build must not keep the placeholder.
 *
 * 1. `ADMOB_ANDROID_APP_ID` when it is set to a real ID
 * 2. Otherwise the app.json value when it is not the placeholder
 * 3. Otherwise Google's sample ID when the EAS profile is not production
 * 4. Otherwise throw
 *
 * This file is plain JavaScript because Expo loads app.config.ts without transpiling
 * TypeScript dependencies.
 */
function resolveAndroidAppId(input) {
  const fromEnv = input.fromEnv?.trim() ?? '';
  if (fromEnv && fromEnv !== ADMOB_ANDROID_APP_ID_PLACEHOLDER) return fromEnv;

  const fromConfig = input.fromConfig?.trim() ?? '';
  if (fromConfig && fromConfig !== ADMOB_ANDROID_APP_ID_PLACEHOLDER) return fromConfig;

  if (input.profile !== 'production') return GOOGLE_SAMPLE_ANDROID_APP_ID;

  throw new Error('Set the real AdMob Android app ID before a production build');
}

module.exports = {
  ADMOB_ANDROID_APP_ID_PLACEHOLDER,
  GOOGLE_SAMPLE_ANDROID_APP_ID,
  resolveAndroidAppId,
};
