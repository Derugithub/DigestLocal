import assert from 'node:assert/strict';
import test from 'node:test';

import { draftFromShare } from '../src/lib/share-draft.ts';

test('a share keeps the first http(s) url', () => {
  assert.deepEqual(
    draftFromShare({
      text: 'see https://example.com/story. and then https://other.test/later',
    }),
    { url: 'https://example.com/story', notice: null },
  );
  assert.deepEqual(draftFromShare({ webUrl: 'https://example.com/from-web', text: 'https://other.test/a' }), {
    url: 'https://example.com/from-web',
    notice: null,
  });
  assert.deepEqual(draftFromShare({ webUrl: 'javascript:alert(1)', text: 'notes https://example.com/a' }), {
    url: 'https://example.com/a',
    notice: null,
  });
});

test('a share without a link asks for one', () => {
  assert.deepEqual(draftFromShare({ text: 'just a sentence' }), { url: '', notice: 'share' });
  assert.deepEqual(draftFromShare({ text: '   ' }), { url: '', notice: 'share' });
  assert.deepEqual(draftFromShare({ text: null, webUrl: null }), { url: '', notice: 'share' });
});
