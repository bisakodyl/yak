import { describe, expect, it } from 'vitest';
import { DocumentStore } from '../core/doc-store';
import { DocMux, decodeControl, decodeFrame, encodeControl, encodeFrame } from './doc-mux';

const memory = () => ({ whenLoaded: Promise.resolve(), destroy: () => Promise.resolve() });

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
}

function pair(a: DocumentStore, b: DocumentStore): { muxA: DocMux; muxB: DocMux } {
  // eslint-disable-next-line prefer-const
  let muxB: DocMux;
  const muxA = new DocMux(a, (f) => muxB.receive(f), { firstResyncMs: 60_000, resyncMs: 60_000 });
  muxB = new DocMux(b, (f) => muxA.receive(f), { firstResyncMs: 60_000, resyncMs: 60_000 });
  muxA.start();
  muxB.start();
  return { muxA, muxB };
}

describe('DocMux', () => {
  it('round-trips a frame', () => {
    const frame = encodeFrame('space/work', new Uint8Array([1, 2, 3]));
    expect(decodeFrame(frame)).toEqual({ docId: 'space/work', payload: new Uint8Array([1, 2, 3]) });
  });

  it('syncs several documents over one channel', async () => {
    const a = new DocumentStore(memory);
    const b = new DocumentStore(memory);
    const pa = await a.open('space/personal');
    const wa = await a.open('space/work');
    const pb = await b.open('space/personal');
    const wb = await b.open('space/work');
    pa.getText('t').insert(0, 'personal from a');
    wb.getText('t').insert(0, 'work from b');
    const { muxA, muxB } = pair(a, b);
    await settle();
    expect(pb.getText('t').toString()).toBe('personal from a');
    expect(wa.getText('t').toString()).toBe('work from b');
    muxA.close();
    muxB.close();
  });

  it('opens a document the peer has and this device has not', async () => {
    const a = new DocumentStore(memory);
    const b = new DocumentStore(memory);
    const extra = await a.open('space/work/notes/abc');
    extra.getText('t').insert(0, 'only on a');
    const { muxA, muxB } = pair(a, b);
    await settle();
    expect(b.get('space/work/notes/abc')?.getText('t').toString()).toBe('only on a');
    muxA.close();
    muxB.close();
  });

  it('includes documents opened after the link came up', async () => {
    const a = new DocumentStore(memory);
    const b = new DocumentStore(memory);
    const { muxA, muxB } = pair(a, b);
    const late = await a.open('space/personal');
    late.getText('t').insert(0, 'late');
    await settle();
    expect(b.get('space/personal')?.getText('t').toString()).toBe('late');
    muxA.close();
    muxB.close();
  });

  it('refuses document ids outside the allowed set', async () => {
    const b = new DocumentStore(memory);
    const errors: unknown[] = [];
    const mux = new DocMux(b, () => undefined, { onError: (e) => errors.push(e), firstResyncMs: 60_000, resyncMs: 60_000 });
    mux.start();
    mux.receive(encodeFrame('other/thing', new Uint8Array([0, 0])));
    mux.receive(new Uint8Array([7, 7, 7]));
    await settle();
    expect(b.opened().size).toBe(0);
    expect(errors.length).toBe(1);
    mux.close();
  });

  it('heals a lost update on resync', async () => {
    const a = new DocumentStore(memory);
    const b = new DocumentStore(memory);
    const da = await a.open('space/personal');
    const db = await b.open('space/personal');
    let drop = false;
    // eslint-disable-next-line prefer-const
    let muxB: DocMux;
    const muxA = new DocMux(a, (f) => (drop ? undefined : muxB.receive(f)), { firstResyncMs: 60_000, resyncMs: 60_000 });
    muxB = new DocMux(b, (f) => muxA.receive(f), { firstResyncMs: 60_000, resyncMs: 60_000 });
    muxA.start();
    muxB.start();
    drop = true;
    da.getText('t').insert(0, 'lost');
    drop = false;
    expect(db.getText('t').toString()).toBe('');
    muxB.resync();
    await settle();
    expect(db.getText('t').toString()).toBe('lost');
    muxA.close();
    muxB.close();
  });

  it('syncs only the documents both sides allow, including ones open before the link', async () => {
    const a = new DocumentStore(memory);
    const b = new DocumentStore(memory);
    const workA = await a.open('space/work');
    const workTimeA = await a.open('space/work/time');
    const personalA = await a.open('space/personal');
    workA.getText('t').insert(0, 'work');
    workTimeA.getText('t').insert(0, 'work time');
    personalA.getText('t').insert(0, 'personal');
    const notWork = (id: string): boolean => !id.startsWith('space/work');
    const errors: string[] = [];
    // eslint-disable-next-line prefer-const
    let muxB: DocMux;
    const muxA = new DocMux(a, (f) => muxB.receive(f), { firstResyncMs: 60_000, resyncMs: 60_000, allowDoc: notWork });
    muxB = new DocMux(b, (f) => muxA.receive(f), { firstResyncMs: 60_000, resyncMs: 60_000, onError: (e) => errors.push(String(e)) });
    muxA.start();
    muxB.start();
    await settle();
    expect(b.get('space/personal')?.getText('t').toString()).toBe('personal');
    expect(b.get('space/work')).toBeUndefined();
    expect(b.get('space/work/time')).toBeUndefined();
    // B allows everything and offers its own work document; A refuses it, once, quietly.
    const workB = await b.open('space/work');
    workB.getText('t').insert(0, 'from b');
    muxB.resync();
    muxB.resync();
    await settle();
    expect(workA.getText('t').toString()).toBe('work');
    expect(errors).toEqual([]);
    muxA.close();
    muxB.close();
  });
});

describe('control frames', () => {
  it('round-trips a message and is not mistaken for a document frame', () => {
    const frame = encodeControl({ kind: 'sync-code', secret: 'ABCD', account: 'x' });
    expect(decodeControl(frame)).toEqual({ kind: 'sync-code', secret: 'ABCD', account: 'x' });
    expect(decodeFrame(frame)).toBeUndefined();
  });

  it('is not produced by a document frame, and survives garbage', () => {
    expect(decodeControl(encodeFrame('space/work', new Uint8Array([1, 2])))).toBeUndefined();
    expect(decodeControl(new Uint8Array([2, 5, 1]))).toBeUndefined();
    expect(decodeControl(new Uint8Array([]))).toBeUndefined();
  });
});

