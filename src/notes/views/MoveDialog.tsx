import { useEffect, useState } from 'preact/hooks';
import { Dialog } from '../../app/ui';

export interface MoveDialogProps {
  /** What is moved, for the title: "Acme website" or "Projects". */
  name: string;
  /** Spaces to move to, when there are several; the first pick is `spaceId`. */
  spaces: readonly { id: string; name: string }[];
  spaceId: string;
  /** Folders of a space the item may go into. */
  foldersFor(spaceId: string): readonly string[];
  /** The folder it is in now, marked in the list (in its own space). */
  current: string;
  onMove(spaceId: string, folder: string): void;
  onClose(): void;
}

/**
 * "Move to…": pick a space (when there are several) and a folder, or type a new folder path. The
 * keyboard and touch alternative to dragging in the file tree.
 */
export function MoveDialog(p: MoveDialogProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [target, setTarget] = useState(p.spaceId);
  const folders = p.foldersFor(target);
  const q = query.trim().toLowerCase();
  const options = ['', ...folders].filter((f) => !q || f.toLowerCase().includes(q));
  const typed = query.trim().replace(/^\/+|\/+$/g, '');
  const isNew = typed !== '' && !folders.some((f) => f.toLowerCase() === typed.toLowerCase());

  useEffect(() => setActive(0), [query, target]);

  const choose = (folder: string): void => {
    p.onMove(target, folder);
    p.onClose();
  };
  const label = (f: string): string => (f === '' ? 'Top level' : f);

  return (
    <Dialog class="switcher move-dialog" label={`Move ${p.name}`} onClose={p.onClose}>
      <p class="move-title">Move “{p.name}” to…</p>
      {p.spaces.length > 1 && (
        <label class="move-space">
          Space{' '}
          <select aria-label="Space" value={target} onChange={(e) => setTarget((e.target as HTMLSelectElement).value)}>
            {p.spaces.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <input
        class="switcher-input"
        aria-label="Folder"
        placeholder="Find a folder, or type a new one"
        value={query}
        autoFocus
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          const count = options.length + (isNew ? 1 : 0);
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, Math.max(count - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (active < options.length) choose(options[active] ?? '');
            else if (isNew) choose(typed);
          }
        }}
      />
      <ul role="listbox" class="switcher-list" aria-label="Folders">
        {options.map((f, i) => (
          <li
            key={f || '/'}
            role="option"
            aria-selected={i === active}
            class={i === active ? 'active' : ''}
            onMouseDown={(e) => {
              e.preventDefault();
              choose(f);
            }}
          >
            <span>{label(f)}</span>
            {target === p.spaceId && f.toLowerCase() === p.current.toLowerCase() && <span class="switcher-path">current</span>}
          </li>
        ))}
        {isNew && (
          <li
            role="option"
            aria-selected={active === options.length}
            class={active === options.length ? 'active' : ''}
            onMouseDown={(e) => {
              e.preventDefault();
              choose(typed);
            }}
          >
            New folder “{typed}”
          </li>
        )}
      </ul>
      <p class="hint">↑ ↓ to choose, Enter to move, Esc to cancel</p>
    </Dialog>
  );
}
