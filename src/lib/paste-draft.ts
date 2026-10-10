export type PasteNotice = 'empty' | 'invalid' | 'unavailable' | 'share';

export type PasteDraft = {
  id: number;
  url: string;
  notice: PasteNotice | null;
};

let nextId = 1;
let draft: PasteDraft | null = null;
const listeners = new Set<(draft: PasteDraft) => void>();

export function stagePaste(url: string, notice: PasteNotice | null): PasteDraft {
  draft = { id: nextId, url, notice };
  nextId += 1;
  for (const listener of listeners) listener(draft);
  return draft;
}

export function currentPaste(): PasteDraft | null {
  return draft;
}

export function subscribePaste(listener: (draft: PasteDraft) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
