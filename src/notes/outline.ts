import { maskCode } from './links';

export interface Heading {
  level: number;
  text: string;
  /** Offset of the heading line's start in the note text. */
  from: number;
}

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;

/** ATX headings of a note, in order; front matter and code are skipped. */
export function outline(text: string): Heading[] {
  const front = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  const src = maskCode(text);
  const start = front ? front[0].length : 0;
  const out: Heading[] = [];
  HEADING.lastIndex = start;
  let m: RegExpExecArray | null;
  while ((m = HEADING.exec(src))) {
    // The text comes from the original line, so code inside a heading stays.
    const line = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(text.slice(m.index, m.index + m[0].length));
    const label = line?.[1]?.trim();
    if (label) out.push({ level: m[1]!.length, text: label, from: m.index });
  }
  return out;
}
