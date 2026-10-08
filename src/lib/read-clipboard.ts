/**
 * Reads clipboard text only after the caller has confirmed the native module exists.
 * Importing `expo-clipboard` evaluates `requireNativeModule('ExpoClipboard')`.
 * On a development build that does not include that module, the evaluation throws
 * and React Native logs a red error even when the import promise is caught.
 * Callers must pass `null` in that case and must not call `readText`.
 */
export async function readClipboardText(input: {
  nativeModule: unknown;
  readText: () => Promise<string>;
}): Promise<string | null> {
  if (input.nativeModule == null) return null;
  try {
    return await input.readText();
  } catch {
    return null;
  }
}
