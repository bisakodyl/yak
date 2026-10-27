import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Restyling must only need tokens.css (and src/app/ui/ui.css), so no other style sheet may hold a
// colour of its own. src/style.css is the capability probe and proof-of-concept page: standalone
// diagnostics that must not depend on the app, so it keeps its own few colours.
const SRC = new URL('../../', import.meta.url).pathname;
const TOKENS = join(SRC, 'app/theme/tokens.css');
const EXEMPT = new Set([TOKENS, join(SRC, 'style.css')]);

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

/** Every declaration value in a style sheet, with its line number; selectors and comments are skipped. */
export function declarationValues(css: string): { line: number; value: string }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const out: { line: number; value: string }[] = [];
  const block = /\{([^{}]*)\}/g;
  for (let m = block.exec(text); m; m = block.exec(text)) {
    let offset = m.index + 1;
    for (const decl of m[1]!.split(';')) {
      const colon = decl.indexOf(':');
      if (colon > 0) out.push({ line: text.slice(0, offset).split('\n').length, value: decl.slice(colon + 1).trim() });
      offset += decl.length + 1;
    }
  }
  return out;
}

const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|light-dark)\(/i;
const HEX = /#[0-9a-f]{3,8}\b/i;
const NAMED = /\b(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|maroon|navy|teal|olive|lime|aqua|fuchsia)\b/i;

export function colourLiterals(css: string): string[] {
  return declarationValues(css)
    .filter(({ value }) => COLOUR_FUNCTION.test(value) || HEX.test(value) || NAMED.test(value))
    .map(({ line, value }) => `${line}: ${value}`);
}

describe('design tokens', () => {
  it('finds colour literals in declarations but not in selectors or comments', () => {
    const css = '/* #fff */ #app .a { color: #fff; } .b:hover { background: rgb(0 0 0 / 0.3); border-color: var(--border); }\n.c { outline: 1px solid white; white-space: nowrap; }';
    expect(colourLiterals(css)).toEqual(['1: #fff', '1: rgb(0 0 0 / 0.3)', '2: 1px solid white']);
  });

  it('no style sheet outside tokens.css has a colour literal', () => {
    const found = cssFiles(SRC)
      .filter((f) => !EXEMPT.has(f))
      .flatMap((f) => colourLiterals(readFileSync(f, 'utf8')).map((hit) => `${relative(SRC, f)}:${hit}`));
    expect(found).toEqual([]);
  });

  it('every token a style sheet uses is defined', () => {
    const files = cssFiles(SRC).filter((f) => f !== join(SRC, 'style.css'));
    const css = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    const editor = readFileSync(join(SRC, 'notes/editor.ts'), 'utf8');
    const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...(css + editor).matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    expect([...used].filter((t) => !defined.has(t))).toEqual([]);
  });

  it('defines light and dark once each, switched by the system preference and by data-theme', () => {
    const css = readFileSync(TOKENS, 'utf8');
    for (const name of ['--bg', '--surface', '--text', '--accent', '--danger']) {
      expect(css.match(new RegExp(`${name}:`, 'g'))).toHaveLength(1);
      expect(css).toMatch(new RegExp(`${name}: light-dark\\(`));
    }
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme\]\)\s*\{\s*color-scheme: dark;/);
    expect(css).toMatch(/:root\[data-theme='light'\]\s*\{\s*color-scheme: light;/);
    expect(css).toMatch(/:root\[data-theme='dark'\]\s*\{\s*color-scheme: dark;/);
  });

  it('text colours reach WCAG AA (4.5:1) on every surface, in light and dark', () => {
    const css = readFileSync(TOKENS, 'utf8');
    const pair = (name: string): [string, string] => {
      const m = css.match(new RegExp(`${name}:\\s*light-dark\\(\\s*(#[0-9a-f]{6}),\\s*(#[0-9a-f]{6})\\)`, 'i'));
      if (!m) throw new Error(`${name} is not a light-dark() hex pair`);
      return [m[1]!, m[2]!];
    };
    const luminance = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const ratio = (a: string, b: string): number => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    const failures: string[] = [];
    for (const theme of [0, 1]) {
      for (const bg of ['--bg', '--surface', '--surface-2']) {
        for (const fg of ['--text', '--muted', '--accent', '--ok', '--warn', '--danger']) {
          const r = ratio(pair(fg)[theme]!, pair(bg)[theme]!);
          if (r < 4.5) failures.push(`${theme ? 'dark' : 'light'} ${fg} on ${bg}: ${r.toFixed(2)}`);
        }
      }
      const r = ratio(pair('--accent-text')[theme]!, pair('--accent')[theme]!);
      if (r < 4.5) failures.push(`${theme ? 'dark' : 'light'} --accent-text on --accent: ${r.toFixed(2)}`);
    }
    expect(failures).toEqual([]);
  });
});
