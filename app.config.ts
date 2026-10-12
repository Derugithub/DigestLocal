import type { ConfigContext, ExpoConfig } from 'expo/config';

import { resolveMobileAdsAppIds, syncRootMobileAdsAppIds } from './src/lib/ads/android-app-id.js';

/**
 * app.json stays the source for everything except the resolved AdMob app IDs and ads mode.
 * Non-live builds substitute Google's sample app IDs so a placeholder never reaches the SDK.
 * A live build throws until a real Android app ID is set in app.json or ADMOB_ANDROID_APP_ID.
 *
 * The Expo plugin options and the root `react-native-google-mobile-ads` block are separate.
 * Gradle reads the root `android_app_id` from disk, so native builds also rewrite that block.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const profile = process.env.EAS_BUILD_PROFILE ?? 'local';
  const adsMode = process.env.ADS_MODE ?? (profile === 'production' ? 'live' : 'test');

  const entry = (config.plugins ?? []).find(
    (plugin): plugin is [string, Record<string, unknown>] =>
      Array.isArray(plugin) && plugin[0] === 'react-native-google-mobile-ads',
  );
  const options = entry?.[1] ?? {};
  const ids = resolveMobileAdsAppIds({
    profile,
    adsMode,
    androidFromEnv: process.env.ADMOB_ANDROID_APP_ID,
    androidFromConfig: typeof options.androidAppId === 'string' ? options.androidAppId : undefined,
    iosFromEnv: process.env.ADMOB_IOS_APP_ID,
    iosFromConfig: typeof options.iosAppId === 'string' ? options.iosAppId : undefined,
  });
  syncRootMobileAdsAppIds(ids);

  const plugins = (config.plugins ?? []).map((plugin) => {
    if (!Array.isArray(plugin) || plugin[0] !== 'react-native-google-mobile-ads') return plugin;
    const current = { ...(plugin[1] ?? {}) } as Record<string, unknown>;
    return [
      'react-native-google-mobile-ads',
      { ...current, androidAppId: ids.androidAppId, iosAppId: ids.iosAppId },
    ] as [string, Record<string, unknown>];
  });

  return {
    ...config,
    name: config.name ?? 'DigestLocal',
    slug: config.slug ?? 'digestlocal',
    plugins,
    extra: {
      ...config.extra,
      adsMode,
    },
  };
};
