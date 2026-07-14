/**
 * Local Naive Bayes classifier for expense categories.
 * Zero tokens, fully offline. Spec: speclocalclassifier.md
 *
 * Three layers:
 *   1. Exact match cache (norm description → majority category)
 *   2. Naive Bayes over informative tokens (entropy-filtered)
 *   3. Confidence thresholds → auto-fill / top-3 buttons / full list
 */

import { normalize, tokenize } from './normalize';
import {
  getExactMatches, upsertExact,
  getWordCats, upsertWord, wordTotalInCategory, vocabSize,
  getAllPriors, upsertPrior,
  importSeed, isSeedLoaded,
} from './db';
import { SEED } from './seed';

export const CATEGORIES = [
  'Продукты', 'Кафе', 'Транспорт', 'Одежда', 'Красота',
  'Медицина', 'Развлечения', 'Дети', 'Дом', 'Связь', 'Прочее',
];

const ALPHA = 0.5;            // Laplace smoothing
const ENTROPY_THRESHOLD = 1.0; // from spec §6
const CONF_HI = 0.80;         // auto-fill threshold
const CONF_LO = 0.45;         // buttons threshold

export type PredictResult =
  | { mode: 'auto';    category: string; confidence: number }
  | { mode: 'buttons'; top3: string[];   confidence: number }
  | { mode: 'full';    top3: string[] };

// ─── init ─────────────────────────────────────────────────────────────────────

export async function initClassifier() {
  const seeded = await isSeedLoaded();
  if (!seeded) {
    await importSeed(SEED);
    for (const cat of CATEGORIES) {
      await upsertPrior(cat).catch(() => {});
    }
  }
}

// ─── entropy filter ───────────────────────────────────────────────────────────

function entropy(catCounts: Array<{ category: string; cnt: number }>): number {
  const total = catCounts.reduce((s, r) => s + r.cnt, 0);
  if (total === 0) return 99;
  return -catCounts.reduce((s, r) => {
    const p = r.cnt / total;
    return s + p * Math.log(p + 1e-12);
  }, 0);
}

// ─── predict ──────────────────────────────────────────────────────────────────

export async function predict(description: string, cats: string[] = CATEGORIES): Promise<PredictResult> {
  const norm = normalize(description);

  // Step 1: exact match
  const exact = await getExactMatches(norm);
  if (exact.length > 0) {
    const total = exact.reduce((s, r) => s + r.cnt, 0);
    const best = exact.reduce((a, b) => (a.cnt > b.cnt ? a : b));
    const conf = best.cnt / total;
    if (conf >= CONF_HI) return { mode: 'auto', category: best.category, confidence: conf };
    const top3 = exact.sort((a, b) => b.cnt - a.cnt).slice(0, 3).map(r => r.category);
    return { mode: 'buttons', top3, confidence: conf };
  }

  // Step 2: Naive Bayes
  const tokens = tokenize(description);
  if (tokens.length === 0) return { mode: 'full', top3: cats.slice(0, 3) };

  // Filter to informative tokens (low entropy)
  const wordInfos = await Promise.all(
    tokens.map(async w => ({ w, cats: await getWordCats(w) })),
  );
  const known = wordInfos.filter(
    ({ cats }) => cats.length > 0 && entropy(cats) < ENTROPY_THRESHOLD,
  );

  if (known.length === 0) return { mode: 'full', top3: cats.slice(0, 3) };

  // Build priors
  const priorRows = await getAllPriors();
  const totalDocs = priorRows.reduce((s, r) => s + r.cnt, 0) || 1;
  const prior: Record<string, number> = {};
  for (const r of priorRows) prior[r.category] = r.cnt;
  for (const cat of cats) if (!prior[cat]) prior[cat] = 0;

  const vocab = await vocabSize();
  const scores: Record<string, number> = {};

  for (const cat of cats) {
    let s = Math.log((prior[cat] + ALPHA) / (totalDocs + ALPHA * cats.length));
    const catTotal = await wordTotalInCategory(cat);
    for (const { w, cats } of known) {
      const n = cats.find(r => r.category === cat)?.cnt ?? 0;
      s += Math.log((n + ALPHA) / (catTotal + ALPHA * (vocab || 1)));
    }
    scores[cat] = s;
  }

  // Softmax
  const mx = Math.max(...Object.values(scores));
  const exps: Record<string, number> = {};
  let z = 0;
  for (const cat of cats) { exps[cat] = Math.exp(scores[cat] - mx); z += exps[cat]; }
  const probs: Record<string, number> = {};
  for (const cat of cats) probs[cat] = exps[cat] / z;

  const ranked = cats.slice().sort((a, b) => probs[b] - probs[a]);
  const [best, ...rest] = ranked;
  const conf = probs[best];

  if (conf >= CONF_HI) return { mode: 'auto', category: best, confidence: conf };
  if (conf >= CONF_LO) return { mode: 'buttons', top3: [best, ...rest.slice(0, 2)], confidence: conf };
  return { mode: 'full', top3: [best, ...rest.slice(0, 2)] };
}

// ─── learn ────────────────────────────────────────────────────────────────────

export async function learn(description: string, category: string) {
  const norm = normalize(description);
  await upsertExact(norm, category);
  await upsertPrior(category);
  const tokens = tokenize(description);
  for (const w of tokens) {
    await upsertWord(w, category);
  }
}

// ─── crowd contribution ───────────────────────────────────────────────────────

const pendingContributions: Array<{ w: string; c: string }> = [];

export function queueContribution(description: string, category: string) {
  // Пользовательские категории в краудсловарь не отправляем
  if (!CATEGORIES.includes(category)) return;
  const tokens = tokenize(description);
  for (const w of tokens) {
    pendingContributions.push({ w, c: category });
  }
}

// Returns pairs that appeared ≥2 times locally (client-side privacy filter)
export function getDueContributions(): Array<{ w: string; c: string }> {
  const counts: Record<string, number> = {};
  for (const { w, c } of pendingContributions) {
    const key = `${w}|${c}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.entries(counts)
    .filter(([, n]) => n >= 2)
    .map(([key]) => { const [w, c] = key.split('|'); return { w, c }; });
}
