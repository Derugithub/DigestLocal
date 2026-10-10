import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Button, IconButton, LoadingState, Note, Screen } from '@/components/ui';
import { deleteArticleImages, storeArticleImages } from '@/lib/article-images';
import { findArticleIdByUrl, insertArticle } from '@/lib/articles';
import { useDatabase } from '@/lib/database';
import { extractArticle } from '@/lib/extract';
import { fetchPublicHtml } from '@/lib/fetch-page';
import { currentPaste, subscribePaste, type PasteDraft, type PasteNotice } from '@/lib/paste-draft';
import type { ExtractedArticle } from '@/lib/types';
import { countWords, readingMinutes } from '@/lib/text';
import { normalizeUrl } from '@/lib/url';
import { inputFontFamily } from '@/theme/font-text';
import { useAppTheme } from '@/theme/preferences';
import { Fonts } from '@/theme/palette';

type Phase =
  | { name: 'edit' }
  | { name: 'fetching' }
  | { name: 'preview'; url: string; article: ExtractedArticle; id: string }
  | { name: 'saving'; url: string; article: ExtractedArticle; id: string }
  | { name: 'error'; message: string };

const PASTE_NOTICE: Record<PasteNotice, string> = {
  empty: 'Nothing on the clipboard. Type a link here.',
  invalid: 'No link on the clipboard. Type one here.',
  unavailable: 'The clipboard could not be read. Type a link here.',
  share: 'No link in that share. Type one here.',
};

