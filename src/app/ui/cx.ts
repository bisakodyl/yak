/** Join class names, skipping empty ones; returns undefined when nothing is left so no empty attribute is rendered. */
export function cx(...names: (string | false | null | undefined)[]): string | undefined {
  const joined = names.filter(Boolean).join(' ');
  return joined || undefined;
}
