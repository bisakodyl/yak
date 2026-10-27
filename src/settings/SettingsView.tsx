import { Page, PageHeader } from '../app/ui';
import { AboutCard } from './AboutCard';
import { DataCard } from './DataCard';
import { PreferencesCard } from './PreferencesCard';

/**
 * Settings (F-326): one scrolling page, no sub-menu. Your data (spaces × devices, with status lines),
 * Preferences, About & help; two columns on a wide screen. Detail views exist only for things: a device,
 * a space, Backup & restore.
 */
export function SettingsView() {
  return (
    <Page width="wide" class="st st-home">
      <PageHeader title="Settings" hideTitle />
      <div class="st-columns">
        <div class="st-col">
          <DataCard />
        </div>
        <div class="st-col">
          <PreferencesCard />
          <AboutCard />
        </div>
      </div>
    </Page>
  );
}
