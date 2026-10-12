import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { useAds } from '@/lib/ads/ads-context';
import { useEntitlement } from '@/lib/entitlement';
import { saveStudy } from '@/lib/articles';
import { getStudyEngine } from '@/lib/study';
import type { Article, QuizQuestion } from '@/lib/types';
import { formatSavedDate } from '@/lib/text';
import { useDatabase } from '@/lib/database';
import { useAppTheme } from '@/theme/preferences';
import { Fonts } from '@/theme/palette';

export function StudyPanel({
  article,
  onChange,
}: {
  article: Article;
  onChange: (article: Article) => void;
}) {
  const { colors } = useAppTheme();
  const { db } = useDatabase();
  const { isPro } = useEntitlement();
  const ads = useAds();
  const { suppress, release, preloadRewarded, showRewarded } = ads;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);

  const questions = article.quiz?.questions ?? [];
  const unlocked = isPro || ads.quizUnlocked(article.id) || Platform.OS === 'web';
  const capApplies = !unlocked && ads.sessionCount >= ads.config.minSessionForAds;
  const activeQuestions = capApplies ? questions.slice(0, ads.config.quizFreeQuestionCap) : questions;
  const lockedCount = Math.max(0, questions.length - activeQuestions.length);
  const question = activeQuestions[cursor];
  const inQuiz = !finished && (picked !== null || cursor > 0);
  const showUnlock = lockedCount > 0 && !inQuiz;

  useEffect(() => {
    const inProgress = !finished && (picked !== null || cursor > 0);
    if (inProgress) suppress('quiz');
    else release('quiz');
  }, [cursor, finished, picked, release, suppress]);

  useEffect(() => {
    return () => release('quiz');
  }, [release]);

  useEffect(() => {
    if (showUnlock && ads.ready && ads.canRequestAds) preloadRewarded();
  }, [ads.canRequestAds, ads.ready, preloadRewarded, showUnlock]);

  const resetQuiz = () => {
    setCursor(0);
    setPicked(null);
    setCorrectCount(0);
    setFinished(false);
  };

  const generate = async () => {
    if (!db || busy) return;
    setBusy(true);
    setError(null);
    try {
      const engine = getStudyEngine();
      const summary = engine.summarize({ title: article.title, content: article.content });
      const quiz = engine.buildQuiz({ title: article.title, content: article.content });
      await saveStudy(db, article.id, summary, quiz);
      onChange({ ...article, summary, quiz });
      resetQuiz();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not build the summary.');
    } finally {
      setBusy(false);
    }
  };

  const choose = (index: number) => {
    if (!question || picked !== null) return;
    setPicked(index);
    if (index === question.answerIndex) setCorrectCount((count) => count + 1);
  };

  const unlockLabel = ads.canOfferRewarded('quiz_unlock')
    ? ads.rewardedLoaded
      ? `Watch an ad for ${lockedCount} more questions`
      : 'Ad not ready'
    : 'Not available right now';

  const unlockOffer = showUnlock ? (
    <View style={styles.reward}>
      <Button
        label={unlockLabel}
        onPress={() => {
          if (!ads.canOfferRewarded('quiz_unlock') || !ads.rewardedLoaded) {
            preloadRewarded();
            return;
          }
          void showRewarded('quiz_unlock', { articleId: article.id }).then((result) => {
            if (result === 'earned') resetQuiz();
          });
        }}
        disabled={!ads.canOfferRewarded('quiz_unlock') || !ads.rewardedLoaded}
      />
      <AppText variant="meta" color={colors.faint}>
        Optional
      </AppText>
    </View>
  ) : null;

  const next = () => {
    if (cursor + 1 >= activeQuestions.length) {
      setFinished(true);
      return;
    }
    setCursor((value) => value + 1);
    setPicked(null);
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <AppText variant="label" color={colors.accent}>
        On this device
      </AppText>
      <AppText variant="title" style={styles.heading}>
        Summary and quiz
      </AppText>
      <AppText variant="ui" color={colors.soft}>
        Built from the saved text with {article.quiz?.engine ?? getStudyEngine().id}. The summary and quiz are created on this device and are not uploaded.
      </AppText>

      {article.summary ? (
        <View style={[styles.card, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
          <AppText variant="label" color={colors.faint}>
            Summary
          </AppText>
          <AppText style={[styles.summary, { color: colors.ink }]}>{article.summary}</AppText>
          {article.quiz ? (
            <AppText variant="meta" color={colors.faint}>
              Saved with the article · {formatSavedDate(Date.parse(article.quiz.generatedAt))}
            </AppText>
          ) : null}
        </View>
      ) : (
        <AppText variant="ui" color={colors.soft}>
          No summary is stored yet. Generating one also writes a quiz into this article.
        </AppText>
      )}

      {error ? (
        <AppText variant="ui" color={colors.bad}>
          {error}
        </AppText>
      ) : null}

      <Button
        label={busy ? 'Working on this device…' : article.summary ? 'Rebuild summary and quiz' : 'Create summary and quiz'}
        onPress={() => void generate()}
        disabled={busy || !db}
        icon="sparkles-outline"
      />

      {article.summary && questions.length === 0 ? (
        <AppText variant="ui" color={colors.soft}>
          {article.quiz?.note ?? 'This page does not have enough text for quiz questions.'}
        </AppText>
      ) : null}

      {questions.length > 0 && finished ? (
        <View style={[styles.card, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
          <AppText variant="label" color={colors.faint}>
            Score
          </AppText>
          <AppText variant="title">
            {correctCount} of {activeQuestions.length}
          </AppText>
          {unlockOffer}
          <Button label="Try the quiz again" variant="secondary" onPress={resetQuiz} />
        </View>
      ) : null}

      {question && !finished ? (
        <View style={styles.quiz}>
          {cursor === 0 && picked === null ? unlockOffer : null}
          <AppText variant="label" color={colors.faint}>
            Question {cursor + 1} of {activeQuestions.length}
          </AppText>
          <AppText variant="bodySemi" style={styles.prompt}>
            {question.prompt}
          </AppText>
          {question.choices.map((choice, index) => (
            <Choice
              key={`${question.id}-${choice}`}
              choice={choice}
              index={index}
              question={question}
              picked={picked}
              onPress={() => choose(index)}
            />
          ))}
          {picked !== null ? (
            <>
              <AppText variant="ui" color={colors.soft}>
                {question.explanation}
              </AppText>
              <Button label={cursor + 1 === activeQuestions.length ? 'See score' : 'Next question'} onPress={next} />
            </>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function Choice({
  choice,
  index,
  question,
  picked,
  onPress,
}: {
  choice: string;
  index: number;
  question: QuizQuestion;
  picked: number | null;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  const checked = picked !== null;
  const isAnswer = index === question.answerIndex;
  const isPicked = index === picked;
  const background = !checked
    ? colors.elevated
    : isAnswer
      ? colors.goodSoft
      : isPicked
        ? colors.badSoft
        : colors.elevated;
  const border = !checked ? colors.line : isAnswer ? colors.good : isPicked ? colors.bad : colors.line;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={choice}
      disabled={checked}
      onPress={onPress}
      style={[styles.choice, { backgroundColor: background, borderColor: border }]}>
      <AppText variant="ui" color={colors.ink}>
        {choice}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 36, gap: 16 },
  heading: { marginTop: -6 },
  card: { borderWidth: 1, borderRadius: 22, padding: 18, gap: 12 },
  summary: { fontFamily: Fonts.body, fontSize: 17, lineHeight: 26 },
  quiz: { gap: 12 },
  reward: { gap: 8 },
  prompt: { fontSize: 22, lineHeight: 30 },
  choice: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 14 },
});
