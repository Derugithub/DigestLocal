import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkForSpeech } from '../src/lib/text.ts';
import { normalizeUrl, siteFromUrl, urlFromClipboard } from '../src/lib/url.ts';

test('normalizes public links and rejects other schemes', () => {
  assert.equal(normalizeUrl('  example.com/story#top  '), 'https://example.com/story');
  assert.equal(normalizeUrl('http://localhost:8765/article.html'), 'http://localhost:8765/article.html');
  assert.equal(siteFromUrl('https://www.example.com/a'), 'example.com');
  assert.throws(() => normalizeUrl('javascript:alert(1)'), /http or https/);
  assert.throws(() => normalizeUrl(''), /Paste a link/);
});

test('reads an http(s) url from clipboard text', () => {
  assert.equal(urlFromClipboard('https://example.com/story'), 'https://example.com/story');
  assert.equal(urlFromClipboard('  see https://example.com/story.  '), 'https://example.com/story');
  assert.equal(
    urlFromClipboard('https://en.wikipedia.org/wiki/Tool_(library)'),
    'https://en.wikipedia.org/wiki/Tool_(library)',
  );
  assert.equal(urlFromClipboard('http://localhost:8765/article.html'), 'http://localhost:8765/article.html');
  assert.equal(urlFromClipboard(''), null);
  assert.equal(urlFromClipboard('   '), null);
  assert.equal(urlFromClipboard('not a link'), null);
  assert.equal(urlFromClipboard('javascript:alert(1)'), null);
  assert.equal(urlFromClipboard(null), null);
});

test('splits long passages for speech', () => {
  const long = `${'Alpha sentence about the harbor library and its ledger. '.repeat(20)}`;
  const chunks = chunkForSpeech(`Short passage.\n\n${long}`);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 500));
  assert.equal(chunks[0], 'Short passage.');
});
