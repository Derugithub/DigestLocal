import { parseHTML } from 'linkedom';

const TEXT_NODE = 3;

const TRUNCATION_NOTE = '[DigestLocal stored the first part of this page because it was very long.]';

const INLINE_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'br',
  'cite',
  'code',
  'data',
  'dfn',
  'em',
  'i',
  'kbd',
  'mark',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
  'wbr',
  'font',
]);

/** Tags whose contents are never kept. Scripts and styles cannot reach the reader. */
const DROPPED_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'iframe',
  'object',
  'embed',
  'form',
  'svg',
  'math',
  'canvas',
  'video',
  'audio',
  'button',
  'input',
  'select',
  'textarea',
  'nav',
  'template',
  'link',
  'meta',
  'base',
  'img',
  'picture',
  'source',
  'track',
  'map',
  'area',
  'portal',
]);

const AD_HINT =
  /(^|[\s_-])(advert(isement|orial)?|sponsor(ed|ship)?|promo(tion)?|newsletter|cookie-banner|social-share|share-buttons|sharebar|outbrain|taboola|adsbygoogle|ad-slot|ads?([\s_-]|$))/i;

const JUNK_LINE =
  /^(share|tweet|pin it|advertisement|sponsored|subscribe|sign in|log in|menu|search|cookie settings|accept cookies|related|read more)$/i;

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'break' }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: InlineNode[] };

export type ListItem = { blocks: BlockNode[] };

export type BlockNode =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; inlines: InlineNode[] }
  | { type: 'paragraph'; inlines: InlineNode[] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'quote'; blocks: BlockNode[] }
  | { type: 'pre'; text: string }
  | { type: 'rule' };

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

function tagName(element: Element): string {
  return element.tagName.toLowerCase();
}

function attribute(element: Element, name: string): string {
  return element.getAttribute(name) ?? '';
}

function shouldDrop(element: Element): boolean {
  const tag = tagName(element);
  if (DROPPED_TAGS.has(tag)) return true;
  if (element.hasAttribute('hidden')) return true;
  const role = attribute(element, 'role');
  if (/^(navigation|banner|contentinfo)$/i.test(role)) return true;
  const hint = [
    attribute(element, 'class'),
    attribute(element, 'id'),
    role,
    attribute(element, 'aria-label'),
    attribute(element, 'data-ad'),
  ]
    .filter(Boolean)
    .join(' ');
  return hint.length > 0 && AD_HINT.test(hint);
}

function stripUnsafe(root: Element): void {
  const nodes = Array.from(root.querySelectorAll('*'));
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node?.parentNode && shouldDrop(node)) node.remove();
  }
}

function isBlockTag(tag: string): boolean {
  return !INLINE_TAGS.has(tag);
}

function hasBlockChild(element: Element): boolean {
  return Array.from(element.children).some((child) => isBlockTag(tagName(child)) && !shouldDrop(child));
}

function safeHref(raw: string | null, baseUrl: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('#') || /^(javascript|data|vbscript):/i.test(trimmed)) return null;
  try {
    const url = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function compactInlines(nodes: InlineNode[]): InlineNode[] {
  const merged: InlineNode[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      if (!node.text) continue;
      const previous = merged[merged.length - 1];
      if (previous?.type === 'text') previous.text += node.text;
      else merged.push({ type: 'text', text: node.text });
      continue;
    }
    if (node.type === 'break') {
      merged.push({ type: 'break' });
      continue;
    }
    if (node.type === 'code') {
      if (node.text) merged.push(node);
      continue;
    }
    const children = compactInlines(node.children);
    if (children.length === 0) continue;
    if (node.type === 'strong') merged.push({ type: 'strong', children });
    else if (node.type === 'em') merged.push({ type: 'em', children });
    else merged.push({ type: 'link', href: node.href, children });
  }
  trimEdge(merged, 'start');
  trimEdge(merged, 'end');
  const collapsed: InlineNode[] = [];
  for (const node of merged) {
    if (node.type === 'break' && collapsed[collapsed.length - 1]?.type === 'break') continue;
    collapsed.push(node);
  }
  return collapsed;
}

