import { describe, expect, it } from 'vitest';
import { buildReport, fileNameFor, lastDay, mailtoUrl, MAIL_BODY_MAX, subjectFor } from './report';

const base = { what: 'Timer would not stop', expected: 'It stops', includeDetails: true, appName: 'Yak', version: '1.2', userAgent: 'UA', device: '800x600 @2x, en', page: '#/timer', logText: 'a line', now: new Date('2026-10-19T10:00:00Z') };

describe('problem report', () => {
  it('holds the description, details and log, or only the description', () => {
    const full = buildReport(base);
    expect(full).toContain('Timer would not stop');
    expect(full).toContain('App version: 1.2');
    expect(full).toContain('a line');
    const bare = buildReport({ ...base, includeDetails: false });
    expect(bare).not.toContain('Browser');
    expect(bare).not.toContain('a line');
  });

  it('keeps the last day of the log', () => {
    expect(lastDay([{ at: 0 }, { at: 90_000_000 }], 90_000_000 + 1000)).toEqual([{ at: 90_000_000 }]);
  });

  it('makes a subject from the first words and a short mail link', () => {
    expect(subjectFor('Yak', 'Timer would not stop when I pressed the button twice today')).toBe('Yak problem: Timer would not stop when I pressed the');
    expect(subjectFor('Yak', '')).toBe('Yak problem');
    const long = mailtoUrl('yak@example.com', 'Yak problem', { ...base, what: 'x'.repeat(5000) });
    expect(long.startsWith('mailto:yak@example.com?subject=Yak%20problem&body=')).toBe(true);
    expect(decodeURIComponent(long.split('&body=')[1] ?? '').length).toBeLessThanOrEqual(MAIL_BODY_MAX);
    expect(decodeURIComponent(mailtoUrl('a@b.c', 's', base).split('&body=')[1] ?? '')).toContain('Full report copied; paste or attach it.');
  });

  it('names the file by date', () => {
    expect(fileNameFor('Yak', base.now)).toBe('yak-report-2026-10-19.txt');
  });
});
