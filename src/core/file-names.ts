/** Backslashes, NUL and other control characters: never part of a mirrored path. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\\\u0000-\u001f\u007f]/;

/** Device names Windows refuses as file names, with or without an extension. */
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/** Windows also drops trailing dots and spaces, so `a.md ` and `a.md.` name the same file as `a.md`. */
const TRAILING = /[. ]$/;

export const hasControlChars = (name: string): boolean => CONTROL.test(name);

export const isReservedName = (name: string): boolean => RESERVED.test(name);

/** Whether one path segment is a name no supported file system could read as something else. */
export function portableSegment(name: string): boolean {
  return name.length > 0 && !CONTROL.test(name) && !RESERVED.test(name) && !TRAILING.test(name);
}
