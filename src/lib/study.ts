import type { Quiz, QuizQuestion, StudyInput } from '@/lib/types';
import { escapeRegExp } from '@/lib/text';

/**
 * On-device study engine.
 *
 * `heuristic-v1` scores sentences locally and writes an extractive summary
 * plus a multiple-choice quiz. Replace `getStudyEngine()` with another
 * `StudyEngine` to plug in a real on-device model. Callers persist the
 * returned summary string and quiz JSON with the article.
 */
export const STUDY_ENGINE_ID = 'heuristic-v1';

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

type ScoredSentence = {
  index: number;
  text: string;
  score: number;
};

function splitSentences(content: string): string[] {
  return content
    .split(/\n+/)
    .flatMap((chunk) => chunk.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z“"'])/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 40);
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
    const lengthAdjust = text.length < 55 || text.length > 320 ? -0.5 : 0.35;
    return { index, text, score: freqScore + position + titleOverlap + lengthAdjust };
  });
}

function wordFrequencies(content: string): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const token of contentTokens(content)) {
    frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }
  return frequency;
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

function matchCase(sample: string, word: string): string {
  if (sample === sample.toUpperCase()) return word.toUpperCase();
  if (sample[0] === sample[0]?.toUpperCase()) {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }
  return word.toLowerCase();
}

function clip(sentence: string, max = 200): string {
  if (sentence.length <= max) return sentence;
  const slice = sentence.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 80 ? slice.slice(0, lastSpace) : slice).trim();
}

function makeCloze(
  sentence: ScoredSentence,
  vocabulary: string[],
  frequency: Map<string, number>,
  random: () => number,
  index: number,
): QuizQuestion | null {
  const matches = sentence.text.match(/[A-Za-z][A-Za-z'-]{4,}/g) ?? [];
  const ranked = matches
    .map((word) => ({ word, key: word.toLowerCase() }))
    .filter((item) => !STOPWORDS.has(item.key) && (frequency.get(item.key) ?? 0) > 0 && (frequency.get(item.key) ?? 0) <= 8)
    .sort((a, b) => (frequency.get(a.key) ?? 0) - (frequency.get(b.key) ?? 0) || b.word.length - a.word.length);
  const pick = ranked[0];
  if (!pick) return null;

  const blanked = sentence.text.replace(new RegExp(`\\b${escapeRegExp(pick.word)}\\b`), '______');
  if (blanked === sentence.text) return null;

  const sentenceTokens = new Set(contentTokens(sentence.text));
  const distractorPool = vocabulary.filter((word) => word !== pick.key && !sentenceTokens.has(word));
  if (distractorPool.length < 3) return null;

  const window = distractorPool.slice(0, Math.min(12, distractorPool.length));
  const chosen = shuffle(window, random).slice(0, 3).map((word) => matchCase(pick.word, word));
  if (new Set(chosen).size < 3) return null;

  const answer = pick.word;
  const choices = shuffle([answer, ...chosen], random);
  return {
    id: `q${index + 1}`,
    kind: 'cloze',
    prompt: `Fill in the blank: ${blanked}`,
    choices,
    answerIndex: choices.indexOf(answer),
    explanation: `The saved article uses “${answer}” in that sentence.`,
  };
}

function mutateSentence(sentence: string, replacement: string, random: () => number): string | null {
  const matches = [...sentence.matchAll(/[A-Za-z][A-Za-z'-]{4,}/g)];
  const eligible = matches.filter((match) => {
    const word = match[0];
    const at = match.index ?? 0;
    return at < 150 && !STOPWORDS.has(word.toLowerCase()) && word.toLowerCase() !== replacement.toLowerCase();
  });
  if (eligible.length === 0) return null;
  const chosen = eligible[Math.floor(random() * eligible.length)];
  if (!chosen) return null;
  const start = chosen.index ?? 0;
  const original = chosen[0];
  return sentence.slice(0, start) + matchCase(original, replacement) + sentence.slice(start + original.length);
}

function makeAttribution(
  sentence: ScoredSentence,
  others: ScoredSentence[],
  content: string,
  vocabulary: string[],
  random: () => number,
  index: number,
): QuizQuestion | null {
  const correct = clip(sentence.text);
  const sources = others.filter((item) => item.index !== sentence.index);
  const pool = sources.length > 0 ? sources : [sentence];
  const replacements = vocabulary.filter((word) => word.length >= 5);
  if (replacements.length === 0) return null;

  const distractors: string[] = [];
  let attempts = 0;
  while (distractors.length < 3 && attempts < 40) {
    attempts += 1;
    const source = pool[Math.floor(random() * pool.length)];
    const replacement = replacements[Math.floor(random() * replacements.length)];
    if (!source || !replacement) break;
    const mutated = mutateSentence(source.text, replacement, random);
    if (!mutated) continue;
    const clipped = clip(mutated);
    if (!clipped || clipped === correct || content.includes(clipped) || distractors.includes(clipped)) continue;
    distractors.push(clipped);
  }
  if (distractors.length < 3) return null;

  const choices = shuffle([correct, ...distractors], random);
  return {
    id: `q${index + 1}`,
    kind: 'attribution',
    prompt: 'Which passage appears in the saved article?',
    choices,
    answerIndex: choices.indexOf(correct),
    explanation: `The saved text includes: “${sentence.text}”`,
  };
}

export function summarize(input: StudyInput): string {
  const sentences = splitSentences(input.content);
  if (sentences.length === 0) return input.content.trim();
  if (sentences.length <= 2) return sentences.join(' ');

  const ranked = scoreSentences(sentences, input.title)
    .slice()
    .sort((a, b) => b.score - a.score);
  const count = Math.min(4, Math.max(2, Math.round(sentences.length * 0.3)));
  return ranked
    .slice(0, count)
    .sort((a, b) => a.index - b.index)
    .map((sentence) => sentence.text)
    .join(' ');
}

export function buildQuiz(input: StudyInput, now = new Date()): Quiz {
  const sentences = splitSentences(input.content);
  const ranked = scoreSentences(sentences, input.title)
    .filter((sentence) => sentence.score > 0)
    .sort((a, b) => b.score - a.score);
  const frequency = wordFrequencies(input.content);
  const vocabulary = [...frequency.entries()]
    .filter(([word]) => word.length >= 5 && !STOPWORDS.has(word))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word);
  const random = mulberry32(hashString(`${input.title}\n${input.content}`));
  const questions: QuizQuestion[] = [];
  const used = new Set<number>();

  for (const sentence of ranked) {
    if (questions.length >= 4) break;
    if (used.has(sentence.index)) continue;
    const preferCloze = questions.length % 2 === 0;
    const question = preferCloze
      ? makeCloze(sentence, vocabulary, frequency, random, questions.length)
      : makeAttribution(sentence, ranked, input.content, vocabulary, random, questions.length);
    const fallback = question
      ? question
      : preferCloze
        ? makeAttribution(sentence, ranked, input.content, vocabulary, random, questions.length)
        : makeCloze(sentence, vocabulary, frequency, random, questions.length);
    if (!fallback) continue;
    questions.push({ ...fallback, id: `q${questions.length + 1}` });
    used.add(sentence.index);
  }

  return {
    engine: STUDY_ENGINE_ID,
    generatedAt: now.toISOString(),
    questions,
    note: questions.length === 0 ? 'Not enough article text to build a quiz.' : undefined,
  };
}

export const heuristicEngine: StudyEngine = {
  id: STUDY_ENGINE_ID,
  summarize,
  buildQuiz,
};

export function getStudyEngine(): StudyEngine {
  return heuristicEngine;
}
