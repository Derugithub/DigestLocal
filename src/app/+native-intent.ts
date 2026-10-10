import { getShareExtensionKey } from 'expo-share-intent';

/**
 * expo-share-intent opens the app at `digestlocal://dataUrl=<scheme>ShareKey`.
 * That string is not a route. Send both cold start and warm start to the add screen.
 */
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) return '/add';
    return path;
  } catch {
    return '/';
  }
}
