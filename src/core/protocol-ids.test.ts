import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import * as ids from './protocol-ids';

it('pins every wire id', () => {
  const { LEGACY, FROM_EARLIER_VERSION, ...current } = ids;
  expect(current).toEqual({
    ACCOUNT_ID_INFO: 'yak/v1/account',
    PAIRING_SALT: 'yak-pairing-v1',
    PAIRING_TOPIC_INFO: 'yak/v1/topic',
    PAIRING_KEY_INFO: 'yak/v1/key',
    TOPIC_PREFIX: 'yk-',
    ENVELOPE_PREFIX: 'yak/',
    RELAY_PAIR_DIGEST: 'yak/v1:pair:',
    RELAY_CONTEXT_PREFIX: 'yak/v1:',
    SIGNAL_SIGNATURE_LABEL: 'yak/v1/signal',
    PAIR_KEY_INFO: 'yak/v1/pair-key:',
    INVITE_TOPIC_INFO: 'yak/v1/invite-topic',
    INVITE_KEY_INFO: 'yak/v1/invite-key',
    INVITE_ENVELOPE: 'yak/v1/invite:',
    INVITE_COMPARE_LABEL: 'yak/v1/invite-compare',
    SHARE_TOPIC_INFO: 'yak/v1/share-topic',
    SHARE_KEY_INFO: 'yak/v1/share-key',
    SHARE_ENVELOPE: 'yak/v1/share:',
    SHARE_COMPARE_LABEL: 'yak/v1/share-compare',
    RELAY_SERVICE: 'yak-relay',
    DATA_CHANNEL_LABEL: 'yak-sync',
    BACKUP_CHECK_LABEL: 'yak-backup-check',
    QR_PREFIX: 'yak:pair?',
    SYNC_CODE_PREFIX: 'yk1.',
    SETTINGS_KIND: 'yak-settings',
    PLUGIN_STORAGE_PREFIX: 'yak-sync',
  });
  expect(LEGACY.qrPrefix).not.toBe(ids.QR_PREFIX);
  expect(FROM_EARLIER_VERSION).toContain('earlier test version');
});

it('the relay and its mock use the same ids', () => {
  for (const file of ['../../worker/index.ts', '../../scripts/mock-relay.mjs']) {
    expect(readFileSync(new URL(file, import.meta.url), 'utf8')).toContain(`/^${ids.TOPIC_PREFIX}[0-9a-f]{32}$/`);
  }
  expect(readFileSync(new URL('../../worker/index.ts', import.meta.url), 'utf8')).toContain(`service: '${ids.RELAY_SERVICE}'`);
});
