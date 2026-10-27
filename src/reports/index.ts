import { registerView } from '../app/registry';
import './reports.css';
import { lazyView } from '../app/lazy';

registerView({ id: 'reports', title: 'Reports', path: 'reports', order: 30, joins: 'timer', component: lazyView(() => import('./ReportsView').then((m) => ({ default: m.ReportsView }))) });
