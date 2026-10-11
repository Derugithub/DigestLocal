import type { ConfigContext, ExpoConfig } from 'expo/config';

import { resolveAndroidAppId } from './src/lib/ads/android-app-id.js';

/**
 * app.json stays the source for everything except the AdMob Android app ID and ads mode.
 * Non-production builds substitute Google's sample app ID so the placeholder never reaches the SDK.
 * A production build throws until a real ID is set in app.json or ADMOB_ANDROID_APP_ID.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const profile = process.env.EAS_BUILD_PROFILE ?? 'local';
  const adsMode = process.env.ADS_MODE ?? (profile === 'production' ? 'live' : 'test');

  const plugins = (config.plugins ?? []).map((plugin) => {
    if (!Array.isArray(plugin) || plugin[0] !== 'react-native-google-mobile-ads') return plugin;
    const options = { ...(plugin[1] ?? {}) } as Record<string, unknown>;
    const fromConfig = typeof options.androidAppId === 'string' ? options.androidAppId : undefined;
    const androidAppId = resolveAndroidAppId({
      profile,
      fromEnv: process.env.ADMOB_ANDROID_APP_ID,
      fromConfig,
    });
    return ['react-native-google-mobile-ads', { ...options, androidAppId }] as [string, Record<string, unknown>];
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
