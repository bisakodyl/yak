import { registerTagSource } from '../app/tag-sources';
import { collection } from '../core/schema';
import { deleteTag, renameTag, tagEntryCount, uniqueTagNames } from './catalog';
import { liveEntries } from './entries';

/** Time entries as a place tags live, for the tag manager. */
registerTagSource({
  id: 'entries',
  singular: 'entry',
  plural: 'entries',
  docs: (app, spaceId) => [app.spaceDocs.get(spaceId), app.privateDocs.get(spaceId)].filter((d) => d !== undefined),
  tags(app, spaceId) {
    const out = new Map<string, { name: string; count: number }>();
    const doc = app.spaceDocs.get(spaceId);
    const priv = app.privateDocs.get(spaceId);
    if (!doc || !priv) return out;
    for (const name of uniqueTagNames(doc)) out.set(name.toLowerCase(), { name, count: tagEntryCount(priv, name) });
    // Names on entries that have no tag record (older data) are listed too.
    collection(priv, 'time_entries').forEach((rec) => {
      const tags = rec.get('tags');
      if (rec.get('deleted') === true || !Array.isArray(tags)) return;
      for (const t of tags) if (typeof t === 'string' && !out.has(t.toLowerCase())) out.set(t.toLowerCase(), { name: t, count: tagEntryCount(priv, t) });
    });
    return out;
  },
  items(app, spaceId, tag) {
    const priv = app.privateDocs.get(spaceId);
    if (!priv) return [];
    const lower = tag.toLowerCase();
    return liveEntries(priv)
      .filter((e) => e.tags.some((t) => t.toLowerCase() === lower))
      .sort((a, b) => (a.start < b.start ? 1 : -1))
      .slice(0, 200)
      .map((e) => ({ id: e.id, label: `${e.description || '(no description)'} · ${new Date(e.start).toLocaleDateString()}` }));
  },
  rename(app, spaceId, from, to) {
    const doc = app.spaceDocs.get(spaceId);
    const priv = app.privateDocs.get(spaceId);
    return doc && priv ? renameTag(doc, from, to, priv) : 0;
  },
  remove(app, spaceId, tag) {
    const doc = app.spaceDocs.get(spaceId);
    const priv = app.privateDocs.get(spaceId);
    return doc && priv ? deleteTag(doc, tag, priv) : 0;
  },
});
