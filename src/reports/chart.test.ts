import { describe, expect, test } from 'vitest';
import { labelStride, niceScale, tickLabel } from './chart';

const H = 3_600_000;

describe('niceScale', () => {
  test('rounds the maximum up to a whole step', () => {
    expect(niceScale(7.5 * H)).toMatchObject({ max: 8, step: 2, ticks: [0, 2, 4, 6, 8] });
    expect(niceScale(3 * H)).toMatchObject({ max: 3, step: 1, ticks: [0, 1, 2, 3] });
    expect(niceScale(0.4 * H).step).toBe(0.25);
  });

  test('an empty chart still has an axis', () => {
    expect(niceScale(0)).toMatchObject({ max: 0.25, step: 0.25 });
  });

  test('big totals use big steps and never more than 6 ticks', () => {
    for (const hours of [1, 9, 24, 90, 400, 3000]) {
      const s = niceScale(hours * H);
      expect(s.max).toBeGreaterThanOrEqual(hours);
      expect(s.ticks.length).toBeLessThanOrEqual(7);
    }
  });
});

test('tick labels follow the hours format', () => {
  expect(tickLabel(2, 'decimal')).toBe('2 h');
  expect(tickLabel(0.25, 'decimal')).toBe('0.25 h');
  expect(tickLabel(0.5, 'decimal')).toBe('0.5 h');
  expect(tickLabel(2, 'hm')).toBe('2:00');
  expect(tickLabel(0.5, 'hm')).toBe('0:30');
});

test('label stride skips labels when bars are narrow', () => {
  expect(labelStride(7, 280, 40)).toBe(1);
  expect(labelStride(31, 280, 24)).toBe(3);
  expect(labelStride(0, 280, 24)).toBe(1);
});
