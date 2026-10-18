import { PRODUCTION_UNIT_IDS as PRODUCTION_UNIT_ID_VALUES } from './production-unit-ids';

export const AD_PLACEMENTS = ['shelf_banner', 'article_end_banner', 'save_interstitial', 'study_rewarded'] as const;

export type AdPlacement = (typeof AD_PLACEMENTS)[number];

export type BannerSizeName = 'LARGE_ANCHORED_ADAPTIVE_BANNER' | 'INLINE_ADAPTIVE_BANNER';

/**
 * Production unit IDs live in production-unit-ids.js so app.config.ts can stop a live build
 * when one is missing. At runtime a remaining placeholder still turns that placement off.
 */
export const PRODUCTION_UNIT_IDS: Record<AdPlacement, string> = PRODUCTION_UNIT_ID_VALUES;

/**
 * Google's public test unit IDs, matching `TestIds` in react-native-google-mobile-ads 17.2.0.
 * Runtime test mode prefers the library's `TestIds` object so platform selection stays in the SDK.
 */
export const GOOGLE_TEST_UNIT_IDS: Record<'android', Record<AdPlacement, string>> = {
  android: {
    shelf_banner: 'ca-app-pub-3940256099942544/9214589741',
    article_end_banner: 'ca-app-pub-3940256099942544/9214589741',
    save_interstitial: 'ca-app-pub-3940256099942544/1033173712',
    study_rewarded: 'ca-app-pub-3940256099942544/5224354917',
  },
  // Kept for a future iOS release. Android is the only ad target for now.
  // ios: {
  //   shelf_banner: 'ca-app-pub-3940256099942544/2435281174',
  //   article_end_banner: 'ca-app-pub-3940256099942544/2435281174',
  //   save_interstitial: 'ca-app-pub-3940256099942544/4411468910',
  //   study_rewarded: 'ca-app-pub-3940256099942544/1712485313',
  // },
};

export type TestIdMap = Record<AdPlacement, string>;

const warned = new Set<AdPlacement>();

export function resetUnitIdWarnings(): void {
  warned.clear();
}

/**
 * Returns a unit ID, or null when live mode still has a placeholder (ads stay off).
 * In test mode the value is `TestIds.*` from the installed library when `testIds` is passed,
 * otherwise the public Google test ID for Android. iOS test IDs are commented out.
 */
export function getUnitId(
  placement: AdPlacement,
  options: { testMode: boolean; platform?: 'android' | 'ios'; testIds?: Partial<TestIdMap> },
): string | null {
  if (options.testMode) {
    const fromLibrary = options.testIds?.[placement];
    if (fromLibrary) return fromLibrary;
    // Kept for a future iOS release. Android is the only ad target for now.
    // const platform = options.platform === 'ios' ? 'ios' : 'android';
    // return GOOGLE_TEST_UNIT_IDS[platform][placement];
    return GOOGLE_TEST_UNIT_IDS.android[placement];
  }

  const id = PRODUCTION_UNIT_IDS[placement];
  if (id.includes('XXXXXXXX')) {
    if (!warned.has(placement)) {
      warned.add(placement);
      console.warn(
        `DigestLocal ads: ${placement} still uses a placeholder unit id. That placement stays off until a real AdMob unit id is set.`,
      );
    }
    return null;
  }
  return id;
}
