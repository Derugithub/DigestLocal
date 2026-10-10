import assert from 'node:assert/strict';
import test from 'node:test';

import {
  blocksFromHtml,
  blocksToHtml,
  blocksToPlainText,
  mapFigureSources,
  remoteImageSources,
} from '../src/lib/article-html.ts';

const base = 'https://harbor.example/notes/ledger';

function htmlFor(fragment: string): string {
  return blocksToHtml(blocksFromHtml(fragment, base));
}

test('resolves relative image URLs and srcset candidates', () => {
  const html = htmlFor(`
    <img src="../photos/pier.jpg" alt="Pier" width="640" height="360">
    <img alt="Dock" width="1200" height="800" src="/small.jpg" srcset="/small.jpg 400w, /large.jpg 1200w, /mid.jpg 800w">
    <img alt="Dense" width="800" height="400" src="/a.jpg" srcset="/a.jpg 1x, /b.jpg 2x">
    <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="/real.jpg" alt="Real" width="800" height="400">
    <img src="/tiny.jpg" srcset="/tiny.jpg 20w" data-srcset="/sharp.jpg 900w" alt="Sharp" width="900" height="600">
    <picture>
      <source srcset="/huge.jpg 1600w, /big.jpg 1000w">
      <img src="/fallback.jpg" alt="Sky" width="1000" height="600">
    </picture>
  `);

  assert.match(html, /src="https:\/\/harbor\.example\/photos\/pier\.jpg"/);
  assert.match(html, /src="https:\/\/harbor\.example\/large\.jpg"/);
  assert.match(html, /src="https:\/\/harbor\.example\/b\.jpg"/);
  assert.match(html, /src="https:\/\/harbor\.example\/real\.jpg"/);
  assert.match(html, /src="https:\/\/harbor\.example\/sharp\.jpg"/);
  assert.match(html, /src="https:\/\/harbor\.example\/huge\.jpg"/);
  assert.doesNotMatch(html, /small\.jpg|tiny\.jpg|fallback\.jpg|data:image/);
});

test('keeps a figure caption and round-trips it', () => {
  const blocks = blocksFromHtml(
    `
      <figure>
        <img src="/photos/pier.jpg" alt="The pier" width="800" height="400">
        <figcaption>Morning <em>light</em> on the pier</figcaption>
      </figure>
      <p>The oak counter stays open for neighbors on Saturday morning.</p>
    `,
    base,
  );
  const html = blocksToHtml(blocks);
  const text = blocksToPlainText(blocks);

  assert.match(html, /<figure><img src="https:\/\/harbor\.example\/photos\/pier\.jpg" alt="The pier" width="800" height="400"><figcaption>Morning <em>light<\/em> on the pier<\/figcaption><\/figure>/);
  assert.match(text, /Morning light on the pier/);
  assert.doesNotMatch(text, /The pier/);
  assert.deepEqual(blocksFromHtml(html, base), blocks);
});

test('skips tracking pixels, icons, svg, and ads', () => {
  const html = htmlFor(`
    <img src="/track.gif" width="1" height="1" alt="tracker">
    <img src="/favicon.ico" alt="icon">
    <img src="/icons/share.png" width="48" height="48" alt="share">
    <img src="/photos/mark.jpg" alt="Mark" width="20" height="20">
    <img src="/diagram.svg" alt="Diagram" width="400" height="300">
    <img src="https://doubleclick.net/pagead/view" alt="ad" width="600" height="200">
    <div class="ad-slot"><img src="/banner.jpg" alt="banner" width="600" height="400"></div>
    <img class="sponsored-ad" src="/shoes.jpg" alt="Shoes" width="600" height="400">
    <img class="adaptive" src="/photos/wide.jpg" alt="Wide" width="640" height="360">
    <p>The oak counter stays open for neighbors on Saturday morning.</p>
  `);

  assert.match(html, /src="https:\/\/harbor\.example\/photos\/wide\.jpg"/);
  assert.match(html, /alt="Wide"/);
  assert.doesNotMatch(html, /track\.gif|favicon|share\.png|mark\.jpg|diagram\.svg|doubleclick|banner\.jpg|shoes\.jpg/);
});

test('lifts an inline image without dropping the heading or list', () => {
  const html = htmlFor(`
    <h2>How a Saturday <strong>works</strong></h2>
    <p>Before <strong>bold <img src="/tool.jpg" alt="Tool" width="400" height="300"> tail</strong> end.</p>
    <ul>
      <li>Parent item
        <ul><li>Child <img src="/nest.jpg" alt="Nest" width="400" height="300"> item</li></ul>
      </li>
    </ul>
  `);

  assert.match(html, /<h2>How a Saturday <strong>works<\/strong><\/h2>/);
  assert.match(html, /<p>Before <strong>bold<\/strong><\/p>/);
  assert.match(html, /<figure><img src="https:\/\/harbor\.example\/tool\.jpg" alt="Tool" width="400" height="300"><\/figure>/);
  assert.match(html, /<p><strong>tail<\/strong> end\.<\/p>/);
  assert.match(
    html,
    /<ul><li><p>Parent item<\/p><ul><li><p>Child<\/p><figure><img src="https:\/\/harbor\.example\/nest\.jpg" alt="Nest" width="400" height="300"><\/figure><p>item<\/p><\/li><\/ul><\/li><\/ul>/,
  );
});

test('round-trips a saved digest-image source and rewrites remote ones', () => {
  const saved = blocksFromHtml(
    `
      <figure><img src="digest-image:1.jpg" alt="Pier" width="800" height="400"><figcaption>Morning <em>light</em></figcaption></figure>
      <figure><img src="digest-image:missing" alt="Gone"></figure>
      <p>The oak counter stays open for neighbors on Saturday morning.</p>
    `,
    base,
  );
  assert.deepEqual(blocksFromHtml(blocksToHtml(saved), base), saved);
  assert.match(blocksToPlainText(saved), /Morning light/);
  assert.doesNotMatch(blocksToPlainText(saved), /Pier|Gone/);

  const blocks = blocksFromHtml(
    `
      <p>The oak counter stays open for neighbors on Saturday morning.</p>
      <img src="/a.jpg" alt="A" width="400" height="300">
      <blockquote><p>Quoted</p><img src="/b.jpg" alt="B" width="400" height="300"></blockquote>
    `,
    base,
  );
  assert.deepEqual(remoteImageSources(blocks), [
    'https://harbor.example/a.jpg',
    'https://harbor.example/b.jpg',
  ]);
  const mapped = mapFigureSources(blocks, (src) => (src.endsWith('/b.jpg') ? 'digest-image:2.jpg' : 'digest-image:1.jpg'));
  const html = blocksToHtml(mapped);
  assert.match(html, /digest-image:1\.jpg/);
  assert.match(html, /<blockquote><p>Quoted<\/p><figure><img src="digest-image:2\.jpg"/);
  assert.doesNotMatch(html, /https:/);
  assert.deepEqual(blocksFromHtml(html, base), mapped);
});
