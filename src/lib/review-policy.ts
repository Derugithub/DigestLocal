/**
 * Pure rules for the Google Play in-app review prompt. No React Native imports,
 * so tests can run it under plain Node.
 */

export type ReviewState = {
  /** First time this module saw the app running. */
  firstSeenAt: number | null;
  /** Last time the app asked Play to show the review card. */
  lastRequestAt: number | null;
  /** Last fullscreen ad this module was told about (rewarded ads). */
  lastAdAt: number | null;
};

export const REVIEW_RULES = {
  /** Sessions as counted by the ads state. Session 1 is the first launch. */
  minSessionCount: 3,
  /** Days since first seen. */
  minInstallAgeDays: 2,
  /** Share of correct answers that counts as a good quiz. */
  goodScoreRatio: 0.6,
  /** Days between asks. */
  cooldownDays: 2,
  /** Reader: time on the Read tab that counts as a meaningful read on its own. */
  meaningfulReadSeconds: 60,
  /** Reader: scroll progress that counts as reaching the end. */
  nearEndProgress: 0.9,
  /** Reader: minimum time on the Read tab when the end was reached (skims do not count). */
  nearEndMinSeconds: 20,
  /** Minutes after any fullscreen ad before an ask. */
  adQuietMinutes: 10,
} as const;

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

export function emptyReviewState(): ReviewState {
  return { firstSeenAt: null, lastRequestAt: null, lastAdAt: null };
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function sanitizeReviewState(raw: unknown): ReviewState {
  if (!raw || typeof raw !== 'object') return emptyReviewState();
  const value = raw as Record<string, unknown>;
  return {
    firstSeenAt: numOrNull(value.firstSeenAt),
    lastRequestAt: numOrNull(value.lastRequestAt),
    lastAdAt: numOrNull(value.lastAdAt),
  };
}

export function isGoodQuiz(correct: number, total: number): boolean {
  if (total <= 0) return false;
  return correct / total >= REVIEW_RULES.goodScoreRatio;
}

/** A read counts when the user spent a minute on it, or reached the end without just flicking through. */
export function isMeaningfulRead(input: { readMs: number; maxProgress: number }): boolean {
  const seconds = Math.max(0, input.readMs) / 1000;
  if (seconds >= REVIEW_RULES.meaningfulReadSeconds) return true;
  return input.maxProgress >= REVIEW_RULES.nearEndProgress && seconds >= REVIEW_RULES.nearEndMinSeconds;
}

export type ReviewBlockReason =
  | 'early-session'
  | 'new-install'
  | 'cooldown'
  | 'recent-ad'
  | null;

/** Null means the app may ask Play now. Play still decides whether the card appears. */
export function reviewBlockReason(input: {
  state: ReviewState;
  now: number;
  sessionCount: number;
  lastFullscreenAt: number | null;
}): ReviewBlockReason {
  const { state, now } = input;
  if (input.sessionCount < REVIEW_RULES.minSessionCount) return 'early-session';
  if (state.firstSeenAt == null || now - state.firstSeenAt < REVIEW_RULES.minInstallAgeDays * DAY) return 'new-install';
  if (state.lastRequestAt != null && now - state.lastRequestAt < REVIEW_RULES.cooldownDays * DAY) return 'cooldown';
  const lastAd = Math.max(input.lastFullscreenAt ?? 0, state.lastAdAt ?? 0);
  if (lastAd > 0 && now - lastAd < REVIEW_RULES.adQuietMinutes * MINUTE) return 'recent-ad';
  return null;
}
