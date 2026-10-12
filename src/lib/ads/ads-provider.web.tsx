import { useMemo, type ReactNode } from 'react';

import { AdsContext, idleAdsContext } from '@/lib/ads/ads-context';
import { useEntitlement } from '@/lib/entitlement';

/** Web has no ad SDK. Screens keep rendering; every ad call is a no-op. */
export function AdsProvider({ children }: { children: ReactNode }) {
  const { isPro } = useEntitlement();
  const value = useMemo(() => ({ ...idleAdsContext, isPro, extraSpeedsUnlocked: true }), [isPro]);
  return <AdsContext.Provider value={value}>{children}</AdsContext.Provider>;
}
