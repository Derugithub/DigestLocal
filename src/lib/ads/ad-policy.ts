import type { AdConfig } from '@/lib/ads/ad-config';
import type { AdState, DayCount } from '@/lib/ads/ad-state';

export type InterstitialTrigger = 'save' | 'back';
export type RewardedKind = 'ad_free' | 'quiz_unlock';

export type PolicyInput = {
  now: number;
  isPro: boolean;
  config: AdConfig;
  state: AdState;
  suppressed?: boolean;
  fromShare?: boolean;
  /** Defaults to true so cap tests can omit SDK readiness. */
  ready?: boolean;
  /** Defaults to true so cap tests can omit UMP. */
  canRequestAds?: boolean;
  platform?: string;
};

export type SessionEvent = { type: 'launch' } | { type: 'background' } | { type: 'active' };

export function localDateKey(now: number): string {
  const date = new Date(now);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function countForToday(bucket: DayCount, now: number): number {
  return bucket.date === localDateKey(now) ? bucket.count : 0;
}

export function bumpToday(bucket: DayCount, now: number): DayCount {
  const date = localDateKey(now);
  if (bucket.date !== date) return { date, count: 1 };
  return { date, count: bucket.count + 1 };
}

export function isAdFree(state: AdState, now: number): boolean {
  return state.adFreeUntil != null && state.adFreeUntil > now;
}

export function canInitAds(
  state: AdState,
  config: AdConfig,
  options?: { isPro?: boolean; platform?: string },
): boolean {
  if (options?.isPro) return false;
  if (options?.platform === 'web') return false;
  if (!config.adsEnabled) return false;
  if (state.sessionCount < config.minSessionForAds) return false;
  if (state.savedCount < config.minSavedForAds) return false;
  return true;
}

function globallyAllowed(input: PolicyInput): boolean {
  if (input.isPro) return false;
  if (input.platform === 'web') return false;
  if (!input.config.adsEnabled) return false;
  if (input.ready === false) return false;
  if (input.canRequestAds === false) return false;
  if (input.suppressed) return false;
  if (isAdFree(input.state, input.now)) return false;
  return true;
}

export function canShowBanner(placement: 'shelf_banner' | 'article_end_banner', input: PolicyInput): boolean {
  if (!globallyAllowed(input)) return false;
  if (input.state.sessionCount < input.config.minSessionForAds) return false;
  if (input.state.savedCount < input.config.minSavedForAds) return false;
  if (placement === 'shelf_banner') return input.config.shelfBannerEnabled && input.config.shelfFormat === 'banner';
  return input.config.articleEndBannerEnabled;
}

function fullscreenCapsAllow(input: PolicyInput): boolean {
  const { state, config, now } = input;
  if (state.sessionCount < config.minSessionForInterstitial) return false;
  if (state.savedCount < config.minSavedForInterstitial) return false;
  const elapsedSec = (now - state.sessionStartedAt) / 1000;
  if (elapsedSec < config.minSecondsIntoSessionForInterstitial) return false;
  if (state.lastFullscreenAt != null && now - state.lastFullscreenAt < config.fullscreenCooldownSec * 1000) {
    return false;
  }
  if (countForToday(state.fullscreenToday, now) >= config.fullscreenDailyCap) return false;
  if (
    state.lastRewardedClosedAt != null &&
    now - state.lastRewardedClosedAt < config.afterRewardedCooldownSec * 1000
  ) {
    return false;
  }
  return true;
}

export function canShowInterstitial(trigger: InterstitialTrigger, input: PolicyInput): boolean {
  if (trigger === 'back' && !input.config.backNavInterstitialEnabled) return false;
  if (trigger === 'save' && !input.config.saveInterstitialEnabled) return false;
  if (!globallyAllowed(input)) return false;
  if (input.fromShare) return false;
  if (!fullscreenCapsAllow(input)) return false;
  if (trigger === 'save') {
    const count = input.state.saveInterstitialCounter;
    const every = input.config.interstitialEveryNSaves;
    if (count <= 0 || every <= 0 || count % every !== 0) return false;
  }
  return true;
}

/**
 * Stable gates for preloading a save interstitial.
 * Ignores the Nth-save modulo, the 90s session timer, and short cooldowns,
 * because those can become true before the user taps Keep.
 */
export function canPreloadInterstitial(trigger: InterstitialTrigger, input: PolicyInput): boolean {
  if (trigger !== 'save') return false;
  if (input.isPro || input.platform === 'web') return false;
  if (!input.config.adsEnabled || !input.config.saveInterstitialEnabled) return false;
  if (input.fromShare) return false;
  if (isAdFree(input.state, input.now)) return false;
  if (input.state.sessionCount < input.config.minSessionForInterstitial) return false;
  if (input.state.savedCount < input.config.minSavedForInterstitial - 1) return false;
  if (countForToday(input.state.fullscreenToday, input.now) >= input.config.fullscreenDailyCap) return false;
  return true;
}

function rewardedWindowOpen(input: PolicyInput): boolean {
  if (input.isPro || input.platform === 'web') return false;
  if (!input.config.adsEnabled) return false;
  if (input.ready === false || input.canRequestAds === false) return false;
  if (input.suppressed) return false;
  if (input.state.sessionCount < input.config.minSessionForAds) return false;
  if (input.state.savedCount < input.config.minSavedForAds) return false;
  if (countForToday(input.state.rewardedToday, input.now) >= input.config.rewardedDailyCap) return false;
  return true;
}

function adFreeGrantBlocked(state: AdState, config: AdConfig, now: number): boolean {
  if (config.adFreePassPerDay < 1) return true;
  if (state.adFreeUntil == null) return false;
  const grantedAt = state.adFreeUntil - config.adFreePassHours * 60 * 60 * 1000;
  return now < grantedAt + 24 * 60 * 60 * 1000;
}

export function canOfferRewarded(kind: RewardedKind, input: PolicyInput): boolean {
  if (!rewardedWindowOpen(input)) return false;
  if (kind === 'ad_free') return !adFreeGrantBlocked(input.state, input.config, input.now);
  if (isAdFree(input.state, input.now)) return false;
  return countForToday(input.state.quizUnlocksToday, input.now) < input.config.quizUnlockPerDay;
}

export function nextSessionState(state: AdState, event: SessionEvent, config: AdConfig, now: number): AdState {
  if (event.type === 'background') {
    return { ...state, lastBackgroundAt: now };
  }

  const gapMs = config.sessionGapMinutes * 60 * 1000;
  if (event.type === 'launch') {
    if (state.firstOpenAt == null || state.sessionCount < 1) {
      return {
        ...state,
        firstOpenAt: state.firstOpenAt ?? now,
        sessionCount: 1,
        sessionStartedAt: now,
        lastBackgroundAt: null,
      };
    }
    const away = state.lastBackgroundAt == null ? gapMs : now - state.lastBackgroundAt;
    if (away >= gapMs) {
      return {
        ...state,
        sessionCount: state.sessionCount + 1,
        sessionStartedAt: now,
        lastBackgroundAt: null,
      };
    }
    return state;
  }

  if (state.lastBackgroundAt == null) return state;
  if (now - state.lastBackgroundAt < gapMs) return state;
  const sessionCount = state.sessionCount < 1 ? 1 : state.sessionCount + 1;
  return {
    ...state,
    firstOpenAt: state.firstOpenAt ?? now,
    sessionCount,
    sessionStartedAt: now,
    lastBackgroundAt: null,
  };
}
