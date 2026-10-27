import { registerTagSource } from '../app/tag-sources';
import { bus } from '../core/bus';
import { buildIndex, rewriteNoteTags } from './note-store';

/** `task` marks a note as a task; renaming or removing it would turn tasks into plain notes. */
const RESERVED = 'task';

/** Notes and tasks as a place tags live (front matter and inline `#tags`), for the tag manager. */
registerTagSource({
  id: 'notes',
  singular: 'note',
  plural: 'notes',
  docs: (app, spaceId) => [app.spaceDocs.get(spaceId)].filter((d) => d !== undefined),
  tags(app, spaceId) {
    const out = new Map<string, { name: string; count: number }>();
    const doc = app.spaceDocs.get(spaceId);
    if (!doc) return out;
    for (const note of buildIndex(doc).notes) {
      for (const t of note.tags) {
        const key = t.toLowerCase();
        if (key === RESERVED) continue;
        const hit = out.get(key);
        if (hit) hit.count++;
        else out.set(key, { name: t, count: 1 });
      }
    }
    return out;
  },
  items(app, spaceId, tag) {
    const doc = app.spaceDocs.get(spaceId);
    if (!doc) return [];
    const lower = tag.toLowerCase();
    return buildIndex(doc)
      .notes.filter((n) => n.tags.some((t) => t.toLowerCase() === lower))
      .map((n) => ({ id: n.id, label: n.path, open: () => bus.emit('notes:open', { spaceId, noteId: n.id }) }));
  },
  rename(app, spaceId, from, to) {
    const doc = app.spaceDocs.get(spaceId);
    return doc && from.toLowerCase() !== RESERVED ? rewriteNoteTags(doc, from, to.trim()) : 0;
  },
  remove(app, spaceId, tag) {
    const doc = app.spaceDocs.get(spaceId);
    return doc && tag.toLowerCase() !== RESERVED ? rewriteNoteTags(doc, tag, null) : 0;
  },
});
