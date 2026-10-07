import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkForSpeech } from '../src/lib/text.ts';
import { normalizeUrl, siteFromUrl } from '../src/lib/url.ts';

test('normalizes public links and rejects other schemes', () => {
  assert.equal(normalizeUrl('  example.com/story#top  '), 'https://example.com/story');
  assert.equal(normalizeUrl('http://localhost:8765/article.html'), 'http://localhost:8765/article.html');
  assert.equal(siteFromUrl('https://www.example.com/a'), 'example.com');
  assert.throws(() => normalizeUrl('javascript:alert(1)'), /http or https/);
  assert.throws(() => normalizeUrl(''), /Paste a link/);
});

test('splits long passages for speech', () => {
  const long = `${'Alpha sentence about the harbor library and its ledger. '.repeat(20)}`;
  const chunks = chunkForSpeech(`Short passage.\n\n${long}`);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 500));
  assert.equal(chunks[0], 'Short passage.');
});
