import assert from 'node:assert/strict';
import test from 'node:test';

import {
  articleOrigin,
  imageRequestHeaders,
  isRefererRejection,
  refererAfterRejection,
} from '../src/lib/image-referer.ts';

const page = 'https://harbor.example/notes/ledger?ref=1#top';

test('image requests send no Referer until a refusal', () => {
  const first = imageRequestHeaders({ userAgent: 'DigestLocal/1.0 (offline article reader)' });
  assert.equal('Referer' in first, false);
  assert.equal(first['User-Agent'], 'DigestLocal/1.0 (offline article reader)');
  assert.match(first.Accept, /^image\/avif/);

  const web = imageRequestHeaders();
  assert.equal('Referer' in web, false);
  assert.equal('User-Agent' in web, false);
});

test('a 401 or 403 retries once with the article origin only', () => {
  assert.equal(isRefererRejection(401), true);
  assert.equal(isRefererRejection(403), true);
  assert.equal(isRefererRejection(404), false);
  assert.equal(isRefererRejection(429), false);
  assert.equal(isRefererRejection(500), false);

  assert.equal(articleOrigin(page), 'https://harbor.example');
  assert.equal(articleOrigin('http://harbor.example:8080/a/b'), 'http://harbor.example:8080');
  assert.equal(articleOrigin('https://user:secret@harbor.example/private'), 'https://harbor.example');
  assert.equal(articleOrigin('ftp://harbor.example/file'), null);
  assert.equal(articleOrigin('not a url'), null);

  assert.equal(refererAfterRejection(403, page), 'https://harbor.example');
  assert.equal(refererAfterRejection(401, page), 'https://harbor.example');
  assert.equal(refererAfterRejection(404, page), undefined);
  assert.equal(refererAfterRejection(200, page), undefined);
  assert.equal(refererAfterRejection(403, 'not a url'), undefined);

  const retry = imageRequestHeaders({ referer: refererAfterRejection(403, page) });
  assert.equal(retry.Referer, 'https://harbor.example');
  assert.doesNotMatch(retry.Referer, /\/notes/);
});
