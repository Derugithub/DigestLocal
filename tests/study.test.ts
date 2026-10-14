import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildQuiz,
  freshQuizIfDifferent,
  getStudyEngine,
  isQuizWorthySentence,
  MAX_QUIZ_QUESTIONS,
  MIN_QUIZ_QUESTIONS,
  quizSizeForPoints,
  sameQuizSet,
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

  const answers = first.questions.map((question) => question.choices[question.answerIndex] ?? '');
  assert.ok(answers.some((answer) => /418|Inez|Pier Street|Harbor Tool Library/.test(answer)), answers.join(' | '));

  for (const question of first.questions) {
    assert.ok(['why', 'meaning', 'relation', 'takeaway', 'cloze'].includes(question.kind));
    if (question.kind === 'cloze') assert.match(question.prompt, /_____/);
    assert.equal(/which passage appears/i.test(question.prompt), false);
    assert.ok(question.choices.length >= 3 && question.choices.length <= 4);
    assert.equal(new Set(question.choices).size, question.choices.length);
    assert.ok(question.answerIndex >= 0 && question.answerIndex < question.choices.length);
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
  assert.ok(few.questions.length < many.questions.length);
  assert.equal(many.questions.length, MAX_QUIZ_QUESTIONS);
});

const lighthouse = {
  title: 'Lighthouse',
  content: [
    'The Lighthouse of Alexandria was built on the island of Pharos around 280 BC and stood for centuries.',
    'Minutes of Proceedings of the Institution of Civil Engineers. 1868. pp. 12–19.',
    'A typical LED system designed to fit into the existing 3rd order Fresnel lens costs about',
    'For many years, lighthouses still had keepers, partly because lighthouse keepers could serve as a rescue service, if necessary.',
    'Augustin Fresnel developed the multi-part Fresnel lens for use in lighthouses in 1822.',
    'Eddystone Lighthouse was rebuilt by John Smeaton in 1759 using interlocking granite blocks.',
    'The Bell Rock Lighthouse, completed by Robert Stevenson in 1810, is the oldest surviving sea-washed lighthouse.',
    'The last keepers left the North Foreland Lighthouse in 1998 after more than 300 years of staffed service.',
    'Lighthouse keeper’s cottage, pictured in 1905 (left).',
    'Retrieved 12 March 2015.',
  ].join('\n\n'),
};

test('references, captions, and fragments are never quiz material', () => {
  assert.equal(isQuizWorthySentence('Minutes of Proceedings of the Institution of Civil Engineers. 1868. pp. 12–19.'), false);
  assert.equal(isQuizWorthySentence('A typical LED system designed to fit into the existing 3rd order Fresnel lens costs about'), false);
  assert.equal(isQuizWorthySentence('Lighthouse keeper’s cottage, pictured in 1905 (left).'), false);
  assert.equal(isQuizWorthySentence('Retrieved 12 March 2015.'), false);
  assert.equal(isQuizWorthySentence('Eddystone Lighthouse was rebuilt by John Smeaton in 1759 using interlocking granite blocks.'), true);
  const quiz = buildQuiz(lighthouse);
  const text = JSON.stringify(quiz);
  assert.equal(/Proceedings|costs about|pictured|Retrieved/.test(text), false);
});

test('cloze distractors have the same type as the hidden term', () => {
  const quiz = buildQuiz(lighthouse);
  assert.ok(quiz.questions.length >= MIN_QUIZ_QUESTIONS);
  for (const question of quiz.questions.filter((item) => item.kind === 'cloze')) {
    const answer = question.choices[question.answerIndex] ?? '';
    if (/^\d{4}$/.test(answer)) assert.ok(question.choices.every((choice) => /^\d{4}$/.test(choice)), question.choices.join(' / '));
    assert.equal(question.prompt.includes(answer), false);
  }
});

test('the active engine is the local heuristic', () => {
  assert.equal(getStudyEngine().id, STUDY_ENGINE_ID);
});

test('reward sets never repeat earlier questions and run out gracefully', () => {
  const first = buildQuiz(lighthouse);
  assert.equal(sameQuizSet(first.questions, buildQuiz(lighthouse).questions), true);
  const key = (q: { prompt: string; choices: string[]; answerIndex: number }) => `${q.prompt}\n${q.choices[q.answerIndex]}`.toLowerCase();
  const seen = new Set(first.questions.map(key));
  let current = first;
  let produced = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const next = freshQuizIfDifferent(lighthouse, current.questions, undefined, current.asked);
    if (!next) break;
    for (const question of next.questions) {
      assert.equal(seen.has(key(question)), false, question.prompt);
      seen.add(key(question));
    }
    current = next;
    produced += 1;
  }
  assert.ok(produced >= 2);
  assert.equal(freshQuizIfDifferent(lighthouse, current.questions, undefined, current.asked), null);
  assert.equal(freshQuizIfDifferent(input, []), null);
});
