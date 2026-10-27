import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { DocumentStore } from './doc-store';
import { docVersion, migrateDoc, migrationConverges, runSteps, watchTooNew, type DocMigration } from './migrations';
import { createRecord, collection } from './schema';

/** A deterministic step: every project gets `slug` computed from its name. */
const addSlug: DocMigration = {
  id: 'add-slug',
  version: 2,
  run(doc) {
    collection(doc, 'projects').forEach((p) => {
      p.set('slug', String(p.get('name')).toLowerCase());
    });
  },
};

/** Creates a derived-id record (as #255 would create the account record under a key-derived id). */
const addMarker: DocMigration = {
  id: 'add-marker',
  version: 3,
  run(doc) {
    const m = new Y.Map<unknown>();
    m.set('name', 'from migration');
    m.set('deleted', false);
    collection(doc, 'tags').set('derived-tag-id', m);
  },
};

function json(doc: Y.Doc): unknown {
  doc.getMap('meta');
  return doc.toJSON();
}

function seeded(): Y.Doc {
  const doc = new Y.Doc();
  createRecord(doc, 'projects', { name: 'Alpha', deleted: false });
  createRecord(doc, 'projects', { name: 'Beta', deleted: false });
  return doc;
}

describe('migrateDoc', () => {
  it('runs steps in order, once, and stamps the version', () => {
    const doc = seeded();
    const log: string[] = [];
    const r = migrateDoc(doc, 'space/x', [addSlug, addMarker], (s) => log.push(s));
    expect(r).toMatchObject({ status: 'migrated', from: 1, to: 3, ran: ['add-slug', 'add-marker'] });
    expect(docVersion(doc)).toBe(3);
    expect(log).toEqual(['add-slug', 'add-marker']);
    expect(migrateDoc(doc, 'space/x', [addSlug, addMarker])).toMatchObject({ status: 'current', ran: [] });
  });

  it('does not touch a document with nothing to do', () => {
    const doc = seeded();
    const before = Y.encodeStateVector(doc);
    expect(migrateDoc(doc, 'space/x', []).status).toBe('current');
    expect(Y.encodeStateVector(doc)).toEqual(before);
  });

  it('skips steps that do not apply to the document', () => {
    const doc = seeded();
    const only: DocMigration = { ...addSlug, applies: (id) => id.endsWith('/private') };
    expect(migrateDoc(doc, 'space/x', [only]).ran).toEqual([]);
  });

  it('refuses a document newer than the steps know and leaves it unchanged', () => {
    const doc = seeded();
    doc.getMap('meta').set('schema_version', 9);
    const before = Y.encodeStateVector(doc);
    expect(migrateDoc(doc, 'space/x', [addSlug])).toMatchObject({ status: 'too-new', from: 9 });
    expect(Y.encodeStateVector(doc)).toEqual(before);
    expect(doc.getMap('projects').toJSON()).not.toHaveProperty('slug');
  });

  it('never lowers the version and rejects unordered steps', () => {
    expect(() => migrateDoc(seeded(), 'x', [addMarker, addSlug])).toThrow(/must increase/);
  });
});

describe('concurrent migration under sync', () => {
  it('two devices migrating the same document converge', () => {
    const { a, b } = migrationConverges(seeded(), [addSlug, addMarker]);
    expect(a).toEqual(b);
    const tags = (a as { tags: Record<string, unknown> }).tags;
    expect(Object.keys(tags)).toEqual(['derived-tag-id']);
    expect((a as { meta: { schema_version: number } }).meta.schema_version).toBe(3);
  });

  it('converges when one device migrated before the other edited', () => {
    const base = seeded();
    const update = Y.encodeStateAsUpdate(base);
    const a = new Y.Doc();
    const b = new Y.Doc();
    Y.applyUpdate(a, update);
    Y.applyUpdate(b, update);
    migrateDoc(a, 'x', [addSlug]);
    createRecord(b, 'projects', { name: 'Gamma', deleted: false });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(json(a)).toEqual(json(b));
    // The record made on the other device has no slug yet; migrating again fills it, idempotently.
    const stale: DocMigration = { ...addSlug, version: 3 };
    migrateDoc(a, 'x', [addSlug, stale]);
    migrateDoc(b, 'x', [addSlug, stale]);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(json(a)).toEqual(json(b));
  });

  it('a step that copies another document keeps converging (account id move, #255)', () => {
    const old = seeded();
    const oldState = Y.encodeStateAsUpdate(old);
    const copy: DocMigration = {
      id: 'copy-from-old',
      version: 2,
      run(doc) {
        Y.applyUpdate(doc, oldState);
        collection(doc, 'projects');
      },
    };
    const { a, b } = migrationConverges(new Y.Doc(), [copy]);
    expect(a).toEqual(b);
    expect(Object.keys((a as { projects: object }).projects)).toHaveLength(2);
  });

  it('a device that migrated does not undo a higher version arriving by sync', () => {
    const a = seeded();
    const b = seeded();
    migrateDoc(b, 'x', [addSlug, { id: 'v5', version: 5, run: () => {} }]);
    migrateDoc(a, 'x', [addSlug]);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    // Whichever `schema_version` write won, the marks keep the higher version on both.
    expect(docVersion(a)).toBe(5);
    expect(docVersion(b)).toBe(5);
  });
});

describe('newer-version guard', () => {
  it('fires for a version that arrives later', () => {
    const doc = new Y.Doc();
    const seen: number[] = [];
    watchTooNew(doc, (v) => seen.push(v), 2);
    const remote = new Y.Doc();
    remote.getMap('meta').set('schema_version', 3);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
    expect(seen).toEqual([3]);
  });

  it('the store marks a too-new document', async () => {
    const store = new DocumentStore((_n, doc) => {
      doc.getMap('meta').set('schema_version', 99);
      return { whenLoaded: Promise.resolve(), destroy: async () => {} };
    });
    const seen: string[] = [];
    store.onTooNew((id) => seen.push(id));
    await store.open('space/x');
    expect(store.isTooNew('space/x')).toBe(true);
    expect(seen).toEqual(['space/x']);
  });
});

describe('runSteps (device-local scope)', () => {
  it('runs async steps in order and persists the version after each', async () => {
    let version = 0;
    const order: number[] = [];
    const steps = [1, 2, 3].map((v) => ({ id: `s${v}`, version: v, run: async () => void order.push(v) }));
    const r = await runSteps(null, steps, { read: () => version, write: (v) => (version = v) }, () => {}, 0);
    expect(order).toEqual([1, 2, 3]);
    expect(version).toBe(3);
    expect(r.status).toBe('migrated');
    expect((await runSteps(null, steps, { read: () => version, write: (v) => (version = v) }, () => {}, 0)).status).toBe('current');
  });

  it('resumes after a failed step and reports newer data', async () => {
    let version = 0;
    let fail = true;
    const steps = [
      { id: 'a', version: 1, run: () => {} },
      { id: 'b', version: 2, run: () => { if (fail) throw new Error('boom'); } },
    ];
    const store = { read: () => version, write: (v: number) => (version = v) };
    await expect(runSteps(null, steps, store, () => {}, 0)).rejects.toThrow('boom');
    expect(version).toBe(1);
    fail = false;
    expect((await runSteps(null, steps, store, () => {}, 0)).ran).toEqual(['b']);
    version = 7;
    expect((await runSteps(null, steps, store, () => {}, 0)).status).toBe('too-new');
  });
});
