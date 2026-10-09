import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildQuiz,
  getStudyEngine,
  MAX_QUIZ_QUESTIONS,
  MIN_QUIZ_QUESTIONS,
  quizSizeForPoints,
  STUDY_ENGINE_ID,
  summarize,
} from '../src/lib/study.ts';

const input = {
  title: 'The Saturday Ledger at Harbor Tool Library',
  content: [
    'The Harbor Tool Library opens every Saturday in a converted boathouse on Pier Street.',
    'Volunteers lend calipers, clamps, and coil hoses to neighbors who would rather borrow than buy.',
    'A paper ledger records each loan because the boathouse has no reliable network connection.',
    'Last spring the ledger showed 418 loans, most of them returned within nine days.',
    'The oak counter by the door still carries pencil marks from the first year of lending.',
    'New members learn the rule on their first visit: bring the tool back cleaner than you found it.',
    'A retired machinist named Inez checks the calipers for rust before they go out again.',
    'When the city proposed moving the library into a mall, the Saturday crowd filled the boathouse and asked to stay on the pier.',
  ].join('\n\n'),
};

const short = {
  title: 'Monday hours',
  content: [
    'The workshop closes early on Mondays because the volunteers teach a class.',
    'Visitors sign a card so that the hosts know who borrowed a saw.',
  ].join('\n\n'),
};

const long = {
  title: 'Constraints on the plan',
  content: Array.from({ length: 16 }, (_, index) => {
    const n = index + 1;
    return `Point ${n} changes the plan because reason ${n} is the constraint that shapes this decision for readers.`;
  }).join('\n\n'),
};

test('summary is a shorter extract of the saved sentences', () => {
  const summary = summarize(input);
  assert.ok(summary.length < input.content.length);
  const sentences = summary.split(/(?<=[.!?])\s+/);
  assert.ok(sentences.length >= 2);
  assert.ok(sentences.length <= 4);
  for (const sentence of sentences) {
    assert.ok(input.content.includes(sentence), sentence);
  }
});

test('quiz questions are concept questions, local, and deterministic', () => {
  const now = new Date('2026-10-07T15:00:00.000Z');
  const first = buildQuiz(input, now);
  const second = buildQuiz(input, now);
  assert.equal(first.engine, STUDY_ENGINE_ID);
  assert.deepEqual(first, second);
  assert.ok(first.questions.length >= MIN_QUIZ_QUESTIONS);
  assert.ok(first.questions.length <= MAX_QUIZ_QUESTIONS);

  const answers = first.questions.map((question) => question.choices[question.answerIndex]?.toLowerCase() ?? '');
  assert.ok(
    answers.some((answer) => answer.includes('network') || answer.includes('borrow') || answer.includes('cleaner') || answer.includes('pier')),
    answers.join(' | '),
  );

  for (const question of first.questions) {
    assert.ok(['why', 'meaning', 'relation', 'takeaway'].includes(question.kind));
    assert.equal(/fill in the blank/i.test(question.prompt), false);
    assert.equal(/which passage appears/i.test(question.prompt), false);
    assert.equal(question.choices.length, 4);
    assert.equal(new Set(question.choices).size, 4);
    assert.ok(question.answerIndex >= 0 && question.answerIndex < 4);
    assert.ok(question.explanation.length > 20);
    assert.equal(/uses “/i.test(question.explanation), false);
  }
});

test('quiz length follows how many main points the article has', () => {
  assert.equal(quizSizeForPoints(0), 0);
  assert.equal(quizSizeForPoints(1), 1);
  assert.equal(quizSizeForPoints(2), MIN_QUIZ_QUESTIONS);
  assert.equal(quizSizeForPoints(16), MAX_QUIZ_QUESTIONS);

  const few = buildQuiz(short);
  const many = buildQuiz(long);
  assert.ok(few.questions.length >= 1);
  assert.ok(few.questions.length < many.questions.length);
  assert.equal(many.questions.length, MAX_QUIZ_QUESTIONS);
  assert.ok(few.questions.every((question) => question.kind === 'why' || question.kind === 'meaning' || question.kind === 'relation' || question.kind === 'takeaway'));
});

test('a meaning question asks what an idea shows, not which word was used', () => {
  const quiz = buildQuiz({
    title: 'Debug Mode',
    content: [
      'The context ring next to your prompt input shows how full the window is at a glance.',
      'A larger window lets the model read more of the conversation before it has to forget earlier turns.',
      'Developers watch the ring because a full window means the next prompt may drop important instructions.',
      'When the ring fills, the practical response is to start a fresh thread or shorten the prompt.',
    ].join('\n\n'),
  });
  const meaning = quiz.questions.find((question) => question.prompt.toLowerCase().includes('context ring'));
  assert.ok(meaning);
  assert.equal(meaning.kind, 'meaning');
  assert.equal(/fill in the blank|which passage/i.test(meaning.prompt), false);
  assert.match(meaning.choices[meaning.answerIndex] ?? '', /how full the window is/i);
});

test('the active engine is the local heuristic', () => {
  assert.equal(getStudyEngine().id, STUDY_ENGINE_ID);
});
