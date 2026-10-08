export type FontRun = {
  text: string;
  system: boolean;
};

/**
 * Splits a string into runs that Inter can draw and runs that must use the
 * platform font. Inter covers Latin, Greek, and Cyrillic. Ethiopic and other
 * scripts stay on the system face so Android does not show missing-glyph boxes.
 */
export function fontRuns(text: string): FontRun[] {
  const runs: FontRun[] = [];
  let buffer = '';
  let system: boolean | null = null;

  const flush = () => {
    if (!buffer) return;
    runs.push({ text: buffer, system: system ?? false });
    buffer = '';
  };

  for (const char of text) {
    const kind = kindOf(char.codePointAt(0) ?? 0);
    if (kind === 'stick') {
      if (system === null) system = false;
      buffer += char;
      continue;
    }
    const next = kind === 'system';
    if (system === null) {
      system = next;
    } else if (next !== system) {
      flush();
      system = next;
    }
    buffer += char;
  }

  flush();
  return runs;
}

export function needsSystemFont(text: string): boolean {
  return fontRuns(text).some((run) => run.system);
}

export function isEntirelySystem(text: string): boolean {
  const runs = fontRuns(text);
  return runs.length > 0 && runs.every((run) => run.system);
}

function kindOf(code: number): 'inter' | 'system' | 'stick' {
  if (isCoveredLetter(code)) return 'inter';
  if (isNeutral(code)) return 'stick';
  return 'system';
}

function isCoveredLetter(code: number): boolean {
  if (code >= 0x41 && code <= 0x5a) return true;
  if (code >= 0x61 && code <= 0x7a) return true;
  if (code >= 0xc0 && code <= 0x24f) return true;
  if (code >= 0x370 && code <= 0x3ff) return true;
  if (code >= 0x400 && code <= 0x52f) return true;
  if (code >= 0x1e00 && code <= 0x1eff) return true;
  if (code >= 0x1f00 && code <= 0x1fff) return true;
  return false;
}

function isNeutral(code: number): boolean {
  if (code <= 0x40) return true;
  if (code >= 0x5b && code <= 0x60) return true;
  if (code >= 0x7b && code <= 0xbf) return true;
  if (code >= 0x300 && code <= 0x36f) return true;
  if (code >= 0x2000 && code <= 0x206f) return true;
  if (code >= 0x20a0 && code <= 0x20cf) return true;
  if (code >= 0xfe00 && code <= 0xfe0f) return true;
  if (code === 0x200d) return true;
  return false;
}
