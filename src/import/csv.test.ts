import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv, parseCsvAsync } from './csv';

describe('parseCsv', () => {
  it('reads plain rows and the line each starts on', () => {
    const r = parseCsv('a,b,c\n1,2,3\n4,5,6\n');
    expect(r.rows).toEqual([['a', 'b', 'c'], ['1', '2', '3'], ['4', '5', '6']]);
    expect(r.lines).toEqual([1, 2, 3]);
    expect(r.unterminatedQuote).toBe(false);
  });

  it('handles CRLF, CR and LF line ends alike', () => {
    for (const nl of ['\r\n', '\n', '\r']) expect(parseCsv(`a,b${nl}1,2${nl}`).rows).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('does not need a final newline and does not add an empty row for one', () => {
    expect(parseCsv('a,b\n1,2').rows).toHaveLength(2);
    expect(parseCsv('a,b\n1,2\n').rows).toHaveLength(2);
    expect(parseCsv('a,b\r\n1,2\r\n\r\n').rows).toHaveLength(2);
  });

  it('skips blank lines', () => {
    expect(parseCsv('a\n\n\nb\n').rows).toEqual([['a'], ['b']]);
  });

  it('reads quoted cells with commas, doubled quotes and newlines', () => {
    const r = parseCsv('x,"a, b","say ""hi""","line1\nline2",end\n');
    expect(r.rows).toEqual([['x', 'a, b', 'say "hi"', 'line1\nline2', 'end']]);
  });

  it('keeps CRLF inside a quoted cell and counts lines past it', () => {
    const r = parseCsv('a,b\r\n"one\r\ntwo",x\r\nnext,y\r\n');
    expect(r.rows[1]).toEqual(['one\r\ntwo', 'x']);
    expect(r.lines).toEqual([1, 2, 4]);
  });

  it('reads empty cells, including a trailing one', () => {
    expect(parseCsv('a,,c,\n,,\n').rows).toEqual([['a', '', 'c', ''], ['', '', '']]);
    expect(parseCsv('a,b,').rows).toEqual([['a', 'b', '']]);
  });

  it('reads an empty quoted cell and a quoted cell holding only a quote', () => {
    expect(parseCsv('"",""""\n').rows).toEqual([['', '"']]);
  });

  it('drops a UTF-8 byte-order mark', () => {
    expect(parseCsv('﻿User,Email\nA,b\n').rows[0]).toEqual(['User', 'Email']);
  });

  it('keeps a quote in the middle of an unquoted cell as text', () => {
    expect(parseCsv('5" pipe,x\n').rows).toEqual([['5" pipe', 'x']]);
  });

  it('keeps text after a closing quote', () => {
    expect(parseCsv('"ab"cd,e\n').rows).toEqual([['abcd', 'e']]);
  });

  it('reports a quote that never closes and keeps what was read', () => {
    const r = parseCsv('a,b\n1,"open\nstill open');
    expect(r.unterminatedQuote).toBe(true);
    expect(r.rows[1]).toEqual(['1', 'open\nstill open']);
  });

  it('reads unicode and long cells', () => {
    const long = 'x'.repeat(100_000);
    expect(parseCsv(`ü,日本,${long}\n`).rows[0]).toEqual(['ü', '日本', long]);
  });

  it('handles an empty input', () => {
    expect(parseCsv('').rows).toEqual([]);
    expect(parseCsv('\n\n').rows).toEqual([]);
  });

  it('detects semicolons and tabs from the first line, ignoring quoted separators', () => {
    expect(detectDelimiter('a;b;c\n1,2,3')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n')).toBe('\t');
    expect(detectDelimiter('"a;b;c",d,e\n')).toBe(',');
    expect(detectDelimiter('single\n')).toBe(',');
    expect(parseCsv('a;"b;c"\n1;2\n').rows).toEqual([['a', 'b;c'], ['1', '2']]);
  });

  it('parses tens of thousands of rows quickly', () => {
    const lines = ['a,b,c'];
    for (let i = 0; i < 100_000; i++) lines.push(`${i},"text, ${i}",z`);
    const t0 = Date.now();
    const r = parseCsv(lines.join('\r\n'));
    expect(r.rows).toHaveLength(100_001);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe('parseCsvAsync', () => {
  it('gives the same result as parseCsv, in slices', async () => {
    const text = 'a,b\r\n' + Array.from({ length: 250 }, (_, i) => `${i},"x\ny ${i}"`).join('\r\n') + '\r\n';
    expect(await parseCsvAsync(text, { sliceRows: 40 })).toEqual(parseCsv(text));
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(parseCsvAsync('a\n'.repeat(100), { sliceRows: 10, signal: controller.signal })).rejects.toThrow('cancelled');
  });
});
