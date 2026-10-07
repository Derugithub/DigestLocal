export type QuizKind = 'cloze' | 'attribution';

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
  note?: string;
};

export type Article = {
  id: string;
  url: string;
  title: string;
  site: string;
  content: string;
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
  truncated: boolean;
};

export type StudyInput = {
  title: string;
  content: string;
};
