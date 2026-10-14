import { Linking, Platform } from 'react-native';
import * as StoreReview from 'expo-store-review';

import {
  emptyReviewState,
  isGoodQuiz,
  isMeaningfulRead,
  reviewBlockReason,
  sanitizeReviewState,
  type ReviewState,
} from '@/lib/review-policy';

const STORAGE_KEY = 'digestlocal.review.v1';
const ANDROID_PACKAGE = 'app.digestlocal.mobile';
const PLAY_MARKET_URL = `market://details?id=${ANDROID_PACKAGE}`;
const PLAY_WEB_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
/** Let the score card settle before the Play sheet slides up. */
const PROMPT_DELAY_MS = 1200;

let inFlight = false;

async function storage() {
  const module = await import('expo-sqlite/kv-store');
  return module.default;
}

async function load(): Promise<ReviewState> {
  try {
    const raw = await (await storage()).getItem(STORAGE_KEY);
    return raw ? sanitizeReviewState(JSON.parse(raw) as unknown) : emptyReviewState();
  } catch {
    return emptyReviewState();
  }
}

async function save(state: ReviewState): Promise<void> {
  try {
    await (await storage()).setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The review prompt is optional. Nothing else depends on this key.
  }
}

async function update(change: (prev: ReviewState) => ReviewState): Promise<ReviewState> {
  const next = change(await load());
  await save(next);
  return next;
}

/** Call once per launch. Records the first-seen time used by the install-age rule. */
export async function noteAppOpened(now = Date.now()): Promise<void> {
  if (Platform.OS !== 'android') return;
  const state = await load();
  if (state.firstSeenAt == null) await save({ ...state, firstSeenAt: now });
}

/** Call after a rewarded ad closes so the prompt never follows an ad. */
export async function noteFullscreenAd(now = Date.now()): Promise<void> {
  if (Platform.OS !== 'android') return;
  await update((prev) => ({ ...prev, lastAdAt: now }));
}

type ReviewContext = { sessionCount: number; lastFullscreenAt: number | null };

/** Shared path for every trigger. Asks Play only when every rule in review-policy passes. No custom pre-prompt. */
async function maybeRequestReview(context: ReviewContext): Promise<void> {
  if (Platform.OS !== 'android' || inFlight) return;
  inFlight = true;
  try {
    const state = await load();
    const now = Date.now();
    if (reviewBlockReason({ state, now, ...context })) return;
    if (!(await StoreReview.isAvailableAsync()) || !(await StoreReview.hasAction())) return;
    await new Promise((resolve) => setTimeout(resolve, PROMPT_DELAY_MS));
    // Record first: Play gives no signal whether the card appeared, so the cooldown counts every ask.
    await save({ ...state, lastRequestAt: now });
    await StoreReview.requestReview();
  } catch {
    // Play Services missing or the flow failed. The app carries on.
  } finally {
    inFlight = false;
  }
}

/** Trigger 1: the user reached the quiz score card. A single quiz at 60% or better qualifies. */
export async function maybeRequestReviewAfterQuiz(input: ReviewContext & { correct: number; total: number }): Promise<void> {
  if (!isGoodQuiz(input.correct, input.total)) return;
  await maybeRequestReview(input);
}

/** Trigger 2: the user left the reader after a meaningful read (see isMeaningfulRead). */
export async function maybeRequestReviewAfterRead(
  input: ReviewContext & { readMs: number; maxProgress: number },
): Promise<void> {
  if (!isMeaningfulRead(input)) return;
  await maybeRequestReview(input);
}

/** Settings "Rate DigestLocal": user-initiated, so it opens the store listing directly. */
export async function openStoreListing(): Promise<void> {
  const url = StoreReview.storeUrl() ?? PLAY_MARKET_URL;
  try {
    await Linking.openURL(url);
  } catch {
    try {
      await Linking.openURL(PLAY_WEB_URL);
    } catch {
      // No store and no browser. Nothing more to try.
    }
  }
}
