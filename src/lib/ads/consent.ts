import type { AdsConsentInfo, AdsConsentInfoOptions } from 'react-native-google-mobile-ads';

import { TEST_DEVICE_IDENTIFIERS } from '@/lib/ads/ad-config';

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
