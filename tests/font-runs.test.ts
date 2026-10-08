import assert from 'node:assert/strict';
import test from 'node:test';

import { fontRuns, isEntirelySystem, needsSystemFont } from '../src/theme/font-runs.ts';

test('latin headings stay on Inter', () => {
  assert.deepEqual(fontRuns('The shelf'), [{ text: 'The shelf', system: false }]);
  assert.deepEqual(fontRuns('Debug Mode'), [{ text: 'Debug Mode', system: false }]);
  assert.equal(needsSystemFont('Agents Window'), false);
  assert.equal(isEntirelySystem('The shelf'), false);
});

test('Amharic titles use the system font', () => {
  assert.deepEqual(fontRuns('አክሱም'), [{ text: 'አክሱም', system: true }]);
  assert.equal(needsSystemFont('አክሱም'), true);
  assert.equal(isEntirelySystem('አክሱም'), true);
  assert.deepEqual(fontRuns('አክሱም.'), [{ text: 'አክሱም.', system: true }]);
});

test('mixed titles keep Latin on Inter and Ethiopic on the system font', () => {
  assert.deepEqual(fontRuns('Axum አክሱም'), [
    { text: 'Axum ', system: false },
    { text: 'አክሱም', system: true },
  ]);
  assert.equal(needsSystemFont('Axum አክሱም'), true);
  assert.equal(isEntirelySystem('Axum አክሱም'), false);
});
