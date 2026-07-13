import * as SQLite from 'expo-sqlite';

type Db = ReturnType<typeof SQLite.openDatabase>;

let db: Db | null = null;
let initPromise: Promise<Db> | null = null;

export function openDb(): Promise<Db> {
  if (db) return Promise.resolve(db);
  if (initPromise) return initPromise;
  initPromise = new Promise((resolve, reject) => {
    const d = SQLite.openDatabase('classifier.db');
    d.transaction(
      tx => {
        tx.executeSql(
          `CREATE TABLE IF NOT EXISTS exact_map (
            norm_desc TEXT NOT NULL,
            category  TEXT NOT NULL,
            cnt       INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (norm_desc, category)
          )`,
        );
        tx.executeSql(
          `CREATE TABLE IF NOT EXISTS word_stats (
            word      TEXT NOT NULL,
            category  TEXT NOT NULL,
            cnt       INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (word, category)
          )`,
        );
        tx.executeSql(
          `CREATE TABLE IF NOT EXISTS cat_prior (
            category  TEXT PRIMARY KEY,
            cnt       INTEGER NOT NULL DEFAULT 0
          )`,
        );
      },
      reject,
      () => { db = d; resolve(d); },
    );
  });
  return initPromise;
}

function read<T>(sql: string, params: (string | number)[] = []): Promise<T[]> {
  return openDb().then(
    d => new Promise<T[]>((resolve, reject) => {
      d.readTransaction(
        tx => tx.executeSql(
          sql, params,
          (_, result) => { resolve(result.rows._array as T[]); },
          (_, err) => { reject(err); return false; },
        ),
        reject,
      );
    }),
  );
}

function exec(sql: string, params: (string | number)[] = []): Promise<void> {
  return openDb().then(
    d => new Promise<void>((resolve, reject) => {
      d.transaction(
        tx => tx.executeSql(
          sql, params,
          () => {},
          (_, err) => { reject(err); return false; },
        ),
        reject,
        resolve,
      );
    }),
  );
}

// exact_map

export async function getExactMatches(normDesc: string) {
  return read<{ category: string; cnt: number }>(
    'SELECT category, cnt FROM exact_map WHERE norm_desc = ?',
    [normDesc],
  );
}

export async function upsertExact(normDesc: string, category: string) {
  return exec(
    'INSERT INTO exact_map (norm_desc, category, cnt) VALUES (?, ?, 1) ON CONFLICT(norm_desc, category) DO UPDATE SET cnt = cnt + 1',
    [normDesc, category],
  );
}

// word_stats

export async function getWordCats(word: string) {
  return read<{ category: string; cnt: number }>(
    'SELECT category, cnt FROM word_stats WHERE word = ?',
    [word],
  );
}

export async function upsertWord(word: string, category: string) {
  return exec(
    'INSERT INTO word_stats (word, category, cnt) VALUES (?, ?, 1) ON CONFLICT(word, category) DO UPDATE SET cnt = cnt + 1',
    [word, category],
  );
}

export async function wordTotalInCategory(category: string): Promise<number> {
  const rows = await read<{ total: number }>(
    'SELECT COALESCE(SUM(cnt), 0) as total FROM word_stats WHERE category = ?',
    [category],
  );
  return rows[0]?.total ?? 0;
}

export async function vocabSize(): Promise<number> {
  const rows = await read<{ n: number }>('SELECT COUNT(DISTINCT word) as n FROM word_stats');
  return rows[0]?.n ?? 0;
}

// cat_prior

export async function getAllPriors() {
  return read<{ category: string; cnt: number }>('SELECT category, cnt FROM cat_prior');
}

export async function upsertPrior(category: string) {
  return exec(
    'INSERT INTO cat_prior (category, cnt) VALUES (?, 1) ON CONFLICT(category) DO UPDATE SET cnt = cnt + 1',
    [category],
  );
}

// bulk seed import

export async function importSeed(entries: Array<{ word: string; category: string; cnt: number }>) {
  const d = await openDb();
  const cats = new Set<string>();
  entries.forEach(e => cats.add(e.category));
  return new Promise<void>((resolve, reject) => {
    d.transaction(
      tx => {
        for (const { word, category, cnt } of entries) {
          tx.executeSql(
            'INSERT INTO word_stats (word, category, cnt) VALUES (?, ?, ?) ON CONFLICT(word, category) DO NOTHING',
            [word, category, cnt],
          );
        }
        for (const cat of cats) {
          tx.executeSql(
            'INSERT INTO cat_prior (category, cnt) VALUES (?, 0) ON CONFLICT(category) DO NOTHING',
            [cat],
          );
        }
      },
      reject,
      resolve,
    );
  });
}

export async function isSeedLoaded(): Promise<boolean> {
  const rows = await read<{ n: number }>('SELECT COUNT(*) as n FROM word_stats');
  return (rows[0]?.n ?? 0) > 0;
}
