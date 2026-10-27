import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { bookmarks, isBookmarked, setBookmark } from './bookmarks';

describe('bookmarks', () => {
  it('sets, lists and removes', () => {
    const account = new Y.Doc();
    setBookmark(account, 's1', 'n1', true);
    setBookmark(account, 's2', 'n2', true);
    expect(isBookmarked(account, 's1', 'n1')).toBe(true);
    expect(bookmarks(account)).toEqual(expect.arrayContaining([{ spaceId: 's1', noteId: 'n1' }, { spaceId: 's2', noteId: 'n2' }]));
    setBookmark(account, 's1', 'n1', false);
    expect(isBookmarked(account, 's1', 'n1')).toBe(false);
    expect(bookmarks(account)).toEqual([{ spaceId: 's2', noteId: 'n2' }]);
  });
});
