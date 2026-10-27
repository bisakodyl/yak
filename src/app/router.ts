import { useEffect, useState } from 'preact/hooks';

/** Route segments from the hash: `#/notes/abc` gives `['notes', 'abc']`. */
export function parseHash(hash: string): string[] {
  return hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => decodeURIComponent(s));
}

export function navigate(...segments: string[]): void {
  location.hash = '#/' + segments.map((s) => encodeURIComponent(s)).join('/');
}

export function useRoute(): string[] {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const onChange = (): void => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
