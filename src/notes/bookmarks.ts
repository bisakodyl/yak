import type * as Y from 'yjs';

/**
 * Bookmarked notes, in the account document's `bookmarks` map: key `<spaceId>:<noteId>`, plain
 * boolean value (`false` = removed), so two devices never lose each other's entry. A note moved to
 * another space gets a new id and loses its bookmark.
 */

const BOOKMARKS_MAP = 'bookmarks';

export function bookmarksMap(account: Y.Doc): Y.Map<boolean> {
  return account.getMap<boolean>(BOOKMARKS_MAP);
}

const key = (spaceId: string, noteId: string): string => `${spaceId}:${noteId}`;

export function isBookmarked(account: Y.Doc, spaceId: string, noteId: string): boolean {
  return bookmarksMap(account).get(key(spaceId, noteId)) === true;
}

export function setBookmark(account: Y.Doc, spaceId: string, noteId: string, on: boolean): void {
  bookmarksMap(account).set(key(spaceId, noteId), on);
}

/** Bookmarked `{ spaceId, noteId }` pairs. Space ids are hex, so the first `:` splits the key. */
export function bookmarks(account: Y.Doc): { spaceId: string; noteId: string }[] {
  const out: { spaceId: string; noteId: string }[] = [];
  bookmarksMap(account).forEach((on, k) => {
    const at = k.indexOf(':');
    if (on === true && at > 0) out.push({ spaceId: k.slice(0, at), noteId: k.slice(at + 1) });
  });
  return out;
}
