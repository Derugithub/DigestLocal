import type { AdConfig } from '@/lib/ads/ad-config';
import type { AdState, DayCount } from '@/lib/ads/ad-state';
import { extraAfterQuizReward } from '@/lib/quiz-reward';

export type InterstitialTrigger = 'save' | 'back';
export type RewardedKind = 'ad_free' | 'quiz_unlock' | 'extra_speeds';

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

export function initBlockReason(
  state: AdState,
  config: AdConfig,
  options?: { isPro?: boolean; platform?: string },
): string | null {
  if (options?.isPro) return 'Pro';
  if (options?.platform === 'web') return 'web';
  if (!config.adsEnabled) return 'ads disabled';
  if (state.sessionCount < config.minSessionForAds) {
    return `session ${state.sessionCount} is below ${config.minSessionForAds}`;
  }
  if (state.savedCount < config.minSavedForAds) {
    return `saved ${state.savedCount} is below ${config.minSavedForAds}`;
  }
  return null;
}

export function canInitAds(
  state: AdState,
  config: AdConfig,
  options?: { isPro?: boolean; platform?: string },
): boolean {
  return initBlockReason(state, config, options) == null;
}

function globalBlockReason(input: PolicyInput): string | null {
  if (input.isPro) return 'Pro';
  if (input.platform === 'web') return 'web';
  if (!input.config.adsEnabled) return 'ads disabled';
  if (input.ready === false) return 'sdk not ready';
  if (input.canRequestAds === false) return 'consent does not allow ad requests';
  if (input.suppressed) return 'suppressed';
  if (isAdFree(input.state, input.now)) return 'ad-free pass';
  return null;
}

function globallyAllowed(input: PolicyInput): boolean {
  return globalBlockReason(input) == null;
}

export function canShowBanner(placement: 'shelf_banner' | 'article_end_banner', input: PolicyInput): boolean {
  if (!globallyAllowed(input)) return false;
  if (input.state.sessionCount < input.config.minSessionForAds) return false;
  if (input.state.savedCount < input.config.minSavedForAds) return false;
  if (placement === 'shelf_banner') return input.config.shelfBannerEnabled && input.config.shelfFormat === 'banner';
  return input.config.articleEndBannerEnabled;
}

function fullscreenBlockReason(input: PolicyInput): string | null {
  const { state, config, now } = input;
  if (state.sessionCount < config.minSessionForInterstitial) {
    return `session ${state.sessionCount} is below ${config.minSessionForInterstitial}`;
  }
  if (state.savedCount < config.minSavedForInterstitial) {
    return `saved ${state.savedCount} is below ${config.minSavedForInterstitial}`;
  }
  // No session-age gate. Session 1 never reaches this check (`minSessionForAds` / interstitial session).
  if (state.lastFullscreenAt != null && now - state.lastFullscreenAt < config.fullscreenCooldownSec * 1000) {
    return `fullscreen cooldown (${config.fullscreenCooldownSec}s)`;
  }
  if (countForToday(state.fullscreenToday, now) >= config.fullscreenDailyCap) {
    return `daily cap ${config.fullscreenDailyCap}`;
  }
  if (
    state.lastRewardedClosedAt != null &&
    now - state.lastRewardedClosedAt < config.afterRewardedCooldownSec * 1000
  ) {
    return `rewarded cooldown (${config.afterRewardedCooldownSec}s)`;
  }
  if (
    state.adFreeUntil != null &&
    state.adFreeUntil <= now &&
    now - state.adFreeUntil < config.afterAdFreeCooldownSec * 1000
  ) {
    return `interstitial waits ${config.afterAdFreeCooldownSec}s after the ad-free pass`;
  }
  return null;
}

