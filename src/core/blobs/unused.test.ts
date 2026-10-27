import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addNote, memoryStore } from '../../backup/testing';
import { softDelete } from '../schema';
import { addAttachment, attachmentsMap, listAttachments } from './attachments';
import { MemoryBlobStore } from './store';
import { deleteFiles, dropDeletedBytes, referencedNames, spaceFiles, unreferencedFiles } from './unused';

const opts = { persist: async () => true, estimate: async () => undefined };
const add = async (doc: Y.Doc, store: MemoryBlobStore, name: string, text: string) => {
  const r = await addAttachment(doc, store, new File([text], name), opts);
  if (!r.ok) throw new Error(r.error);
  return r.attachment;
};
async function setup() {
  const doc = await memoryStore().open('space/s1');
  return { doc, store: new MemoryBlobStore() };
}

describe('unused files', () => {
  it('finds the names live notes point to, in links, embeds, widths and headings', async () => {
    const { doc } = await setup();
    addNote(doc, 'A.md', 'see ![[Photo.PNG|300]] and [[report.pdf#p2]] and [[Other note]]');
    expect([...referencedNames(doc)].sort()).toEqual(['other note', 'photo.png', 'report.pdf']);
  });

  it('takes the last path segment of a link and finds Markdown links and images, decoded', async () => {
    const { doc } = await setup();
    addNote(doc, 'A.md', '![[attachments/Pic.png]] [[a/b/doc.pdf#p2|x]] [t](attachments/my%20file.txt "title") ![](<sub/img.gif>) [web](https://x.test/dl/rep.zip?v=1)');
    expect([...referencedNames(doc)].sort()).toEqual(['doc.pdf', 'img.gif', 'my file.txt', 'pic.png', 'rep.zip']);
  });

  it('lists files no live note names, biggest first; a deleted note is no reference', async () => {
    const { doc, store } = await setup();
    await add(doc, store, 'used.txt', 'x');
    await add(doc, store, 'small.txt', 'ab');
    await add(doc, store, 'big.txt', 'abcdef');
    const keep = addNote(doc, 'Keep.md', 'embed ![[used.txt]]');
    expect(unreferencedFiles(doc).map((a) => a.name)).toEqual(['big.txt', 'small.txt']);
    softDelete(doc, 'notes', keep);
    expect(unreferencedFiles(doc).map((a) => a.name)).toEqual(['big.txt', 'small.txt', 'used.txt']);
  });

  it('deletes only the chosen files and drops their bytes', async () => {
    const { doc, store } = await setup();
    const a = await add(doc, store, 'a.txt', 'aaa');
    const b = await add(doc, store, 'b.txt', 'bbb');
    await deleteFiles(doc, store, [a.hash]);
    expect(await store.get(a.hash)).toBeUndefined();
    expect(await store.get(b.hash)).toBeDefined();
    expect(listAttachments(doc).map((x) => x.name)).toEqual(['b.txt']);
    expect(attachmentsMap(doc).get(a.hash)?.get('deleted')).toBe(true);
  });

  it('another device that sees the delete drops its bytes', async () => {
    const one = await setup();
    const two = { doc: new Y.Doc(), store: new MemoryBlobStore() };
    const a = await add(one.doc, one.store, 'a.txt', 'aaa');
    Y.applyUpdate(two.doc, Y.encodeStateAsUpdate(one.doc));
    await two.store.put(a.hash, new Blob(['aaa']));
    await deleteFiles(one.doc, one.store, [a.hash]);
    Y.applyUpdate(two.doc, Y.encodeStateAsUpdate(one.doc));
    expect(await dropDeletedBytes(two.doc, two.store)).toBe(1);
    expect(await two.store.get(a.hash)).toBeUndefined();
    expect(await dropDeletedBytes(two.doc, two.store)).toBe(0);
  });

  it('drops half-received pieces of a deleted file, held or not', async () => {
    const { doc, store } = await setup();
    const a = await add(doc, store, 'a.txt', 'aaa');
    await store.putPiece(a.hash, 0, new Uint8Array([1]));
    await store.delete(a.hash);
    attachmentsMap(doc).get(a.hash)?.set('deleted', true);
    expect((await store.getPieces(a.hash)).size).toBe(1);
    expect(await dropDeletedBytes(doc, store)).toBe(0);
    expect((await store.getPieces(a.hash)).size).toBe(0);
  });

  it('counts only live files in what a space holds', async () => {
    const { doc, store } = await setup();
    await add(doc, store, 'a.txt', 'aaa');
    const b = await add(doc, store, 'b.txt', 'bbbbb');
    attachmentsMap(doc).get(b.hash)?.set('deleted', true);
    expect(await spaceFiles(doc, store)).toMatchObject({ held: 3, files: 1 });
  });

  it('reports what the space holds against its limit', async () => {
    const { doc, store } = await setup();
    await add(doc, store, 'a.txt', 'aaa');
    expect(await spaceFiles(doc, store)).toMatchObject({ held: 3, files: 1 });
  });
});
