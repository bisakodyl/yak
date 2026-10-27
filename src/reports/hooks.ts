import { useEffect, useState } from 'preact/hooks';
import type * as Y from 'yjs';

/** Re-render when any of the given Yjs types (or anything inside them) changes. Pass a memoised array. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type YType = Y.AbstractType<any>;

export function useTypesVersion(types: YType[]): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = (): void => setVersion((v) => v + 1);
    for (const t of types) t.observeDeep(bump);
    return () => {
      for (const t of types) t.unobserveDeep(bump);
    };
  }, [types]);
  return version;
}