/** Why a full-screen interstitial must not show, or null when the caps allow it. */
export function interstitialBlockReason(trigger: InterstitialTrigger, input: PolicyInput): string | null {
  if (trigger === 'back' && !input.config.backNavInterstitialEnabled) return 'back-nav interstitial is off';
  if (trigger === 'save' && !input.config.saveInterstitialEnabled) return 'save interstitial is off';
  const global = globalBlockReason(input);
  if (global) return global;
  if (input.fromShare) return 'opened from a share';
  const caps = fullscreenBlockReason(input);
  if (caps) return caps;
  if (trigger === 'save') {
    const count = input.state.saveInterstitialCounter;
    const every = input.config.interstitialEveryNSaves;
    if (count <= 0 || every <= 0 || count % every !== 0) {
      return `save ${count} is not a multiple of ${every}`;
    }
  }
  return null;
}

export function canShowInterstitial(trigger: InterstitialTrigger, input: PolicyInput): boolean {
  return interstitialBlockReason(trigger, input) == null;
}

/** Saves before the interstitial session do not move the every-Nth counter. */
export function nextSaveInterstitialCounter(state: AdState, config: AdConfig): number {
  if (state.sessionCount < config.minSessionForInterstitial) return state.saveInterstitialCounter;
  return state.saveInterstitialCounter + 1;
}

/**
 * Stable gates for preloading a save interstitial.
 * Ignores the Nth-save modulo and short cooldowns, because those can become true before the user taps Keep.
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

function rewardedWindowReason(kind: RewardedKind, input: PolicyInput): string | null {
  if (input.isPro) return 'Pro';
  if (input.platform === 'web') return 'web';
  if (!input.config.adsEnabled) return 'ads disabled';
  if (input.ready === false) return 'sdk not ready';
  if (input.canRequestAds === false) return 'consent does not allow ad requests';
  // The faster-speed offer lives in the Listen control, which is itself a suppression reason.
  if (input.suppressed && kind !== 'extra_speeds') return 'suppressed';
  if (input.state.sessionCount < input.config.minSessionForAds) {
    return `session ${input.state.sessionCount} is below ${input.config.minSessionForAds}`;
  }
  if (input.state.savedCount < input.config.minSavedForAds) {
    return `saved ${input.state.savedCount} is below ${input.config.minSavedForAds}`;
  }
  if (countForToday(input.state.rewardedToday, input.now) >= input.config.rewardedDailyCap) {
    return `rewarded daily cap ${input.config.rewardedDailyCap}`;
  }
  return null;
}

const HOUR_MS = 60 * 60 * 1000;

/** Adds one pass onto any time still left, and never leaves more than the stack cap. */
export function nextAdFreeUntil(until: number | null, now: number, config: AdConfig): number {
  const add = Math.max(0, config.adFreePassHours) * HOUR_MS;
  const cap = Math.max(add, config.adFreePassMaxHours * HOUR_MS);
  const base = until != null && until > now ? until : now;
  return Math.min(base + add, now + cap);
}

export function formatAdFreeRemaining(until: number, now: number): string | null {
  const ms = until - now;
  if (ms <= 0) return null;
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourLabel = hours === 1 ? '1 hour' : `${hours} hours`;
  const minuteLabel = minutes === 1 ? '1 minute' : `${minutes} minutes`;
  if (hours <= 0) return `${minuteLabel} left`;
  if (minutes === 0) return `${hourLabel} left`;
  return `${hourLabel} ${minuteLabel} left`;
}

function adFreeGrantBlockReason(state: AdState, config: AdConfig, now: number): string | null {
  if (config.adFreePassPerDay < 1) return 'ad-free passes are off';
  if (countForToday(state.adFreePassesToday, now) >= config.adFreePassPerDay) {
    return `ad-free pass daily cap ${config.adFreePassPerDay}`;
  }
  const capMs = config.adFreePassMaxHours * HOUR_MS;
  if (state.adFreeUntil != null && state.adFreeUntil - now >= capMs) {
    return `ad-free pass is already at the ${config.adFreePassMaxHours}h cap`;
  }
  return null;
}

export type RewardedGrantOptions = {
  articleId?: string;
  quizQuestionCount?: number;
  quizFresh?: boolean;
};

