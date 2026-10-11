/**
 * Share-intent handoff. Consent and Mobile Ads init wait until the shelf is shown again.
 */
let shareHandoff = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function markShareHandoff(): void {
  shareHandoff = true;
  emit();
}

export function clearShareHandoff(): void {
  if (!shareHandoff) return;
  shareHandoff = false;
  emit();
}

export function isShareHandoff(): boolean {
  return shareHandoff;
}

export function subscribeShareHandoff(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
