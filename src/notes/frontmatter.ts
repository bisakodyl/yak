import { parse, parseDocument, stringify, isMap, isScalar } from 'yaml';

/**
 * YAML front matter as Obsidian and TaskNotes write it: the file starts with a `---` line and the
 * block ends at the next `---` (or `...`) line. Only top-level keys are edited; everything else in
 * the block (comments, order, quoting, nested values) is kept byte for byte.
 */

export type FrontMatterValue = unknown;
export type Properties = Record<string, FrontMatterValue>;

export interface FrontMatterBlock {
  /** Offset of the first character after the opening `---` line. */
  start: number;
  /** Offset of the closing `---` line (the YAML source is `text.slice(start, end)`). */
  end: number;
  /** Offset just after the closing line, where the body starts. */
  bodyStart: number;
}

export interface ParsedNote {
  block: FrontMatterBlock | null;
  /** Top-level properties; empty when there is no front matter or it is not a YAML map. */
  properties: Properties;
  /** Set when the front matter exists but is not valid YAML or not a map. */
  error: string | null;
  body: string;
}

/** A single splice on a text: remove `remove` characters at `index`, then insert `insert`. */
export interface TextEdit {
  index: number;
  remove: number;
  insert: string;
}

const OPEN = /^---[ \t]*\r?\n/;
const CLOSE = /^(?:---|\.\.\.)[ \t]*$/;

export function findFrontMatter(text: string): FrontMatterBlock | null {
  const open = OPEN.exec(text);
  if (!open) return null;
  const start = open[0].length;
  let pos = start;
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = text.slice(pos, lineEnd).replace(/\r$/, '');
    if (CLOSE.test(line)) return { start, end: pos, bodyStart: nl === -1 ? text.length : nl + 1 };
    if (nl === -1) break;
    pos = nl + 1;
  }
  return null;
}

export function parseNote(text: string): ParsedNote {
  const block = findFrontMatter(text);
  if (!block) return { block: null, properties: {}, error: null, body: text };
  const body = text.slice(block.bodyStart);
  const src = text.slice(block.start, block.end);
  if (!src.trim()) return { block, properties: {}, error: null, body };
  try {
    const value: unknown = parse(src);
    if (value === null || value === undefined) return { block, properties: {}, error: null, body };
    if (typeof value !== 'object' || Array.isArray(value)) {
      return { block, properties: {}, error: 'Front matter is not a list of properties', body };
    }
    return { block, properties: value as Properties, error: null, body };
  } catch (e) {
    return { block, properties: {}, error: e instanceof Error ? e.message.split('\n')[0] ?? 'Invalid YAML' : 'Invalid YAML', body };
  }
}

/** Serialize properties as a complete front matter block (with both `---` lines). */
export function serializeFrontMatter(properties: Properties): string {
  const keys = Object.keys(properties);
  if (keys.length === 0) return '---\n---\n';
  return `---\n${stringify(properties)}---\n`;
}

/** One top-level property serialized as YAML lines, ending in a newline. */
function propertyLines(key: string, value: FrontMatterValue): string {
  return stringify({ [key]: value });
}

/** The smallest single splice that turns `oldText` into `newText` (common prefix and suffix kept). */
export function minimalEdit(oldText: string, newText: string): TextEdit {
  let prefix = 0;
  const max = Math.min(oldText.length, newText.length);
  while (prefix < max && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)) {
    suffix++;
  }
  // Never split a UTF-16 surrogate pair.
  if (prefix > 0 && isHighSurrogate(oldText.charCodeAt(prefix - 1))) prefix--;
  if (suffix > 0 && isLowSurrogate(oldText.charCodeAt(oldText.length - suffix))) suffix--;
  return { index: prefix, remove: oldText.length - prefix - suffix, insert: newText.slice(prefix, newText.length - suffix) };
}

function isHighSurrogate(c: number): boolean {
  return c >= 0xd800 && c <= 0xdbff;
}
function isLowSurrogate(c: number): boolean {
  return c >= 0xdc00 && c <= 0xdfff;
}

