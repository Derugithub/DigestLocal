const IMAGE_ACCEPT =
  'image/avif,image/webp,image/apng,image/png,image/jpeg,image/gif;q=0.8,*/*;q=0.5';

/** 401 and 403 are the refusals a missing Referer typically draws. Other errors are not retried. */
export function isRefererRejection(status: number): boolean {
  return status === 401 || status === 403;
}

/** Scheme and host only, including a non-default port. No path, query, or userinfo. */
export function articleOrigin(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.host) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function imageRequestHeaders(options?: { userAgent?: string; referer?: string }): Record<string, string> {
  const headers: Record<string, string> = { Accept: IMAGE_ACCEPT };
  if (options?.userAgent) headers['User-Agent'] = options.userAgent;
  if (options?.referer) headers.Referer = options.referer;
  return headers;
}

/** Referer for the one retry after a refusal, or undefined when the download should not be retried. */
export function refererAfterRejection(status: number, pageUrl: string): string | undefined {
  if (!isRefererRejection(status)) return undefined;
  return articleOrigin(pageUrl) ?? undefined;
}
