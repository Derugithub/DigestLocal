import { Platform } from 'react-native';

import { normalizeUrl } from '@/lib/url';

const TIMEOUT_MS = 20_000;

export const DIGEST_USER_AGENT = 'DigestLocal/1.0 (offline article reader)';

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /aborted/i.test(error.message));
}

export async function fetchPublicHtml(rawUrl: string): Promise<{ html: string; url: string; finalUrl: string }> {
  const url = normalizeUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers: Record<string, string> = {
    Accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8',
    'Accept-Language': 'en',
  };
  if (Platform.OS !== 'web') {
    headers['User-Agent'] = DIGEST_USER_AGENT;
  }

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`The site responded with ${response.status}.`);
    }
    const type = response.headers.get('content-type') ?? '';
    if (type && !/html|xml|text\/plain|text\/markdown/i.test(type)) {
      throw new Error('That URL did not return an HTML page.');
    }
    const html = await response.text();
    if (!html.trim()) throw new Error('The page was empty.');
    return { html: html.slice(0, 2_000_000), url, finalUrl: response.url || url };
  } catch (error) {
    if (isAbort(error)) {
      throw new Error('The download timed out. Check the link and try again.');
    }
    if (error instanceof TypeError && Platform.OS === 'web') {
      throw new Error(
        'The browser blocked this download (CORS). On iOS and Android, DigestLocal fetches the page directly. On the web, the site must allow cross-origin reads.',
      );
    }
    if (error instanceof Error && error.message) throw error;
    throw new Error('Could not download that page.');
  } finally {
    clearTimeout(timer);
  }
}
