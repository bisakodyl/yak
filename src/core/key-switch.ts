import type * as Y from 'yjs';
import { KEYS_REQUIRED_LEVEL, readDeviceKey, readDeviceKeys, type DeviceKeyRecord } from './account-keys';
import { readDevices } from './devices';

/**
 * Who stands in the way of "Require device keys" (#257, S-76n). Every device still in the account
 * (not removed, not left) must run a build that knows keys required and have published its keys;
 * the others are stragglers: update them, remove them, or mark them left.
 */

export interface SwitchDevice {
  id: string;
  name?: string;
  keys?: DeviceKeyRecord;
  /** `ready`: can be approved; `no-keys`: an older build or not opened since the update; `old-build`: keys from a build that cannot run keys required. */
  state: 'ready' | 'no-keys' | 'old-build';
}

/** Every device in the account, from the device list, the published keys and the devices seen on the network (`seen`). */
export function switchDevices(doc: Y.Doc, seen: Iterable<string> = []): SwitchDevice[] {
  const devices = readDevices(doc);
  const ids = new Set([...devices.keys(), ...readDeviceKeys(doc).keys(), ...seen]);
  const out: SwitchDevice[] = [];
  for (const id of ids) {
    const d = devices.get(id);
    if (d?.removed || d?.left) continue;
    const keys = readDeviceKey(doc, id);
    out.push({ id, ...(d?.name ? { name: d.name } : {}), ...(keys ? { keys } : {}), state: !keys ? 'no-keys' : (keys.v ?? 0) < KEYS_REQUIRED_LEVEL ? 'old-build' : 'ready' });
  }
  return out.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
}
