import type { SQLiteDatabase } from 'expo-sqlite';

import type { Article, ArticleListItem, Quiz } from '@/lib/types';

type ArticleRow = {
  id: string;
  url: string;
  title: string;
  site: string;
  content: string;
  saved_at: number;
  summary: string | null;
  quiz_json: string | null;
};

type ListRow = {
  id: string;
  url: string;
  title: string;
  site: string;
  saved_at: number;
  word_count: number;
  has_summary: number;
};

function parseQuiz(raw: string | null): Quiz | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Quiz;
    if (!parsed || !Array.isArray(parsed.questions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function mapArticle(row: ArticleRow): Article {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    site: row.site,
    content: row.content,
    savedAt: row.saved_at,
    summary: row.summary,
    quiz: parseQuiz(row.quiz_json),
  };
}

export async function migrateArticles(db: SQLiteDatabase): Promise<void> {
  try {
    await db.execAsync('PRAGMA journal_mode = WAL;');
  } catch {
    // The web SQLite build may reject WAL. The table setup below still runs.
  }
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY NOT NULL,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      site TEXT NOT NULL,
      content TEXT NOT NULL,
      saved_at INTEGER NOT NULL,
      summary TEXT,
      quiz_json TEXT
    );
    CREATE INDEX IF NOT EXISTS articles_saved_at ON articles (saved_at DESC);
  `);
}

export async function listArticles(db: SQLiteDatabase): Promise<ArticleListItem[]> {
  const rows = await db.getAllAsync<ListRow>(`
    SELECT
      id,
      url,
      title,
      site,
      saved_at,
      CASE
        WHEN trim(content) = '' THEN 0
        ELSE length(trim(replace(content, char(10), ' ')))
          - length(replace(trim(replace(content, char(10), ' ')), ' ', ''))
          + 1
      END AS word_count,
      CASE WHEN summary IS NOT NULL AND length(trim(summary)) > 0 THEN 1 ELSE 0 END AS has_summary
    FROM articles
    ORDER BY saved_at DESC
  `);
  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    title: row.title,
    site: row.site,
    savedAt: row.saved_at,
    wordCount: row.word_count,
    hasSummary: row.has_summary === 1,
  }));
}

export async function getArticle(db: SQLiteDatabase, id: string): Promise<Article | null> {
  const row = await db.getFirstAsync<ArticleRow>(
    'SELECT id, url, title, site, content, saved_at, summary, quiz_json FROM articles WHERE id = ?',
    id,
  );
  return row ? mapArticle(row) : null;
}

export async function findArticleIdByUrl(db: SQLiteDatabase, url: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ id: string }>('SELECT id FROM articles WHERE url = ?', url);
  return row?.id ?? null;
}

export async function insertArticle(
  db: SQLiteDatabase,
  article: { id: string; url: string; title: string; site: string; content: string; savedAt: number },
): Promise<void> {
  await db.runAsync(
    'INSERT INTO articles (id, url, title, site, content, saved_at, summary, quiz_json) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)',
    article.id,
    article.url,
    article.title,
    article.site,
    article.content,
    article.savedAt,
  );
}

export async function saveStudy(
  db: SQLiteDatabase,
  id: string,
  summary: string,
  quiz: Quiz,
): Promise<void> {
  await db.runAsync(
    'UPDATE articles SET summary = ?, quiz_json = ? WHERE id = ?',
    summary,
    JSON.stringify(quiz),
    id,
  );
}

export async function deleteArticle(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM articles WHERE id = ?', id);
}
