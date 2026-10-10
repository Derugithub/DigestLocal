import type { PasteNotice } from '@/lib/paste-draft';
import { urlFromClipboard } from '@/lib/url';

export function draftFromShare(input: {
  webUrl?: string | null;
  text?: string | null;
}): { url: string; notice: PasteNotice | null } {
  const fromWeb = urlFromClipboard(input.webUrl);
  if (fromWeb) return { url: fromWeb, notice: null };
  const fromText = urlFromClipboard(input.text);
  if (fromText) return { url: fromText, notice: null };
  return { url: '', notice: 'share' };
}
