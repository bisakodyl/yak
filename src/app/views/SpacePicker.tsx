import { useApp } from '../context';

const ALL = 'all';

/**
 * Chooses the space a page (Notes, Tasks, Projects) shows; hidden while only one space is kept.
 * With `all` set the page can also show every kept space: pass the current choice and its setter.
 */
export function SpacePicker({ class: extra, all, onAll }: { class?: string; all?: boolean; onAll?(all: boolean): void }) {
  const { spaces, spaceId, setSpaceId } = useApp();
  if (spaces.length < 2) return null;
  const canAll = onAll !== undefined;
  return (
    <select
      class={`space-select ${extra ?? ''}`.trim()}
      aria-label="Space"
      value={canAll && all ? ALL : spaceId}
      onChange={(e) => {
        const v = (e.target as HTMLSelectElement).value;
        if (v === ALL) onAll?.(true);
        else {
          onAll?.(false);
          setSpaceId(v);
        }
      }}
    >
      {canAll && <option value={ALL}>All spaces</option>}
      {spaces.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
