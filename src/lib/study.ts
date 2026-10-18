import type { Quiz, QuizKind, QuizQuestion, StudyInput } from '@/lib/types';

/**
 * On-device study engine.
 *
 * `heuristic-v3` scores sentences locally and writes an extractive summary
 * plus a multiple-choice quiz. Questions are mostly cloze questions: a key
 * term (year, number, or proper name) is hidden in a real sentence from the
 * article, and the wrong choices are other terms of the same type taken from
 * the same article. Reference lists, citations, captions, and fragments are
 * filtered out before anything is scored. It does not call a language model.
 * Replace `getStudyEngine()` with another `StudyEngine` to plug in an
 * on-device model. Callers persist the returned summary string and quiz JSON
 * with the article.
 */
export const STUDY_ENGINE_ID = 'heuristic-v3';
export const MIN_QUIZ_QUESTIONS = 2;
export const MAX_QUIZ_QUESTIONS = 8;

export type StudyEngine = {
  id: string;
  summarize(input: StudyInput): string;
  buildQuiz(input: StudyInput, now?: Date): Quiz;
};

const STOPWORDS = new Set(
  `a an the and or but if then else when while at from by for with of on in to into over after before about as is are was were be been being it this that these those i you he she we they them his her their its not no nor so than too very can will just your our my me do does did doing have has had having which who whom what where why how also said says onto off up down out there here such only other more most some any each few own same may might should would could across through during without within between because however therefore among`.split(
    /\s+/,
  ),
);

/** Capitalized words that are never a useful "name" answer on their own. */
const NAME_STOPWORDS = new Set(
  `The A An And Or But If Then When While At From By For With Of On In To Into Over After Before About As Is Are Was Were It This That These Those I You He She We They His Her Their Its Not No So Than Also However Therefore Although Because Since During Many Most Some Each Other Such Here There What Which Who Why How Where One Two Three Four Five Six Seven Eight Nine Ten First Second Third Today Yesterday Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Mr Mrs Ms Dr St Figure Fig Table Chapter Section Page`.split(
    /\s+/,
  ),
);

const MIN_SENTENCE_CHARS = 40;
const MAX_SENTENCE_CHARS = 300;
const MIN_SENTENCE_WORDS = 7;
const MAX_SENTENCE_WORDS = 55;

type ScoredSentence = {
  index: number;
  text: string;
  score: number;
};