function trimEdge(nodes: InlineNode[], edge: 'start' | 'end'): void {
  while (nodes.length > 0) {
    const index = edge === 'start' ? 0 : nodes.length - 1;
    const node = nodes[index];
    if (!node) return;
    if (node.type === 'break') {
      nodes.splice(index, 1);
      continue;
    }
    if (node.type === 'text') {
      const text = edge === 'start' ? node.text.replace(/^\s+/, '') : node.text.replace(/\s+$/, '');
      if (!text) {
        nodes.splice(index, 1);
        continue;
      }
      node.text = text;
    }
    return;
  }
}

function inlineChildren(element: Element, baseUrl: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  for (const child of Array.from(element.childNodes)) {
    if (isElement(child) && shouldDrop(child)) continue;
    if (isElement(child) && isBlockTag(tagName(child))) {
      const text = blocksToPlainText(blocksFromElement(child, baseUrl)).replace(/\s+/g, ' ').trim();
      if (text) nodes.push({ type: 'text', text });
      continue;
    }
    nodes.push(...inlinesFromNode(child, baseUrl));
  }
  return compactInlines(nodes);
}

function inlinesFromNode(node: Node, baseUrl: string): InlineNode[] {
  if (node.nodeType === TEXT_NODE) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ');
    return text ? [{ type: 'text', text }] : [];
  }
  if (!isElement(node) || shouldDrop(node)) return [];
  const tag = tagName(node);
  if (tag === 'br') return [{ type: 'break' }];
  if (tag === 'wbr') return [];
  if (isBlockTag(tag)) {
    const text = blocksToPlainText(blocksFromElement(node, baseUrl)).replace(/\s+/g, ' ').trim();
    return text ? [{ type: 'text', text }] : [];
  }
  if (tag === 'code' || tag === 'kbd' || tag === 'samp' || tag === 'var') {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    return text ? [{ type: 'code', text }] : [];
  }
  const children = inlineChildren(node, baseUrl);
  if (children.length === 0) return [];
  if (tag === 'strong' || tag === 'b') return [{ type: 'strong', children }];
  if (tag === 'em' || tag === 'i' || tag === 'cite' || tag === 'dfn') return [{ type: 'em', children }];
  if (tag === 'a') {
    const href = safeHref(node.getAttribute('href'), baseUrl);
    return href ? [{ type: 'link', href, children }] : children;
  }
  return children;
}

function listStart(element: Element): number {
  const raw = element.getAttribute('start');
  if (!raw) return 1;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : 1;
}

function listFrom(element: Element, ordered: boolean, baseUrl: string): BlockNode | null {
  const items = Array.from(element.children)
    .filter((child) => tagName(child) === 'li' && !shouldDrop(child))
    .map((child) => ({ blocks: blocksFromChildren(child, baseUrl) }))
    .filter((item) => item.blocks.length > 0);
  if (items.length === 0) return null;
  return { type: 'list', ordered, start: ordered ? listStart(element) : 1, items };
}

function tableRows(table: Element): Element[] {
  const rows: Element[] = [];
  const visit = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = tagName(child);
      if (tag === 'tr') rows.push(child);
      else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') visit(child);
    }
  };
  visit(table);
  return rows;
}

function tableBlocks(table: Element, baseUrl: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  for (const child of Array.from(table.children)) {
    if (tagName(child) === 'caption') blocks.push(...blocksFromElement(child, baseUrl));
  }
  for (const row of tableRows(table)) {
    const inlines: InlineNode[] = [];
    for (const cell of Array.from(row.children)) {
      const tag = tagName(cell);
      if ((tag !== 'td' && tag !== 'th') || shouldDrop(cell)) continue;
      const inner = inlineChildren(cell, baseUrl);
      if (inner.length === 0) continue;
      if (inlines.length > 0) inlines.push({ type: 'text', text: ' · ' });
      if (tag === 'th') inlines.push({ type: 'strong', children: inner });
      else inlines.push(...inner);
    }
    const compact = compactInlines(inlines);
    if (compact.length > 0) blocks.push({ type: 'paragraph', inlines: compact });
  }
  return blocks;
}

