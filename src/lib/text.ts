export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

export function readingMinutes(text: string): number {
  return Math.max(1, Math.round(countWords(text) / 220));
}

export function formatSavedDate(ms: number): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(ms));
}

export function chunkForSpeech(content: string, maxLength = 480): string[] {
  const paragraphs = content
    .split(/\n\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const chunks: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxLength) {
      chunks.push(paragraph);
      continue;
    }

    const sentences = paragraph.split(/(?<=[.!?])\s+/);
    let buffer = '';
    for (const sentence of sentences) {
      const next = buffer ? `${buffer} ${sentence}` : sentence;
      if (next.length > maxLength && buffer) {
        chunks.push(buffer);
        buffer = sentence;
      } else {
        buffer = next;
      }
    }
    if (buffer) chunks.push(buffer);
  }

  return chunks.length > 0 ? chunks : [content.trim()].filter(Boolean);
}
