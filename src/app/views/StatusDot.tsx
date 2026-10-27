import type { LinkState } from '../../sync/types';

const DOT: Record<LinkState, string> = {
  stopped: 'off',
  'waiting-for-peer': 'wait',
  connecting: 'busy',
  connected: 'on',
  reconnecting: 'busy',
};

export function StatusDot({ state }: { state: LinkState }) {
  return <span class={`dot ${DOT[state]}`} aria-hidden="true" />;
}
