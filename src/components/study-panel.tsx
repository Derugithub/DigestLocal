import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { useAds } from '@/lib/ads/ads-context';
import { useEntitlement } from '@/lib/entitlement';
import { saveStudy } from '@/lib/articles';
import { planQuizOffer, visibleQuizCount } from '@/lib/quiz-reward';
import { maybeRequestReviewAfterQuiz, noteFullscreenAd } from '@/lib/review-prompt';
import { freshQuizIfDifferent, getStudyEngine, rebuildQuiz, rebuildSummary } from '@/lib/study';
import type { Article, Quiz, QuizQuestion } from '@/lib/types';
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
  const { isPro, proEnabled } = useEntitlement();
  const ads = useAds();
  const { suppress, release, preloadRewarded, showRewarded, recordQuizOfferShown, resetQuizExtra } = ads;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);
  const [declinedOffer, setDeclinedOffer] = useState(false);
  const countedOffer = useRef(false);

  const questions = article.quiz?.questions ?? [];
  const capApplies = !(proEnabled && isPro) && Platform.OS !== 'web' && ads.sessionCount >= ads.config.minSessionForAds;
  const extra = ads.quizExtra(article.id);
  const visibleCount = visibleQuizCount({
    questionCount: questions.length,
    capApplies,
    freeCap: ads.config.quizFreeQuestionCap,
    extra,
  });
  const activeQuestions = questions.slice(0, visibleCount);
  const question = activeQuestions[cursor];
  const freshQuiz = useMemo(() => {
    if (!article.quiz || article.quiz.questions.length === 0) return null;
    return freshQuizIfDifferent(
      { title: article.title, content: article.content },
      article.quiz.questions,
      new Date(),
      article.quiz.asked,
    );
  }, [article.content, article.quiz, article.title]);
  const offerPlan = planQuizOffer({
    questionCount: questions.length,
    capApplies,
    freeCap: ads.config.quizFreeQuestionCap,
    extra,
    rewardQuestions: ads.config.quizRewardQuestions,
    freshAvailable: freshQuiz != null,
  });
  const showOffer = finished && !declinedOffer && offerPlan.kind !== 'hide' && ads.canOfferRewarded('quiz_unlock');

  useEffect(() => {
    const inProgress = !finished && (picked !== null || cursor > 0);
    if (inProgress) suppress('quiz');
    else release('quiz');
  }, [cursor, finished, picked, release, suppress]);

  useEffect(() => {
    return () => release('quiz');
  }, [release]);

  useEffect(() => {
    if (showOffer && ads.ready && ads.canRequestAds) preloadRewarded();
  }, [ads.canRequestAds, ads.ready, preloadRewarded, showOffer]);

  useEffect(() => {
    if (!finished) {
      countedOffer.current = false;
      return;
    }
    if (!showOffer || countedOffer.current) return;
    countedOffer.current = true;
    void recordQuizOfferShown();
  }, [finished, recordQuizOfferShown, showOffer]);

  const reviewChecked = useRef(false);
  useEffect(() => {
    if (!finished) {
      reviewChecked.current = false;
      return;
    }
    if (reviewChecked.current || activeQuestions.length === 0) return;
    reviewChecked.current = true;
    void maybeRequestReviewAfterQuiz({
      correct: correctCount,
      total: activeQuestions.length,
      sessionCount: ads.sessionCount,
      lastFullscreenAt: ads.lastFullscreenAt,
    });
  }, [activeQuestions.length, ads.lastFullscreenAt, ads.sessionCount, correctCount, finished]);

  const resetQuiz = () => {
    setCursor(0);
    setPicked(null);
    setCorrectCount(0);
    setFinished(false);
    setDeclinedOffer(false);
  };

  const generate = async () => {
    if (!db || busy) return;
    setBusy(true);
    setError(null);
    try {
      const engine = getStudyEngine();
      const input = { title: article.title, content: article.content };
      let summary: string;
      let quiz: Quiz;
      let note: string | undefined;
      if (article.summary) {
        // Rebuild: a different summary and unseen questions, keeping what was already shown.
        const nextSummary = rebuildSummary(input, article.summary, article.quiz?.summaryShown ?? []);
        const nextQuiz = rebuildQuiz(input, article.quiz);
        summary = nextSummary.summary;
        quiz = { ...nextQuiz.quiz, summaryShown: nextSummary.shown };
        note = [nextSummary.note, nextQuiz.note].filter((item): item is string => Boolean(item)).join(' ') || undefined;
      } else {
        // First build: the best-scored summary, remembered so a later Rebuild can pick other sentences.
        const first = rebuildSummary(input, null);
        summary = first.summary;
        quiz = { ...engine.buildQuiz(input), summaryShown: first.shown };
      }
      await saveStudy(db, article.id, summary, quiz);
      await resetQuizExtra(article.id);
      onChange({ ...article, summary, quiz });
      setNotice(note ?? null);
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

  const watchForMore = () => {
    if (!ads.rewardedLoaded || !ads.canOfferRewarded('quiz_unlock')) {
      preloadRewarded();
      return;
    }
    const start = activeQuestions.length;
    const replacement = freshQuiz;
    const fresh = offerPlan.kind === 'fresh';
    void showRewarded('quiz_unlock', {
      articleId: article.id,
      quizQuestionCount: questions.length,
      quizFresh: fresh,
    }).then(async (result) => {
      if (result !== 'unavailable') void noteFullscreenAd();
      if (result !== 'earned') return;
      if (fresh && replacement) {
        const kept = article.quiz?.summaryShown;
        const nextQuiz = kept ? { ...replacement, summaryShown: kept } : replacement;
        if (db && article.summary) {
          try {
            await saveStudy(db, article.id, article.summary, nextQuiz);
          } catch {
            // The earned reward still replaces the questions on screen.
          }
        }
        onChange({ ...article, summary: article.summary, quiz: nextQuiz });
        setCursor(0);
        setCorrectCount(0);
        setNotice(null);
      } else {
        setCursor(start);
      }
      setPicked(null);
      setFinished(false);
      setDeclinedOffer(false);
    });
  };

  const rewardOffer = showOffer ? (
    <View style={styles.reward}>
      <Button
        label="Watch a short ad for 3 more questions"
        onPress={watchForMore}
        disabled={!ads.rewardedLoaded}
      />
      {!ads.rewardedLoaded ? (
        <AppText variant="meta" color={colors.faint}>
          The ad is still loading.
        </AppText>
      ) : null}
      <Button label="No thanks" variant="ghost" onPress={() => setDeclinedOffer(true)} />
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

      {notice ? (
        <AppText variant="meta" color={colors.faint}>
          {notice}
        </AppText>
      ) : null}

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
          {rewardOffer}
          <Button label="Try the quiz again" variant="secondary" onPress={resetQuiz} />
        </View>
      ) : null}

      {question && !finished ? (
        <View style={styles.quiz}>
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