function blocksFromElement(element: Element, baseUrl: string): BlockNode[] {
  if (shouldDrop(element)) return [];
  const tag = tagName(element);
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) {
    const level = Number(heading[1]) as 1 | 2 | 3 | 4 | 5 | 6;
    const inlines = inlineChildren(element, baseUrl);
    return inlines.length > 0 ? [{ type: 'heading', level, inlines }] : [];
  }
  if (tag === 'p') {
    if (hasBlockChild(element)) return blocksFromChildren(element, baseUrl);
    const inlines = inlineChildren(element, baseUrl);
    return inlines.length > 0 ? [{ type: 'paragraph', inlines }] : [];
  }
  if (tag === 'ul' || tag === 'ol') {
    const list = listFrom(element, tag === 'ol', baseUrl);
    return list ? [list] : [];
  }
  if (tag === 'blockquote' || tag === 'aside') {
    const blocks = blocksFromChildren(element, baseUrl);
    return blocks.length > 0 ? [{ type: 'quote', blocks }] : [];
  }
  if (tag === 'pre') {
    const text = (element.textContent ?? '').replace(/\r\n/g, '\n').replace(/^\n/, '').replace(/\n$/, '');
    return text.trim() ? [{ type: 'pre', text }] : [];
  }
  if (tag === 'hr') return [{ type: 'rule' }];
  if (tag === 'table') return tableBlocks(element, baseUrl);
  if (tag === 'dt') {
    const inlines = inlineChildren(element, baseUrl);
    return inlines.length > 0 ? [{ type: 'paragraph', inlines: [{ type: 'strong', children: inlines }] }] : [];
  }
  return blocksFromChildren(element, baseUrl);
}

function blocksFromChildren(parent: Node, baseUrl: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  let buffer: InlineNode[] = [];
  const flush = () => {
    const inlines = compactInlines(buffer);
    buffer = [];
    if (inlines.length > 0) blocks.push({ type: 'paragraph', inlines });
  };
  const blockParent = isElement(parent) && hasBlockChild(parent);
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === TEXT_NODE) {
      const raw = child.textContent ?? '';
      if (blockParent && raw.trim() === '') continue;
      const text = raw.replace(/\s+/g, ' ');
      if (text) buffer.push({ type: 'text', text });
      continue;
    }
    if (!isElement(child) || shouldDrop(child)) continue;
    const tag = tagName(child);
    if (tag === 'br') {
      buffer.push({ type: 'break' });
      continue;
    }
    if (!isBlockTag(tag)) {
      buffer.push(...inlinesFromNode(child, baseUrl));
      continue;
    }
    flush();
    blocks.push(...blocksFromElement(child, baseUrl));
  }
  flush();
  return blocks;
}

function isJunk(text: string): boolean {
  return JUNK_LINE.test(text.trim());
}

function pruneBlocks(blocks: BlockNode[]): BlockNode[] {
  const kept: BlockNode[] = [];
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      const text = inlinesToText(block.inlines);
      if (text.length <= 1 || isJunk(text)) continue;
      kept.push(block);
    } else if (block.type === 'heading') {
      const text = inlinesToText(block.inlines);
      if (!text || isJunk(text)) continue;
      kept.push(block);
    } else if (block.type === 'list') {
      const items = block.items
        .map((item) => ({ blocks: pruneBlocks(item.blocks) }))
        .filter((item) => item.blocks.length > 0);
      if (items.length > 0) kept.push({ ...block, items });
    } else if (block.type === 'quote') {
      const inner = pruneBlocks(block.blocks);
      if (inner.length > 0) kept.push({ type: 'quote', blocks: inner });
    } else if (block.type === 'pre') {
      if (block.text.trim()) kept.push(block);
    } else if (block.type === 'rule') {
      if (kept.length > 0 && kept[kept.length - 1]?.type !== 'rule') kept.push(block);
    }
  }
  return kept;
}

function mountFragment(html: string): HTMLElement | null {
  const { document } = parseHTML('<div id="digest-root"></div>');
  const root = document.querySelector('#digest-root');
  if (!root) return null;
  (root as HTMLElement).innerHTML = html;
  return root as HTMLElement;
}

