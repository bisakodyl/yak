import { useEffect, useState } from 'preact/hooks';
import { useApp } from './context';

const FILTER_KEY = 'app-space-filter';
const EVENT = 'app:space-filter';

function read(): string {
  try {
    return localStorage.getItem(FILTER_KEY) ?? 'all';
  } catch {
    return 'all';
  }
}

/**
 * "all", or the id of the one space the Timer, Week, Reports and Organize pages show: one control for all of them (R-335).
 * Remembered on this device only. Every user of the hook re-renders when any of them changes it, so the control in the
 * page header and the view below it never disagree. A stale id (a space this device no longer keeps) is the caller's to treat as "all".
 */
export function useSpaceFilter(): [string, (id: string) => void] {
  const [filter, set] = useState(read);
  useEffect(() => {
    const sync = (): void => set(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    sync(); // a change made between the first render and this effect
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const setFilter = (id: string): void => {
    set(id);
    try {
      localStorage.setItem(FILTER_KEY, id);
    } catch {
      // ignore: the choice then lasts until the page reloads
    }
    window.dispatchEvent(new CustomEvent(EVENT));
  };
  return [filter, setFilter];
}

/** The space filter select; nothing when this device keeps fewer than two spaces. */
export function SpaceFilter() {
  const { spaces } = useApp();
  const [stored, setFilter] = useSpaceFilter();
  if (spaces.length < 2) return null;
  const filter = spaces.some((s) => s.id === stored) ? stored : 'all';
  return (
    <select class="space-filter" aria-label="Show space" value={filter} onChange={(e) => setFilter((e.target as HTMLSelectElement).value)}>
      <option value="all">All spaces</option>
      {spaces.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
