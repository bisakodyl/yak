import { accountOfDoc, readSpaces } from './account';
import type { DocumentStore } from './doc-store';

/**
 * Test hooks only (`?test`): browser tests name documents by the first layout's fixed ids
 * (`space/personal`, `space/work/time`). Translate them to the account's spaces by name, and back,
 * so the suites keep working while spaces have random ids. Never used by the app itself.
 */

function spacesByName(store: DocumentStore): Map<string, string> {
  for (const [id, doc] of store.opened()) {
    if (!accountOfDoc(id)) continue;
    const spaces = readSpaces(doc);
    if (spaces.length) return new Map(spaces.map((s) => [s.storedName.toLowerCase(), s.id]));
  }
  return new Map();
}

/** `space/personal` → `space/<id>`, `space/work/time` → `space/<id>/private`; other ids unchanged. */
export function testDocId(store: DocumentStore, id: string): string {
  const m = /^space\/([a-z]+)(?:\/(time|private))?$/.exec(id);
  if (!m) return id;
  const real = spacesByName(store).get(m[1] ?? '');
  if (!real) return id;
  return m[2] ? `space/${real}/private` : `space/${real}`;
}

/** `space/<id>` → `space/personal`, `space/<id>/private` → `space/personal/time`: the inverse, for dumps. */
export function friendlyDocId(store: DocumentStore, id: string): string {
  const names = new Map([...spacesByName(store)].map(([name, sid]) => [sid, name]));
  const m = /^space\/([a-f0-9]{24})(\/private)?$/.exec(id);
  const name = m ? names.get(m[1] ?? '') : undefined;
  if (!m || !name) return id;
  return m[2] ? `space/${name}/time` : `space/${name}`;
}
