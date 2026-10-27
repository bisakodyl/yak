import { registerSearchSource } from '../app/search-sources';
import { bus } from '../core/bus';
import { buildIndex } from './note-store';
import { isTaskProps } from './tasks';
import { frontMatterTags } from './links';

/** Notes and tasks (a task is a note with task front matter) for the universal search. */
registerSearchSource({
  id: 'notes',
  collect(app, spaceId) {
    const doc = app.spaceDocs.get(spaceId);
    if (!doc) return [];
    return buildIndex(doc).notes.map((n) => ({
      kind: isTaskProps(n.parsed.properties) ? 'task' : 'note',
      spaceId,
      id: n.id,
      title: n.title,
      names: [n.path, ...frontMatterTags(n.parsed.properties.aliases)],
      text: n.text,
      tags: n.tags,
      open: () => bus.emit('notes:open', { spaceId, noteId: n.id }),
    }));
  },
});
