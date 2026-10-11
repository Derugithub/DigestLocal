export type GoogleMobileAdsModule = never;

export function loadGoogleMobileAds(): GoogleMobileAdsModule {
  throw new Error('Google Mobile Ads is not loaded on web.');
}
