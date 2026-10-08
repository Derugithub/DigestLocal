import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

import { blocksFromHtml, blocksToHtml, blocksToPlainText, dropMatchingTitle, limitBlocks } from '@/lib/article-html';
import type { ExtractedArticle } from '@/lib/types';
import { countWords, escapeRegExp } from '@/lib/text';
import { siteFromUrl } from '@/lib/url';

const MAX_CONTENT_CHARS = 200_000;
const MIN_WORDS = 40;

export class UnreadablePageError extends Error {
  constructor() {
    super('Could not find enough article text on that page.');
    this.name = 'UnreadablePageError';
  }
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

function finish(
  title: string,
  fragment: string,
  url: string,
): { title: string; content: string; contentHtml: string; truncated: boolean } | null {
  const blocks = dropMatchingTitle(blocksFromHtml(fragment, url), title);
  if (countWords(blocksToPlainText(blocks)) < MIN_WORDS) return null;
  const limited = limitBlocks(blocks, MAX_CONTENT_CHARS);
  return {
    title,
    content: blocksToPlainText(limited.blocks),
    contentHtml: blocksToHtml(limited.blocks),
    truncated: limited.truncated,
  };
}

function tryReadability(html: string, url: string): ReturnType<typeof finish> {
  try {
    const { document } = parseHTML(html);
    const article = new Readability(document as unknown as Document, { charThreshold: 180 }).parse();
    if (!article?.content) return null;
    const title = cleanTitle(article.title || readDocumentTitle(document), url);
    return finish(title, article.content, url);
  } catch {
    return null;
  }
}

function fallbackExtract(html: string, url: string): ReturnType<typeof finish> {
  try {
    const { document } = parseHTML(html);
    document
      .querySelectorAll('script,style,noscript,nav,footer,header,aside,form,svg,iframe')
      .forEach((node) => node.remove());
    const title = cleanTitle(readDocumentTitle(document), url);
    const root = document.querySelector('article') ?? document.querySelector('main') ?? document.body;
    if (!root) return null;
    return finish(title, root.innerHTML, url);
  } catch {
    return null;
  }
}

export function extractArticle(html: string, url: string): ExtractedArticle {
  const extracted = tryReadability(html, url) ?? fallbackExtract(html, url);
  if (!extracted) throw new UnreadablePageError();
  return {
    title: extracted.title,
    site: siteFromUrl(url),
    content: extracted.content,
    contentHtml: extracted.contentHtml,
    truncated: extracted.truncated,
  };
}
