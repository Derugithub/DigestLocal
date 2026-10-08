export type PasteNotice = 'empty' | 'invalid' | 'unavailable';

export type PasteDraft = {
  id: number;
  url: string;
  notice: PasteNotice | null;
};

let nextId = 1;
let draft: PasteDraft | null = null;

export function stagePaste(url: string, notice: PasteNotice | null): PasteDraft {
  draft = { id: nextId, url, notice };
  nextId += 1;
  return draft;
}

export function currentPaste(): PasteDraft | null {
  return draft;
}
