export const ADMOB_ANDROID_APP_ID_PLACEHOLDER: string;
export const GOOGLE_SAMPLE_ANDROID_APP_ID: string;

export function resolveAndroidAppId(input: {
  profile: string;
  fromEnv?: string | null;
  fromConfig?: string | null;
}): string;
