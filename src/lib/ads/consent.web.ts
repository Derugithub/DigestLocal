type ConsentInfo = {
  canRequestAds: false;
  privacyOptionsRequirementStatus: 'NOT_REQUIRED';
  status: 'NOT_REQUIRED';
  isConsentFormAvailable: false;
};

const idle: ConsentInfo = {
  canRequestAds: false,
  privacyOptionsRequirementStatus: 'NOT_REQUIRED',
  status: 'NOT_REQUIRED',
  isConsentFormAvailable: false,
};

export async function gatherConsent(): Promise<ConsentInfo> {
  return idle;
}

export async function readConsent(): Promise<ConsentInfo> {
  return idle;
}

export function privacyOptionsRequired(): boolean {
  return false;
}

export async function isPrivacyOptionsRequired(): Promise<boolean> {
  return false;
}

export async function showPrivacyOptions(): Promise<ConsentInfo> {
  return idle;
}

export async function showConsentFormDebugEea(): Promise<ConsentInfo> {
  return idle;
}
