import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArticleBody } from '@/components/article-body';
import { ListenPanel } from '@/components/listen-panel';
import { StudyPanel } from '@/components/study-panel';
import { AppText, Button, IconButton, LoadingState, Screen, Segmented } from '@/components/ui';
import { deleteArticleImages } from '@/lib/article-images';
import { deleteArticle, getArticle } from '@/lib/articles';
import { useDatabase } from '@/lib/database';
import type { Article } from '@/lib/types';
import { formatSavedDate, readingMinutes } from '@/lib/text';
import { useAppTheme } from '@/theme/preferences';

type Mode = 'read' | 'listen' | 'study';

const MODES: { value: Mode; label: string }[] = [
  { value: 'read', label: 'Read' },
  { value: 'listen', label: 'Listen' },
  { value: 'study', label: 'Study' },
];

export default function ArticleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { db, error } = useDatabase();
  const { colors } = useAppTheme();
  const [article, setArticle] = useState<Article | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>('read');
  const [progress, setProgress] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!db || !id) return;
    let cancelled = false;
    getArticle(db, id)
      .then((row) => {
        if (!cancelled) setArticle(row);
      })
      .catch(() => {
        if (!cancelled) setArticle(null);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [db, id]);

  const remove = async () => {
    if (!db || !article) return;
    await deleteArticle(db, article.id);
    deleteArticleImages(article.id);
    router.replace('/');
  };

  if (error) {
    return (
      <Screen>
        <AppText variant="title">Could not open the library</AppText>
        <AppText variant="ui" color={colors.soft}>
          {error.message}
        </AppText>
      </Screen>
    );
  }

  if (!db || !ready) return <LoadingState label="Opening the article" />;

  if (!article) {
    return (
      <Screen>
        <View style={styles.missing}>
          <AppText variant="title">That page is not on the shelf.</AppText>
          <Button label="Back to the shelf" onPress={() => router.replace('/')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View style={[styles.progressTrack, { backgroundColor: colors.line }]}>
        {mode === 'read' ? (
          <View style={[styles.progress, { backgroundColor: colors.accent, width: `${Math.round(progress * 100)}%` }]} />
        ) : null}
      </View>
      <View style={styles.toolbar}>
        <IconButton icon="chevron-back" label="Back to shelf" onPress={() => router.back()} />
        <AppText variant="label" color={colors.faint} numberOfLines={1} style={styles.site}>
          {article.site}
        </AppText>
      </View>

      {mode === 'read' ? (
        <ScrollView
          style={styles.panel}
          contentContainerStyle={[styles.reader, { paddingBottom: insets.bottom + 120 }]}
          scrollEventThrottle={16}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            const max = contentSize.height - layoutMeasurement.height;
            setProgress(max > 0 ? Math.min(1, Math.max(0, contentOffset.y / max)) : 0);
          }}>
          <AppText variant="label" color={colors.accent}>
            On this device
          </AppText>
          <AppText variant="title" style={styles.title}>
            {article.title}
          </AppText>
          <AppText variant="meta" color={colors.faint}>
            {formatSavedDate(article.savedAt)} · {readingMinutes(article.content)} min read
          </AppText>
          <View style={[styles.rule, { backgroundColor: colors.line }]} />
          <ArticleBody html={article.contentHtml} plain={article.content} baseUrl={article.url} articleId={article.id} />
          {confirmingDelete ? (
            <View style={styles.deleteRow}>
              <Button label="Confirm remove" variant="danger" onPress={() => void remove()} />
              <Button label="Keep it" variant="secondary" onPress={() => setConfirmingDelete(false)} />
            </View>
          ) : (
            <Button label="Remove from shelf" variant="ghost" onPress={() => setConfirmingDelete(true)} />
          )}
        </ScrollView>
      ) : null}

      {mode === 'listen' ? (
        <View style={[styles.panel, { paddingBottom: insets.bottom + 88 }]}>
          <ListenPanel content={article.content} />
        </View>
      ) : null}

      {mode === 'study' ? (
        <View style={[styles.panel, { paddingBottom: insets.bottom + 88 }]}>
          <StudyPanel
            key={article.quiz?.generatedAt ?? 'none'}
            article={article}
            onChange={setArticle}
          />
        </View>
      ) : null}

      <View style={[styles.modeBar, { backgroundColor: colors.bg, borderColor: colors.line, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Segmented value={mode} options={MODES} onChange={setMode} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  progressTrack: { height: 3, width: '100%' },
  progress: { height: 3 },
  toolbar: {
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  site: { flex: 1 },
  reader: { paddingHorizontal: 22, paddingTop: 8, gap: 16 },
  title: { fontSize: 34, lineHeight: 40 },
  rule: { height: 1, marginVertical: 4 },
  deleteRow: { gap: 10, marginTop: 8 },
  panel: { flex: 1 },
  modeBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  missing: { flex: 1, justifyContent: 'center', gap: 16 },
});
