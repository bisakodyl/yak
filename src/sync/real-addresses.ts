import type { EventLog } from './event-log';

/**
 * Chrome hides LAN addresses behind `.local` names until the origin holds camera permission.
 * Some machines cannot resolve those names, even to themselves (seen on the managed work
 * laptop), so ask once before pairing; QR scanning needs the camera anyway.
 */
export async function ensureRealAddresses(log: EventLog): Promise<'granted' | 'refused' | 'unavailable'> {
  try {
    const status = await navigator.permissions?.query({ name: 'camera' as PermissionName });
    if (status?.state === 'granted') return 'granted';
  } catch {
    // Permissions API unavailable; fall through and ask.
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    log.log('camera', 'unavailable; connections will use .local names');
    return 'unavailable';
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((t) => t.stop());
    log.log('camera', 'granted');
    return 'granted';
  } catch (e) {
    log.log('camera', `not granted: ${e instanceof Error ? e.name : String(e)}; connections will use .local names`);
    return 'refused';
  }
}
