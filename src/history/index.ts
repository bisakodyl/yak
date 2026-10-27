import './history.css';
import { registerBanner, registerGlobal } from '../app/registry';
import { HistoryBanner } from './HistoryBanner';
import { HistoryHost } from './HistoryHost';
import './test-hook';

registerGlobal({ id: 'history', component: HistoryHost });
registerBanner(HistoryBanner);
