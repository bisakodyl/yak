import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { attachmentsMap, listAttachments } from './attachments';
import { copyBlobs, copyIndexEntry } from './copy';
import { MemoryBlobStore } from './store';

function put(doc: Y.Doc, hash: string, name: string): void {
  const m = new Y.Map<unknown>();
  m.set('name', name);
  m.set('size', 3);
  m.set('type', 'image/png');
  m.set('pieces', 'p');
  m.set('created_at', '2026-01-01T00:00:00.000Z');
  m.set('deleted', false);
  attachmentsMap(doc).set(hash, m);
}

describe('copyIndexEntry', () => {
  it('adds the entry under the same hash and leaves the source alone', () => {
    const src = new Y.Doc();
    const dst = new Y.Doc();
    put(src, 'a', 'cat.png');
    expect(copyIndexEntry(src, dst, 'cat.png')).toEqual({ hash: 'a', name: 'cat.png' });
    expect(listAttachments(dst).map((x) => [x.hash, x.name, x.pieces])).toEqual([['a', 'cat.png', 'p']]);
    expect(listAttachments(src)).toHaveLength(1);
  });

  it('reuses the entry when the target already has the same bytes', () => {
    const src = new Y.Doc();
    const dst = new Y.Doc();
    put(src, 'a', 'cat.png');
    put(dst, 'a', 'kitten.png');
    expect(copyIndexEntry(src, dst, 'cat.png')).toEqual({ hash: 'a', name: 'kitten.png' });
    expect(listAttachments(dst)).toHaveLength(1);
  });

  it('suffixes the name when other bytes hold it in the target', () => {
    const src = new Y.Doc();
    const dst = new Y.Doc();
    put(src, 'a', 'cat.png');
    put(dst, 'b', 'cat.png');
    expect(copyIndexEntry(src, dst, 'cat.png')).toEqual({ hash: 'a', name: 'cat 2.png' });
  });

  it('brings back a deleted entry and returns null for an unknown name', () => {
    const src = new Y.Doc();
    const dst = new Y.Doc();
    put(src, 'a', 'cat.png');
    put(dst, 'a', 'cat.png');
    attachmentsMap(dst).get('a')!.set('deleted', true);
    expect(copyIndexEntry(src, dst, 'cat.png')?.name).toBe('cat.png');
    expect(listAttachments(dst)).toHaveLength(1);
    expect(copyIndexEntry(src, dst, 'nope.png')).toBeNull();
  });
});

describe('copyBlobs', () => {
  it('copies held bytes, keeps the source, skips what is not held', async () => {
    const from = new MemoryBlobStore();
    const to = new MemoryBlobStore();
    await from.put('a', new Blob(['abc']));
    await copyBlobs('s', 't', ['a', 'missing'], { from, to });
    expect(await to.has('a')).toBe(true);
    expect(await to.has('missing')).toBe(false);
    expect(await from.has('a')).toBe(true);
  });
});
