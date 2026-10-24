import type { AdsConsentInfo, AdsConsentInfoOptions } from 'react-native-google-mobile-ads';

import { TEST_DEVICE_IDENTIFIERS } from '@/lib/ads/ad-config';
import { shouldRequestNonPersonalizedOnly } from '@/lib/ads/consent-logic';

function sdk() {
  // Session 1 and Pro never reach this. A static import would execute the native module anyway.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads');
}

export async function gatherConsent(options?: AdsConsentInfoOptions): Promise<AdsConsentInfo> {
  return sdk().AdsConsent.gatherConsent(options);
}

export async function readConsent(): Promise<AdsConsentInfo> {
  return sdk().AdsConsent.getConsentInfo();
}

export function privacyOptionsRequired(info: AdsConsentInfo): boolean {
  const { AdsConsentPrivacyOptionsRequirementStatus } = sdk();
  return info.privacyOptionsRequirementStatus === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED;
}

/**
 * True only when the user gave consent in a region that requires it and declined personalized ads.
 * Everywhere else the request keeps the SDK default.
 */
export async function isNonPersonalizedOnly(info: AdsConsentInfo): Promise<boolean> {
  const { AdsConsent, AdsConsentStatus } = sdk();
  let selectPersonalisedAds: boolean | null = null;
  if (info.canRequestAds && info.status === AdsConsentStatus.OBTAINED) {
    try {
      selectPersonalisedAds = (await AdsConsent.getUserChoices()).selectPersonalisedAds;
    } catch {
      selectPersonalisedAds = null;
    }
  }
  return shouldRequestNonPersonalizedOnly(info.status, selectPersonalisedAds);
}

export async function isPrivacyOptionsRequired(): Promise<boolean> {
  return privacyOptionsRequired(await readConsent());
}

export async function showPrivacyOptions(): Promise<AdsConsentInfo> {
  return sdk().AdsConsent.showPrivacyOptionsForm();
}

/** Dev-only helper. Resets UMP, then requests the form as if the device were in the EEA. */
export async function showConsentFormDebugEea(): Promise<AdsConsentInfo> {
  const { AdsConsent, AdsConsentDebugGeography } = sdk();
  AdsConsent.reset();
  return AdsConsent.gatherConsent({
    debugGeography: AdsConsentDebugGeography.EEA,
    testDeviceIdentifiers: [...TEST_DEVICE_IDENTIFIERS],
  });
}
