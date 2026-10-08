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
  assert.match(article.content, /second shelf/);
  assert.match(article.content, /TL-418/);
  assert.doesNotMatch(article.content, /Buy shoes now/);
  assert.doesNotMatch(article.content, /<[a-z]/i);
  assert.equal(article.truncated, false);
});

test('keeps reader structure and strips active content', () => {
  const article = extractArticle(fixture, 'https://harbor.example/ledger');
  assert.match(article.contentHtml, /<h2>How a Saturday works<\/h2>/);
  assert.match(article.contentHtml, /<ul>/);
  assert.match(article.contentHtml, /<ol>/);
  assert.match(article.contentHtml, /<blockquote>/);
  assert.match(article.contentHtml, /<strong>Sign<\/strong>/);
  assert.match(article.contentHtml, /<em>cleaner<\/em>/);
  assert.match(article.contentHtml, /<a href="https:\/\/harbor\.example\/manual">/);
  assert.match(article.contentHtml, /<code>TL-418<\/code>/);
  assert.match(article.contentHtml, /<pre><code>loan: calipers/);
  assert.match(article.contentHtml, /this trap/);
  assert.match(article.contentHtml, /The pier stays open until dusk/);
  assert.doesNotMatch(article.contentHtml, /<script|onclick|javascript:|sponsored-ad|Limited offer/i);
  assert.equal((article.content.match(/second shelf/g) ?? []).length, 1);
});

test('rejects a page without article text', () => {
  assert.throws(
    () => extractArticle('<html><title>Empty</title><body><nav>Menu</nav></body></html>', 'https://example.com/empty'),
    /enough article text/,
  );
});
