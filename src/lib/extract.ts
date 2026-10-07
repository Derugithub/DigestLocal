import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

import type { ExtractedArticle } from '@/lib/types';
import { countWords, escapeRegExp } from '@/lib/text';
import { siteFromUrl } from '@/lib/url';

const MAX_CONTENT_CHARS = 200_000;
const MIN_WORDS = 40;

const JUNK =
  /^(share|tweet|pin it|advertisement|sponsored|subscribe|sign in|log in|menu|search|cookie settings|accept cookies|related|read more)$/i;

export class UnreadablePageError extends Error {
  constructor() {
    super('Could not find enough article text on that page.');
    this.name = 'UnreadablePageError';
  }
}

export function htmlToPlainText(html: string): string {
  const { document } = parseHTML(`<div id="digest-root">${html}</div>`);
  const root = document.querySelector('#digest-root');
  if (!root) return '';

  root.querySelectorAll('script,style,noscript').forEach((node) => node.remove());
  root.querySelectorAll('br').forEach((node) => {
    node.replaceWith(document.createTextNode('\n'));
  });
  root.querySelectorAll('p,h1,h2,h3,h4,li,blockquote,pre,figcaption').forEach((node) => {
    node.append(document.createTextNode('\n\n'));
  });

  const lines = (root.textContent ?? '')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 1 && !JUNK.test(line));

  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] !== line) deduped.push(line);
  }
  return deduped.join('\n\n');
}

function readDocumentTitle(document: { title?: unknown; querySelector: (selector: string) => { textContent: string | null } | null }): string {
  if (typeof document.title === 'string') return document.title;
  return document.querySelector('title')?.textContent ?? '';
}

function cleanTitle(title: string, url: string): string {
  const site = siteFromUrl(url);
  const compact = title.replace(/\s+/g, ' ').trim();
  const stripped = compact
    .replace(new RegExp(`\\s*[|\\-–—:]\\s*${escapeRegExp(site)}\\s*$`, 'i'), '')
    .trim();
  return stripped || site;
}

function dropDuplicateTitle(title: string, content: string): string {
  const blocks = content.split(/\n\n+/);
  if (blocks[0] && blocks[0].trim().toLowerCase() === title.trim().toLowerCase()) {
    return blocks.slice(1).join('\n\n').trim();
  }
  return content.trim();
}

function tryReadability(html: string, url: string): { title: string; content: string } | null {
  try {
    const { document } = parseHTML(html);
    const article = new Readability(document as unknown as Document, { charThreshold: 180 }).parse();
    if (!article?.content) return null;
    const title = cleanTitle(article.title || readDocumentTitle(document), url);
    const content = dropDuplicateTitle(title, htmlToPlainText(article.content));
    if (countWords(content) < MIN_WORDS) return null;
    return { title, content };
  } catch {
    return null;
  }
}

function fallbackExtract(html: string, url: string): { title: string; content: string } | null {
  try {
    const { document } = parseHTML(html);
    document
      .querySelectorAll('script,style,noscript,nav,footer,header,aside,form,svg,iframe')
      .forEach((node) => node.remove());
    const title = cleanTitle(readDocumentTitle(document), url);
    const blocks = [...document.querySelectorAll('article p, article h1, article h2, article li, main p, p')]
      .map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .filter((line) => line.length > 40 && !JUNK.test(line));
    const unique: string[] = [];
    for (const block of blocks) {
      if (!unique.includes(block)) unique.push(block);
    }
    const content = dropDuplicateTitle(title, unique.join('\n\n'));
    if (countWords(content) < MIN_WORDS) return null;
    return { title, content };
  } catch {
    return null;
  }
}

export function extractArticle(html: string, url: string): ExtractedArticle {
  const extracted = tryReadability(html, url) ?? fallbackExtract(html, url);
  if (!extracted) throw new UnreadablePageError();

  let content = extracted.content;
  let truncated = false;
  if (content.length > MAX_CONTENT_CHARS) {
    content = `${content.slice(0, MAX_CONTENT_CHARS).trim()}\n\n[DigestLocal stored the first part of this page because it was very long.]`;
    truncated = true;
  }

  return {
    title: extracted.title,
    site: siteFromUrl(url),
    content,
    truncated,
  };
}
