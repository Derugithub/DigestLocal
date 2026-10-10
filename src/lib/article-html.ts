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

/** Saved file name, not a file:// path. iOS container paths change between launches. */
export const DIGEST_IMAGE_PREFIX = 'digest-image:';

export const MISSING_IMAGE_SRC = `${DIGEST_IMAGE_PREFIX}missing`;

export type FigureBlock = {
  type: 'figure';
  src: string;
  alt: string;
  width: number | null;
  height: number | null;
  caption: InlineNode[];
};

export type BlockNode =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; inlines: InlineNode[] }
  | { type: 'paragraph'; inlines: InlineNode[] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'quote'; blocks: BlockNode[] }
  | { type: 'pre'; text: string }
  | { type: 'rule' }
  | FigureBlock;

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
  if (tag === 'source') {
    const parent = element.parentElement;
    if (!parent || tagName(parent) !== 'picture') return true;
  }
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

const TRACKER_URL =
  /doubleclick|googlesyndication|googleadservices|adnxs|facebook\.com\/tr|scorecardresearch|quantserve|(?:^|[/?&=._-])(?:pixel|spacer|beacon)\.(?:gif|png|jpe?g|webp)(?:$|[?#])/i;

const ICON_URL =
  /(?:^|[/?&=._-])(?:favicon|apple-touch-icon|sprite|emoji)(?:[./_?-]|$)|\/icons?\//i;

const ICON_HINT = /(^|[\s_-])(icon|sprite|emoji|favicon|badge)([\s_-]|$)/i;

const PLACEHOLDER_SRC =
  /^(?:data|blob|javascript|about):|(?:^|[/?&=._-])(?:spacer|blank|transparent|clear|1x1|pixel)\.(?:gif|png|jpe?g|webp)(?:$|[?#])/i;

type ImageCandidate = { raw: string; width: number | null; density: number | null };

function isDigestImageSrc(src: string): boolean {
  if (src === MISSING_IMAGE_SRC) return true;
  if (!src.startsWith(DIGEST_IMAGE_PREFIX)) return false;
  const name = src.slice(DIGEST_IMAGE_PREFIX.length);
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(name);
}

function isPlaceholderSrc(raw: string): boolean {
  return PLACEHOLDER_SRC.test(raw.trim());
}

function resolveImageUrl(raw: string, baseUrl: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || isPlaceholderSrc(trimmed)) return null;
  if (trimmed.startsWith(DIGEST_IMAGE_PREFIX)) return isDigestImageSrc(trimmed) ? trimmed : null;
  return safeHref(trimmed, baseUrl);
}

function parseSrcset(value: string): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];
  for (const part of value.split(',')) {
    const bits = part.trim().split(/\s+/);
    const raw = bits[0];
    if (!raw) continue;
    let width: number | null = null;
    let density: number | null = null;
    for (const bit of bits.slice(1)) {
      if (/^\d+(?:\.\d+)?w$/i.test(bit)) width = Number.parseFloat(bit);
      else if (/^\d+(?:\.\d+)?x$/i.test(bit)) density = Number.parseFloat(bit);
    }
    candidates.push({ raw, width, density });
  }
  return candidates;
}

function bestImageUrl(candidates: ImageCandidate[], baseUrl: string): string | null {
  const resolved = candidates.flatMap((candidate) => {
    const url = resolveImageUrl(candidate.raw, baseUrl);
    return url ? [{ ...candidate, url }] : [];
  });
  if (resolved.length === 0) return null;
  const withWidth = resolved.filter((candidate) => candidate.width !== null && candidate.width > 0);
  if (withWidth.length > 0) {
    return withWidth.reduce((best, candidate) => ((candidate.width ?? 0) > (best.width ?? 0) ? candidate : best)).url;
  }
  const withDensity = resolved.filter((candidate) => candidate.density !== null && candidate.density > 0);
  if (withDensity.length > 0) {
    return withDensity.reduce((best, candidate) => ((candidate.density ?? 0) > (best.density ?? 0) ? candidate : best)).url;
  }
  return resolved[0]?.url ?? null;
}

function srcsetCandidates(element: Element): ImageCandidate[] {
  const srcset = attribute(element, 'data-srcset').trim() || attribute(element, 'srcset').trim();
  return srcset ? parseSrcset(srcset) : [];
}

function candidatesFromImg(img: Element): ImageCandidate[] {
  const fromSet = srcsetCandidates(img);
  if (fromSet.length > 0) return fromSet;
  for (const name of ['data-src', 'data-lazy-src', 'data-original', 'data-hi-res-src']) {
    const raw = attribute(img, name).trim();
    if (raw && !isPlaceholderSrc(raw)) return [{ raw, width: null, density: null }];
  }
  const src = attribute(img, 'src').trim();
  if (src && !isPlaceholderSrc(src)) return [{ raw: src, width: null, density: null }];
  return [];
}

function candidatesFromPicture(picture: Element): ImageCandidate[] {
  const collected: ImageCandidate[] = [];
  for (const child of Array.from(picture.children)) {
    const tag = tagName(child);
    if (tag === 'source') {
      collected.push(...srcsetCandidates(child));
      for (const name of ['data-src', 'src']) {
        const raw = attribute(child, name).trim();
        if (raw && !isPlaceholderSrc(raw)) collected.push({ raw, width: null, density: null });
      }
    } else if (tag === 'img') {
      collected.push(...candidatesFromImg(child));
    }
  }
  return collected;
}

function dimension(element: Element, name: string): number | null {
  const match = /^(\d{1,5})(?:\.\d+)?$/.exec(attribute(element, name).trim());
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 10);
  return value > 0 ? value : null;
}

