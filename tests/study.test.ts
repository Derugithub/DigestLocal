import assert from 'node:assert/strict';
import test from 'node:test';

import { buildQuiz, getStudyEngine, STUDY_ENGINE_ID, summarize } from '../src/lib/study.ts';

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

test('quiz questions are local, deterministic, and grounded in the text', () => {
  const now = new Date('2026-10-07T15:00:00.000Z');
  const first = buildQuiz(input, now);
  const second = buildQuiz(input, now);
  assert.equal(first.engine, STUDY_ENGINE_ID);
  assert.deepEqual(first, second);
  assert.ok(first.questions.length >= 2);

  for (const question of first.questions) {
    assert.equal(question.choices.length, 4);
    assert.equal(new Set(question.choices).size, 4);
    assert.ok(question.answerIndex >= 0 && question.answerIndex < 4);
    const answer = question.choices[question.answerIndex];
    assert.ok(answer);
    if (question.kind === 'cloze') {
      assert.match(question.prompt, /______/);
      assert.ok(input.content.includes(answer));
    } else {
      assert.ok(input.content.includes(answer));
      for (const choice of question.choices) {
        if (choice !== answer) assert.equal(input.content.includes(choice), false);
      }
    }
  }
});

test('the active engine is the local heuristic', () => {
  assert.equal(getStudyEngine().id, STUDY_ENGINE_ID);
});
