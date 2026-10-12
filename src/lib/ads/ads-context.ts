import { createContext, useContext } from 'react';

import { adConfigFromDefaults, type AdConfig } from '@/lib/ads/ad-config';
import type { AdPlacement } from '@/lib/ads/ad-units';

export type SuppressionReason = 'listen' | 'quiz' | 'fetch' | 'add-sheet';
export type InterstitialTrigger = 'save' | 'back';
export type RewardedKind = 'ad_free' | 'quiz_unlock' | 'extra_speeds';
export type ShowInterstitialResult = 'shown' | 'skipped';
export type ShowRewardedResult = 'earned' | 'closed' | 'unavailable' | 'error';
export type RewardedShowOptions = {
  articleId?: string;
  quizQuestionCount?: number;
  quizFresh?: boolean;
};
export type FullscreenLoadState = 'idle' | 'loading' | 'loaded' | 'error';
export type SdkInitStatus = 'idle' | 'running' | 'ready' | 'retry-on-foreground';

export type AdsContextValue = {
  ready: boolean;
  isPro: boolean;
  adFree: boolean;
  adFreeUntil: number | null;
  extraSpeedsUntil: number | null;
  extraSpeedsUnlocked: boolean;
  privacyOptionsRequired: boolean;
  rewardedLoaded: boolean;
  config: AdConfig;
  suppressed: boolean;
  quizExtra: (articleId: string) => number;
  suppress: (reason: SuppressionReason) => void;
  release: (reason: SuppressionReason) => void;
  showInterstitialIfEligible: (
    trigger: InterstitialTrigger,
    options?: { fromShare?: boolean },
  ) => Promise<ShowInterstitialResult>;
  showRewarded: (kind: RewardedKind, options?: RewardedShowOptions) => Promise<ShowRewardedResult>;
  recordQuizOfferShown: () => Promise<void>;
  resetQuizExtra: (articleId: string) => Promise<void>;
  preloadInterstitial: (options?: { fromShare?: boolean }) => void;
  preloadRewarded: () => void;
  unitId: (placement: AdPlacement) => string | null;
  canShowPlacement: (placement: 'shelf_banner' | 'article_end_banner') => boolean;
  canOfferRewarded: (kind: RewardedKind) => boolean;
  showPrivacyOptions: () => Promise<void>;
  showConsentDebug: () => Promise<void>;
  resetAdCounters: () => Promise<void>;
  /** Read-only status for the dev/preview Settings readout. Does not gate ads. */
  sessionCount: number;
  sessionStartedAt: number | null;
  saveInterstitialCounter: number;
  lastFullscreenAt: number | null;
  fullscreenTodayCount: number;
  adFreePassesToday: number;
  quizRewardsToday: number;
  quizOffersShown: number;
  quizOffersAccepted: number;
  interstitialLoadState: FullscreenLoadState;
  rewardedLoadState: FullscreenLoadState;
  canRequestAds: boolean;
  consentStatus: string;
  initStatus: SdkInitStatus;
  lastLoadError: string | null;
  lastDecision: string;
  recordAdLoadError: (error: unknown) => void;
};

export const idleAdsContext: AdsContextValue = {
  ready: false,
  isPro: false,
  adFree: false,
  adFreeUntil: null,
  extraSpeedsUntil: null,
  extraSpeedsUnlocked: false,
  privacyOptionsRequired: false,
  rewardedLoaded: false,
  config: adConfigFromDefaults(),
  suppressed: false,
  quizExtra: () => 0,
  suppress: () => undefined,
  release: () => undefined,
  showInterstitialIfEligible: async () => 'skipped',
  showRewarded: async () => 'unavailable',
  recordQuizOfferShown: async () => undefined,
  resetQuizExtra: async () => undefined,
  preloadInterstitial: () => undefined,
  preloadRewarded: () => undefined,
  unitId: () => null,
  canShowPlacement: () => false,
  canOfferRewarded: () => false,
  showPrivacyOptions: async () => undefined,
  showConsentDebug: async () => undefined,
  resetAdCounters: async () => undefined,
  sessionCount: 0,
  sessionStartedAt: null,
  saveInterstitialCounter: 0,
  lastFullscreenAt: null,
  fullscreenTodayCount: 0,
  adFreePassesToday: 0,
  quizRewardsToday: 0,
  quizOffersShown: 0,
  quizOffersAccepted: 0,
  interstitialLoadState: 'idle',
  rewardedLoadState: 'idle',
  canRequestAds: false,
  consentStatus: 'not read',
  initStatus: 'idle',
  lastLoadError: null,
  lastDecision: 'none yet',
  recordAdLoadError: () => undefined,
};

export const AdsContext = createContext<AdsContextValue>(idleAdsContext);

export function useAds(): AdsContextValue {
  return useContext(AdsContext);
}
