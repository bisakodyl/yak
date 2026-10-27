import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readRate, writeRate } from './rates';

describe('private project rates', () => {
  it('is undefined until set, then reads back per field', () => {
    const priv = new Y.Doc();
    expect(readRate(priv, 'p1')).toBeUndefined();
    expect(readRate(undefined, 'p1')).toBeUndefined();
    writeRate(priv, 'p1', { rate: 120 });
    expect(readRate(priv, 'p1')).toEqual({ rate: 120, currency: 'USD' });
    writeRate(priv, 'p1', { currency: 'EUR' });
    expect(readRate(priv, 'p1')).toEqual({ rate: 120, currency: 'EUR' });
    writeRate(priv, 'p1', { rate: null });
    expect(readRate(priv, 'p1')).toEqual({ rate: null, currency: 'EUR' });
  });
});
