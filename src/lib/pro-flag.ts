import Constants from 'expo-constants';

import { isProEnabledFrom } from '@/lib/pro-flag-value';

type ProExtra = { proEnabled?: unknown };

export { isProEnabledFrom, proEnabledFromValue } from '@/lib/pro-flag-value';

function readExtra(): ProExtra | undefined {
  const constants = Constants as typeof Constants & {
    manifest?: { extra?: ProExtra } | null;
    manifest2?: { extra?: { expoClient?: { extra?: ProExtra } } } | null;
  };
  return (
    constants.expoConfig?.extra ??
    constants.manifest2?.extra?.expoClient?.extra ??
    constants.manifest?.extra ??
    undefined
  );
}

/** True only when this build turned the dormant entitlement on. Defaults to off. */
export function isProEnabled(): boolean {
  return isProEnabledFrom({ EXPO_PUBLIC_PRO_ENABLED: process.env.EXPO_PUBLIC_PRO_ENABLED }, readExtra());
}
