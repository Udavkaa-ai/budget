// Normalization and stemming exactly as specified in speclocalclassifier.md

const SUFFIXES = ['ами', 'ах', 'ов', 'ой', 'ом', 'ы', 'и', 'а', 'у', 'е', 'я'];

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\d+/g, '')
    .replace(/[^\wа-яёa-z\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stem(w: string): string {
  for (const e of SUFFIXES) {
    if (w.length - e.length >= 4 && w.endsWith(e)) {
      return w.slice(0, w.length - e.length);
    }
  }
  return w;
}

export function tokenize(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter(w => w.length > 2)
    .map(stem);
}
