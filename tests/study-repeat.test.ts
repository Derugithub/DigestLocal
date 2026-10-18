import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildQuiz,
  freshQuizIfDifferent,
  isNearDuplicate,
  QUIZ_CYCLED_NOTE,
  quizQuestionKey,
  rebuildQuiz,
  rebuildSummary,
  SUMMARY_CYCLED_NOTE,
  SUMMARY_TOO_SHORT_NOTE,
  summarize,
  summarySentenceKey,
} from '../src/lib/study.ts';
import type { Quiz, QuizQuestion } from '../src/lib/types.ts';

const NAMES = ['Amara Osei', 'Bruno Keller', 'Chloe Martin', 'Dawit Bekele', 'Elena Rossi', 'Farid Haddad', 'Grace Liu', 'Hana Sato', 'Ivan Petrov', 'Julia Weber', 'Kofi Mensah', 'Lena Novak'];
const PLACES = ['Ashford', 'Brookvale', 'Carrow', 'Dunmore', 'Elmstead', 'Fairhaven', 'Glenmoor', 'Harwick', 'Ivybridge', 'Kelso', 'Lowther', 'Marston'];

/** A long article where every sentence carries a different year, name, and place. */
const long = {
  title: 'Bridges of the river valley',
  content: NAMES.map(
    (name, index) =>
      `In ${1850 + index * 7}, the engineer ${name} finished a stone bridge near ${PLACES[index]} after many slow winters of work.`,
  ).join('\n\n'),
};

const short = {
  title: 'Monday hours',
  content: [
    'The workshop closes early on Mondays because the volunteers teach a class.',
    'Visitors sign a card so that the hosts know who borrowed a saw.',
  ].join('\n\n'),
};

function sentencesOf(summary: string): string[] {
  return summary.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
}

function keys(questions: QuizQuestion[]): string[] {
  return questions.map((question) => quizQuestionKey(question.prompt, question.choices[question.answerIndex] ?? ''));
}

test('repro: the old rebuild path returned the identical summary and quiz every time', () => {
  // This is what "Rebuild summary and quiz" used to call.
  assert.equal(summarize(long), summarize(long));
  assert.deepEqual(keys(buildQuiz(long).questions), keys(buildQuiz(long).questions));
});

test('rebuildSummary picks different sentences each time, then starts over with a note', () => {
  const first = rebuildSummary(long, null);
  assert.equal(first.summary, summarize(long));
  assert.equal(first.note, undefined);

  let current = first.summary;
  let history = first.shown;
  const seen = new Set(sentencesOf(current).map(summarySentenceKey));
  let cycledAt = -1;
  for (let round = 1; round <= 8; round += 1) {
    const next = rebuildSummary(long, current, history);
    assert.notEqual(next.summary, current, `round ${round} repeated the summary`);
    const nextSentences = sentencesOf(next.summary).map(summarySentenceKey);
    // Never a sentence from the summary on screen, and no duplicate sentence inside one summary.
    for (const sentence of nextSentences) assert.ok(!summarySentenceKey(current).includes(sentence));
    assert.equal(new Set(nextSentences).size, nextSentences.length);
    if (next.note === SUMMARY_CYCLED_NOTE) {
      cycledAt = round;
      break;
    }
    assert.equal(next.note, undefined);
    // Before the cycle, every sentence is new for this article.
    for (const sentence of nextSentences) {
      assert.ok(!seen.has(sentence), `round ${round} reused ${sentence}`);
      seen.add(sentence);
    }
    current = next.summary;
    history = next.shown;
  }
  // 12 sentences, 4 per summary: three unseen summaries, then the cycle note.
  assert.equal(cycledAt, 3);
});

test('rebuildSummary says so when the article is too short to vary', () => {
  const first = rebuildSummary(short, null);
  const again = rebuildSummary(short, first.summary, first.shown);
  assert.equal(again.summary, first.summary);
  assert.equal(again.note, SUMMARY_TOO_SHORT_NOTE);
  assert.equal(rebuildSummary({ title: 'Empty', content: '' }, null).summary, '');
});

test('rebuildQuiz keeps the asked history and never repeats a question until every one was asked', () => {
  const now = new Date('2026-10-18T10:00:00.000Z');
  let quiz: Quiz = { ...buildQuiz(long, now), summaryShown: ['kept'] };
  const asked = new Set(keys(quiz.questions));
  assert.ok(quiz.questions.length >= 2);
  let cycled = false;
  for (let round = 1; round <= 12; round += 1) {
    const next = rebuildQuiz(long, quiz, now);
    const nextKeys = keys(next.quiz.questions);
    assert.ok(nextKeys.length > 0);
    assert.equal(new Set(nextKeys).size, nextKeys.length, 'duplicate question inside one quiz');
    assert.deepEqual(next.quiz.summaryShown, ['kept'], 'summary history is carried over');
    if (next.note === QUIZ_CYCLED_NOTE) {
      cycled = true;
      // Even when starting over, the set on screen does not come straight back.
      assert.notDeepEqual([...nextKeys].sort(), keys(quiz.questions).sort());
      break;
    }
    for (const key of nextKeys) {
      assert.ok(!asked.has(key), `round ${round} repeated a question`);
      asked.add(key);
    }
    // The persisted history covers everything asked so far.
    for (const key of asked) assert.ok(next.quiz.asked?.includes(key));
    quiz = next.quiz;
  }
  assert.ok(cycled, 'the generator should run out and say so');
});

test('fresh reward rounds prefer new sentences over a new blank in an asked sentence', () => {
  const now = new Date('2026-10-18T10:00:00.000Z');
  const first = buildQuiz(long, now);
  const fresh = freshQuizIfDifferent(long, first.questions, now, first.asked);
  assert.ok(fresh);
  for (const question of fresh.questions) {
    for (const old of first.questions) {
      const a = question.prompt.replace(/_{2,}/g, question.choices[question.answerIndex] ?? '');
      const b = old.prompt.replace(/_{2,}/g, old.choices[old.answerIndex] ?? '');
      assert.ok(!isNearDuplicate(a, b), `fresh round asked about the same sentence again: ${question.prompt}`);
    }
  }
});

test('a sentence repeated on the page (pull quote) appears once in the summary and quiz', () => {
  const quote = 'In 1871, the engineer Bruno Keller finished a stone bridge near Brookvale after many slow winters of work.';
  const repeated = {
    title: long.title,
    content: `${long.content}\n\n${quote}\n\n${quote.replace('many slow winters', 'many  slow winters')}`,
  };
  for (const summary of [summarize(repeated), rebuildSummary(repeated, summarize(repeated)).summary]) {
    const parts = sentencesOf(summary);
    for (let i = 0; i < parts.length; i += 1) {
      for (let j = i + 1; j < parts.length; j += 1) assert.ok(!isNearDuplicate(parts[i] ?? '', parts[j] ?? ''));
    }
  }
  const quiz = buildQuiz(repeated);
  const answers = quiz.questions.map((question) => question.choices[question.answerIndex]);
  assert.equal(new Set(answers).size, answers.length);
  assert.ok(isNearDuplicate(quote, `${quote} `));
  assert.ok(!isNearDuplicate('Point 3 changes the plan.', 'Point 4 changes the plan.'));
});
