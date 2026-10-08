import assert from 'node:assert/strict';
import test from 'node:test';

import { readClipboardText } from '../src/lib/read-clipboard.ts';

test('does not import the clipboard package when the native module is missing', async () => {
  let loaded = false;
  const text = await readClipboardText({
    nativeModule: null,
    readText: async () => {
      loaded = true;
      return 'https://example.com';
    },
  });
  assert.equal(text, null);
  assert.equal(loaded, false);
});

test('returns clipboard text when the native module is present', async () => {
  const text = await readClipboardText({
    nativeModule: { name: 'ExpoClipboard' },
    readText: async () => '  https://example.com/story  ',
  });
  assert.equal(text, '  https://example.com/story  ');
});

test('treats a failed clipboard read as unavailable', async () => {
  const text = await readClipboardText({
    nativeModule: { name: 'ExpoClipboard' },
    readText: async () => {
      throw new Error("Cannot find native module 'ExpoClipboard'");
    },
  });
  assert.equal(text, null);
});
