/**
 * Whether ad requests must ask for non-personalized ads only.
 *
 * True only when consent was required and the user gave it (`OBTAINED`) but did not allow
 * personalized ads. Outside the EEA/UK there is no consent string, so the library reports every
 * choice as false; that is not a refusal. If the choices could not be read, the request is left
 * alone and the SDK applies the TCF string itself.
 */
export function shouldRequestNonPersonalizedOnly(status: string, selectPersonalisedAds: boolean | null): boolean {
  return status === 'OBTAINED' && selectPersonalisedAds === false;
}
