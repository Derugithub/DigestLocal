import type { Quiz, QuizKind, QuizQuestion, StudyInput } from '@/lib/types';

/**
 * On-device study engine.
 *
 * `heuristic-v2` scores sentences locally and writes an extractive summary
 * plus concept questions: why something matters, what an idea means, how
 * ideas relate, and which statements are main points. It does not call a
 * language model, so it can only ask about claims the saved text actually
 * makes. Replace `getStudyEngine()` with another `StudyEngine` to plug in
 * an on-device model. Callers persist the returned summary string and quiz
 * JSON with the article.
 */
export const STUDY_ENGINE_ID = 'heuristic-v2';
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

function clip(sentence: string, max = 180): string {
  if (sentence.length <= max) return sentence;
  const slice = sentence.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 60 ? slice.slice(0, lastSpace) : slice).trim();
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
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function sameIdea(a: string, b: string): boolean {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  return left === right || left.includes(right) || right.includes(left);
}

type DraftQuestion = {
  sentenceIndex: number;
  kind: QuizKind;
  prompt: string;
  answer: string;
  explanation: string;
};

const MEANING_VERBS: Record<string, string> = {
  shows: 'show',
  show: 'show',
  means: 'mean',
  mean: 'mean',
  indicates: 'indicate',
  indicate: 'indicate',
  measures: 'measure',
  measure: 'measure',
  describes: 'describe',
  describe: 'describe',
  represents: 'represent',
  represent: 'represent',
  explains: 'explain',
  explain: 'explain',
  tracks: 'track',
  track: 'track',
  lets: 'let',
  let: 'let',
  allows: 'allow',
  allow: 'allow',
  helps: 'help',
  help: 'help',
};

function fromBecause(sentence: ScoredSentence): DraftQuestion | null {
  const match = sentence.text.match(/^(.+?)\s+because\s+(.+)$/i);
  if (!match) return null;
  const effect = tidy(match[1] ?? '');
  const cause = asAnswer(match[2] ?? '');
  if (effect.length < 12 || cause.length < 12) return null;
  return {
    sentenceIndex: sentence.index,
    kind: 'why',
    prompt: `Why does the article say that ${lowerFirst(effect)}?`,
    answer: cause,
    explanation: 'That is the reason the article gives. The other choices are different points from the text.',
  };
}

function fromPurpose(sentence: ScoredSentence): DraftQuestion | null {
  const match = sentence.text.match(/^(.+?)\s+(?:in order to|so that)\s+(.+)$/i);
  if (!match) return null;
  const action = tidy(match[1] ?? '');
  const purpose = asAnswer(match[2] ?? '');
  if (action.length < 12 || purpose.length < 8) return null;
  return {
    sentenceIndex: sentence.index,
    kind: 'why',
    prompt: `What is the purpose of this: ${lowerFirst(action)}?`,
    answer: purpose,
    explanation: 'The article is explaining why that idea matters, not asking you to recall one word.',
  };
}

function fromMeaning(sentence: ScoredSentence): DraftQuestion | null {
  const verbs = Object.keys(MEANING_VERBS).sort((a, b) => b.length - a.length).join('|');
  const match = sentence.text.match(new RegExp(`^(.{8,90}?)\\s+(${verbs})\\s+(.{12,})$`, 'i'));
  if (!match) return null;
  const subject = tidy(match[1] ?? '');
  const verb = (match[2] ?? '').toLowerCase();
  const object = asAnswer(match[3] ?? '');
  const base = MEANING_VERBS[verb];
  if (!base || subject.length < 8 || object.length < 12) return null;
  return {
    sentenceIndex: sentence.index,
    kind: 'meaning',
    prompt: `What does ${lowerFirst(subject)} ${base}?`,
    answer: object,
    explanation: 'That is what the article says the idea means. The other choices describe different ideas.',
  };
}

function fromWhen(sentence: ScoredSentence): DraftQuestion | null {
  const match = sentence.text.match(/^When\s+(.+?),\s+(.+)$/i);
  if (!match) return null;
  const situation = tidy(match[1] ?? '');
  const response = asAnswer(match[2] ?? '');
  if (situation.length < 12 || response.length < 12) return null;
  return {
    sentenceIndex: sentence.index,
    kind: 'relation',
    prompt: `What does the article say follows from this: ${lowerFirst(situation)}?`,
    answer: response,
    explanation: 'The article connects that situation to this outcome. The other choices belong to different parts of the piece.',
  };
}

function fromRather(sentence: ScoredSentence): DraftQuestion | null {
  const match = sentence.text.match(/would rather\s+(.{3,80}?)\s+than\s+(.{3,80})/i);
  if (!match) return null;
  const preferred = tidy(match[1] ?? '');
  const avoided = tidy(match[2] ?? '');
  if (preferred.length < 3 || avoided.length < 3) return null;
  const answer = preferred.split(/\s+/).length < 3
    ? `${asAnswer(preferred)} rather than ${lowerFirst(avoided)}`
    : asAnswer(preferred);
  return {
    sentenceIndex: sentence.index,
    kind: 'relation',
    prompt: 'What preference does the article describe?',
    answer,
    explanation: 'The article sets up that comparison. The other choices are different ideas, not this preference.',
  };
}

