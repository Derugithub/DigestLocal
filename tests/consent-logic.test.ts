import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldRequestNonPersonalizedOnly } from '../src/lib/ads/consent-logic.ts';

test('no consent required: choices read as false but the request is left alone', () => {
  assert.equal(shouldRequestNonPersonalizedOnly('NOT_REQUIRED', false), false);
  assert.equal(shouldRequestNonPersonalizedOnly('NOT_REQUIRED', null), false);
});

test('consent not obtained or unknown: request is left alone', () => {
  assert.equal(shouldRequestNonPersonalizedOnly('REQUIRED', false), false);
  assert.equal(shouldRequestNonPersonalizedOnly('UNKNOWN', false), false);
});

test('consent obtained and personalization declined: non-personalized only', () => {
  assert.equal(shouldRequestNonPersonalizedOnly('OBTAINED', false), true);
});

test('consent obtained and personalization allowed, or choices unreadable: not restricted', () => {
  assert.equal(shouldRequestNonPersonalizedOnly('OBTAINED', true), false);
  assert.equal(shouldRequestNonPersonalizedOnly('OBTAINED', null), false);
});
