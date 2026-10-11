export type GoogleMobileAdsModule = typeof import('react-native-google-mobile-ads');

/**
 * Loads the Google Mobile Ads module the first time ads are actually allowed.
 * Pro users and session 1 never call this, so the native module is not executed.
 */
export function loadGoogleMobileAds(): GoogleMobileAdsModule {
  // Session 1 and Pro never call this. A static import would execute the native module anyway.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native-google-mobile-ads') as GoogleMobileAdsModule;
}
