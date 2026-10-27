import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { deviceName, isLeft, isRemoved, readDevices, setDeviceName, setLeft, setRemoved, suggestedName } from './devices';

const sync = (a: Y.Doc, b: Y.Doc): void => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
};

describe('device names and removals', () => {
  it('stores, trims and clears a name', () => {
    const doc = new Y.Doc();
    expect(setDeviceName(doc, 'abc', '  Spare   laptop ')).toBe('Spare laptop');
    expect(deviceName(doc, 'abc')).toBe('Spare laptop');
    setDeviceName(doc, 'abc', '');
    expect(deviceName(doc, 'abc')).toBeUndefined();
    expect(setDeviceName(doc, 'abc', 'x'.repeat(80))?.length).toBe(40);
  });

  it('keeps a name and a removal made at the same time on two devices', () => {
    const phone = new Y.Doc();
    const laptop = new Y.Doc();
    setDeviceName(phone, 'phone-id', 'Phone');
    setRemoved(laptop, 'phone-id', true);
    sync(phone, laptop);
    expect(readDevices(phone).get('phone-id')).toEqual({ name: 'Phone', removed: true, left: false });
    expect(isRemoved(laptop, 'phone-id')).toBe(true);
    setRemoved(laptop, 'phone-id', false);
    sync(phone, laptop);
    expect(isRemoved(phone, 'phone-id')).toBe(false);
  });

  it('suggests a name from the browser', () => {
    expect(suggestedName('Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0')).toBe('Firefox on Android');
    expect(suggestedName('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36')).toBe('Chrome on Linux');
    expect(suggestedName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0')).toBe('Edge on Windows');
  });

  it('marks a device as having left, and clears the mark when it is back', () => {
    const phone = new Y.Doc();
    const laptop = new Y.Doc();
    setLeft(phone, 'phone-id', true);
    sync(phone, laptop);
    expect(isLeft(laptop, 'phone-id')).toBe(true);
    expect(isRemoved(laptop, 'phone-id')).toBe(false);
    expect(readDevices(laptop).get('phone-id')).toEqual({ removed: false, left: true });
    setLeft(phone, 'phone-id', false);
    sync(phone, laptop);
    expect(isLeft(laptop, 'phone-id')).toBe(false);
  });
});

