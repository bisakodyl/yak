import { useEffect, useMemo, useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { Button, Dialog, toast } from '../../app/ui';
import { spaceDocId } from '../../core/doc-store';
import { uuid } from '../../core/ids';
import { lineDiff } from '../../core/history/diff';
import { historyStore } from '../../core/history/store';
import { minimalEdit, type NoteVersion, noteVersions } from '../../core/history/travel';
import { applyTextEdit } from '../note-store';

const when = (ms: number): string => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const preview = (text: string): string => (text.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n').find((l) => l.trim()) ?? '(empty)').slice(0, 60);

export interface NoteHistoryProps {
  spaceId: string;
  noteId: string;
  title: string;
  ytext: Y.Text;
  onClose(): void;
}

/** Earlier texts of a note, from this device's change log and the versions you named; restore one as a small edit. */
export function NoteHistory({ spaceId, noteId, title, ytext, onClose }: NoteHistoryProps) {
  const docId = spaceDocId(spaceId);
  const [versions, setVersions] = useState<NoteVersion[] | null>(null);
  const [picked, setPicked] = useState(0);
  const [name, setName] = useState('');
  const [reload, setReload] = useState(0);
  const current = ytext.toString();

  useEffect(() => {
    let live = true;
    void (async () => {
      const logged = noteVersions(await historyStore.list(docId), noteId);
      const named: NoteVersion[] = (await historyStore.marks(docId, noteId)).map((m) => ({ at: m.at, text: m.text, name: m.name, markId: m.id }));
      const all = [...logged, ...named].sort((a, b) => b.at - a.at);
      if (live) {
        setVersions(all);
        setPicked(0);
      }
    })();
    return () => {
      live = false;
    };
  }, [docId, noteId, reload]);

  const shown = versions?.[picked];
  const diff = useMemo(() => (shown ? lineDiff(shown.text, current) : []), [shown, current]);

  const restore = (v: NoteVersion): void => {
    const edit = minimalEdit(ytext.toString(), v.text);
    ytext.doc?.transact(() => applyTextEdit(ytext, edit));
    toast(`Restored the version from ${when(v.at)}.`);
    onClose();
  };
  const saveName = async (): Promise<void> => {
    const n = name.trim();
    if (!n) return;
    await historyStore.addMark({ id: uuid(), docId, noteId, name: n, at: Date.now(), text: ytext.toString() });
    setName('');
    setReload(reload + 1);
  };

  return (
    <Dialog class="switcher note-history" label={`History of ${title}`} onClose={onClose}>
      <h2>History of “{title}”</h2>
      <div class="row nh-name">
        <input aria-label="Name for this version" placeholder="Name the current text, for example “Before the rewrite”" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        <Button onClick={() => void saveName()} disabled={!name.trim()}>
          Save named version
        </Button>
      </div>
      {versions === null ? (
        <p class="empty">Reading the log…</p>
      ) : versions.length === 0 ? (
        <p class="empty nh-none">No earlier versions yet. This device records changes from when it first opened this space.</p>
      ) : (
        <div class="nh-body">
          <ul class="nh-list" aria-label="Versions">
            {versions.map((v, i) => (
              <li key={`${v.at}-${v.markId ?? i}`}>
                <button type="button" class={i === picked ? 'active' : ''} aria-current={i === picked} onClick={() => setPicked(i)}>
                  <span class="nh-when">{when(v.at)}</span>
                  {v.name && <strong class="nh-badge">{v.name}</strong>}
                  <span class="muted">{v.text === current ? 'same as now' : preview(v.text)}</span>
                </button>
              </li>
            ))}
          </ul>
          {shown && (
            <div class="nh-diff">
              <pre aria-label="Changes since this version">
                {diff.map((l, i) => (
                  <div key={i} class={`nh-${l.kind}`}>
                    {l.kind === 'added' ? '+ ' : l.kind === 'removed' ? '- ' : '  '}
                    {l.text}
                  </div>
                ))}
              </pre>
              <p class="hint">Green lines were added since this version, red lines were removed.</p>
              <div class="row">
                <Button variant="primary" disabled={shown.text === current} onClick={() => restore(shown)}>
                  Restore this version
                </Button>
                {shown.markId && (
                  <Button
                    onClick={() => {
                      void historyStore.removeMark(shown.markId as string).then(() => setReload(reload + 1));
                    }}
                  >
                    Remove this name
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      <div class="row">
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}
