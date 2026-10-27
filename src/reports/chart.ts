import type { HoursFormat } from './format';

/** Geometry helpers for the bar chart, kept apart from the component so they can be tested. */

const H = 3_600_000;
const STEPS = [0.25, 0.5, 1, 2, 3, 4, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

/** A round axis maximum (in hours) and tick step so that about 3 to 6 ticks cover the data. */
export function niceScale(maxMs: number): { max: number; step: number; ticks: number[] } {
  const hours = Math.max(maxMs / H, 0);
  let step = STEPS[STEPS.length - 1] ?? 1000;
  for (const s of STEPS) {
    if (hours / s <= 5) {
      step = s;
      break;
    }
  }
  const max = Math.max(step, Math.ceil(hours / step - 1e-9) * step);
  const ticks: number[] = [];
  for (let t = 0; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
  return { max, step, ticks };
}

export function tickLabel(hours: number, format: HoursFormat): string {
  if (format === 'hm') return `${Math.floor(hours)}:${String(Math.round((hours % 1) * 60)).padStart(2, '0')}`;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(2).replace(/0$/, '')} h`;
}

/** Label every n-th bar so that labels of `labelWidth` pixels never overlap. */
export function labelStride(barCount: number, plotWidth: number, labelWidth: number): number {
  if (barCount <= 0) return 1;
  const slot = plotWidth / barCount;
  return Math.max(1, Math.ceil(labelWidth / Math.max(slot, 1)));
}
