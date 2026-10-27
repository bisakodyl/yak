import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DEFAULT_DAILY, expandTemplate, formatDate, readDaily, writeDaily } from './templates';

const day = new Date(2026, 9, 17, 8, 5, 9);

describe('formatDate', () => {
  it('fills the tokens', () => {
    expect(formatDate(day, 'YYYY-MM-DD')).toBe('2026-10-17');
    expect(formatDate(day, 'YY/MM/DD HH:mm:ss')).toBe('26/10/17 08:05:09');
  });
  it('names the weekday', () => {
    expect(formatDate(day, 'dddd', 'en')).toBe('Saturday');
    expect(formatDate(day, 'ddd', 'en')).toBe('Sat');
  });
  it('numbers ISO weeks and their year', () => {
    expect(formatDate(day, 'GGGG-[W]WW')).toBe('2026-W42');
    expect(formatDate(new Date(2027, 0, 1), 'GGGG-[W]WW')).toBe('2026-W53');
    expect(formatDate(new Date(2024, 11, 30), 'GGGG-[W]WW')).toBe('2025-W01');
  });
  it('keeps bracketed text and other characters as written', () => {
    expect(formatDate(day, '[Week of] DD.MM')).toBe('Week of 17.10');
  });
});

describe('expandTemplate', () => {
  it('fills date, time and title, with optional formats', () => {
    const out = expandTemplate('# {{title}}\n{{date}} {{time}}\n{{date:DD/MM}} {{ time:HH }}', { now: day, title: 'Plan' });
    expect(out).toBe('# Plan\n2026-10-17 08:05\n17/10 08');
  });
  it('leaves unknown variables alone', () => {
    expect(expandTemplate('{{other}} {{date}}', { now: day, title: 'x' })).toBe('{{other}} 2026-10-17');
  });
});

describe('daily settings', () => {
  it('default, then stored values', () => {
    const doc = new Y.Doc();
    expect(readDaily(doc)).toEqual(DEFAULT_DAILY);
    writeDaily(doc, 'folder', 'Journal');
    writeDaily(doc, 'format', '  ');
    expect(readDaily(doc)).toEqual({ ...DEFAULT_DAILY, folder: 'Journal' });
  });
});
