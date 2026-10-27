import { Page, PageHeader } from '../app/ui';
import { FilesCard } from './FilesCard';
import { LinksCard } from './LinksCard';
import { PeriodicNotesTable } from './DailyCard';
import { lazyView } from '../app/lazy';
import { Sections } from '../app/views/Sections';

// Loaded when Notes opens: the list of unused files is not needed to start the app.
const UnusedFiles = lazyView(() => import('./UnusedFiles').then((m) => ({ default: m.UnusedFiles })));

export function NotesSettings() {
  return (
    <Page width="settings" class="st">
      <PageHeader title="Note settings" />
      <p class="hint">
        <a href="#/notes">← Notes</a>
      </p>
      <h2>Links</h2>
      <LinksCard />

      <h2>Files</h2>
      <FilesCard />
      <h3>Unused files</h3>
      <p class="hint">Files that no note refers to. Yak never deletes a file by itself: removing a link from a note keeps the file, and you delete it here.</p>
      <UnusedFiles params={[]} />

      <h2>Daily, weekly and monthly notes</h2>
      <PeriodicNotesTable />

      <Sections page="note-settings" />
    </Page>
  );
}
