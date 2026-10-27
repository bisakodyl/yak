import type * as Y from 'yjs';
import { useApp } from '../app/context';
import { useYVersion } from '../app/hooks';
import { Field } from '../app/ui';
import { type LinkMode, readLinkMode, writeLinkMode } from '../notes/link-update';

/** What happens to links when a note is renamed or moved. */
export function LinksCard() {
  const { account } = useApp();
  useYVersion(account.getMap('settings') as Y.AbstractType<unknown>);
  return (
    <div class="card st-group">
      <Field layout="split" class="st-field" label="When a note is renamed or moved">
        <select aria-label="Links when a note moves" value={readLinkMode(account)} onChange={(e) => writeLinkMode(account, (e.target as HTMLSelectElement).value as LinkMode)}>
          <option value="auto">Fix the links that point at it (with Undo)</option>
          <option value="ask">Offer to fix them afterwards</option>
          <option value="off">Leave the links as they are</option>
        </select>
      </Field>
    </div>
  );
}
