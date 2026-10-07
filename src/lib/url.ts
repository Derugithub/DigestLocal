export function siteFromUrl(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch {
    return 'unknown site';
  }
}

export function normalizeUrl(input: string): string {
  const compact = input.trim().split(/\s+/)[0] ?? '';
  if (!compact) {
    throw new Error('Paste a link first.');
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(compact) ? compact : `https://${compact}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('That does not look like a web link.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Use an http or https link.');
  }
  if (!url.hostname || !url.hostname.includes('.') && url.hostname !== 'localhost') {
    throw new Error('That link needs a host name.');
  }

  url.hash = '';
  return url.toString();
}