/** Applies a reward that the earned-reward callback already confirmed. Callers do not re-check the offer caps. */
export function grantRewardedReward(
  state: AdState,
  kind: RewardedKind,
  now: number,
  config: AdConfig,
  options?: RewardedGrantOptions,
): AdState {
  const next: AdState = {
    ...state,
    rewardedToday: bumpToday(state.rewardedToday, now),
    lastRewardedClosedAt: now,
  };
  if (kind === 'ad_free') {
    return {
      ...next,
      adFreeUntil: nextAdFreeUntil(state.adFreeUntil, now, config),
      adFreePassesToday: bumpToday(state.adFreePassesToday, now),
    };
  }
  if (kind === 'extra_speeds') {
    return {
      ...next,
      extraSpeedsUntil: now + config.extraSpeedsHours * HOUR_MS,
    };
  }
  const quizExtra = { ...state.quizExtra };
  if (options?.articleId) {
    quizExtra[options.articleId] = extraAfterQuizReward({
      questionCount: options.quizQuestionCount ?? 0,
      freeCap: config.quizFreeQuestionCap,
      extra: state.quizExtra[options.articleId] ?? 0,
      rewardQuestions: config.quizRewardQuestions,
      fresh: options.quizFresh === true,
    });
  }
  return {
    ...next,
    quizExtra,
    quizUnlocksToday: bumpToday(state.quizUnlocksToday, now),
    quizOffersAccepted: state.quizOffersAccepted + 1,
  };
}

export function extraSpeedsActive(state: AdState, now: number): boolean {
  return state.extraSpeedsUntil != null && state.extraSpeedsUntil > now;
}

/** Why a rewarded offer must not be made, or null when the caps allow it. */
export function rewardedBlockReason(kind: RewardedKind, input: PolicyInput): string | null {
  const windowReason = rewardedWindowReason(kind, input);
  if (windowReason) return windowReason;
  if (kind === 'ad_free') return adFreeGrantBlockReason(input.state, input.config, input.now);
  if (kind === 'extra_speeds') {
    if (extraSpeedsActive(input.state, input.now)) return 'extra speeds already unlocked';
    return null;
  }
  if (countForToday(input.state.quizUnlocksToday, input.now) >= input.config.quizUnlockPerDay) {
    return `quiz unlock daily cap ${input.config.quizUnlockPerDay}`;
  }
  return null;
}

export function canOfferRewarded(kind: RewardedKind, input: PolicyInput): boolean {
  return rewardedBlockReason(kind, input) == null;
}

const RELOAD_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000] as const;

/** Backoff after a fullscreen load or init failure. `attempt` is how many failures already happened. */
export function fullscreenReloadDelayMs(attempt: number): number {
  const index = Math.min(RELOAD_DELAYS_MS.length - 1, Math.max(0, Math.floor(attempt)));
  return RELOAD_DELAYS_MS[index];
}

export function nextSessionState(state: AdState, event: SessionEvent, config: AdConfig, now: number): AdState {
  const gapMs = config.sessionGapMinutes * 60 * 1000;

  // Keep the earliest departure. A later background event (iOS emits one again
  // on the way back to the foreground) must not restart the 30 minute clock.
  if (event.type === 'background') {
    if (state.lastBackgroundAt != null) return state;
    return { ...state, lastBackgroundAt: now };
  }

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
    // Every later cold start is a new session, even if the process died in the
    // foreground or the background gap has not elapsed. The gap is only for warm resumes.
    return {
      ...state,
      sessionCount: state.sessionCount + 1,
      sessionStartedAt: now,
      lastBackgroundAt: null,
    };
  }

  if (state.lastBackgroundAt == null) return state;
  if (now - state.lastBackgroundAt < gapMs) {
    return { ...state, lastBackgroundAt: null };
  }
  const sessionCount = state.sessionCount < 1 ? 1 : state.sessionCount + 1;
  return {
    ...state,
    firstOpenAt: state.firstOpenAt ?? now,
    sessionCount,
    sessionStartedAt: now,
    lastBackgroundAt: null,
  };
}
