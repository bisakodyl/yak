import { describe, expect, test } from 'vitest';
import { NO_FILTERS, buildReport, groupSegments } from './aggregate';
import { CSV_HEADER, csvField, detailCsv, summaryMarkdown } from './export';
import { at, entry, project, source, useTimeZone } from './testing';


describe('csvField', () => {
  test('quotes commas, quotes and newlines', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
  });

  test('neutralises spreadsheet formulas', () => {
    expect(csvField('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(csvField('@cmd')).toBe("'@cmd");
    expect(csvField('+1')).toBe("'+1");
    expect(csvField('-1')).toBe("'-1");
    expect(csvField('a=b')).toBe('a=b');
  });
});

describe('exports (Europe/Berlin)', () => {
  useTimeZone('Europe/Berlin');

  const report = () => {
    const s = source({
      projects: [project({ id: 'p1', name: 'Web | site', rate: 100 })],
      entries: [
        entry({ startMs: at(2025, 3, 10, 9), endMs: at(2025, 3, 10, 10, 30), projectId: 'p1', billable: true, description: 'Design, "v2"', tags: ['ui', 'review'] }),
        entry({ startMs: at(2025, 3, 11, 9), endMs: at(2025, 3, 11, 10), description: '=evil()' }),
        entry({ startMs: at(2025, 3, 12, 9), endMs: null, description: 'Running' }),
      ],
    });
    return buildReport(s, {
      now: at(2025, 3, 12, 9, 30),
      range: { from: at(2025, 3, 10), to: at(2025, 3, 17) },
      weekStart: 'monday',
      filters: NO_FILTERS,
      groupBy: 'project',
      thenBy: 'description',
      multiSpace: false,
    });
  };

  test('detailed CSV has a header, quoting, local times and both duration forms', () => {
    const r = report();
    const csv = detailCsv([...r.rows].sort((a, b) => a.startMs - b.startMs), { personal: 'Personal' });
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe(CSV_HEADER.join(','));
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe('Personal,(No client),Web | site,"Design, ""v2""",Yes,2025-03-10,09:00:00,2025-03-10,10:30:00,1:30:00,1.5000,"ui, review",150.00,USD');
    expect(lines[2]).toContain("'=evil()");
    expect(lines[3]).toBe('Personal,(No client),(No project),Running,No,2025-03-12,09:00:00,,,0:30:00,0.5000,,,');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  test('Markdown summary: facts, a table with sub-rows, escaped pipes, a total', () => {
    const r = report();
    const md = summaryMarkdown({
      rangeText: '2025-03-10 to 2025-03-16',
      totals: r.totals,
      groups: r.groups,
      groupBy: 'project',
      thenBy: 'description',
      format: 'decimal',
      filterText: ['Billable: all'],
      spaceText: 'Personal',
      locale: 'en-US',
    });
    expect(md).toContain('## Time report 2025-03-10 to 2025-03-16');
    expect(md).toContain('- Total: 3.00 h');
    expect(md).toContain('- Billable: 1.50 h');
    expect(md).toContain('- Amount: $150.00');
    expect(md).toContain('| Project / Description | Duration | Share | Amount |');
    expect(md).toContain('| --- | ---: | ---: | ---: |');
    expect(md).toContain('| **Web \\| site** | 1.50 h | 50% | $150.00 |');
    expect(md).toContain('| ↳ Design, "v2" | 1.50 h | 50% | $150.00 |');
    expect(md).toContain('| **Total** | **3.00 h** | | **$150.00** |');
    expect(md).not.toContain('several tags');
  });

  test('Markdown says that tags overlap, and uses h:mm when asked', () => {
    const r = report();
    const md = summaryMarkdown({
      rangeText: 'x',
      totals: r.totals,
      groups: groupSegments(r.segments, 'tag'),
      groupBy: 'tag',
      thenBy: null,
      format: 'hm',
      filterText: [],
      spaceText: 'All spaces',
      locale: 'en-US',
    });
    expect(md).toContain('Entries with several tags are counted under each tag');
    expect(md).toContain('- Total: 3:00');
    expect(md).toContain('| ui | 1:30 | 50% | $150.00 |');
    expect(md).toContain('| (No tags) | 1:30 | 50% | — |');
  });
});
