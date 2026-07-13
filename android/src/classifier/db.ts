import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export async function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('classifier.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS exact_map (
      norm_desc TEXT NOT NULL,
      category  TEXT NOT NULL,
      cnt       INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (norm_desc, category)
    );
    CREATE TABLE IF NOT EXISTS word_stats (
      word      TEXT NOT NULL,
      category  TEXT NOT NULL,
      cnt       INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (word, category)
    );
    CREATE TABLE IF NOT EXISTS cat_prior (
      category  TEXT PRIMARY KEY,
      cnt       INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

// exact_map

export async function getExactMatches(normDesc: string) {
  const d = await openDb();
  return d.getAllAsync<{ category: string; cnt: number }>(
    'SELECT category, cnt FROM exact_map WHERE norm_desc = ?',
    [normDesc],
  );
}

export async function upsertExact(normDesc: string, category: string) {
  const d = await openDb();
  await d.runAsync(
    'INSERT INTO exact_map (norm_desc, category, cnt) VALUES (?, ?, 1) ON CONFLICT(norm_desc, category) DO UPDATE SET cnt = cnt + 1',
    [normDesc, category],
  );
}

// word_stats

export async function getWordCats(word: string) {
  const d = await openDb();
  return d.getAllAsync<{ category: string; cnt: number }>(
    'SELECT category, cnt FROM word_stats WHERE word = ?',
    [word],
  );
}

export async function upsertWord(word: string, category: string) {
  const d = await openDb();
  await d.runAsync(
    'INSERT INTO word_stats (word, category, cnt) VALUES (?, ?, 1) ON CONFLICT(word, category) DO UPDATE SET cnt = cnt + 1',
    [word, category],
  );
}

export async function wordTotalInCategory(category: string): Promise<number> {
  const d = await openDb();
  const row = await d.getFirstAsync<{ total: number }>(
    'SELECT COALESCE(SUM(cnt), 0) as total FROM word_stats WHERE category = ?',
    [category],
  );
  return row?.total ?? 0;
}

export async function vocabSize(): Promise<number> {
  const d = await openDb();
  const row = await d.getFirstAsync<{ n: number }>('SELECT COUNT(DISTINCT word) as n FROM word_stats');
  return row?.n ?? 0;
}

// cat_prior

export async function getAllPriors() {
  const d = await openDb();
  return d.getAllAsync<{ category: string; cnt: number }>('SELECT category, cnt FROM cat_prior');
}

export async function upsertPrior(category: string) {
  const d = await openDb();
  await d.runAsync(
    'INSERT INTO cat_prior (category, cnt) VALUES (?, 1) ON CONFLICT(category) DO UPDATE SET cnt = cnt + 1',
    [category],
  );
}

// bulk seed import

export async function importSeed(entries: Array<{ word: string; category: string; cnt: number }>) {
  const d = await openDb();
  const cats = new Set<string>();
  await d.withTransactionAsync(async () => {
    for (const { word, category, cnt } of entries) {
      await d.runAsync(
        'INSERT INTO word_stats (word, category, cnt) VALUES (?, ?, ?) ON CONFLICT(word, category) DO NOTHING',
        [word, category, cnt],
      );
      cats.add(category);
    }
    for (const cat of cats) {
      await d.runAsync(
        'INSERT INTO cat_prior (category, cnt) VALUES (?, 0) ON CONFLICT(category) DO NOTHING',
        [cat],
      );
    }
  });
}

export async function isSeedLoaded(): Promise<boolean> {
  const d = await openDb();
  const row = await d.getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM word_stats');
  return (row?.n ?? 0) > 0;
}