export function applyEdit(text: string, edit: TextEdit): string {
  return text.slice(0, edit.index) + edit.insert + text.slice(edit.index + edit.remove);
}

/** Line range [from, to) of each top-level key in the YAML source, `to` just after its last line. */
function keyRanges(src: string): Map<string, [number, number]> | null {
  const doc = parseDocument(src);
  if (doc.errors.length > 0) return null;
  const out = new Map<string, [number, number]>();
  if (doc.contents === null) return out;
  if (!isMap(doc.contents)) return null;
  for (const pair of doc.contents.items) {
    const key = pair.key;
    if (!isScalar(key) || !key.range) continue;
    const valueRange = (pair.value as { range?: [number, number, number] } | null)?.range;
    const endPos = valueRange ? valueRange[2] : key.range[2];
    const from = src.lastIndexOf('\n', key.range[0] - 1) + 1;
    let to: number;
    if (endPos > 0 && src[endPos - 1] === '\n') to = endPos;
    else {
      const nl = src.indexOf('\n', endPos);
      to = nl === -1 ? src.length : nl + 1;
    }
    out.set(String(key.value), [from, to]);
  }
  return out;
}

/**
 * The edit that sets (or with `undefined`, removes) one top-level front matter property, touching
 * only that property's lines inside the front matter block. Creates a block when there is none.
 * Returns null when the text has front matter that cannot be edited safely (invalid YAML), and an
 * empty edit when nothing changes.
 */
export function propertyEdit(text: string, key: string, value: FrontMatterValue | undefined): TextEdit | null {
  const block = findFrontMatter(text);
  if (!block) {
    if (value === undefined) return { index: 0, remove: 0, insert: '' };
    return { index: 0, remove: 0, insert: `---\n${propertyLines(key, value)}---\n` };
  }
  const src = text.slice(block.start, block.end);
  const ranges = keyRanges(src);
  if (!ranges) return null;
  const range = ranges.get(key);
  let local: TextEdit;
  if (range) {
    const oldLines = src.slice(range[0], range[1]);
    const newLines = value === undefined ? '' : withNewline(propertyLines(key, value), oldLines);
    local = minimalEdit(oldLines, newLines);
    local.index += range[0];
  } else {
    if (value === undefined) return { index: 0, remove: 0, insert: '' };
    const needsNl = src.length > 0 && !src.endsWith('\n');
    local = { index: src.length, remove: 0, insert: (needsNl ? '\n' : '') + propertyLines(key, value) };
  }
  return { index: local.index + block.start, remove: local.remove, insert: local.insert };
}

/** Keep a property that was the last line without a trailing newline that way. */
function withNewline(lines: string, old: string): string {
  return old.endsWith('\n') ? lines : lines.replace(/\n$/, '');
}

/** Apply several property changes in order; returns the new text (or null if not editable). */
export function setProperties(text: string, changes: Properties): string | null {
  let out = text;
  for (const [k, v] of Object.entries(changes)) {
    const edit = propertyEdit(out, k, v);
    if (!edit) return null;
    out = applyEdit(out, edit);
  }
  return out;
}

/** The value as a single line of text for inputs and table cells. Lists are comma-separated. */
export function formatValue(value: FrontMatterValue): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((v) => formatValue(v)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Parse what the user typed into a property input, keeping the old value's type: lists split on
 * commas, numbers and booleans stay numbers and booleans when they still parse. An empty input
 * removes the property (`undefined`).
 */
export function parseInput(input: string, old: FrontMatterValue): FrontMatterValue | undefined {
  const s = input.trim();
  if (Array.isArray(old) || (old === undefined && s.includes(','))) {
    const parts = s.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
    return parts.length === 0 && old === undefined ? undefined : parts;
  }
  if (s === '') return undefined;
  if (typeof old === 'number' && /^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (typeof old === 'boolean' && /^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
  return s;
}
