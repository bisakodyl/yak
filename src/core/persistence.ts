export type PersistenceResult = 'granted' | 'denied' | 'unsupported';

/** Ask the browser not to evict this origin's storage. Feature-detected; never throws. */
export async function requestPersistence(): Promise<PersistenceResult> {
  try {
    if (!navigator.storage?.persist) return 'unsupported';
    if (await navigator.storage.persisted()) return 'granted';
    return (await navigator.storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}
