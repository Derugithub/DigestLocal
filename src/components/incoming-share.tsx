import { useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect, useRef } from 'react';

import { stagePaste } from '@/lib/paste-draft';
import { draftFromShare } from '@/lib/share-draft';

/** Sends a shared link into the existing add screen. No-op until a share arrives. */
export function IncomingShare() {
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const idle = useRef(true);

  useEffect(() => {
    if (!hasShareIntent) {
      idle.current = true;
      return;
    }
    if (!idle.current) return;
    idle.current = false;
    const draft = draftFromShare({ webUrl: shareIntent.webUrl, text: shareIntent.text });
    stagePaste(draft.url, draft.notice);
    resetShareIntent();
    router.navigate('/add');
  }, [hasShareIntent, resetShareIntent, router, shareIntent.text, shareIntent.webUrl]);

  return null;
}
