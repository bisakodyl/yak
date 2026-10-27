import * as Y from 'yjs';

/**
 * Data migrations (F39, docs/architecture.md). One ordered list per scope; each step has an id and
 * the version it brings the data to. A scope's version is stored with the data and a step runs once.
 *
 * Synced documents: the version is `meta.schema_version`. Two devices may migrate the same document
 * at the same time and their edits merge, so a step must be deterministic and idempotent:
 * - set fields to values computed from the data (the same on every device), never `Date.now()`, random ids or counters;
 * - a record a step creates gets an id derived from the data it comes from (a hash), never a fresh UUID,
 *   and is created whole in one `set` (two concurrent `set`s of one key keep one value, which is then identical);
 * - when a step moves data to another document (#255), it copies the old document's Yjs state with
 *   `Y.applyUpdate`: updates carry their own ids, so two devices copying the same state converge.
 * - a step also runs on a document that is still empty (a joining device, before sync brings the data), so it must cope with missing records.
 * A step that breaks these rules breaks convergence between devices; `migrationConverges` checks it.
 */

export interface MigrationStep<T> {
  /** Stable name, shown in the debug log. */
  id: string;
  /** The version the data has after this step; strictly increasing along the list. */
  version: number;
  run(target: T): void | Promise<void>;
}

export type MigrationLog = (step: string, detail: string) => void;

export interface MigrationResult {
  /** `current` nothing to do, `migrated` steps ran, `too-new` the data is newer than this app: do not write to it. */
  status: 'current' | 'migrated' | 'too-new';
  from: number;
  to: number;
  ran: string[];
}

/** The newest version the steps lead to (`base` when there are none). */
function latestVersion(steps: readonly MigrationStep<unknown>[], base = 1): number {
  return steps.reduce((v, s) => Math.max(v, s.version), base);
}

function checkOrder(steps: readonly MigrationStep<unknown>[]): void {
  steps.forEach((s, i) => {
    const prev = steps[i - 1];
    if (prev && s.version <= prev.version) throw new Error(`Migration ${s.id}: version must increase`);
  });
}

/**
 * Run the steps newer than `from`, in order. `store.write` is called after each step, so a failed
 * step leaves the version at the last good one and runs again next start.
 */
export async function runSteps<T>(
  target: T,
  steps: readonly MigrationStep<T>[],
  store: { read(): number; write(version: number): void },
  log: MigrationLog = () => {},
  base = 1,
): Promise<MigrationResult> {
  checkOrder(steps);
  const from = store.read();
  const latest = latestVersion(steps, base);
  if (from > latest) return { status: 'too-new', from, to: from, ran: [] };
  const ran: string[] = [];
  let at = from;
  for (const step of steps) {
    if (step.version <= at) continue;
    await step.run(target);
    store.write(step.version);
    at = step.version;
    ran.push(step.id);
    log(step.id, `migrated to version ${step.version}`);
  }
  return { status: ran.length ? 'migrated' : 'current', from, to: at, ran };
}

/** Steps over a synced document. `applies` limits a step to some documents (by id). */
export interface DocMigration extends MigrationStep<Y.Doc> {
  applies?(docId: string): boolean;
  /** The version is written by a feature, never by this step; new documents do not start at it. */
  declared?: true;
}

/**
 * An account document that requires device keys (#257) is version 2. The switch writes it
 * (`requireKeys`), not a migration: this step applies to no document and only declares the version,
 * so this build reads such a document while older builds stop syncing it and say to update.
 */
export const KEYS_REQUIRED_DOC_VERSION = 2;

/** Steps for synced documents. Add new steps at the end. */
const DOC_MIGRATIONS: readonly DocMigration[] = [{ id: 'keys-required', version: KEYS_REQUIRED_DOC_VERSION, applies: () => false, declared: true, run() {} }];

/**
 * A document's version is the highest of `schema_version` and the `migrated:<n>` marks. Two devices
 * writing `schema_version` concurrently keep only one value, possibly the lower; the marks are
 * distinct keys, so none is lost and the version never goes down.
 */