/** Remove inline citation markers such as [12], [a], [citation needed], and stray carets. */
function stripCitations(text: string): string {
  return text
    .replace(/\[(?:\d+|[a-z]|citation needed|note \d+|nb \d+|clarification needed|when\?|who\?|by whom\?)\]/gi, '')
    .replace(/\s+\^\s*/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const REFERENCE_PATTERNS: RegExp[] = [
  /https?:\/\/|www\.|\.(?:com|org|net|gov|edu)\b/i,
  /\bdoi\b|\bisbn\b|\bissn\b|\bpmid\b|\barxiv\b|\boclc\b/i,
  /\bretrieved\b|\barchived from\b|\baccessed (?:on )?\d|\boriginal on\b/i,
  /\bproceedings of\b|\bminutes of proceedings\b|\bjournal of\b|\btransactions of\b|\bvol\.\s*\d|\bpp?\.\s*\d|\bed(?:s|ited by)?\.\s/i,
  /\bet al\.?/i,
  /\((?:pdf|in [a-z]+|\d{4}[a-z]?)\)\s*[.,]?$/i,
  /^\s*(?:\^|↑|\*|•|·|\d+\.\s|\[\d+\])/,
  /^\s*(?:figure|fig\.|table|image|photo|picture|map|chart|diagram|source|credit|caption|see also|main article|further reading|external links|references|notes|bibliography)\b/i,
  /\b(?:pictured|shown here|seen here|above|below|left|right)\)?\s*\.?$/i,
  /\(\s*(?:left|right|top|bottom|center|centre|pictured)\s*\)/i,
  /\bclick here\b|\bsubscribe\b|\bsign up\b|\bcookie\b|\badvertisement\b|\ball rights reserved\b|©/i,
];

/** True when a sentence reads like body prose rather than a reference, caption, heading, or fragment. */
export function isQuizWorthySentence(sentence: string): boolean {
  const text = sentence.trim();
  if (text.length < MIN_SENTENCE_CHARS || text.length > MAX_SENTENCE_CHARS) return false;
  const words = text.split(/\s+/);
  if (words.length < MIN_SENTENCE_WORDS || words.length > MAX_SENTENCE_WORDS) return false;
  // Body prose ends with terminal punctuation; captions, headings, and list items often do not.
  if (!/[.!?]["”’')\]]?$/.test(text)) return false;
  // Body prose starts with a capital letter, quote, or digit.
  if (!/^["“‘'(]?[A-Z0-9]/.test(text)) return false;
  if (REFERENCE_PATTERNS.some((pattern) => pattern.test(text))) return false;
  // Title-cased runs ("Minutes of Proceedings of the Institution of Civil Engineers") are references or headings.
  const letters = words.filter((word) => /^[A-Za-z]/.test(word));
  const capitalized = letters.filter((word) => /^[A-Z]/.test(word)).length;
  if (letters.length > 0 && capitalized / letters.length > 0.6) return false;
  // Too many digits or punctuation usually means a table row, citation, or price list.
  const digits = (text.match(/\d/g) ?? []).length;
  if (digits / text.length > 0.2) return false;
  const separators = (text.match(/[;|•·–—]/g) ?? []).length;
  if (separators > 4) return false;
  // A sentence that trails off ("costs about") is a truncated fragment.
  if (/\b(?:about|around|approximately|of|the|a|an|to|and|or|for|with)\s*[.!?]?$/i.test(text)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Near-duplicate detection. Pages often repeat a sentence (pull quotes, captions, teasers),
// and a cloze question on the same sentence with a different blank reads like a repeat.

/** Jaccard similarity at or above this means two texts say the same thing. */
const NEAR_DUPLICATE = 0.9;

/** Content words and numbers, lowercased. Numbers count, so "Point 3" and "Point 4" stay different. */
function fingerprint(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) ?? [];
  return new Set(words.filter((word) => !STOPWORDS.has(word)));
}

function similarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function nearDuplicate(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return similarity(left, right) >= NEAR_DUPLICATE;
}

/** True when two texts are the same or nearly the same sentence. */
export function isNearDuplicate(left: string, right: string): boolean {
  return nearDuplicate(fingerprint(left), fingerprint(right));
}

function dedupeSentences(sentences: string[]): string[] {
  const kept: { text: string; words: Set<string> }[] = [];
  for (const text of sentences) {
    const words = fingerprint(text);
    if (kept.some((item) => nearDuplicate(item.words, words))) continue;
    kept.push({ text, words });
  }
  return kept.map((item) => item.text);
}

function splitSentences(content: string): string[] {
  return dedupeSentences(
    content
      .split(/\n+/)
      .flatMap((chunk) =>
        stripCitations(chunk.replace(/\s+/g, ' ').trim()).split(/(?<=[.!?]["”’)]?)\s+(?=["“‘(]?[A-Z0-9])/),
      )
      .map((sentence) => sentence.trim())
      .filter(isQuizWorthySentence),
  );
}

function contentTokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []).filter((token) => !STOPWORDS.has(token));
}

function scoreSentences(sentences: string[], title: string): ScoredSentence[] {
  const tokenized = sentences.map(contentTokens);
  const frequency = new Map<string, number>();
  for (const tokens of tokenized) {
    for (const token of new Set(tokens)) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }
  const titleTokens = new Set(contentTokens(title));

  return sentences.map((text, index) => {
    const tokens = tokenized[index] ?? [];
    if (tokens.length === 0) return { index, text, score: 0 };
    const freqScore = tokens.reduce((sum, token) => sum + (frequency.get(token) ?? 0), 0) / Math.sqrt(tokens.length);
    const position = index === 0 ? 2.4 : index === 1 ? 1.2 : index === 2 ? 0.45 : 0;
    const titleOverlap = tokens.filter((token) => titleTokens.has(token)).length * 0.85;
    const lengthAdjust = text.length < 60 || text.length > 260 ? -0.5 : 0.35;
    return { index, text, score: freqScore + position + titleOverlap + lengthAdjust };
  });
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let next = Math.imul(state ^ (state >>> 15), 1 | state);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = copy[index];
    copy[index] = copy[swap] as T;
    copy[swap] = current as T;
  }
  return copy;
}

function tidy(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[.?!]+$/, '').trim();
}

function asAnswer(value: string): string {
  const text = tidy(value);
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lowerFirst(value: string): string {
  const text = tidy(value);
  if (!text) return '';
  // Keep acronyms and proper names at the start ("NASA said", "Paris is").
  if (/^[A-Z][A-Z]|^[A-Z][a-z]+\s+[A-Z]/.test(text)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function sameIdea(a: string, b: string): boolean {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  return left === right || left.includes(right) || right.includes(left);
}

// ---------------------------------------------------------------------------
// Key terms: years, numbers, and proper names.

type TermType = 'year' | 'number' | 'name';

type Term = {
  type: TermType;
  /** Exactly as it appears in the sentence. */
  text: string;
  start: number;
};

const YEAR_RE = /\b(?:1[0-9]{3}|20[0-9]{2})s?\b/g;
const NUMBER_RE =
  /(?:[$€£¥]\s?)?\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b(?:\s?(?:%|percent|million|billion|thousand|km|kilometres|kilometers|miles|metres|meters|feet|kg|tonnes|tons|hours|days|years|people))?|(?:[$€£¥]\s?)?\b\d+(?:\.\d+)?\b(?:\s?(?:%|percent|million|billion|thousand|km|kilometres|kilometers|miles|metres|meters|feet|kg|tonnes|tons|hours|days|years|people))?/g;
const NAME_RE = /\b[A-Z][a-zA-Z'’.-]+(?:\s+(?:of|de|la|von|van|the|and|du|da|del)?\s*[A-Z][a-zA-Z'’.-]+)*/g;

function isYear(text: string): boolean {
  const value = Number.parseInt(text, 10);
  return /^\d{4}s?$/.test(text) && value >= 1000 && value <= new Date().getFullYear() + 5;
}

function extractTerms(sentence: string): Term[] {
  const terms: Term[] = [];
  const taken: [number, number][] = [];
  const overlaps = (start: number, end: number) => taken.some(([a, b]) => start < b && end > a);
  const add = (type: TermType, text: string, start: number) => {
    const end = start + text.length;
    if (overlaps(start, end)) return;
    taken.push([start, end]);
    terms.push({ type, text, start });
  };

  for (const match of sentence.matchAll(YEAR_RE)) {
    if (match.index !== undefined && isYear(match[0])) add('year', match[0], match.index);
  }
  for (const match of sentence.matchAll(NUMBER_RE)) {
    if (match.index === undefined) continue;
    const text = match[0].trim();
    // Skip tiny bare numbers ("1", "2") that make trivial questions, and lone years already handled.
    if (/^\d$/.test(text) || isYear(text)) continue;
    add('number', text, match.index);
  }
  for (const match of sentence.matchAll(NAME_RE)) {
    if (match.index === undefined) continue;
    let text = match[0].replace(/[.'’-]+$/, '').trim();
    let start = match.index;
    // Drop leading function words picked up at a sentence start ("The Harbor Tool Library" -> keep, "In Australia" -> "Australia").
    const parts = text.split(/\s+/);
    while (parts.length > 0 && NAME_STOPWORDS.has(parts[0] ?? '')) {
      const dropped = parts.shift() ?? '';
      start += sentence.slice(start).indexOf(dropped) + dropped.length;
      start += sentence.slice(start).length - sentence.slice(start).trimStart().length;
    }
    while (parts.length > 0 && /^(?:of|de|la|von|van|the|and|du|da|del)$/.test(parts[parts.length - 1] ?? '')) parts.pop();
    if (parts.length === 0) continue;
    text = parts.join(' ');
    // A single capitalized word at the very start of a sentence is usually just a capitalized common word.
    if (start === 0 && parts.length === 1) continue;
    if (text.length < 3 || NAME_STOPWORDS.has(text)) continue;
    const at = sentence.indexOf(text, Math.max(0, start - 2));
    if (at < 0) continue;
    add('name', text, at);
  }
  return terms.sort((a, b) => a.start - b.start);
}

function termKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function numberUnit(text: string): string {
  const prefix = text.match(/^[$€£¥]/)?.[0] ?? '';
  const suffix = text.replace(/^[$€£¥]?\s?[\d,]+(?:\.\d+)?\s?/, '').toLowerCase();
  return `${prefix}|${suffix === 'percent' ? '%' : suffix}`;
}

function blankOut(sentence: string, term: Term): string {
  return `${sentence.slice(0, term.start)}_____${sentence.slice(term.start + term.text.length)}`.replace(/\s+/g, ' ').trim();
}

/** Plausible same-type alternatives for a number when the article does not offer enough. */
function syntheticNumbers(term: Term, random: () => number): string[] {
  const match = term.text.match(/^([$€£¥]\s?)?([\d,]+(?:\.\d+)?)(.*)$/);
  if (!match) return [];
  const prefix = match[1] ?? '';
  const raw = match[2] ?? '';
  const suffix = match[3] ?? '';
  const value = Number.parseFloat(raw.replace(/,/g, ''));
  if (!Number.isFinite(value)) return [];
  const decimals = raw.includes('.') ? (raw.split('.')[1] ?? '').length : 0;
  const commas = raw.includes(',');
  const format = (n: number) => {
    const fixed = n.toFixed(decimals);
    return commas ? Number(fixed).toLocaleString('en-US', { minimumFractionDigits: decimals }) : fixed;
  };
  const factors = shuffle([0.5, 0.75, 1.25, 1.5, 2, 3], random);
  const out: string[] = [];
  for (const factor of factors) {
    const next = term.type === 'year' ? Math.round(value + (factor - 1) * 40) : value * factor;
    const text = `${prefix}${format(next)}${suffix}`;
    if (text !== term.text && !out.includes(text) && next > 0) out.push(text);
  }
  return out;
}

function syntheticYears(term: Term, random: () => number): string[] {
  const value = Number.parseInt(term.text, 10);
  const decade = term.text.endsWith('s');
  const offsets = shuffle(decade ? [-30, -20, -10, 10, 20, 30] : [-25, -12, -7, -3, 4, 9, 15, 30], random);
  const now = new Date().getFullYear();
  const out: string[] = [];
  for (const offset of offsets) {
    const year = value + offset;
    if (year > now || year < 1000) continue;
    out.push(decade ? `${year}s` : String(year));
  }
  return out;
}

const CLOZE_STEMS: Record<TermType, string> = {
  year: 'Which year completes this sentence from the article?',
  number: 'Which figure completes this sentence from the article?',
  name: 'Which name completes this sentence from the article?',
};

const CLOZE_EXPLANATIONS: Record<TermType, string> = {
  year: 'The article gives this year. The other years also appear in the article or are nearby, but they refer to something else.',
  number: 'That is the figure the article gives here. The other figures belong to different points in the article.',
  name: 'The article names this here. The other names appear elsewhere in the same article.',
};

// ---------------------------------------------------------------------------
// Drafts

type DraftQuestion = {
  sentenceIndex: number;
  kind: QuizKind;
  prompt: string;
  answer: string;
  explanation: string;
  /** Wrong choices already chosen for this question. */
  distractors: string[];
};

type TermBank = Record<TermType, Map<string, string>>;

function buildTermBank(sentences: ScoredSentence[]): TermBank {
  const bank: TermBank = { year: new Map(), number: new Map(), name: new Map() };
  for (const sentence of sentences) {
    for (const term of extractTerms(sentence.text)) {
      const key = termKey(term.text);
      if (key && !bank[term.type].has(key)) bank[term.type].set(key, term.text);
    }
  }
  return bank;
}

function clozeDraft(sentence: ScoredSentence, term: Term, bank: TermBank, random: () => number): DraftQuestion | null {
  const answerKey = termKey(term.text);
  const sameType = [...bank[term.type].entries()]
    .filter(([key]) => key !== answerKey && !sameIdea(key, answerKey))
    // A distractor that already appears in this sentence would make the blank ambiguous.
    .filter(([, text]) => !sentence.text.includes(text))
    .map(([, text]) => text);
  // Numbers must share a unit ("2,900 feet" vs "300 feet"), otherwise the answer is obvious.
  const unit = numberUnit(term.text);
  let pool = shuffle(term.type === 'number' ? sameType.filter((text) => numberUnit(text) === unit) : sameType, random);
  if (pool.length < 3 && term.type === 'year') pool = [...pool, ...syntheticYears(term, random)];
  if (pool.length < 3 && term.type === 'number') pool = [...pool, ...syntheticNumbers(term, random)];
  const distractors: string[] = [];
  for (const candidate of pool) {
    if (distractors.length >= 3) break;
    if (termKey(candidate) === answerKey || distractors.some((item) => termKey(item) === termKey(candidate))) continue;
    distractors.push(candidate);
  }
  if (distractors.length < 2) return null;
  return {
    sentenceIndex: sentence.index,
    kind: 'cloze',
    prompt: `${CLOZE_STEMS[term.type]}\n“${blankOut(sentence.text, term)}”`,
    answer: term.text,
    explanation: CLOZE_EXPLANATIONS[term.type],
    distractors,
  };
}

/** Prefer years, then names, then numbers; longer names are more specific than single words. */
function rankTerms(terms: Term[]): Term[] {
  const weight = (term: Term) =>
    term.type === 'year' ? 3 : term.type === 'name' ? 2 + Math.min(term.text.split(/\s+/).length, 3) * 0.2 : 1.5;
  return terms.slice().sort((a, b) => weight(b) - weight(a));
}

type ReasonDraft = { sentenceIndex: number; effect: string; answer: string; kind: QuizKind };

function reasonParts(sentence: ScoredSentence): ReasonDraft | null {
  const because = sentence.text.match(/^(.{12,160}?)\s+because\s+(.{12,160})$/i);
  if (because) {
    return { sentenceIndex: sentence.index, effect: tidy(because[1] ?? ''), answer: asAnswer(because[2] ?? ''), kind: 'why' };
  }
  const purpose = sentence.text.match(/^(.{12,160}?)\s+(?:in order to|so that)\s+(.{8,160})$/i);
  if (purpose) {
    return { sentenceIndex: sentence.index, effect: tidy(purpose[1] ?? ''), answer: asAnswer(purpose[2] ?? ''), kind: 'why' };
  }
  return null;
}

/**
 * "Why" questions only when the article gives at least three reasons, so every
 * wrong choice is also a reason from the same article (same type), never a random sentence.
 */
function reasonDrafts(sentences: ScoredSentence[], random: () => number): DraftQuestion[] {
  const reasons = sentences.map(reasonParts).filter((item): item is ReasonDraft => item !== null);
  if (reasons.length < 3) return [];
  return reasons.map((reason) => {
    const others = shuffle(
      reasons.filter((other) => other !== reason && !sameIdea(other.answer, reason.answer)).map((other) => other.answer),
      random,
    ).slice(0, 3);
    return {
      sentenceIndex: reason.sentenceIndex,
      kind: reason.kind,
      prompt: `According to the article, why ${lowerFirst(reason.effect)}?`,
      answer: reason.answer,
      explanation: 'That is the reason the article gives. The other choices are reasons the article gives for different things.',
      distractors: others,
    };
  });
}

export function quizSizeForPoints(pointCount: number): number {
  if (pointCount <= 0) return 0;
  if (pointCount === 1) return 1;
  return Math.min(MAX_QUIZ_QUESTIONS, Math.max(MIN_QUIZ_QUESTIONS, Math.ceil(pointCount / 2)));
}

function summaryLength(sentenceCount: number): number {
  return Math.min(4, Math.max(2, Math.round(sentenceCount * 0.3)));
}

function joinInOrder(sentences: ScoredSentence[]): string {
  return sentences
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((sentence) => sentence.text)
    .join(' ');
}

export function summarize(input: StudyInput): string {
  const sentences = splitSentences(input.content);
  if (sentences.length === 0) return input.content.trim().slice(0, 600);
  if (sentences.length <= 2) return sentences.join(' ');

  const ranked = scoreSentences(sentences, input.title)
    .slice()
    .sort((a, b) => b.score - a.score);
  return joinInOrder(ranked.slice(0, summaryLength(sentences.length)));
}

/** Normalized form of a summary sentence, as stored in `Quiz.summaryShown`. */
export function summarySentenceKey(sentence: string): string {
  return sentence.replace(/\s+/g, ' ').trim().toLowerCase();
}

export type SummaryRebuild = {
  summary: string;
  /** Every summary sentence shown for this article so far, including this one (summarySentenceKey values). */
  shown: string[];
  /** Set when the summary could not change, or when every sentence has been used and selection starts over. */
  note?: string;
};

export const SUMMARY_TOO_SHORT_NOTE = 'This article is too short for a different summary, so it stays the same.';
export const SUMMARY_CYCLED_NOTE = 'Every sentence has now appeared in a summary, so earlier ones come back.';

/**
 * A different extractive summary for "Rebuild". It skips the sentences in the summary on screen and,
 * where it can, every sentence shown in an earlier summary (`history`), taking the best-scored of the
 * rest. Once nothing unseen is left it starts over (still avoiding the summary on screen) and says so.
 * When the article has too few sentences to change anything, it returns the same text with a note.
 */
export function rebuildSummary(input: StudyInput, current: string | null, history: Iterable<string> = []): SummaryRebuild {
  const currentText = current?.trim() ?? '';
  const sentences = splitSentences(input.content);
  const ranked = scoreSentences(sentences, input.title)
    .slice()
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const count = summaryLength(sentences.length);
  const shownBefore = new Set<string>();
  for (const key of history) if (typeof key === 'string' && key) shownBefore.add(summarySentenceKey(key));

  if (sentences.length <= Math.max(2, count)) {
    const summary = summarize(input);
    const same = currentText !== '' && summarySentenceKey(summary) === summarySentenceKey(currentText);
    return {
      summary,
      shown: [...new Set([...shownBefore, ...sentences.map(summarySentenceKey)])],
      note: same ? SUMMARY_TOO_SHORT_NOTE : undefined,
    };
  }

  const currentKey = summarySentenceKey(currentText);
  const inCurrent = (sentence: ScoredSentence) => currentKey !== '' && currentKey.includes(summarySentenceKey(sentence.text));
  const seen = (sentence: ScoredSentence) => shownBefore.has(summarySentenceKey(sentence.text));

  let cycled = false;
  let unseen = ranked.filter((sentence) => !inCurrent(sentence) && !seen(sentence));
  if (unseen.length === 0) {
    cycled = true;
    unseen = ranked.filter((sentence) => !inCurrent(sentence));
  }
  const picked: ScoredSentence[] = unseen.slice(0, count);
  // Top up with seen sentences that are not on screen, then with on-screen ones, keeping the length.
  for (const pool of [ranked.filter((sentence) => !inCurrent(sentence)), ranked]) {
    for (const sentence of pool) {
      if (picked.length >= count) break;
      if (!picked.includes(sentence)) picked.push(sentence);
    }
  }
  const summary = joinInOrder(picked);
  const pickedKeys = picked.map((sentence) => summarySentenceKey(sentence.text));
  const currentKeys = ranked.filter(inCurrent).map((sentence) => summarySentenceKey(sentence.text));
  const shown = cycled ? [...new Set([...currentKeys, ...pickedKeys])] : [...new Set([...shownBefore, ...currentKeys, ...pickedKeys])];
  const same = summarySentenceKey(summary) === currentKey;
  return { summary, shown, note: same ? SUMMARY_TOO_SHORT_NOTE : cycled ? SUMMARY_CYCLED_NOTE : undefined };
}

export function quizQuestionKey(prompt: string, answer: string): string {
  return `${prompt.trim().toLowerCase()}\n${answer.trim().toLowerCase()}`;
}

/**
 * Words of the sentence a question is about, with the blank filled back in, so two cloze questions on
 * the same sentence (different blanks) match. The shared question stem is left out.
 */
function questionFingerprint(prompt: string, answer: string): Set<string> {
  const quoted = prompt.match(/“([^”]*)”/);
  const body = (quoted?.[1] ?? prompt).replace(/_{2,}/g, ' ');
  return fingerprint(`${body} ${answer}`);
}

function fingerprintOfKey(key: string): Set<string> {
  const split = key.lastIndexOf('\n');
  return split < 0 ? fingerprint(key) : questionFingerprint(key.slice(0, split), key.slice(split + 1));
}

function keyOf(question: QuizQuestion): string {
  return quizQuestionKey(question.prompt, question.choices[question.answerIndex] ?? '');
}

export function sameQuizSet(left: QuizQuestion[], right: QuizQuestion[]): boolean {
  if (left.length !== right.length) return false;
  const a = left.map(keyOf).sort();
  const b = right.map(keyOf).sort();
  return a.every((key, index) => key === b[index]);
}

export function buildQuiz(
  input: StudyInput,
  now = new Date(),
  options?: {
    /** quizQuestionKey(prompt, answer) values that must not be asked again. */
    exclude?: ReadonlySet<string>;
    /** Changes which term is picked and how choices are shuffled; 0 is the default set. */
    seed?: number;
    /** Also skip questions about the same sentence as an excluded question (a different blank reads as a repeat). */
    avoidSimilar?: boolean;
  },
): Quiz {
  const sentences = splitSentences(input.content);
  const ranked = scoreSentences(sentences, input.title)
    .filter((sentence) => sentence.score > 0)
    .sort((a, b) => b.score - a.score);
  const seed = options?.seed ?? 0;
  const random = mulberry32(hashString(`${input.title}\n${input.content}\n${seed}`));
  const target = quizSizeForPoints(ranked.length);
  const exclude = options?.exclude;
  const bank = buildTermBank(ranked);

  const selected: DraftQuestion[] = [];
  const usedSentences = new Set<number>();
  const usedAnswers = new Set<string>();
  const usedPrints: Set<string>[] = [];
  const excludedPrints = options?.avoidSimilar && exclude ? [...exclude].map(fingerprintOfKey) : [];
  const accept = (draft: DraftQuestion | null): boolean => {
    if (!draft) return false;
    if (exclude?.has(quizQuestionKey(draft.prompt, draft.answer))) return false;
    if (usedSentences.has(draft.sentenceIndex) || usedAnswers.has(termKey(draft.answer))) return false;
    if (draft.distractors.length < 2) return false;
    const print = questionFingerprint(draft.prompt, draft.answer);
    // Never two near-identical questions in one set, and with avoidSimilar none like an earlier one.
    if (usedPrints.some((other) => nearDuplicate(other, print))) return false;
    if (excludedPrints.some((other) => nearDuplicate(other, print))) return false;
    selected.push(draft);
    usedSentences.add(draft.sentenceIndex);
    usedAnswers.add(termKey(draft.answer));
    usedPrints.push(print);
    return true;
  };

  // Cloze questions first: one per sentence, trying the best key term and then the others.
  for (const sentence of ranked) {
    if (selected.length >= target) break;
    const terms = rankTerms(extractTerms(sentence.text));
    // Rotate the preferred term by seed so later sets can ask about a different term in the same sentence.
    const rotated = terms.length > 0 ? [...terms.slice(seed % terms.length), ...terms.slice(0, seed % terms.length)] : terms;
    for (const term of rotated) {
      if (accept(clozeDraft(sentence, term, bank, random))) break;
    }
  }

  // Then reason questions whose distractors are other reasons.
  for (const draft of reasonDrafts(ranked, random)) {
    if (selected.length >= target) break;
    accept(draft);
  }

  const want = ranked.length >= 4 ? 3 : 2;
  const questions: QuizQuestion[] = [];
  for (const draft of selected.sort((a, b) => a.sentenceIndex - b.sentenceIndex)) {
    const picked = draft.distractors.filter((item) => !sameIdea(item, draft.answer)).slice(0, want);
    if (picked.length < want && picked.length < 2) continue;
    const choices = shuffle([draft.answer, ...picked], random);
    if (new Set(choices.map((choice) => choice.toLowerCase())).size !== choices.length) continue;
    questions.push({
      id: `q${questions.length + 1}`,
      kind: draft.kind,
      prompt: draft.prompt,
      choices,
      answerIndex: choices.indexOf(draft.answer),
      explanation: draft.explanation,
    });
  }

  return {
    engine: STUDY_ENGINE_ID,
    generatedAt: now.toISOString(),
    questions,
    asked: questions.map(keyOf),
    note: questions.length === 0 ? 'Not enough article text to build a quiz.' : undefined,
  };
}

/**
 * Another set for the same article with no question that was asked before, or null when nothing new is left.
 * `previous` is the set on screen; `askedKeys` is the history persisted on the quiz (`Quiz.asked`), so a
 * second or third reward never brings back the first set. Several seeds are tried before giving up.
 */
export function freshQuizIfDifferent(
  input: StudyInput,
  previous: QuizQuestion[],
  now = new Date(),
  askedKeys?: Iterable<string>,
): Quiz | null {
  if (previous.length === 0) return null;
  const exclude = new Set<string>([...previous.map(keyOf), ...[...(askedKeys ?? [])].filter((key) => typeof key === 'string')]);
  // First try sets about sentences not asked before; only then allow a new blank in an asked sentence.
  for (const avoidSimilar of [true, false]) {
    for (let seed = 0; seed < 4; seed += 1) {
      const next = buildQuiz(input, now, { exclude, seed, avoidSimilar });
      const novel = next.questions.filter((question) => !exclude.has(keyOf(question)));
      if (novel.length === 0) continue;
      const questions = novel.map((question, index) => ({ ...question, id: `q${index + 1}` }));
      if (sameQuizSet(previous, questions)) continue;
      return { ...next, questions, asked: [...exclude, ...questions.map(keyOf)] };
    }
  }
  return null;
}

export const QUIZ_CYCLED_NOTE = 'You have seen every question this article can make, so some come back.';

/**
 * The quiz for "Rebuild". It keeps the asked history and prefers questions never shown for this article.
 * When every question has been asked it starts the history over, still avoiding the set on screen where
 * possible, and returns a note. Summary history on the previous quiz is carried over.
 */
export function rebuildQuiz(input: StudyInput, previous: Quiz | null, now = new Date()): { quiz: Quiz; note?: string } {
  const carry = previous?.summaryShown ? { summaryShown: previous.summaryShown } : {};
  const previousQuestions = previous?.questions ?? [];
  if (previousQuestions.length === 0) {
    return { quiz: { ...buildQuiz(input, now), ...carry } };
  }
  const fresh = freshQuizIfDifferent(input, previousQuestions, now, previous?.asked);
  if (fresh) return { quiz: { ...fresh, ...carry } };

  // Everything has been asked. Start over, but not with the exact set on screen if another one exists.
  const onScreen = new Set(previousQuestions.map(keyOf));
  for (let seed = 1; seed <= 4; seed += 1) {
    const next = buildQuiz(input, now, { seed, exclude: onScreen });
    if (next.questions.length > 0 && !sameQuizSet(previousQuestions, next.questions)) {
      return { quiz: { ...next, ...carry }, note: QUIZ_CYCLED_NOTE };
    }
  }
  const again = buildQuiz(input, now);
  return { quiz: { ...again, ...carry }, note: again.questions.length > 0 ? QUIZ_CYCLED_NOTE : undefined };
}

export const heuristicEngine: StudyEngine = {
  id: STUDY_ENGINE_ID,
  summarize,
  buildQuiz,
};

export function getStudyEngine(): StudyEngine {
  return heuristicEngine;
}
