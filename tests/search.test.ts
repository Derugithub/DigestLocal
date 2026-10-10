import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  likeContainsPattern,
  mergeShelfSearch,
  searchArticleIdsByBody,
} from '../src/lib/articles.ts';
import type { ArticleListItem } from '../src/lib/types.ts';
import type { SQLiteDatabase } from 'expo-sqlite';

function shelf(partial: Pick<ArticleListItem, 'id' | 'title' | 'site'>): ArticleListItem {
  return {
    url: 'https://example.com',
    savedAt: 1,
    wordCount: 10,
    hasSummary: false,
    ...partial,
  };
}

test('escapes LIKE wildcards in the shelf pattern', () => {
  assert.equal(likeContainsPattern('  harbor '), '%harbor%');
  assert.equal(likeContainsPattern('100%'), '%100\\%%');
  assert.equal(likeContainsPattern('a_b'), '%a\\_b%');
  assert.equal(likeContainsPattern('c\\d'), '%c\\\\d%');
});

test('shelf search keeps title and site matches and adds body ids', () => {
  const articles = [
    shelf({ id: 'title', title: 'Harbor Ledger', site: 'example.com' }),
    shelf({ id: 'site', title: 'Notes', site: 'Harbor.example' }),
    shelf({ id: 'body', title: 'Untitled', site: 'other.test' }),
    shelf({ id: 'none', title: 'Untitled', site: 'other.test' }),
  ];
  const hits = mergeShelfSearch(articles, 'harbor', new Set(['body']));
  assert.deepEqual(
    hits.map((article) => article.id),
    ['title', 'site', 'body'],
  );
  assert.deepEqual(
    mergeShelfSearch(articles, 'harbor', null).map((article) => article.id),
    ['title', 'site'],
  );
  assert.equal(mergeShelfSearch(articles, '   ', new Set(['body'])).length, articles.length);
});

test('body search matches plain text and ignores HTML, summary, and quiz', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE articles (
      id TEXT PRIMARY KEY NOT NULL,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      site TEXT NOT NULL,
      content TEXT NOT NULL,
      content_html TEXT,
      saved_at INTEGER NOT NULL,
      summary TEXT,
      quiz_json TEXT
    );
  `);
  const insert = sqlite.prepare(
    'INSERT INTO articles (id, url, title, site, content, content_html, saved_at, summary, quiz_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  insert.run(
    'body',
    'https://example.com/body',
    'Morning note',
    'example.com',
    'The harbor ledger kept the tide tables.',
    '<p>nope</p>',
    1,
    null,
    null,
  );
  insert.run(
    'html-only',
    'https://example.com/html',
    'Other',
    'example.com',
    'Nothing about the search word here.',
    '<p>harbor</p>',
    2,
    'harbor summary',
    '{"questions":["harbor"]}',
  );
  insert.run(
    'percent',
    'https://example.com/percent',
    'Rates',
    'example.com',
    'Growth was 100% this year.',
    null,
    3,
    null,
    null,
  );
  insert.run(
    'literal',
    'https://example.com/literal',
    'Codes',
    'example.com',
    'Use a_b as the code.',
    null,
    4,
    null,
    null,
  );
  insert.run(
    'almost-percent',
    'https://example.com/almost-percent',
    'Count',
    'example.com',
    'There were 1000 items.',
    null,
    5,
    null,
    null,
  );
  insert.run(
    'almost-underscore',
    'https://example.com/almost-underscore',
    'Codes',
    'example.com',
    'Use axb as the other code.',
    null,
    6,
    null,
    null,
  );

  const db = {
    async getAllAsync(sql: string, ...params: unknown[]) {
      const bound = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      return sqlite.prepare(sql).all(...(bound as never[]));
    },
  } as unknown as SQLiteDatabase;

  assert.deepEqual([...(await searchArticleIdsByBody(db, 'Harbor'))].sort(), ['body']);
  assert.deepEqual([...(await searchArticleIdsByBody(db, '100%'))].sort(), ['percent']);
  assert.deepEqual([...(await searchArticleIdsByBody(db, 'a_b'))].sort(), ['literal']);
  assert.equal((await searchArticleIdsByBody(db, '   ')).size, 0);
  sqlite.close();
});
