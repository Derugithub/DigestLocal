/**
 * Pure read of the entitlement flag. Kept separate so tests and app.config
 * do not load expo-constants.
 * `EXPO_PUBLIC_PRO_ENABLED` wins when it is set. Otherwise `extra.proEnabled` is used.
 * Both default to off.
 */
export function proEnabledFromValue(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function isProEnabledFrom(
  env: { EXPO_PUBLIC_PRO_ENABLED?: string },
  extra?: { proEnabled?: unknown },
): boolean {
  const fromEnv = env.EXPO_PUBLIC_PRO_ENABLED;
  if (fromEnv != null && fromEnv.trim() !== '') return proEnabledFromValue(fromEnv);
  return proEnabledFromValue(extra?.proEnabled);
}
