import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { isProEnabled } from '@/lib/pro-flag';

export const PRO_STORAGE_KEY = 'entitlement.pro';

export interface BillingProvider {
  isAvailable(): Promise<boolean>;
  /** Localized price from the store, or null when the store cannot quote one. */
  getProPrice(): Promise<string | null>;
  purchasePro(): Promise<'purchased' | 'cancelled' | 'error'>;
  /** True when Pro is owned on this store account. */
  restore(): Promise<boolean>;
}

/**
 * Billing is not available. Ethiopia cannot register a Google Play merchant account yet,
 * so this build does not ship react-native-iap or RevenueCat.
 *
 * TODO(billing): ReactNativeIapProvider: product id 'pro_lifetime' (non-consumable),
 * acknowledge within 3 days, restore via getAvailablePurchases().
 * Blocked on a merchant-eligible payments profile.
 */
export class StubBillingProvider implements BillingProvider {
  async isAvailable(): Promise<boolean> {
    return false;
  }

  async getProPrice(): Promise<string | null> {
    return null;
  }

  async purchasePro(): Promise<'purchased' | 'cancelled' | 'error'> {
    return 'error';
  }

  async restore(): Promise<boolean> {
    return false;
  }
}

type EntitlementValue = {
  ready: boolean;
  /** True only when the build flag is on and this device has the entitlement. */
  proEnabled: boolean;
  isPro: boolean;
  setPro: (value: boolean) => Promise<void>;
  billing: BillingProvider;
};

const EntitlementContext = createContext<EntitlementValue>({
  ready: false,
  proEnabled: false,
  isPro: false,
  setPro: async () => undefined,
  billing: new StubBillingProvider(),
});

export function EntitlementProvider({ children }: { children: ReactNode }) {
  const proEnabled = isProEnabled();
  const [ready, setReady] = useState(!proEnabled);
  const [isPro, setIsPro] = useState(false);
  const billing = useMemo(() => new StubBillingProvider(), []);

  useEffect(() => {
    if (!proEnabled) return;
    let cancelled = false;
    import('expo-sqlite/kv-store')
      .then((module) => module.default.getItem(PRO_STORAGE_KEY))
      .then((value) => {
        if (!cancelled) setIsPro(value === '1');
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [proEnabled]);

  const setPro = useCallback(async (value: boolean) => {
    if (!proEnabled) return;
    setIsPro(value);
    try {
      const storage = (await import('expo-sqlite/kv-store')).default;
      if (value) await storage.setItem(PRO_STORAGE_KEY, '1');
      else await storage.removeItem(PRO_STORAGE_KEY);
    } catch {
      // The in-memory switch still hides ads for this session.
    }
  }, [proEnabled]);

  const value = useMemo(
    () => ({ ready, proEnabled, isPro: proEnabled && isPro, setPro, billing }),
    [billing, isPro, proEnabled, ready, setPro],
  );
  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
}

export function useEntitlement(): EntitlementValue {
  return useContext(EntitlementContext);
}