function fromColon(sentence: ScoredSentence): DraftQuestion | null {
  const match = sentence.text.match(/^(.{12,100}?):\s+(.{12,})$/);
  if (!match) return null;
  const setup = tidy(match[1] ?? '');
  const point = asAnswer(match[2] ?? '');
  if (setup.length < 12 || point.length < 12) return null;
  return {
    sentenceIndex: sentence.index,
    kind: 'meaning',
    prompt: `What does the article mean by this: ${lowerFirst(setup)}?`,
    answer: point,
    explanation: 'That is the idea being spelled out. The other choices come from elsewhere in the article.',
  };
}

const TAKEAWAY_PROMPTS = [
  'Which of these is a main point of the article?',
  'Which idea should a reader remember from this article?',
  'Which statement is a key takeaway, rather than a minor detail?',
  'What is one of the central ideas in the article?',
];

function fromTakeaway(sentence: ScoredSentence, promptIndex: number): DraftQuestion | null {
  const answer = asAnswer(clip(sentence.text));
  if (answer.length < 24) return null;
  return {
    sentenceIndex: sentence.index,
    kind: 'takeaway',
    prompt: TAKEAWAY_PROMPTS[promptIndex % TAKEAWAY_PROMPTS.length] ?? TAKEAWAY_PROMPTS[0],
    answer,
    explanation: 'This is one of the article’s central ideas. The other choices are separate details from the same text.',
  };
}

function conceptDrafts(ranked: ScoredSentence[]): DraftQuestion[] {
  const drafts: DraftQuestion[] = [];
  const seenAnswers = new Set<string>();
  const seenPrompts = new Set<string>();
  const builders = [fromBecause, fromPurpose, fromMeaning, fromWhen, fromRather, fromColon];
  for (const sentence of ranked) {
    for (const build of builders) {
      const draft = build(sentence);
      if (!draft) continue;
      const answerKey = draft.answer.toLowerCase();
      const promptKey = draft.prompt.toLowerCase();
      if (seenAnswers.has(answerKey) || seenPrompts.has(promptKey)) continue;
      if (sameIdea(draft.prompt, draft.answer)) continue;
      drafts.push(draft);
      seenAnswers.add(answerKey);
      seenPrompts.add(promptKey);
      break;
    }
  }
  return drafts;
}

export function quizSizeForPoints(pointCount: number): number {
  if (pointCount <= 0) return 0;
  if (pointCount === 1) return 1;
  return Math.min(MAX_QUIZ_QUESTIONS, Math.max(MIN_QUIZ_QUESTIONS, Math.ceil(pointCount / 2)));
}

function claimPool(sentences: ScoredSentence[], exceptIndex: number): string[] {
  const claims: string[] = [];
  for (const sentence of sentences) {
    if (sentence.index === exceptIndex) continue;
    claims.push(sentence.text);
    for (const part of sentence.text.split(/\s+(?:because|in order to|so that)\s+|:\s+/i)) {
      claims.push(part);
    }
    const when = sentence.text.match(/^When\s+(.+?),\s+(.+)$/i);
    if (when?.[1] && when[2]) {
      claims.push(when[1], when[2]);
    }
  }
  return claims.map((claim) => asAnswer(clip(claim))).filter((claim) => claim.length >= 12);
}

function pickDistractors(answer: string, pool: string[], random: () => number): string[] {
  const chosen: string[] = [];
  for (const candidate of shuffle(pool, random)) {
    if (chosen.length >= 3) break;
    if (sameIdea(candidate, answer) || chosen.some((item) => sameIdea(item, candidate))) continue;
    const ratio = candidate.length / Math.max(answer.length, 1);
    if (ratio < 0.35 || ratio > 3) continue;
    chosen.push(candidate);
  }
  return chosen;
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
  const random = mulberry32(hashString(`${input.title}\n${input.content}`));
  const target = quizSizeForPoints(ranked.length);
  const selected: DraftQuestion[] = [];
  const used = new Set<number>();
  const seenPrompts = new Set<string>();

  for (const draft of conceptDrafts(ranked)) {
    if (selected.length >= target) break;
    if (used.has(draft.sentenceIndex) || seenPrompts.has(draft.prompt.toLowerCase())) continue;
    selected.push(draft);
    used.add(draft.sentenceIndex);
    seenPrompts.add(draft.prompt.toLowerCase());
  }

  let takeawayIndex = 0;
  for (const sentence of ranked) {
    if (selected.length >= target) break;
    if (used.has(sentence.index)) continue;
    const draft = fromTakeaway(sentence, takeawayIndex);
    takeawayIndex += 1;
    if (!draft || seenPrompts.has(draft.prompt.toLowerCase())) continue;
    selected.push(draft);
    used.add(sentence.index);
    seenPrompts.add(draft.prompt.toLowerCase());
  }

  const questions: QuizQuestion[] = [];
  for (const draft of selected.sort((a, b) => a.sentenceIndex - b.sentenceIndex)) {
    const pool = [
      ...selected.filter((item) => item !== draft).map((item) => item.answer),
      ...claimPool(ranked, draft.sentenceIndex),
    ];
    const distractors = pickDistractors(draft.answer, pool, random);
    const want = ranked.length >= 4 ? 3 : 2;
    if (distractors.length < want) continue;
    const picked = distractors.slice(0, want);
    const choices = shuffle([draft.answer, ...picked], random);
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
