import { useEffect } from 'preact/hooks';
import { useApp } from '../app/context';
import { addNotice } from '../core/notices';
import { buildIndex, notesMap } from './note-store';
import { pathConflicts } from './paths';

/** Always mounted (a global): tells the user when a merge left two notes on one path. */
export function NoticeWatch() {
  const { spaceDocs, spaces } = useApp();
  useEffect(() => {
    const cleanups: (() => void)[] = [];
    for (const [spaceId, doc] of spaceDocs) {
      let pending: ReturnType<typeof setTimeout> | undefined;
      const check = (): void => {
        const index = buildIndex(doc);
        const space = spaces.find((s) => s.id === spaceId)?.name ?? 'a space';
        for (const ids of pathConflicts(index.notes).values()) {
          const sorted = [...ids].sort();
          const first = index.byId.get(sorted[0] as string);
          addNotice({
            key: `path-conflict:${spaceId}:${sorted.join(',')}`,
            kind: 'path-conflict',
            text: `${ids.length} notes share the path ${first?.path ?? ''} in ${space}. Rename one so they can be told apart.`,
            spaceId,
            noteId: sorted[0],
          });
        }
      };
      const schedule = (): void => {
        clearTimeout(pending);
        pending = setTimeout(check, 500);
      };
      const map = notesMap(doc);
      map.observeDeep(schedule);
      schedule();
      cleanups.push(() => {
        clearTimeout(pending);
        map.unobserveDeep(schedule);
      });
    }
    return () => cleanups.forEach((c) => c());
  }, [spaceDocs]);
  return null;
}
