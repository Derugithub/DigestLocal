import { useGlobalSearchParams, usePathname } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import {
  REMOTE_CONFIG_TTL_MS,
  TEST_DEVICE_IDENTIFIERS,
  adConfigFromDefaults,
  adRequestOptions,
  clampRemoteOverride,
  type AdConfig,
} from '@/lib/ads/ad-config';
import {
  bumpToday,
  canInitAds,
  canOfferRewarded as policyCanOfferRewarded,
  canPreloadInterstitial,
  canShowBanner,
  canShowInterstitial,
  isAdFree,
  nextSessionState,
  type PolicyInput,
  type RewardedKind,
} from '@/lib/ads/ad-policy';
import {
  loadAdState,
  loadRemoteConfigCache,
  saveAdState,
  saveRemoteConfigCache,
  type AdState,
} from '@/lib/ads/ad-state';
import { getUnitId, type AdPlacement, type TestIdMap } from '@/lib/ads/ad-units';
import { AdsContext, type AdsContextValue, type ShowInterstitialResult, type ShowRewardedResult, type SuppressionReason } from '@/lib/ads/ads-context';
import { isTestAdsMode } from '@/lib/ads/ads-mode';
import { clearShareHandoff, isShareHandoff, subscribeShareHandoff } from '@/lib/ads/share-handoff';
import { countArticles } from '@/lib/articles';
import { useDatabase } from '@/lib/database';
import { useEntitlement } from '@/lib/entitlement';

const FULLSCREEN_MAX_AGE_MS = 60 * 60 * 1000;
const SHOW_EVENT_TIMEOUT_MS = 3000;
const CLOSE_TIMEOUT_MS = 120_000;

function adLoadErrorText(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.slice(0, 300) || 'Ad failed to load';
  }
  if (typeof error === 'string' && error.trim()) return error.trim().slice(0, 300);
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim().slice(0, 300);
  }
  return 'Ad failed to load';
}

async function loadNative() {
  const { loadGoogleMobileAds } = await import('@/lib/ads/native-ads');
  return loadGoogleMobileAds();
}

type FullscreenAd = {
  loaded: boolean;
  load: () => void;
  show: () => Promise<unknown>;
  destroy: () => void;
  addAdEventListener: (type: string, listener: (payload?: unknown) => void) => () => void;
};

type HeldAd = { ad: FullscreenAd; unitId: string; loadedAt: number };

async function resolveAdConfig(now: number): Promise<AdConfig> {
  const defaults = adConfigFromDefaults();
  if (!defaults.remoteConfigUrl) return defaults;
  const cached = await loadRemoteConfigCache();
  if (cached && now - cached.fetchedAt < REMOTE_CONFIG_TTL_MS) {
    try {
      return clampRemoteOverride(cached.config, defaults);
    } catch {
      return defaults;
    }
  }
  try {
    const response = await fetch(defaults.remoteConfigUrl);
    if (!response.ok) throw new Error(`Remote ad config responded ${response.status}`);
    const json: unknown = await response.json();
    const config = clampRemoteOverride(json, defaults);
    await saveRemoteConfigCache({ fetchedAt: now, config });
    return config;
  } catch {
    return defaults;
  }
}

function armAdWait(ad: FullscreenAd, openedType: string, closedType: string, errorType: string) {
  let settled = false;
  let opened = false;
  const unsubs: (() => void)[] = [];
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let finish: (result: 'closed' | 'timeout' | 'error') => void = () => undefined;
  const done = new Promise<'closed' | 'timeout' | 'error'>((resolve) => {
    finish = (result) => {
      if (settled) return;
      settled = true;
      if (openTimer) clearTimeout(openTimer);
      if (closeTimer) clearTimeout(closeTimer);
      unsubs.forEach((unsub) => unsub());
      resolve(result);
    };
  });
  openTimer = setTimeout(() => {
    if (!opened) finish('timeout');
  }, SHOW_EVENT_TIMEOUT_MS);
  closeTimer = setTimeout(() => finish('timeout'), CLOSE_TIMEOUT_MS);
  unsubs.push(
    ad.addAdEventListener(openedType, () => {
      opened = true;
      clearTimeout(openTimer);
    }),
    ad.addAdEventListener(closedType, () => finish('closed')),
    ad.addAdEventListener(errorType, () => finish('error')),
  );
  return { done, cancel: () => finish('error') };
}

