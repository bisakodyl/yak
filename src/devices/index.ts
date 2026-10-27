import { registerView } from '../app/registry';
import './devices.css';
import { lazyView } from '../app/lazy';

registerView({ id: 'devices', title: 'Devices', path: 'devices', order: 90, group: 'settings', component: lazyView(() => import('./DevicesView').then((m) => ({ default: m.DevicesView }))) });
registerView({ id: 'network', title: 'Network stats', path: 'network', order: 91, group: 'settings', hidden: true, component: lazyView(() => import('./NetworkStatsView').then((m) => ({ default: m.NetworkStatsView }))) });
