import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { extractArticle } from '../src/lib/extract.ts';

const fixture = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/harbor.html'), 'utf8');

test('extracts the article and drops the navigation', () => {
  const article = extractArticle(fixture, 'https://harbor.example/ledger');
  assert.equal(article.site, 'harbor.example');
  assert.match(article.title, /Harbor Tool Library/);
  assert.match(article.content, /paper ledger/);
  assert.match(article.content, /Inez/);
  assert.doesNotMatch(article.content, /Buy shoes now/);
  assert.equal(article.truncated, false);
});

test('rejects a page without article text', () => {
  assert.throws(
    () => extractArticle('<html><title>Empty</title><body><nav>Menu</nav></body></html>', 'https://example.com/empty'),
    /enough article text/,
  );
});
