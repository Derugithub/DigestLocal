import assert from 'node:assert/strict';
import test from 'node:test';

import { currentPaste, stagePaste, subscribePaste } from '../src/lib/paste-draft.ts';

test('subscribers receive a paste staged after they subscribe', () => {
  const seen: string[] = [];
  const stop = subscribePaste((draft) => {
    seen.push(draft.url);
  });
  const draft = stagePaste('https://example.com/a', null);
  assert.equal(currentPaste()?.id, draft.id);
  assert.equal(currentPaste()?.url, 'https://example.com/a');
  assert.deepEqual(seen, ['https://example.com/a']);
  stop();
  stagePaste('https://example.com/b', 'empty');
  assert.deepEqual(seen, ['https://example.com/a']);
  assert.equal(currentPaste()?.notice, 'empty');
});
