import assert from 'node:assert/strict';
import test from 'node:test';

import {
  blocksFromHtml,
  blocksToHtml,
  blocksToPlainText,
  limitBlocks,
} from '../src/lib/article-html.ts';

const base = 'https://harbor.example/ledger';

const source = `
  <h2>How a Saturday works</h2>
  <p>Hello <strong>bold</strong> and <em>italic</em> words.</p>
  <ul>
    <li>Parent item
      <ul><li>Child item</li></ul>
    </li>
  </ul>
  <ol start="2">
    <li>Second step</li>
  </ol>
  <blockquote><p>A borrowed tool comes home.</p></blockquote>
  <p>See <a href="/manual">the manual</a> and code <code>TL-418</code>.</p>
  <p>Ignore <a href="javascript:alert(1)" onclick="alert(2)">this trap</a>.</p>
  <pre><code>a &lt; b</code></pre>
  <table>
    <tr><th>Tool</th><td>Calipers</td></tr>
  </table>
  <p class="sponsored-ad">Buy shoes now</p>
  <p class="article-body">The oak counter stays.</p>
  <div class="adaptive">Neighbors keep borrowing.</div>
  <script>alert('nope')</script>
  <style>.ad { color: red }</style>
  <iframe src="https://evil.example"></iframe>
  <p hidden>hidden sponsor copy</p>
  <p>Share</p>
`;

test('preserves structure and strips unsafe content', () => {
  const blocks = blocksFromHtml(source, base);
  const html = blocksToHtml(blocks);
  const text = blocksToPlainText(blocks);

  assert.match(html, /<h2>How a Saturday works<\/h2>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<ul><li><p>Parent item<\/p><ul><li><p>Child item<\/p><\/li><\/ul><\/li><\/ul>/);
  assert.match(html, /<ol start="2"><li><p>Second step<\/p><\/li><\/ol>/);
  assert.match(html, /<blockquote><p>A borrowed tool comes home\.<\/p><\/blockquote>/);
  assert.match(html, /<a href="https:\/\/harbor\.example\/manual">the manual<\/a>/);
  assert.match(html, /<code>TL-418<\/code>/);
  assert.match(html, /<pre><code>a &lt; b<\/code><\/pre>/);
  assert.match(html, /<strong>Tool<\/strong>/);
  assert.match(text, /Calipers/);
  assert.match(text, /The oak counter stays/);
  assert.match(text, /Neighbors keep borrowing/);
  assert.equal((text.match(/Child item/g) ?? []).length, 1);
  assert.doesNotMatch(text, /<[a-z]/i);
  assert.doesNotMatch(html, /<script|onclick|javascript:|Buy shoes now|hidden sponsor|color: red|<iframe/i);

  assert.deepEqual(blocksFromHtml(html, base), blocks);
});

test('truncation stays valid html and keeps a note', () => {
  const blocks = blocksFromHtml(`<p>${'word '.repeat(80)}</p><p>TAIL_MARKER</p>`, base);
  const limited = limitBlocks(blocks, 40);
  assert.equal(limited.truncated, true);
  const text = blocksToPlainText(limited.blocks);
  assert.doesNotMatch(text, /TAIL_MARKER/);
  assert.match(text, /very long/);
  const again = blocksFromHtml(blocksToHtml(limited.blocks), base);
  assert.ok(again.length >= 1);
});

test('empty html produces no blocks', () => {
  assert.deepEqual(blocksFromHtml('   ', base), []);
});
