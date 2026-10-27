export interface DiffLine {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

/**
 * Line by line difference between two texts (longest common subsequence). `removed` lines are in
 * `from` only, `added` lines in `to` only. Notes are short, so the quadratic table is fine; very long
 * texts fall back to "everything replaced" rather than building a huge table.
 */
export function lineDiff(from: string, to: string, maxCells = 4_000_000): DiffLine[] {
  const a = from.split('\n');
  const b = to.split('\n');
  if (a.length * b.length > maxCells) return [...a.map((text): DiffLine => ({ kind: 'removed', text })), ...b.map((text): DiffLine => ({ kind: 'added', text }))];
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) out.push({ kind: 'removed', text: a[i++]! });
    else out.push({ kind: 'added', text: b[j++]! });
  }
  while (i < n) out.push({ kind: 'removed', text: a[i++]! });
  while (j < m) out.push({ kind: 'added', text: b[j++]! });
  return out;
}
