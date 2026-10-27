import { useEffect, useState } from 'preact/hooks';
import { shareLinks } from './share-links';
import { shares } from './shares-runtime';

/** Re-render when shares or the share link change. */
export function useShares(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = (): void => setTick((t) => t + 1);
    const stops = [shares.subscribe(bump), shareLinks.subscribe(bump)];
    return () => stops.forEach((s) => s());
  }, []);
}
