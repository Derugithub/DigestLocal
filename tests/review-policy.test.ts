import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emptyReviewState,
  isGoodQuiz,
  isMeaningfulRead,
  REVIEW_RULES,
  reviewBlockReason,
  sanitizeReviewState,
  type ReviewState,
} from '../src/lib/review-policy.ts';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 14);
const ready: ReviewState = { firstSeenAt: now - 10 * DAY, lastRequestAt: null, lastAdAt: null };
const base = { state: ready, now, sessionCount: 5, lastFullscreenAt: null };

test('asks when every rule passes', () => {
  assert.equal(reviewBlockReason(base), null);
});

test('never in the first sessions or a fresh install', () => {
  assert.equal(reviewBlockReason({ ...base, sessionCount: 1 }), 'early-session');
  assert.equal(reviewBlockReason({ ...base, state: { ...ready, firstSeenAt: now - DAY } }), 'new-install');
  assert.equal(reviewBlockReason({ ...base, state: { ...ready, firstSeenAt: null } }), 'new-install');
});

test('cooldown is 2 days', () => {
  assert.equal(REVIEW_RULES.cooldownDays, 2);
  assert.equal(reviewBlockReason({ ...base, state: { ...ready, lastRequestAt: now - DAY } }), 'cooldown');
  assert.equal(reviewBlockReason({ ...base, state: { ...ready, lastRequestAt: now - 3 * DAY } }), null);
});

test('a single good quiz qualifies', () => {
  assert.equal(isGoodQuiz(3, 5), true);
  assert.equal(isGoodQuiz(2, 5), false);
  assert.equal(isGoodQuiz(0, 0), false);
});

test('cooldown between asks', () => {
  const recent = { ...ready, lastRequestAt: now - (REVIEW_RULES.cooldownDays - 1) * DAY };
  assert.equal(reviewBlockReason({ ...base, state: recent }), 'cooldown');
  const old = { ...ready, lastRequestAt: now - (REVIEW_RULES.cooldownDays + 1) * DAY };
  assert.equal(reviewBlockReason({ ...base, state: old }), null);
});

test('never right after an ad', () => {
  assert.equal(reviewBlockReason({ ...base, lastFullscreenAt: now - 60_000 }), 'recent-ad');
  assert.equal(reviewBlockReason({ ...base, state: { ...ready, lastAdAt: now - 60_000 } }), 'recent-ad');
  assert.equal(reviewBlockReason({ ...base, lastFullscreenAt: now - 60 * 60_000 }), null);
});

test('meaningful read: a minute in the reader, or the end after 20s', () => {
  assert.equal(isMeaningfulRead({ readMs: 60_000, maxProgress: 0 }), true);
  assert.equal(isMeaningfulRead({ readMs: 59_000, maxProgress: 0.5 }), false);
  assert.equal(isMeaningfulRead({ readMs: 25_000, maxProgress: 0.95 }), true);
  assert.equal(isMeaningfulRead({ readMs: 5_000, maxProgress: 1 }), false);
});

test('sanitize drops junk and old fields', () => {
  assert.deepEqual(sanitizeReviewState('x'), emptyReviewState());
  assert.deepEqual(sanitizeReviewState({ goodQuizCount: 3, firstSeenAt: 'no' }), emptyReviewState());
});
