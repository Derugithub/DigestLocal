import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import {
  DIGEST_IMAGE_PREFIX,
  MISSING_IMAGE_SRC,
  blocksFromHtml,
  blocksToHtml,
  mapFigureSources,
  remoteImageSources,
} from '@/lib/article-html';
import { DIGEST_USER_AGENT } from '@/lib/fetch-page';

const MAX_IMAGES = 30;
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

function safeArticleId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  return cleaned || 'article';
}

function articleDirectory(articleId: string): Directory {
  return new Directory(Paths.document, 'articles', safeArticleId(articleId));
}

function extensionFor(mime: string): string {
  if (mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/pjpeg') return 'jpg';
  if (mime === 'image/png' || mime === 'image/apng' || mime === 'image/x-png') return 'png';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/avif') return 'avif';
  if (mime === 'image/bmp' || mime === 'image/x-ms-bmp') return 'bmp';
  return 'img';
}

function imageHeaders(pageUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'image/avif,image/webp,image/apng,image/png,image/jpeg,image/gif;q=0.8,*/*;q=0.5',
  };
  if (Platform.OS !== 'web') {
    headers['User-Agent'] = DIGEST_USER_AGENT;
    headers.Referer = pageUrl;
  }
  return headers;
}

function looksLikeMarkup(bytes: Uint8Array): boolean {
  let head = '';
  const count = Math.min(bytes.length, 80);
  for (let index = 0; index < count; index += 1) head += String.fromCharCode(bytes[index] ?? 0);
  const trimmed = head.trimStart().toLowerCase();
  return trimmed.startsWith('<!doctype') || trimmed.startsWith('<html') || trimmed.startsWith('<svg') || trimmed.startsWith('<?xml');
}

async function downloadImage(directory: Directory, url: string, pageUrl: string, index: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: imageHeaders(pageUrl),
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) return null;
    const mime = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!mime.startsWith('image/') || mime === 'image/svg+xml') return null;
    const advertised = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(advertised) && advertised > MAX_BYTES) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES || looksLikeMarkup(bytes)) return null;
    const name = `${index}.${extensionFor(mime)}`;
    const file = new File(directory, name);
    try {
      file.create({ overwrite: true, intermediates: true });
      file.write(bytes);
    } catch {
      try {
        if (file.exists) file.delete();
      } catch {
        // The failed download should not leave a partial file behind.
      }
      return null;
    }
    return name;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function storeArticleImages(articleId: string, html: string, pageUrl: string): Promise<string> {
  const blocks = blocksFromHtml(html, pageUrl);
  const urls = remoteImageSources(blocks);
  if (urls.length === 0) return html;
  try {
    const directory = articleDirectory(articleId);
    directory.create({ intermediates: true, idempotent: true });
    const replacements = new Map<string, string>();
    for (let index = 0; index < urls.length; index += 1) {
      const url = urls[index];
      if (!url) continue;
      if (index >= MAX_IMAGES) {
        replacements.set(url, MISSING_IMAGE_SRC);
        continue;
      }
      const name = await downloadImage(directory, url, pageUrl, index + 1);
      replacements.set(url, name ? `${DIGEST_IMAGE_PREFIX}${name}` : MISSING_IMAGE_SRC);
    }
    return blocksToHtml(mapFigureSources(blocks, (src) => replacements.get(src) ?? src));
  } catch {
    deleteArticleImages(articleId);
    return html;
  }
}

export function deleteArticleImages(articleId: string): void {
  try {
    const directory = articleDirectory(articleId);
    if (directory.exists) directory.delete();
  } catch {
    // A missing native module or an already-removed folder still leaves the text saved.
  }
}

export function localImageUri(articleId: string, src: string): string | null {
  if (!src.startsWith(DIGEST_IMAGE_PREFIX) || src === MISSING_IMAGE_SRC) return null;
  const name = src.slice(DIGEST_IMAGE_PREFIX.length);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(name)) return null;
  try {
    const file = new File(articleDirectory(articleId), name);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}
