import Constants from 'expo-constants';

/**
 * Test ads are used in dev and in any build whose EAS profile is not live.
 * Preview builds set ADS_MODE=test so closed testers never see live units.
 */
export function isTestAdsMode(): boolean {
  if (__DEV__) return true;
  const extra = Constants.expoConfig?.extra as { adsMode?: string } | undefined;
  return extra?.adsMode !== 'live';
}