export default function AddScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { db, error: databaseError } = useDatabase();
  const [seed] = useState(() => currentPaste());
  const appliedPaste = useRef(seed?.id ?? 0);
  const inputRef = useRef<TextInput>(null);
  const [url, setUrl] = useState(seed?.url ?? '');
  const [notice, setNotice] = useState<PasteNotice | null>(seed?.notice ?? null);
  const [phase, setPhase] = useState<Phase>({ name: 'edit' });
  const alive = useRef(true);
  const request = useRef(0);
  const pendingId = useRef<string | null>(null);
  const savedId = useRef<string | null>(null);

  const releasePending = useCallback(() => {
    const id = pendingId.current;
    if (id && savedId.current !== id) {
      deleteArticleImages(id);
      pendingId.current = null;
    }
  }, []);

  const applyPaste = useCallback((staged: PasteDraft) => {
    if (staged.id === appliedPaste.current) return;
    appliedPaste.current = staged.id;
    request.current += 1;
    releasePending();
    setUrl(staged.url);
    setNotice(staged.notice);
    setPhase({ name: 'edit' });
  }, [releasePending]);

  useEffect(() => {
    const staged = currentPaste();
    if (staged) applyPaste(staged);
    return subscribePaste(applyPaste);
  }, [applyPaste]);

  useFocusEffect(
    useCallback(() => {
      const staged = currentPaste();
      if (staged) applyPaste(staged);
    }, [applyPaste]),
  );

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const id = pendingId.current;
      if (id && savedId.current !== id) deleteArticleImages(id);
    };
  }, []);

  const fetching = phase.name === 'fetching' || phase.name === 'saving';

  const submit = async () => {
    if (!db || fetching) return;
    releasePending();
    const token = ++request.current;
    setPhase({ name: 'fetching' });
    try {
      const normalized = normalizeUrl(url);
      const existing = await findArticleIdByUrl(db, normalized);
      if (!alive.current || token !== request.current) return;
      if (existing) {
        router.replace(`/article/${existing}`);
        return;
      }
      const page = await fetchPublicHtml(normalized);
      if (!alive.current || token !== request.current) return;
      const article = extractArticle(page.html, page.finalUrl || page.url);
      const id = createId();
      pendingId.current = id;
      const pageUrl = page.finalUrl || page.url;
      const contentHtml = await storeArticleImages(id, article.contentHtml, pageUrl);
      if (!alive.current || token !== request.current) {
        if (savedId.current !== id) deleteArticleImages(id);
        if (pendingId.current === id) pendingId.current = null;
        return;
      }
      setPhase({ name: 'preview', url: normalized, id, article: { ...article, contentHtml } });
    } catch (error) {
      releasePending();
      if (!alive.current || token !== request.current) return;
      setPhase({
        name: 'error',
        message: error instanceof Error ? error.message : 'Could not save that page.',
      });
    }
  };

  const save = async () => {
    if (!db || phase.name !== 'preview') return;
    const draft = phase;
    setPhase({ name: 'saving', url: draft.url, article: draft.article, id: draft.id });
    try {
      await insertArticle(db, {
        id: draft.id,
        url: draft.url,
        title: draft.article.title,
        site: draft.article.site,
        content: draft.article.content,
        contentHtml: draft.article.contentHtml,
        savedAt: Date.now(),
      });
      savedId.current = draft.id;
      router.replace(`/article/${draft.id}`);
    } catch (error) {
      setPhase({
        name: 'error',
        message: error instanceof Error ? error.message : 'Could not write the article to this device.',
      });
    }
  };

  if (databaseError) {
    return (
      <Screen>
        <AppText variant="title">The shelf did not open</AppText>
        <AppText variant="ui" color={colors.soft}>
          {databaseError.message}
        </AppText>
      </Screen>
    );
  }

  if (!db) return <LoadingState label="Opening the shelf" />;

  return (
    <Screen>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <View style={styles.top}>
            <IconButton icon="chevron-back" label="Back to shelf" onPress={() => router.back()} />
            <AppText variant="label" color={colors.accent}>
              Add
            </AppText>
          </View>
          <AppText variant="title">Save a page</AppText>
          <AppText variant="ui" color={colors.soft}>
            A copied link lands in the field below. If that page is already on the shelf, DigestLocal opens the saved copy and does not use the network.
          </AppText>

          <Note
            active={phase.name === 'fetching'}
            kicker={phase.name === 'fetching' ? 'Network in use' : 'Network'}
            body={
              phase.name === 'fetching'
                ? 'Downloading this page and its article images once. The text and images will stay on this device.'
                : 'DigestLocal contacts the site only when this URL is new. That fetch downloads the page and its article images. Reading, listening, summaries, and quizzes stay on this device.'
            }
          />

          {phase.name === 'preview' || phase.name === 'saving' ? (
            <View style={[styles.preview, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
              <AppText variant="label" color={colors.faint}>
                {phase.article.site}
              </AppText>
              <AppText variant="bodySemi">{phase.article.title}</AppText>
              <AppText variant="meta" color={colors.faint}>
                {countWords(phase.article.content)} words · {readingMinutes(phase.article.content)} min
                {phase.article.truncated ? ' · truncated' : ''}
              </AppText>
              <AppText variant="ui" color={colors.soft}>
                {excerpt(phase.article.content)}
              </AppText>
              <AppText variant="meta" color={colors.soft}>
                Downloaded once, including article images. Keeping this writes the text to SQLite and the images on this device. It does not use the network.
              </AppText>
            </View>
          ) : (
            <View style={styles.field}>
              {notice ? (
                <AppText variant="ui" color={colors.soft} accessibilityLiveRegion="polite">
                  {PASTE_NOTICE[notice]}
                </AppText>
              ) : null}
              <TextInput
                ref={inputRef}
                value={url}
                onChangeText={(value) => {
                  setUrl(value);
                  if (notice) setNotice(null);
                }}
                placeholder="https://"
                placeholderTextColor={colors.faint}
                accessibilityLabel="Article URL"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus={notice !== null}
                keyboardType="url"
                editable={!fetching}
                style={[
                  styles.input,
                  {
                    color: colors.ink,
                    backgroundColor: colors.elevated,
                    borderColor: colors.line,
                    fontFamily: inputFontFamily(url, Fonts.ui),
                  },
                ]}
              />
            </View>
          )}

          {phase.name === 'error' ? (
            <AppText variant="ui" color={colors.bad}>
              {phase.message}
            </AppText>
          ) : null}

          {phase.name === 'preview' || phase.name === 'saving' ? (
            <View style={styles.actions}>
              <Button
                label={phase.name === 'saving' ? 'Saving…' : 'Keep on this device'}
                onPress={() => void save()}
                disabled={phase.name === 'saving'}
              />
              <Button
                label="Discard"
                variant="secondary"
                onPress={() => {
                  releasePending();
                  setPhase({ name: 'edit' });
                }}
                disabled={phase.name === 'saving'}
              />
            </View>
          ) : (
            <Button
              label={phase.name === 'fetching' ? 'Downloading…' : 'Fetch page'}
              onPress={() => void submit()}
              disabled={!db || fetching || url.trim().length === 0}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function excerpt(content: string): string {
  const text = content.replace(/\s+/g, ' ').trim();
  return text.length > 320 ? `${text.slice(0, 320).trim()}…` : text;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: 12, paddingBottom: 40, gap: 16 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  field: { gap: 16 },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    fontFamily: Fonts.ui,
    fontSize: 16,
  },
  preview: { borderWidth: 1, borderRadius: 22, padding: 16, gap: 8 },
  actions: { gap: 10 },
});
