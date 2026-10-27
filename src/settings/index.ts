import './settings.css';
import { registerView } from '../app/registry';
import { lazyView } from '../app/lazy';
import { NotesSettings } from './SectionViews';
import { applyTheme, readTheme } from './theme';

if (typeof document !== 'undefined') applyTheme(readTheme());

// Settings is one page (F-326); its path is the group's own name, so `#/settings` opens it. Things get detail views: a space here,
// a device in src/devices, Backup & restore in src/backup.
registerView({ id: 'settings', title: 'Settings', path: 'settings', order: 95, group: 'settings', component: lazyView(() => import('./SettingsView').then((m) => ({ default: m.SettingsView }))) });
registerView({ id: 'space', title: 'Space', path: 'space', order: 96, group: 'settings', hidden: true, component: lazyView(() => import('./SpaceView').then((m) => ({ default: m.SpaceView }))) });
registerView({ id: 'account', title: 'Account', path: 'account', order: 96, group: 'settings', hidden: true, component: lazyView(() => import('./AccountView').then((m) => ({ default: m.AccountView }))) });
// Note settings (links, files, daily notes, Mirror) belong to Notes: a ⚙ there opens this page, which is no Settings page.
registerView({ id: 'notes-settings', title: 'Note settings', path: 'note-settings', order: 97, hidden: true, component: NotesSettings });
