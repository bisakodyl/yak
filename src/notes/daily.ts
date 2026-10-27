import type { AppContextValue } from '../app/context';
import { expandTemplate, formatDate, readPeriodic, type PeriodKind } from '../core/templates';
import { buildIndex, createNote, newNoteText } from './note-store';
import { joinPath, noteTitle, normalizePath, pathKey } from './paths';

/**
 * Open the day's, week's or month's note in the space new items go to, making it first when it does
 * not exist: from the template note (`Templates/Daily` by default) with its variables filled in, or
 * empty with a creation date. Folder, name format and template path are settings, per kind.
 */
export function openPeriodNote(app: Pick<AppContextValue, 'doc' | 'spaceId' | 'account' | 'bus'>, kind: PeriodKind, now: Date = new Date()): string {
  const daily = readPeriodic(app.account, kind);
  const path = normalizePath(joinPath(daily.folder.trim(), formatDate(now, daily.format)));
  const index = buildIndex(app.doc);
  let id = index.notes.find((n) => pathKey(n.path) === pathKey(path))?.id;
  if (!id) {
    const templatePath = daily.template.trim() ? pathKey(daily.template) : '';
    const template = templatePath ? index.notes.find((n) => pathKey(n.path) === templatePath) : undefined;
    const body = template ? expandTemplate(template.text, { now, title: noteTitle(path) }) : newNoteText(now);
    id = createNote(app.doc, path, body);
  }
  app.bus.emit('notes:open', { spaceId: app.spaceId, noteId: id });
  return id;
}


export const openTodaysNote = (app: Pick<AppContextValue, 'doc' | 'spaceId' | 'account' | 'bus'>, now: Date = new Date()): string => openPeriodNote(app, 'daily', now);