function altText(img: Element | null): string {
  return (img?.getAttribute('alt') ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function hintText(element: Element): string {
  return [attribute(element, 'class'), attribute(element, 'id'), attribute(element, 'role')].filter(Boolean).join(' ');
}

function shouldSkipImage(url: string, width: number | null, height: number | null, hint: string): boolean {
  if (url.startsWith(DIGEST_IMAGE_PREFIX)) return false;
  if (/\.svg(?:$|[?#])/i.test(url)) return true;
  if (TRACKER_URL.test(url)) return true;
  if (width !== null && height !== null && width <= 2 && height <= 2) return true;
  if (width !== null && height !== null && width <= 32 && height <= 32) return true;
  const iconLike = ICON_URL.test(url) || ICON_HINT.test(hint);
  if (iconLike && (width === null || width <= 128) && (height === null || height <= 128)) return true;
  return false;
}

function resolveImg(img: Element, baseUrl: string): Omit<FigureBlock, 'type' | 'caption'> | null {
  const src = bestImageUrl(candidatesFromImg(img), baseUrl);
  if (!src) return null;
  const width = dimension(img, 'width');
  const height = dimension(img, 'height');
  if (shouldSkipImage(src, width, height, hintText(img))) return null;
  return { src, alt: altText(img), width, height };
}

function pictureImg(picture: Element): Element | null {
  return Array.from(picture.children).find((child) => tagName(child) === 'img') ?? null;
}

function resolvePicture(picture: Element, baseUrl: string): Omit<FigureBlock, 'type' | 'caption'> | null {
  const img = pictureImg(picture);
  const src = bestImageUrl(candidatesFromPicture(picture), baseUrl);
  if (!src) return null;
  const width = img ? dimension(img, 'width') : dimension(picture, 'width');
  const height = img ? dimension(img, 'height') : dimension(picture, 'height');
  const hint = `${hintText(picture)} ${img ? hintText(img) : ''}`;
  if (shouldSkipImage(src, width, height, hint)) return null;
  return { src, alt: altText(img), width, height };
}

function figureFromMedia(element: Element, baseUrl: string): FigureBlock | null {
  const tag = tagName(element);
  const resolved = tag === 'picture' ? resolvePicture(element, baseUrl) : tag === 'img' ? resolveImg(element, baseUrl) : null;
  return resolved ? { type: 'figure', ...resolved, caption: [] } : null;
}

function insideFigcaption(element: Element): boolean {
  let parent = element.parentElement;
  while (parent) {
    if (tagName(parent) === 'figcaption') return true;
    parent = parent.parentElement;
  }
  return false;
}

function isLiftParent(element: Element): boolean {
  const tag = tagName(element);
  if (INLINE_TAGS.has(tag) || tag === 'p' || /^h[1-6]$/.test(tag)) return true;
  return false;
}

function hasMeaningfulContent(element: Element): boolean {
  if ((element.textContent ?? '').trim()) return true;
  return element.children.length > 0;
}

function splitParentAround(node: Element): void {
  const parent = node.parentElement;
  const grand = parent?.parentNode;
  if (!parent || !grand || parent.firstChild === null) return;
  const before = parent.cloneNode(false) as Element;
  const after = parent.cloneNode(false) as Element;
  while (parent.firstChild && parent.firstChild !== node) before.appendChild(parent.firstChild);
  if (parent.firstChild === node) parent.removeChild(node);
  while (parent.firstChild) after.appendChild(parent.firstChild);
  if (hasMeaningfulContent(before)) grand.insertBefore(before, parent);
  grand.insertBefore(node, parent);
  if (hasMeaningfulContent(after)) grand.insertBefore(after, parent);
  parent.remove();
}

function liftUntilFlow(node: Element, root: Element): void {
  let guard = 0;
  while (node.parentElement && node.parentElement !== root && isLiftParent(node.parentElement) && guard < 20) {
    const parent = node.parentElement;
    splitParentAround(node);
    if (node.parentElement === parent) break;
    guard += 1;
  }
}

function prepareContentImages(root: Element, baseUrl: string): void {
  const nodes = Array.from(root.querySelectorAll('picture, img')).filter((node) => {
    if (tagName(node) === 'img' && node.parentElement && tagName(node.parentElement) === 'picture') return false;
    return true;
  });
  for (const node of nodes) {
    if (!node.parentNode) continue;
    if (insideFigcaption(node)) {
      node.remove();
      continue;
    }
    const resolved = tagName(node) === 'picture' ? resolvePicture(node, baseUrl) : resolveImg(node, baseUrl);
    if (!resolved) {
      node.remove();
      continue;
    }
    liftUntilFlow(node, root);
  }
}

function figureBlocks(element: Element, baseUrl: string): BlockNode[] {
  let caption: InlineNode[] = [];
  const media: FigureBlock[] = [];
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (shouldDrop(child)) continue;
      const tag = tagName(child);
      if (tag === 'figcaption') {
        caption = inlineChildren(child, baseUrl);
        continue;
      }
      if (tag === 'picture' || tag === 'img') {
        const figure = figureFromMedia(child, baseUrl);
        if (figure) media.push(figure);
        continue;
      }
      if (tag !== 'figure') walk(child);
    }
  };
  walk(element);
  if (media.length === 0) return blocksFromChildren(element, baseUrl);
  const [first, ...rest] = media;
  if (!first) return blocksFromChildren(element, baseUrl);
  return [{ ...first, caption }, ...rest];
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
  if (tag === 'img' || tag === 'picture') {
    const figure = figureFromMedia(element, baseUrl);
    return figure ? [figure] : [];
  }
  if (tag === 'figure') return figureBlocks(element, baseUrl);
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
    } else if (block.type === 'figure') {
      if (block.src) kept.push(block);
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
    prepareContentImages(root, baseUrl);
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
      } else if (block.type === 'figure') {
        const caption = inlinesToText(block.caption);
        if (caption) lines.push(caption);
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

function serializeFigure(block: FigureBlock): string {
  const width = block.width ? ` width="${block.width}"` : '';
  const height = block.height ? ` height="${block.height}"` : '';
  const caption = block.caption.length > 0 ? `<figcaption>${serializeInlines(block.caption)}</figcaption>` : '';
  return `<figure><img src="${escapeAttr(block.src)}" alt="${escapeAttr(block.alt)}"${width}${height}>${caption}</figure>`;
}

function walkBlocks(blocks: BlockNode[], visit: (block: FigureBlock) => void): void {
  for (const block of blocks) {
    if (block.type === 'figure') visit(block);
    else if (block.type === 'list') {
      for (const item of block.items) walkBlocks(item.blocks, visit);
    } else if (block.type === 'quote') walkBlocks(block.blocks, visit);
  }
}

export function remoteImageSources(blocks: BlockNode[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  walkBlocks(blocks, (block) => {
    if (!/^https?:\/\//i.test(block.src) || seen.has(block.src)) return;
    seen.add(block.src);
    urls.push(block.src);
  });
  return urls;
}

export function mapFigureSources(blocks: BlockNode[], mapSrc: (src: string) => string): BlockNode[] {
  return blocks.map((block) => {
    if (block.type === 'figure') return { ...block, src: mapSrc(block.src) };
    if (block.type === 'list') {
      return {
        ...block,
        items: block.items.map((item) => ({ blocks: mapFigureSources(item.blocks, mapSrc) })),
      };
    }
    if (block.type === 'quote') return { ...block, blocks: mapFigureSources(block.blocks, mapSrc) };
    return block;
  });
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
    if (block.type === 'figure') return serializeFigure(block);
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