export function AdsProvider({ children }: { children: ReactNode }) {
  const { db } = useDatabase();
  const { isPro, ready: entitlementReady } = useEntitlement();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ source?: string | string[] }>();
  const source = Array.isArray(params.source) ? params.source[0] : params.source;

  const [config, setConfig] = useState<AdConfig>(adConfigFromDefaults);
  const [adState, setAdState] = useState<AdState | null>(null);
  const [booted, setBooted] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [canRequestAds, setCanRequestAds] = useState(false);
  const [privacyOptionsRequired, setPrivacyOptionsRequired] = useState(false);
  const [rewardedFlag, setRewardedFlag] = useState(false);
  const [suppressed, setSuppressed] = useState(false);
  const [shareHandoff, setShareHandoff] = useState(isShareHandoff);
  const [libraryTestIds, setLibraryTestIds] = useState<TestIdMap | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [trackedPro, setTrackedPro] = useState(isPro);
  const [consentStatus, setConsentStatus] = useState('not read');
  const [lastLoadError, setLastLoadError] = useState<string | null>(null);

  // Turning Pro off tears the SDK flags down without an effect, so the next
  // render can start init again. Displayed readiness is also gated on !isPro.
  if (isPro !== trackedPro) {
    setTrackedPro(isPro);
    if (isPro) {
      setSdkReady(false);
      setCanRequestAds(false);
      setRewardedFlag(false);
    }
  }

  const ready = sdkReady && !isPro;
  const rewardedLoaded = rewardedFlag && !isPro;
  const holdForShare = pathname !== '/' && pathname !== '' && (source === 'share' || shareHandoff);

  const stateRef = useRef<AdState | null>(null);
  const configRef = useRef(config);
  const reasonsRef = useRef(new Set<SuppressionReason>());
  const readyRef = useRef(false);
  const canRequestRef = useRef(false);
  const proRef = useRef(isPro);
  const initRef = useRef<'idle' | 'running' | 'done'>('idle');
  const initGeneration = useRef(0);
  const interstitialRef = useRef<HeldAd | null>(null);
  const rewardedRef = useRef<HeldAd | null>(null);
  const bootedRef = useRef(false);

  useEffect(() => {
    stateRef.current = adState;
    configRef.current = config;
    readyRef.current = ready;
    canRequestRef.current = canRequestAds && !isPro;
    proRef.current = isPro;
  }, [adState, canRequestAds, config, isPro, ready]);

  const commit = useCallback(async (updater: (prev: AdState) => AdState) => {
    const prev = stateRef.current;
    if (!prev) return prev;
    const next = updater(prev);
    stateRef.current = next;
    setAdState(next);
    setNow(Date.now());
    await saveAdState(next);
    return next;
  }, []);

  useEffect(
    () =>
      subscribeShareHandoff(() => {
        setShareHandoff(isShareHandoff());
      }),
    [],
  );

  useEffect(() => {
    if (pathname === '/' || pathname === '') clearShareHandoff();
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    if (bootedRef.current) {
      if (!db) return;
      countArticles(db)
        .then((savedCount) => {
          if (cancelled) return;
          void commit((prev) => ({ ...prev, savedCount }));
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }
    if (!db) return;
    bootedRef.current = true;
    const now = Date.now();
    Promise.all([resolveAdConfig(now), loadAdState(now), countArticles(db).catch(() => 0)])
      .then(async ([nextConfig, stored, savedCount]) => {
        if (cancelled) return;
        const launched = nextSessionState(stored, { type: 'launch' }, nextConfig, now);
        const withSaved = { ...launched, savedCount };
        await saveAdState(withSaved);
        if (cancelled) return;
        setConfig(nextConfig);
        setAdState(withSaved);
        setBooted(true);
      })
      .catch(() => {
        if (!cancelled) setBooted(true);
      });
    return () => {
      cancelled = true;
    };
  }, [commit, db]);

  useEffect(() => {
    if (!booted) return;
    const sub = AppState.addEventListener('change', (next) => {
      const now = Date.now();
      const event = next === 'active' ? { type: 'active' as const } : next === 'background' || next === 'inactive' ? { type: 'background' as const } : null;
      if (!event) return;
      void commit((prev) => nextSessionState(prev, event, configRef.current, now));
    });
    return () => sub.remove();
  }, [booted, commit]);

  useEffect(() => {
    if (!isPro) return;
    initRef.current = 'idle';
    interstitialRef.current?.ad.destroy();
    rewardedRef.current?.ad.destroy();
    interstitialRef.current = null;
    rewardedRef.current = null;
  }, [isPro]);

  useEffect(() => {
    if (initRef.current !== 'idle') return;
    if (!booted || !entitlementReady || holdForShare || isPro) return;
    const snapshot = stateRef.current;
    if (!snapshot) return;
    if (!canInitAds(snapshot, configRef.current, { isPro: false, platform: Platform.OS })) return;

    const generation = initGeneration.current;
    initRef.current = 'running';
    const stale = () => generation !== initGeneration.current || proRef.current || isShareHandoff();

    const run = async () => {
      try {
        const consent = await import('@/lib/ads/consent');
        const native = (await import('@/lib/ads/native-ads')).loadGoogleMobileAds();
        if (stale()) {
          if (initRef.current === 'running') initRef.current = 'idle';
          return;
        }
        try {
          await consent.gatherConsent(
            __DEV__ ? { testDeviceIdentifiers: [...TEST_DEVICE_IDENTIFIERS] } : undefined,
          );
        } catch (error) {
          console.warn('DigestLocal ads: consent update failed. Using the previous consent status.', error);
        }
        if (stale()) {
          if (initRef.current === 'running') initRef.current = 'idle';
          return;
        }
        const info = await consent.readConsent();
        if (stale()) {
          if (initRef.current === 'running') initRef.current = 'idle';
          return;
        }
        setPrivacyOptionsRequired(consent.privacyOptionsRequired(info));
        setCanRequestAds(info.canRequestAds);
        canRequestRef.current = info.canRequestAds;
        setConsentStatus(info.status);
        if (!info.canRequestAds) {
          initRef.current = 'done';
          return;
        }
        const testMode = isTestAdsMode();
        if (testMode) {
          setLibraryTestIds({
            shelf_banner: native.TestIds.ADAPTIVE_BANNER,
            article_end_banner: native.TestIds.ADAPTIVE_BANNER,
            save_interstitial: native.TestIds.INTERSTITIAL,
            study_rewarded: native.TestIds.REWARDED,
          });
        }
        await native.MobileAds().setRequestConfiguration({
          maxAdContentRating: native.MaxAdContentRating.PG,
          // v17 deprecates these in favor of ageRestrictedTreatment. The brief still sets both to false.
          tagForChildDirectedTreatment: false,
          tagForUnderAgeOfConsent: false,
          ageRestrictedTreatment: native.AgeRestrictedTreatment.UNSPECIFIED,
          ...(testMode ? { testDeviceIdentifiers: [...TEST_DEVICE_IDENTIFIERS] } : {}),
        });
        await native.MobileAds().initialize();
        if (stale()) {
          if (initRef.current === 'running') initRef.current = 'idle';
          return;
        }
        setSdkReady(true);
        readyRef.current = true;
        initRef.current = 'done';
      } catch (error) {
        if (initRef.current === 'running') initRef.current = 'idle';
        console.warn('DigestLocal ads: Mobile Ads SDK did not start.', error);
      }
    };
    void run();
    return () => {
      if (initRef.current !== 'running') return;
      initGeneration.current += 1;
      initRef.current = 'idle';
    };
  }, [
    adState?.savedCount,
    adState?.sessionCount,
    booted,
    config.adsEnabled,
    config.minSavedForAds,
    config.minSessionForAds,
    entitlementReady,
    holdForShare,
    isPro,
  ]);

  const policyInput = useCallback(
    (extra?: Partial<PolicyInput>): PolicyInput => ({
      now: Date.now(),
      isPro: proRef.current,
      config: configRef.current,
      state: stateRef.current ?? adState ?? {
        firstOpenAt: null,
        sessionCount: 0,
        lastBackgroundAt: null,
        sessionStartedAt: 0,
        savedCount: 0,
        saveInterstitialCounter: 0,
        lastFullscreenAt: null,
        fullscreenToday: { date: '', count: 0 },
        rewardedToday: { date: '', count: 0 },
        quizUnlocksToday: { date: '', count: 0 },
        lastRewardedClosedAt: null,
        adFreeUntil: null,
        quizUnlocks: [],
      },
      suppressed: reasonsRef.current.size > 0,
      ready: readyRef.current,
      canRequestAds: canRequestRef.current,
      platform: Platform.OS,
      ...extra,
    }),
    [adState],
  );

  const unitId = useCallback(
    (placement: AdPlacement) =>
      getUnitId(placement, {
        testMode: isTestAdsMode(),
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        testIds: libraryTestIds ?? undefined,
      }),
    [libraryTestIds],
  );

  const suppress = useCallback((reason: SuppressionReason) => {
    if (reasonsRef.current.has(reason)) return;
    const next = new Set(reasonsRef.current);
    next.add(reason);
    reasonsRef.current = next;
    setSuppressed(true);
  }, []);

  const release = useCallback((reason: SuppressionReason) => {
    if (!reasonsRef.current.has(reason)) return;
    const next = new Set(reasonsRef.current);
    next.delete(reason);
    reasonsRef.current = next;
    setSuppressed(next.size > 0);
  }, []);

  const preloadInterstitial = useCallback(
    (options?: { fromShare?: boolean }) => {
      if (!readyRef.current || !canRequestRef.current || proRef.current) return;
      const input = policyInput({ fromShare: options?.fromShare });
      if (!canPreloadInterstitial('save', input)) return;
      const id = unitId('save_interstitial');
      if (!id) return;
      const held = interstitialRef.current;
      if (held && held.unitId === id && held.ad.loaded && Date.now() - held.loadedAt < FULLSCREEN_MAX_AGE_MS) return;
      held?.ad.destroy();
      interstitialRef.current = null;
      void loadNative().then((native) => {
        if (proRef.current || !readyRef.current) return;
        const latest = interstitialRef.current;
        if (latest && latest.unitId === id && latest.ad.loaded && Date.now() - latest.loadedAt < FULLSCREEN_MAX_AGE_MS) return;
        latest?.ad.destroy();
        const ad = native.InterstitialAd.createForAdRequest(id, adRequestOptions(configRef.current)) as unknown as FullscreenAd;
        const record: HeldAd = { ad, unitId: id, loadedAt: 0 };
        ad.addAdEventListener(native.AdEventType.LOADED, () => {
          record.loadedAt = Date.now();
        });
        ad.addAdEventListener(native.AdEventType.ERROR, (error) => {
          setLastLoadError(adLoadErrorText(error));
        });
        ad.load();
        interstitialRef.current = record;
      });
    },
    [policyInput, unitId],
  );

  const preloadRewarded = useCallback(() => {
    if (!readyRef.current || !canRequestRef.current || proRef.current) return;
    const id = unitId('study_rewarded');
    if (!id) return;
    const held = rewardedRef.current;
    if (held && held.unitId === id && held.ad.loaded && Date.now() - held.loadedAt < FULLSCREEN_MAX_AGE_MS) {
      setRewardedFlag(true);
      return;
    }
    held?.ad.destroy();
    rewardedRef.current = null;
    setRewardedFlag(false);
    void loadNative().then((native) => {
      if (proRef.current || !readyRef.current) return;
      const latest = rewardedRef.current;
      if (latest && latest.unitId === id && latest.ad.loaded && Date.now() - latest.loadedAt < FULLSCREEN_MAX_AGE_MS) {
        setRewardedFlag(true);
        return;
      }
      latest?.ad.destroy();
      const ad = native.RewardedAd.createForAdRequest(id, adRequestOptions(configRef.current)) as unknown as FullscreenAd;
      const record: HeldAd = { ad, unitId: id, loadedAt: 0 };
      ad.addAdEventListener(native.RewardedAdEventType.LOADED, () => {
        record.loadedAt = Date.now();
        setRewardedFlag(true);
      });
      ad.addAdEventListener(native.AdEventType.ERROR, (error) => {
        setRewardedFlag(false);
        setLastLoadError(adLoadErrorText(error));
      });
      ad.load();
      rewardedRef.current = record;
    });
  }, [unitId]);

  const showInterstitialIfEligible = useCallback(
    async (trigger: 'save' | 'back', options?: { fromShare?: boolean }): Promise<ShowInterstitialResult> => {
      if (trigger === 'back') return 'skipped';
      if (!stateRef.current) return 'skipped';
      let savedCount = stateRef.current.savedCount;
      if (db) {
        try {
          savedCount = await countArticles(db);
        } catch {
          savedCount += 1;
        }
      }
      const next = await commit((prev) => ({
        ...prev,
        savedCount,
        saveInterstitialCounter: prev.saveInterstitialCounter + 1,
      }));
      if (!next) return 'skipped';
      const input = policyInput({
        fromShare: options?.fromShare,
        state: next,
        now: Date.now(),
      });
      const held = interstitialRef.current;
      if (!canShowInterstitial('save', input) || !held?.ad.loaded) return 'skipped';
      const native = await loadNative();
      const wait = armAdWait(held.ad, native.AdEventType.OPENED, native.AdEventType.CLOSED, native.AdEventType.ERROR);
      try {
        await held.ad.show();
      } catch {
        wait.cancel();
        held.ad.destroy();
        interstitialRef.current = null;
        return 'skipped';
      }
      const now = Date.now();
      await commit((prev) => ({
        ...prev,
        lastFullscreenAt: now,
        fullscreenToday: bumpToday(prev.fullscreenToday, now),
      }));
      await wait.done;
      held.ad.destroy();
      interstitialRef.current = null;
      return 'shown';
    },
    [commit, db, policyInput],
  );

  const showRewarded = useCallback(
    async (kind: RewardedKind, options?: { articleId?: string }): Promise<ShowRewardedResult> => {
      const input = policyInput();
      if (!policyCanOfferRewarded(kind, input)) return 'unavailable';
      const held = rewardedRef.current;
      if (!held?.ad.loaded) return 'unavailable';
      const native = await loadNative();
      let earned = false;
      const unsub = held.ad.addAdEventListener(native.RewardedAdEventType.EARNED_REWARD, () => {
        earned = true;
      });
      const wait = armAdWait(held.ad, native.AdEventType.OPENED, native.AdEventType.CLOSED, native.AdEventType.ERROR);
      try {
        await held.ad.show();
      } catch {
        unsub();
        wait.cancel();
        return 'error';
      }
      await wait.done;
      unsub();
      const now = Date.now();
      await commit((prev) => {
        const quizUnlocks =
          earned && kind === 'quiz_unlock' && options?.articleId && !prev.quizUnlocks.includes(options.articleId)
            ? [...prev.quizUnlocks, options.articleId]
            : prev.quizUnlocks;
        return {
          ...prev,
          quizUnlocks,
          quizUnlocksToday:
            earned && kind === 'quiz_unlock' ? bumpToday(prev.quizUnlocksToday, now) : prev.quizUnlocksToday,
          adFreeUntil:
            earned && kind === 'ad_free' ? now + configRef.current.adFreePassHours * 60 * 60 * 1000 : prev.adFreeUntil,
          rewardedToday: bumpToday(prev.rewardedToday, now),
          lastRewardedClosedAt: now,
        };
      });
      held.ad.destroy();
      rewardedRef.current = null;
      setRewardedFlag(false);
      return earned ? 'earned' : 'closed';
    },
    [commit, policyInput],
  );

  const showPrivacyOptions = useCallback(async () => {
    if (!readyRef.current && !canRequestRef.current) return;
    try {
      const consent = await import('@/lib/ads/consent');
      const info = await consent.showPrivacyOptions();
      setPrivacyOptionsRequired(consent.privacyOptionsRequired(info));
      setCanRequestAds(info.canRequestAds);
      canRequestRef.current = info.canRequestAds;
      setConsentStatus(info.status);
    } catch (error) {
      console.warn('DigestLocal ads: privacy options did not open.', error);
    }
  }, []);

  const showConsentDebug = useCallback(async () => {
    if (!__DEV__) return;
    try {
      const consent = await import('@/lib/ads/consent');
      const info = await consent.showConsentFormDebugEea();
      setPrivacyOptionsRequired(consent.privacyOptionsRequired(info));
      setCanRequestAds(info.canRequestAds);
      canRequestRef.current = info.canRequestAds;
      setConsentStatus(info.status);
    } catch (error) {
      console.warn('DigestLocal ads: debug consent form did not open.', error);
    }
  }, []);

  const recordAdLoadError = useCallback((error: unknown) => {
    setLastLoadError(adLoadErrorText(error));
  }, []);

  const resetAdCounters = useCallback(async () => {
    const now = Date.now();
    await commit((prev) => ({
      ...prev,
      firstOpenAt: prev.firstOpenAt ?? now,
      sessionCount: Math.max(2, prev.sessionCount + 1),
      sessionStartedAt: now,
      lastBackgroundAt: null,
      saveInterstitialCounter: 0,
      lastFullscreenAt: null,
      fullscreenToday: { date: '', count: 0 },
      rewardedToday: { date: '', count: 0 },
      quizUnlocksToday: { date: '', count: 0 },
      lastRewardedClosedAt: null,
      adFreeUntil: null,
      quizUnlocks: [],
    }));
  }, [commit]);

  const value = useMemo<AdsContextValue>(() => {
    const state = adState;
    const adFree = state ? isAdFree(state, now) : false;
    const base: PolicyInput | null = state
      ? {
          now,
          isPro,
          config,
          state,
          suppressed,
          ready,
          canRequestAds: canRequestAds && !isPro,
          platform: Platform.OS,
        }
      : null;
    return {
      ready,
      isPro,
      adFree,
      adFreeUntil: state?.adFreeUntil ?? null,
      privacyOptionsRequired,
      rewardedLoaded,
      config,
      suppressed,
      quizUnlocked: (articleId: string) => state?.quizUnlocks.includes(articleId) ?? false,
      suppress,
      release,
      showInterstitialIfEligible,
      showRewarded,
      preloadInterstitial,
      preloadRewarded,
      unitId,
      canShowPlacement: (placement) => (base ? canShowBanner(placement, base) : false),
      canOfferRewarded: (kind) => (base ? policyCanOfferRewarded(kind, base) : false),
      showPrivacyOptions,
      showConsentDebug,
      resetAdCounters,
      sessionCount: state?.sessionCount ?? 0,
      consentStatus,
      lastLoadError,
      recordAdLoadError,
    };
  }, [
    adState,
    canRequestAds,
    config,
    consentStatus,
    isPro,
    lastLoadError,
    now,
    preloadInterstitial,
    preloadRewarded,
    privacyOptionsRequired,
    ready,
    recordAdLoadError,
    release,
    resetAdCounters,
    rewardedLoaded,
    showConsentDebug,
    showInterstitialIfEligible,
    showPrivacyOptions,
    showRewarded,
    suppress,
    suppressed,
    unitId,
  ]);

  useEffect(() => {
    if (!adState) return;
    const deadlines: number[] = [];
    if (adState.adFreeUntil != null) deadlines.push(adState.adFreeUntil);
    if (adState.lastRewardedClosedAt != null) {
      deadlines.push(adState.lastRewardedClosedAt + config.afterRewardedCooldownSec * 1000);
    }
    const wait = deadlines.map((deadline) => deadline - now).filter((delay) => delay > 0);
    if (wait.length === 0) return;
    const id = setTimeout(() => setNow(Date.now()), Math.min(...wait));
    return () => clearTimeout(id);
  }, [adState, config.afterRewardedCooldownSec, now]);

  return <AdsContext.Provider value={value}>{children}</AdsContext.Provider>;
}
