import { MAX_QUIZ_QUESTIONS } from '@/lib/study';

export type QuizOfferPlan = { kind: 'extend'; add: number } | { kind: 'fresh' } | { kind: 'hide' };

export function visibleQuizCount(args: {
  questionCount: number;
  capApplies: boolean;
  freeCap: number;
  extra: number;
  maxQuestions?: number;
}): number {
  const maxQuestions = args.maxQuestions ?? MAX_QUIZ_QUESTIONS;
  const ceiling = Math.min(Math.max(0, args.questionCount), maxQuestions);
  if (!args.capApplies) return ceiling;
  return Math.min(ceiling, Math.max(0, args.freeCap) + Math.max(0, args.extra));
}

/**
 * What an earned quiz reward would add.
 * Remaining questions in the current set come first, three at a time, and never past 8.
 * A fresh set is only offered when nothing unanswered is left and the generator can make one.
 */
export function planQuizOffer(args: {
  questionCount: number;
  capApplies: boolean;
  freeCap: number;
  extra: number;
  rewardQuestions: number;
  freshAvailable: boolean;
  maxQuestions?: number;
}): QuizOfferPlan {
  const maxQuestions = args.maxQuestions ?? MAX_QUIZ_QUESTIONS;
  const visible = visibleQuizCount({ ...args, maxQuestions });
  const ceiling = Math.min(Math.max(0, args.questionCount), maxQuestions);
  const remaining = ceiling - visible;
  if (remaining > 0) {
    return { kind: 'extend', add: Math.min(Math.max(1, args.rewardQuestions), remaining) };
  }
  if (args.freshAvailable) return { kind: 'fresh' };
  return { kind: 'hide' };
}

/** Extra questions stored for an article after an earned reward. A fresh set starts over at the free cap. */
export function extraAfterQuizReward(args: {
  questionCount: number;
  freeCap: number;
  extra: number;
  rewardQuestions: number;
  fresh: boolean;
  maxQuestions?: number;
}): number {
  if (args.fresh) return 0;
  const plan = planQuizOffer({
    questionCount: args.questionCount,
    capApplies: true,
    freeCap: args.freeCap,
    extra: args.extra,
    rewardQuestions: args.rewardQuestions,
    freshAvailable: false,
    maxQuestions: args.maxQuestions,
  });
  if (plan.kind !== 'extend') return Math.max(0, args.extra);
  return Math.max(0, args.extra) + plan.add;
}
