import { useGlobalSearchParams, usePathname } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  canOfferRewarded as policyCanOfferRewarded,
  canPreloadInterstitial,
  canShowBanner,
  countForToday,
  fullscreenReloadDelayMs,
  initBlockReason,
  interstitialBlockReason,
  isAdFree,
  nextSessionState,
  rewardedBlockReason,
  type PolicyInput,
  type RewardedKind,
} from '@/lib/ads/ad-policy';
import {
  loadAdState,
  loadRemoteConfigCache,
  saveAdState,
  saveAdStateSync,
  saveRemoteConfigCache,
  type AdState,
} from '@/lib/ads/ad-state';
import { getUnitId, type AdPlacement, type TestIdMap } from '@/lib/ads/ad-units';
import {
  AdsContext,
  type AdsContextValue,
  type FullscreenLoadState,
  type ShowInterstitialResult,
  type ShowRewardedResult,
  type SuppressionReason,
} from '@/lib/ads/ads-context';
import { isTestAdsMode, logAdDecision } from '@/lib/ads/ads-mode';
import { clearShareHandoff, isShareHandoff, subscribeShareHandoff } from '@/lib/ads/share-handoff';
import { countArticles } from '@/lib/articles';
import { useDatabase } from '@/lib/database';
import { useEntitlement } from '@/lib/entitlement';

const FULLSCREEN_MAX_AGE_MS = 60 * 60 * 1000;
const SHOW_EVENT_TIMEOUT_MS = 3000;
const CLOSE_TIMEOUT_MS = 120_000;
const MAX_LOAD_ATTEMPTS = 5;

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

type HeldAd = {
  ad: FullscreenAd;
  unitId: string;
  loadedAt: number;
  phase: FullscreenLoadState;
  attempt: number;
  showing: boolean;
};