export function docVersion(doc: Y.Doc): number {
  let version = 1;
  // Reading must not create the type: an untouched document stays empty (a refused backup merge relies on it).
  if (!doc.share.has('meta')) return version;
  doc.getMap<unknown>('meta').forEach((v, k) => {
    if (k === 'schema_version' && typeof v === 'number') version = Math.max(version, v);
    else if (k.startsWith(MARK) && v === true) version = Math.max(version, Number(k.slice(MARK.length)) || 1);
  });
  return version;
}

const MARK = 'migrated:';

/** Newest document version this build understands. */
export const SUPPORTED_DOC_VERSION = latestVersion(DOC_MIGRATIONS);

/** The version a new document starts at: the newest a step brings documents to, not one only a feature writes. */
export const NEW_DOC_VERSION = latestVersion(DOC_MIGRATIONS.filter((s) => !s.declared));

/**
 * Migrate a loaded document, synchronously inside one transaction per step. The version is only
 * ever raised, so a concurrent writer of a higher version is never undone.
 */
export function migrateDoc(doc: Y.Doc, docId: string, steps: readonly DocMigration[] = DOC_MIGRATIONS, log: MigrationLog = () => {}): MigrationResult {
  checkOrder(steps);
  const from = docVersion(doc);
  const latest = latestVersion(steps);
  if (from > latest) return { status: 'too-new', from, to: from, ran: [] };
  const ran: string[] = [];
  let at = from;
  for (const step of steps) {
    if (step.version <= at) continue;
    if (step.applies && !step.applies(docId)) continue;
    doc.transact(() => {
      const r = step.run(doc);
      if (r instanceof Promise) throw new Error(`Migration ${step.id}: document steps must be synchronous`);
      const meta = doc.getMap<unknown>('meta');
      if (docVersion(doc) < step.version) meta.set('schema_version', step.version);
      meta.set(`${MARK}${step.version}`, true);
    });
    at = step.version;
    ran.push(step.id);
    log(step.id, `${docId} migrated to version ${step.version}`);
  }
  return { status: ran.length ? 'migrated' : 'current', from, to: at, ran };
}

/**
 * Call `onTooNew` when the document is, or becomes (a newer device's version arrives by sync),
 * newer than this build understands. Returns a function that stops watching.
 */
export function watchTooNew(doc: Y.Doc, onTooNew: (version: number) => void, supported = SUPPORTED_DOC_VERSION): () => void {
  const check = (): void => {
    const v = docVersion(doc);
    if (v > supported) onTooNew(v);
  };
  check();
  // `meta` may not exist yet (a joining device), so watch transactions instead of the map; the map is a few keys.
  doc.on('afterTransaction', check);
  return () => doc.off('afterTransaction', check);
}

/**
 * Test helper: two devices holding the same document migrate separately, then merge. Returns the
 * JSON of both merged documents; equal when the steps are safe under sync.
 */
export function migrationConverges(base: Y.Doc, steps: readonly DocMigration[], docId = 'space/x'): { a: unknown; b: unknown } {
  const update = Y.encodeStateAsUpdate(base);
  const a = new Y.Doc();
  const b = new Y.Doc();
  Y.applyUpdate(a, update);
  Y.applyUpdate(b, update);
  migrateDoc(a, docId, steps);
  migrateDoc(b, docId, steps);
  const ua = Y.encodeStateAsUpdate(a);
  const ub = Y.encodeStateAsUpdate(b);
  Y.applyUpdate(a, ub);
  Y.applyUpdate(b, ua);
  return { a: a.toJSON(), b: b.toJSON() };
}

export interface DeviceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Steps for device-local stores (`localStorage`, IndexedDB outside the documents). Empty for now; add new steps at the end. */
const DEVICE_MIGRATIONS: readonly MigrationStep<DeviceStorage>[] = [];

const DEVICE_VERSION_KEY = 'app-device-schema';

/** Run the device-local steps once per start, before the documents open. Version 0 is a device that never recorded one. */
export function migrateDevice(storage: DeviceStorage, steps: readonly MigrationStep<DeviceStorage>[] = DEVICE_MIGRATIONS, log: MigrationLog = () => {}): Promise<MigrationResult> {
  return runSteps(
    storage,
    steps,
    {
      read: () => Number(storage.getItem(DEVICE_VERSION_KEY)) || 0,
      write: (v) => storage.setItem(DEVICE_VERSION_KEY, String(v)),
    },
    log,
    0,
  );
}