export function blocksFromHtml(html: string, baseUrl: string): BlockNode[] {
  const trimmed = html.trim();
  if (!trimmed) return [];
  try {
    const root = mountFragment(trimmed);
    if (!root) return [];
    stripUnsafe(root);
    return pruneBlocks(blocksFromChildren(root, baseUrl));
  } catch {
    return [];
  }
}

export function inlinesToText(nodes: InlineNode[]): string {
  let raw = '';
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'code') raw += node.text;
    else if (node.type === 'break') raw += '\n';
    else raw += inlinesToText(node.children);
  }
  return raw.replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
}

export function blocksToPlainText(blocks: BlockNode[]): string {
  const lines: string[] = [];
  const walk = (list: BlockNode[]) => {
    for (const block of list) {
      if (block.type === 'paragraph' || block.type === 'heading') {
        const text = inlinesToText(block.inlines);
        if (text) lines.push(text);
      } else if (block.type === 'pre') {
        const text = block.text.trim();
        if (text) lines.push(text);
      } else if (block.type === 'quote') {
        walk(block.blocks);
      } else if (block.type === 'list') {
        for (const item of block.items) walk(item.blocks);
      }
    }
  };
  walk(blocks);
  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] !== line) deduped.push(line);
  }
  return deduped.join('\n\n');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function serializeInlines(nodes: InlineNode[]): string {
  return nodes.map((node) => {
    if (node.type === 'text') return escapeHtml(node.text);
    if (node.type === 'break') return '<br>';
    if (node.type === 'code') return `<code>${escapeHtml(node.text)}</code>`;
    if (node.type === 'strong') return `<strong>${serializeInlines(node.children)}</strong>`;
    if (node.type === 'em') return `<em>${serializeInlines(node.children)}</em>`;
    return `<a href="${escapeAttr(node.href)}">${serializeInlines(node.children)}</a>`;
  }).join('');
}

export function blocksToHtml(blocks: BlockNode[]): string {
  return blocks.map((block) => {
    if (block.type === 'heading') {
      return `<h${block.level}>${serializeInlines(block.inlines)}</h${block.level}>`;
    }
    if (block.type === 'paragraph') return `<p>${serializeInlines(block.inlines)}</p>`;
    if (block.type === 'quote') return `<blockquote>${blocksToHtml(block.blocks)}</blockquote>`;
    if (block.type === 'pre') return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
    if (block.type === 'rule') return '<hr>';
    const tag = block.ordered ? 'ol' : 'ul';
    const start = block.ordered && block.start !== 1 ? ` start="${block.start}"` : '';
    const items = block.items.map((item) => `<li>${blocksToHtml(item.blocks)}</li>`).join('');
    return `<${tag}${start}>${items}</${tag}>`;
  }).join('');
}

export function dropMatchingTitle(blocks: BlockNode[], title: string): BlockNode[] {
  const first = blocks[0];
  if (!first || (first.type !== 'heading' && first.type !== 'paragraph')) return blocks;
  if (inlinesToText(first.inlines).trim().toLowerCase() === title.trim().toLowerCase()) {
    return blocks.slice(1);
  }
  return blocks;
}

function clipBlock(block: BlockNode, maxChars: number): BlockNode {
  const text = blocksToPlainText([block]).slice(0, maxChars).trim();
  if (block.type === 'pre') return { type: 'pre', text };
  return { type: 'paragraph', inlines: [{ type: 'text', text }] };
}

export function limitBlocks(blocks: BlockNode[], maxChars: number): { blocks: BlockNode[]; truncated: boolean } {
  if (blocksToPlainText(blocks).length <= maxChars) return { blocks, truncated: false };
  const kept: BlockNode[] = [];
  for (const block of blocks) {
    if (blocksToPlainText([...kept, block]).length > maxChars) {
      if (kept.length === 0) {
        const clipped = clipBlock(block, maxChars);
        if (blocksToPlainText([clipped]).trim()) kept.push(clipped);
      }
      break;
    }
    kept.push(block);
  }
  kept.push({ type: 'paragraph', inlines: [{ type: 'text', text: TRUNCATION_NOTE }] });
  return { blocks: kept, truncated: true };
}
