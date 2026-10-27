import { describe, expect, it } from 'vitest';
import { STORAGE_PREFIX } from '../constants';
import { choicePin, clearDroppedKeys } from './account-keys-runtime';

const memory = () => {
  const m = new Map<string, string>();
  return { m, s: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } };
};

describe('stored data of dropped mechanisms (#295, F39)', () => {
  it('a pin left provisional by an older build is not followed: the document decides once', () => {
    const { s } = memory();
    const pin = { fingerprint: 'a'.repeat(32), sealed: false, ids: ['x'] };
    s.setItem(`${STORAGE_PREFIX}-account-chosen`, JSON.stringify({ ...pin, provisional: true, peerSince: 1 }));
    expect(choicePin(s).get()).toBeUndefined();
    choicePin(s).set(pin);
    expect(choicePin(s).get()).toEqual(pin);
  });

  it('empties the local keys of the epochs, old sync secrets and established space keys', () => {
    const { m, s } = memory();
    for (const k of ['account-epochs', 'mesh-secrets', 'epoch-seen', 'space-keys']) s.setItem(`${STORAGE_PREFIX}-${k}`, '{"x":1}');
    s.setItem(`${STORAGE_PREFIX}-account-chosen`, 'kept');
    clearDroppedKeys(s);
    expect([...m.entries()].filter(([, v]) => v !== '')).toEqual([[`${STORAGE_PREFIX}-account-chosen`, 'kept']]);
  });
});
