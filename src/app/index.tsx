import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Button, IconButton, LoadingState, Screen } from '@/components/ui';
import { listArticles } from '@/lib/articles';
import { useDatabase } from '@/lib/database';
import type { ArticleListItem } from '@/lib/types';
import { formatSavedDate } from '@/lib/text';
import { useAppTheme } from '@/theme/preferences';
import { Fonts } from '@/theme/palette';

export default function LibraryScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { db, error } = useDatabase();
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');

  const reload = useCallback(async () => {
    if (!db) return;
    const rows = await listArticles(db);
    setArticles(rows);
    setReady(true);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      if (!db) return;
      reload().catch(() => setReady(true));
    }, [db, reload]),
  );

  if (error) {
    return (
      <Screen>
        <View style={styles.empty}>
          <AppText variant="title">The shelf did not open</AppText>
          <AppText variant="ui" color={colors.soft} style={styles.centerText}>
            {error.message}
          </AppText>
        </View>
      </Screen>
    );
  }

  if (!db || !ready) return <LoadingState label="Opening the shelf" />;

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? articles.filter((article) => `${article.title} ${article.site}`.toLowerCase().includes(needle))
    : articles;

  return (
    <Screen padded={false}>
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        style={styles.flex}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.wordmarkRow}>
              <View>
                <AppText variant="label" color={colors.accent}>
                  DigestLocal
                </AppText>
                <AppText variant="display" style={styles.wordmark}>
                  The shelf
                </AppText>
              </View>
              <IconButton icon="settings-outline" label="Settings" onPress={() => router.push('/settings')} />
            </View>
            <View style={[styles.rule, { backgroundColor: colors.accent }]} />
            <AppText variant="ui" color={colors.soft}>
              {articles.length === 0
                ? 'Nothing saved yet. Pages stay on this device.'
                : `${articles.length} saved · offline`}
            </AppText>
            {articles.length > 0 ? (
              <>
                <Button label="Paste a URL" icon="add" onPress={() => router.push('/add')} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search title or site"
                  placeholderTextColor={colors.faint}
                  accessibilityLabel="Search saved articles"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[
                    styles.search,
                    {
                      color: colors.ink,
                      backgroundColor: colors.elevated,
                      borderColor: colors.line,
                    },
                  ]}
                />
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          articles.length === 0 ? (
            <View style={styles.empty}>
              <AppText variant="displayItalic" color={colors.chip} style={styles.watermark}>
                unread
              </AppText>
              <AppText variant="title">The shelf is empty.</AppText>
              <AppText variant="body" color={colors.soft} style={styles.emptyCopy}>
                Paste a public page. DigestLocal downloads it once, keeps the text here, and can read it aloud or quiz you without a network.
              </AppText>
              <Button label="Paste a URL" icon="add" onPress={() => router.push('/add')} />
            </View>
          ) : (
            <AppText variant="ui" color={colors.soft} style={styles.noMatch}>
              Nothing on the shelf matches that.
            </AppText>
          )
        }
        renderItem={({ item, index }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={() => router.push(`/article/${item.id}`)}
            style={({ pressed }) => [styles.row, { borderColor: colors.line, opacity: pressed ? 0.72 : 1 }]}>
            <AppText variant="label" color={colors.accent}>
              {String(index + 1).padStart(2, '0')}
            </AppText>
            <AppText variant="bodySemi" style={styles.rowTitle}>
              {item.title}
            </AppText>
            <AppText variant="meta" color={colors.faint}>
              {item.site} · {formatSavedDate(item.savedAt)} · {readingMinutesFromCount(item.wordCount)} min
              {item.hasSummary ? ' · study ready' : ''}
            </AppText>
          </Pressable>
        )}
      />
    </Screen>
  );
}

function readingMinutesFromCount(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / 220));
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingHorizontal: 22, paddingBottom: 48 },
  header: { paddingTop: 18, gap: 14, marginBottom: 8 },
  wordmarkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  wordmark: { marginTop: 4 },
  rule: { width: 48, height: 3, borderRadius: 2 },
  search: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 14,
    fontFamily: Fonts.ui,
    fontSize: 16,
  },
  row: { paddingVertical: 18, borderBottomWidth: 1, gap: 6 },
  rowTitle: { fontSize: 22, lineHeight: 28 },
  empty: { paddingTop: 36, gap: 16, position: 'relative' },
  watermark: { position: 'absolute', top: 8, right: 0, fontSize: 64, lineHeight: 70 },
  emptyCopy: { maxWidth: 460 },
  centerText: { textAlign: 'center' },
  noMatch: { paddingVertical: 24 },
});
