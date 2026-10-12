export const ADMOB_ANDROID_APP_ID_PLACEHOLDER: string;
export const GOOGLE_SAMPLE_ANDROID_APP_ID: string;
export const GOOGLE_SAMPLE_IOS_APP_ID: string;

export function resolveAndroidAppId(input: {
  profile: string;
  adsMode?: string | null;
  fromEnv?: string | null;
  fromConfig?: string | null;
}): string;

export function resolveIosAppId(input: {
  profile: string;
  adsMode?: string | null;
  fromEnv?: string | null;
  fromConfig?: string | null;
}): string;

export function resolveMobileAdsAppIds(input: {
  profile: string;
  adsMode?: string | null;
  androidFromEnv?: string | null;
  androidFromConfig?: string | null;
  iosFromEnv?: string | null;
  iosFromConfig?: string | null;
}): { androidAppId: string; iosAppId: string };

export function applyRootMobileAdsAppIds(
  appJsonText: string,
  ids: { androidAppId: string; iosAppId: string },
): string;

export function shouldSyncRootAppJson(
  env?: Record<string, string | undefined>,
  argv?: string[],
): boolean;

export function syncRootMobileAdsAppIds(
  ids: { androidAppId: string; iosAppId: string },
  options?: {
    env?: Record<string, string | undefined>;
    argv?: string[];
    file?: string;
  },
): boolean;
