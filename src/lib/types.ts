export type QuizKind = 'why' | 'meaning' | 'relation' | 'takeaway' | 'cloze';

export type QuizQuestion = {
  id: string;
  kind: QuizKind;
  prompt: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
};

export type Quiz = {
  engine: string;
  generatedAt: string;
  questions: QuizQuestion[];
  /** quizQuestionKey(prompt, answer) of every question shown for this article, so reward sets never repeat. */
  asked?: string[];
  /** summarySentenceKey() of every sentence shown in a summary for this article, so Rebuild picks different ones. */
  summaryShown?: string[];
  note?: string;
};

export type Article = {
  id: string;
  url: string;
  title: string;
  site: string;
  /** Plain text for listening, study, search, and word counts. */
  content: string;
  /** Sanitized article HTML. Null for articles saved before structured storage. */
  contentHtml: string | null;
  savedAt: number;
  summary: string | null;
  quiz: Quiz | null;
};

export type ArticleListItem = {
  id: string;
  url: string;
  title: string;
  site: string;
  savedAt: number;
  wordCount: number;
  hasSummary: boolean;
};

export type ExtractedArticle = {
  title: string;
  site: string;
  content: string;
  contentHtml: string;
  truncated: boolean;
};

export type StudyInput = {
  title: string;
  content: string;
};
