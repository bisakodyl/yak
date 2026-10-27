import { keepMine } from '../core/conflicts';
import { useApp } from '../app/context';
import { useNotices } from '../app/hooks';
import { Button, toast } from '../app/ui';
import { dismissAllNotices, dismissNotice, type Notice } from '../core/notices';

/** Merges worth a look, kept on this device until dismissed. Shows nothing when the list is empty. */
export function NoticesPanel() {
  const { bus, spaceDocs, privateDocs } = useApp();
  const keep = (n: Notice): void => {
    const c = n.conflict;
    const doc = c && n.spaceId ? (c.part === 'private' ? privateDocs : spaceDocs).get(n.spaceId) : undefined;
    if (c && doc && !keepMine(doc, c)) toast('That field has changed again since, so it was left as it is.');
    dismissNotice(n.key);
  };
  const list = useNotices();
  if (list.length === 0) return null;
  return (
    <div class="notice notices-panel" role="status" aria-label="Merges worth a look">
      <p>
        <strong>Merges worth a look.</strong> Syncing combined changes from your devices in ways you may not expect.
      </p>
      <ul class="notice-list">
        {list.map((n) => (
          <li key={n.key}>
            <span>{n.text}</span> <small class="hint">{new Date(n.at).toLocaleString()}</small>
            <span class="row">
              {n.kind === 'path-conflict' && n.spaceId && n.noteId && (
                <Button onClick={() => bus.emit('notes:open', { spaceId: n.spaceId as string, noteId: n.noteId as string })}>Open note</Button>
              )}
              {n.kind === 'field-conflict' && <Button onClick={() => keep(n)}>Keep mine</Button>}
              <Button onClick={() => dismissNotice(n.key)}>{n.kind === 'field-conflict' ? 'Keep theirs' : 'Dismiss'}</Button>
            </span>
          </li>
        ))}
      </ul>
      {list.length > 1 && <Button onClick={dismissAllNotices}>Dismiss all</Button>}
    </div>
  );
}
