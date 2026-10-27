import { Dialog } from '../../app/ui';
import { SHORTCUTS } from '../editor-commands';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The editor's keyboard shortcuts, from the same list the keymap is documented with. */
export function ShortcutsDialog({ onClose }: { onClose(): void }) {
  const keys = (k: string): string => (MAC ? k.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧') : k);
  return (
    <Dialog class="switcher shortcuts-dialog" label="Keyboard shortcuts" onClose={onClose}>
      <div class="shortcuts-head">
        <p class="move-title">Keyboard shortcuts{MAC ? '' : ' (⌘ instead of Ctrl on a Mac)'}</p>
      </div>
      <table class="shortcuts">
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.keys}>
              <td>
                <kbd>{keys(s.keys)}</kbd>
              </td>
              <td>{s.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