/** Keep an in-flight, on-screen, or fresh load. Replacing it drops the fill. */
function keepHeld(held: HeldAd | null, unitId: string): boolean {
  if (!held || held.unitId !== unitId) return false;
  if (held.showing || held.phase === 'loading') return true;
  return held.phase === 'loaded' && Date.now() - held.loadedAt < FULLSCREEN_MAX_AGE_MS;
}

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
  const done = new Promise<{ outcome: 'closed' | 'timeout' | 'error'; opened: boolean }>((resolve) => {
    finish = (result) => {
      if (settled) return;
      settled = true;
      if (openTimer) clearTimeout(openTimer);
      if (closeTimer) clearTimeout(closeTimer);
      unsubs.forEach((unsub) => unsub());
      resolve({ outcome: result, opened });
    };
  });
  openTimer = setTimeout(() => {
    if (!opened) finish('timeout');
  }, SHOW_EVENT_TIMEOUT_MS);
  closeTimer = setTimeout(() => finish('timeout'), CLOSE_TIMEOUT_MS);
  unsubs.push(
    ad.addAdEventListener(openedType, () => {
      opened = true;
      if (openTimer) clearTimeout(openTimer);
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
  const [interstitialLoadState, setInterstitialLoadState] = useState<FullscreenLoadState>('idle');
  const [rewardedLoadState, setRewardedLoadState] = useState<FullscreenLoadState>('idle');
  const [lastDecision, setLastDecision] = useState('none yet');
  const [initKick, setInitKick] = useState(0);

  // Turning Pro off tears the SDK flags down without an effect, so the next
  // render can start init again. Displayed readiness is also gated on !isPro.
  if (isPro !== trackedPro) {
    setTrackedPro(isPro);
    if (isPro) {
      setSdkReady(false);
      setCanRequestAds(false);
      setRewardedFlag(false);
      setInterstitialLoadState('idle');
      setRewardedLoadState('idle');
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
  const initAttemptRef = useRef(0);
  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interstitialRef = useRef<HeldAd | null>(null);
  const rewardedRef = useRef<HeldAd | null>(null);
  const interstitialRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rewardedRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootedRef = useRef(false);
  const preloadInterstitialRef = useRef<(options?: { fromShare?: boolean; attempt?: number }) => void>(() => undefined);
  const preloadRewardedRef = useRef<(options?: { attempt?: number }) => void>(() => undefined);

  // Layout runs before child passive effects, so a screen that preloads in
  // the same commit as `ready` flipping true sees the current flags.
  useLayoutEffect(() => {
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
      // `inactive` is an iOS transition (and fires again on the way back).
      // Recording it as a departure resets the 30 minute clock and the session never advances.
      if (next !== 'active' && next !== 'background') {
        logAdDecision('ignored app state', { next });
        return;
      }
      const now = Date.now();
      const event = next === 'active' ? { type: 'active' as const } : { type: 'background' as const };
      const prev = stateRef.current;
      if (!prev) return;
      const updated = nextSessionState(prev, event, configRef.current, now);
      if (updated === prev) {
        logAdDecision('session unchanged', { next, sessionCount: prev.sessionCount });
        return;
      }
      stateRef.current = updated;
      setAdState(updated);
      setNow(now);
      logAdDecision(updated.sessionCount === prev.sessionCount ? 'session clock updated' : 'session advanced', {
        next,
        sessionCount: updated.sessionCount,
        lastBackgroundAt: updated.lastBackgroundAt,
      });
      try {
        saveAdStateSync(updated);
      } catch (error) {
        logAdDecision('sync session write failed', { error: adLoadErrorText(error) });
        void saveAdState(updated);
      }
    });
    return () => sub.remove();
  }, [booted]);

  useEffect(() => {
    return () => {
      if (initTimerRef.current) clearTimeout(initTimerRef.current);
      if (interstitialRetryRef.current) clearTimeout(interstitialRetryRef.current);
      if (rewardedRetryRef.current) clearTimeout(rewardedRetryRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isPro) return;
    initRef.current = 'idle';
    if (initTimerRef.current) clearTimeout(initTimerRef.current);
    if (interstitialRetryRef.current) clearTimeout(interstitialRetryRef.current);
    if (rewardedRetryRef.current) clearTimeout(rewardedRetryRef.current);
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
    const blocked = initBlockReason(snapshot, configRef.current, { isPro: false, platform: Platform.OS });
    if (blocked) {
      logAdDecision('sdk init skipped', { reason: blocked, sessionCount: snapshot.sessionCount, savedCount: snapshot.savedCount });
      return;
    }

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
          logAdDecision('sdk init stopped', {
            reason: 'consent does not allow ad requests',
            consentStatus: info.status,
          });
          setLastDecision('SDK not started: consent does not allow ad requests');
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
        initAttemptRef.current = 0;
        logAdDecision('sdk ready', { testMode, consentStatus: info.status, adsMode: isTestAdsMode() ? 'test' : 'live' });
        setLastDecision('SDK ready');
      } catch (error) {
        if (initRef.current === 'running') initRef.current = 'idle';
        const message = adLoadErrorText(error);
        console.warn('DigestLocal ads: Mobile Ads SDK did not start.', error);
        logAdDecision('sdk init failed', { error: message, attempt: initAttemptRef.current + 1 });
        setLastDecision(`SDK init failed: ${message}`);
        const attempt = initAttemptRef.current + 1;
        initAttemptRef.current = attempt;
        if (attempt >= MAX_LOAD_ATTEMPTS) {
          initRef.current = 'done';
          return;
        }
        const delay = fullscreenReloadDelayMs(attempt - 1);
        if (initTimerRef.current) clearTimeout(initTimerRef.current);
        initTimerRef.current = setTimeout(() => {
          initTimerRef.current = null;
          if (initRef.current === 'idle') setInitKick((value) => value + 1);
        }, delay);
      }
    };
    void run();
    return () => {
      if (initTimerRef.current) {
        clearTimeout(initTimerRef.current);
        initTimerRef.current = null;
      }
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
    initKick,
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

  const note = useCallback((message: string, detail?: Record<string, unknown>) => {
    logAdDecision(message, detail);
    setLastDecision(detail?.reason ? `${message}: ${String(detail.reason)}` : message);
  }, []);

  const scheduleInterstitialRetry = useCallback((record: HeldAd) => {
    if (record.attempt >= MAX_LOAD_ATTEMPTS) {
      note('interstitial load stopped', { reason: 'too many errors', attempt: record.attempt });
      return;
    }
    const delay = fullscreenReloadDelayMs(record.attempt - 1);
    if (interstitialRetryRef.current) clearTimeout(interstitialRetryRef.current);
    interstitialRetryRef.current = setTimeout(() => {
      interstitialRetryRef.current = null;
      if (interstitialRef.current !== record) return;
      record.ad.destroy();
      interstitialRef.current = null;
      setInterstitialLoadState('idle');
      preloadInterstitialRef.current({ attempt: record.attempt });
    }, delay);
  }, [note]);

  const scheduleRewardedRetry = useCallback((record: HeldAd) => {
    if (record.attempt >= MAX_LOAD_ATTEMPTS) {
      note('rewarded load stopped', { reason: 'too many errors', attempt: record.attempt });
      return;
    }
    const delay = fullscreenReloadDelayMs(record.attempt - 1);
    if (rewardedRetryRef.current) clearTimeout(rewardedRetryRef.current);
    rewardedRetryRef.current = setTimeout(() => {
      rewardedRetryRef.current = null;
      if (rewardedRef.current !== record) return;
      record.ad.destroy();
      rewardedRef.current = null;
      setRewardedFlag(false);
      setRewardedLoadState('idle');
      preloadRewardedRef.current({ attempt: record.attempt });
    }, delay);
  }, [note]);

  const preloadInterstitial = useCallback(
    (options?: { fromShare?: boolean; attempt?: number }) => {
      if (!readyRef.current || !canRequestRef.current || proRef.current) {
        note('interstitial preload skipped', {
          reason: !readyRef.current ? 'sdk not ready' : !canRequestRef.current ? 'consent does not allow ad requests' : 'Pro',
        });
        return;
      }
      const input = policyInput({ fromShare: options?.fromShare });
      if (!canPreloadInterstitial('save', input)) {
        note('interstitial preload skipped', {
          reason: options?.fromShare
            ? 'opened from a share'
            : `session ${input.state.sessionCount}, saved ${input.state.savedCount}, not worth a preload yet`,
        });
        return;
      }
      const id = unitId('save_interstitial');
      if (!id) {
        note('interstitial preload skipped', { reason: 'no unit id' });
        return;
      }
      const held = interstitialRef.current;
      if (keepHeld(held, id)) {
        if (held?.phase === 'loaded') setInterstitialLoadState('loaded');
        return;
      }
      if (interstitialRetryRef.current) {
        clearTimeout(interstitialRetryRef.current);
        interstitialRetryRef.current = null;
      }
      const attempt = options?.attempt ?? (held?.phase === 'error' ? held.attempt : 0);
      held?.ad.destroy();
      interstitialRef.current = null;
      setInterstitialLoadState('loading');
      void loadNative()
        .then((native) => {
          if (proRef.current || !readyRef.current) return;
          const latest = interstitialRef.current;
          if (keepHeld(latest, id)) return;
          latest?.ad.destroy();
          const ad = native.InterstitialAd.createForAdRequest(id, adRequestOptions(configRef.current)) as unknown as FullscreenAd;
          const record: HeldAd = { ad, unitId: id, loadedAt: 0, phase: 'loading', attempt, showing: false };
          ad.addAdEventListener(native.AdEventType.LOADED, () => {
            record.phase = 'loaded';
            record.loadedAt = Date.now();
            record.attempt = 0;
            setInterstitialLoadState('loaded');
            note('interstitial loaded');
          });
          ad.addAdEventListener(native.AdEventType.ERROR, (error) => {
            if (record.showing || record.phase === 'loaded') return;
            record.phase = 'error';
            record.attempt += 1;
            const message = adLoadErrorText(error);
            setInterstitialLoadState('error');
            setLastLoadError(message);
            note('interstitial load error', { reason: message, attempt: record.attempt });
            scheduleInterstitialRetry(record);
          });
          ad.load();
          interstitialRef.current = record;
          note('interstitial loading');
        })
        .catch((error) => {
          setInterstitialLoadState('error');
          const message = adLoadErrorText(error);
          setLastLoadError(message);
          note('interstitial preload failed', { reason: message });
        });
    },
    [note, policyInput, scheduleInterstitialRetry, unitId],
  );

  const preloadRewarded = useCallback((options?: { attempt?: number }) => {
    if (!readyRef.current || !canRequestRef.current || proRef.current) {
      note('rewarded preload skipped', {
        reason: !readyRef.current ? 'sdk not ready' : !canRequestRef.current ? 'consent does not allow ad requests' : 'Pro',
      });
      return;
    }
    const id = unitId('study_rewarded');
    if (!id) {
      note('rewarded preload skipped', { reason: 'no unit id' });
      return;
    }
    const held = rewardedRef.current;
    if (keepHeld(held, id)) {
      if (held?.phase === 'loaded' || held?.ad.loaded) {
        setRewardedFlag(true);
        setRewardedLoadState('loaded');
      }
      return;
    }
    if (rewardedRetryRef.current) {
      clearTimeout(rewardedRetryRef.current);
      rewardedRetryRef.current = null;
    }
    const attempt = options?.attempt ?? (held?.phase === 'error' ? held.attempt : 0);
    held?.ad.destroy();
    rewardedRef.current = null;
    setRewardedFlag(false);
    setRewardedLoadState('loading');
    void loadNative()
      .then((native) => {
        if (proRef.current || !readyRef.current) return;
        const latest = rewardedRef.current;
        if (keepHeld(latest, id)) {
          if (latest?.phase === 'loaded' || latest?.ad.loaded) setRewardedFlag(true);
          return;
        }
        latest?.ad.destroy();
        const ad = native.RewardedAd.createForAdRequest(id, adRequestOptions(configRef.current)) as unknown as FullscreenAd;
        const record: HeldAd = { ad, unitId: id, loadedAt: 0, phase: 'loading', attempt, showing: false };
        ad.addAdEventListener(native.RewardedAdEventType.LOADED, () => {
          record.phase = 'loaded';
          record.loadedAt = Date.now();
          record.attempt = 0;
          setRewardedFlag(true);
          setRewardedLoadState('loaded');
          note('rewarded loaded');
        });
        ad.addAdEventListener(native.AdEventType.ERROR, (error) => {
          if (record.showing || record.phase === 'loaded') return;
          record.phase = 'error';
          record.attempt += 1;
          const message = adLoadErrorText(error);
          setRewardedFlag(false);
          setRewardedLoadState('error');
          setLastLoadError(message);
          note('rewarded load error', { reason: message, attempt: record.attempt });
          scheduleRewardedRetry(record);
        });
        ad.load();
        rewardedRef.current = record;
        note('rewarded loading');
      })
      .catch((error) => {
        setRewardedLoadState('error');
        setRewardedFlag(false);
        const message = adLoadErrorText(error);
        setLastLoadError(message);
        note('rewarded preload failed', { reason: message });
      });
  }, [note, scheduleRewardedRetry, unitId]);

  useEffect(() => {
    preloadInterstitialRef.current = preloadInterstitial;
    preloadRewardedRef.current = preloadRewarded;
  }, [preloadInterstitial, preloadRewarded]);

  const showInterstitialIfEligible = useCallback(
    async (trigger: 'save' | 'back', options?: { fromShare?: boolean }): Promise<ShowInterstitialResult> => {
      if (trigger === 'back') {
        note('interstitial skipped', { reason: 'back-nav interstitial is off' });
        return 'skipped';
      }
      if (!stateRef.current) {
        note('interstitial skipped', { reason: 'ad counters are not loaded yet' });
        return 'skipped';
      }
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
      const blocked = interstitialBlockReason('save', input);
      const held = interstitialRef.current;
      const loaded = held?.phase === 'loaded' || held?.ad.loaded === true;
      if (blocked || !loaded || !held) {
        const reason = blocked ?? 'ad not loaded';
        note('interstitial skipped', {
          reason,
          saveInterstitialCounter: next.saveInterstitialCounter,
          load: held?.phase ?? 'none',
        });
        return 'skipped';
      }
      const native = await loadNative();
      const wait = armAdWait(held.ad, native.AdEventType.OPENED, native.AdEventType.CLOSED, native.AdEventType.ERROR);
      held.showing = true;
      try {
        await held.ad.show();
      } catch (error) {
        held.showing = false;
        wait.cancel();
        held.ad.destroy();
        interstitialRef.current = null;
        setInterstitialLoadState('idle');
        const message = adLoadErrorText(error);
        setLastLoadError(message);
        note('interstitial show failed', { reason: message });
        preloadInterstitialRef.current();
        return 'skipped';
      }
      note('interstitial showing', { saveInterstitialCounter: next.saveInterstitialCounter });
      const result = await wait.done;
      held.showing = false;
      const presented = result.opened || result.outcome === 'closed';
      if (presented) {
        const now = Date.now();
        await commit((prev) => ({
          ...prev,
          lastFullscreenAt: now,
          fullscreenToday: bumpToday(prev.fullscreenToday, now),
        }));
      } else {
        note('interstitial closed without presenting', { outcome: result.outcome });
      }
      if (interstitialRef.current === held) {
        held.ad.destroy();
        interstitialRef.current = null;
        setInterstitialLoadState('idle');
      }
      preloadInterstitialRef.current();
      return 'shown';
    },
    [commit, db, note, policyInput],
  );

  const showRewarded = useCallback(
    async (kind: RewardedKind, options?: { articleId?: string }): Promise<ShowRewardedResult> => {
      const input = policyInput();
      const blocked = rewardedBlockReason(kind, input);
      if (blocked) {
        note('rewarded skipped', { kind, reason: blocked });
        return 'unavailable';
      }
      const held = rewardedRef.current;
      const loaded = held?.phase === 'loaded' || held?.ad.loaded === true;
      if (!held || !loaded) {
        note('rewarded skipped', { kind, reason: 'ad not loaded', load: held?.phase ?? 'none' });
        preloadRewardedRef.current();
        return 'unavailable';
      }
      const native = await loadNative();
      let earned = false;
      const unsub = held.ad.addAdEventListener(native.RewardedAdEventType.EARNED_REWARD, () => {
        earned = true;
        note('rewarded earned', { kind });
      });
      const wait = armAdWait(held.ad, native.AdEventType.OPENED, native.AdEventType.CLOSED, native.AdEventType.ERROR);
      held.showing = true;
      try {
        await held.ad.show();
      } catch (error) {
        held.showing = false;
        unsub();
        wait.cancel();
        const message = adLoadErrorText(error);
        setLastLoadError(message);
        note('rewarded show failed', { kind, reason: message });
        held.ad.destroy();
        rewardedRef.current = null;
        setRewardedFlag(false);
        setRewardedLoadState('idle');
        preloadRewardedRef.current();
        return 'error';
      }
      note('rewarded showing', { kind });
      const result = await wait.done;
      unsub();
      held.showing = false;
      const presented = result.opened || result.outcome === 'closed';
      if (presented) {
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
      }
      if (rewardedRef.current === held) {
        held.ad.destroy();
        rewardedRef.current = null;
        setRewardedFlag(false);
        setRewardedLoadState('idle');
      }
      preloadRewardedRef.current();
      if (!presented) {
        note('rewarded closed without presenting', { kind, outcome: result.outcome });
        return 'error';
      }
      note(earned ? 'rewarded granted' : 'rewarded closed without a reward', { kind });
      return earned ? 'earned' : 'closed';
    },
    [commit, note, policyInput],
  );

  const showPrivacyOptions = useCallback(async () => {
    try {
      const consent = await import('@/lib/ads/consent');
      const info = await consent.showPrivacyOptions();
      setPrivacyOptionsRequired(consent.privacyOptionsRequired(info));
      setCanRequestAds(info.canRequestAds);
      canRequestRef.current = info.canRequestAds && !proRef.current;
      setConsentStatus(info.status);
      logAdDecision('privacy options closed', { canRequestAds: info.canRequestAds, consentStatus: info.status });
      if (info.canRequestAds && !readyRef.current && !proRef.current && initRef.current !== 'running') {
        initRef.current = 'idle';
        initAttemptRef.current = 0;
        setInitKick((value) => value + 1);
      }
    } catch (error) {
      console.warn('DigestLocal ads: privacy options did not open.', error);
      logAdDecision('privacy options failed', { reason: adLoadErrorText(error) });
    }
  }, []);

  const showConsentDebug = useCallback(async () => {
    if (!__DEV__) return;
    try {
      const consent = await import('@/lib/ads/consent');
      const info = await consent.showConsentFormDebugEea();
      setPrivacyOptionsRequired(consent.privacyOptionsRequired(info));
      setCanRequestAds(info.canRequestAds);
      canRequestRef.current = info.canRequestAds && !proRef.current;
      setConsentStatus(info.status);
      if (info.canRequestAds && !readyRef.current && initRef.current !== 'running') {
        initRef.current = 'idle';
        initAttemptRef.current = 0;
        setInitKick((value) => value + 1);
      }
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
      sessionStartedAt: state?.sessionStartedAt ?? null,
      saveInterstitialCounter: state?.saveInterstitialCounter ?? 0,
      lastFullscreenAt: state?.lastFullscreenAt ?? null,
      fullscreenTodayCount: state ? countForToday(state.fullscreenToday, now) : 0,
      interstitialLoadState,
      rewardedLoadState,
      canRequestAds: canRequestAds && !isPro,
      consentStatus,
      lastLoadError,
      lastDecision,
      recordAdLoadError,
    };
  }, [
    adState,
    canRequestAds,
    config,
    consentStatus,
    interstitialLoadState,
    isPro,
    lastDecision,
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
    rewardedLoadState,
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
