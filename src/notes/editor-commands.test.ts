import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { cycleHeading, cycleList, indentLines, toggleBullet, makeTask, setHeading, toggleTask, toggleWrap, wrapLink } from './editor-commands';

/** Run a command on text where `|` marks cursors and `{`…`}` a selection; return the text with the same marks. */
function run(cmd: StateCommand, marked: string): { text: string; ok: boolean } {
  const ranges = [];
  let text = '';
  let anchor = -1;
  for (const ch of marked) {
    if (ch === '|') ranges.push(EditorSelection.cursor(text.length));
    else if (ch === '{') anchor = text.length;
    else if (ch === '}') ranges.push(EditorSelection.range(anchor, text.length));
    else text += ch;
  }
  let state = EditorState.create({ doc: text, selection: EditorSelection.create(ranges), extensions: EditorState.allowMultipleSelections.of(true) });
  const ok = cmd({ state, dispatch: (tr) => (state = tr.state) });
  let out = state.doc.toString();
  const marks = state.selection.ranges.flatMap((r) => (r.empty ? [[r.from, '|']] : [[r.from, '{'], [r.to, '}']])).sort((a, b) => (b[0] as number) - (a[0] as number));
  for (const [pos, m] of marks) out = out.slice(0, pos as number) + m + out.slice(pos as number);
  return { text: out, ok };
}

describe('toggleWrap', () => {
  it('bolds a selection and unbolds it again', () => {
    expect(run(toggleWrap('**'), 'call {Dana} now').text).toBe('call **{Dana}** now');
    expect(run(toggleWrap('**'), 'call **{Dana}** now').text).toBe('call {Dana} now');
    expect(run(toggleWrap('**'), 'call {**Dana**} now').text).toBe('call {Dana} now');
  });
  it('wraps the word at the cursor', () => {
    expect(run(toggleWrap('*'), 'call Da|na now').text).toBe('call *Da|na* now');
    expect(run(toggleWrap('`'), 'run np|m test').text).toBe('run `np|m` test');
  });
  it('inserts an empty pair with nothing to wrap', () => {
    expect(run(toggleWrap('**'), 'a | b').text).toBe('a **|** b');
  });
  it('italic inside bold adds italic rather than removing a bold star', () => {
    expect(run(toggleWrap('*'), '**{x}**').text).toBe('***{x}***');
  });
  it('works on several cursors at once', () => {
    expect(run(toggleWrap('~~'), '{one} and {two}').text).toBe('~~{one}~~ and ~~{two}~~');
  });
});

describe('cycleList', () => {
  it('cycles text, bullet, task, done, text', () => {
    expect(run(cycleList, 'buy |milk').text).toBe('- buy |milk');
    expect(run(cycleList, '- buy |milk').text).toBe('- [ ] buy |milk');
    expect(run(cycleList, '- [ ] buy |milk').text).toBe('- [x] buy |milk');
    expect(run(cycleList, '- [x] buy |milk').text).toBe('buy |milk');
  });
  it('keeps indentation and turns a numbered line into a bullet', () => {
    expect(run(cycleList, '  - [ ] |sub').text).toBe('  - [x] |sub');
    expect(run(cycleList, '1. |first').text).toBe('- |first');
  });
  it('changes every selected line', () => {
    expect(run(cycleList, '{a\nb}').text).toBe('- {a\n- b}');
  });
});

describe('toggleTask', () => {
  it('ticks and unticks', () => {
    expect(run(toggleTask, '- [ ] |a').text).toBe('- [x] |a');
    expect(run(toggleTask, '* [X] |a').text).toBe('* [ ] |a');
  });
  it('returns false off a task, so Ctrl+Enter can do something else', () => {
    expect(run(toggleTask, 'plain |text').ok).toBe(false);
  });
});

describe('setHeading', () => {
  it('sets, changes and removes a heading', () => {
    expect(run(setHeading(2), 'Plan|').text).toBe('## Plan|');
    expect(run(setHeading(1), '## Plan|').text).toBe('# Plan|');
    expect(run(setHeading(1), '# Plan|').text).toBe('Plan|');
    expect(run(setHeading(0), '### Plan|').text).toBe('Plan|');
  });
});

describe('wrapLink', () => {
  it('wraps the selection or word, or inserts [[]]', () => {
    expect(run(wrapLink, 'see {Acme website} now').text).toBe('see [[Acme website]]| now');
    expect(run(wrapLink, 'see Ac|me now').text).toBe('see [[Acme]]| now');
    expect(run(wrapLink, 'see | now').text).toBe('see [[|]] now');
  });
});

describe('makeTask', () => {
  it('turns the checkbox text into a link to the new task', () => {
    const seen: [string, boolean][] = [];
    const cmd = makeTask((t, d) => (seen.push([t, d]), 'Buy milk'));
    expect(run(cmd, '- [x] buy milk|').text).toBe('- [x] [[Buy milk]]|');
    expect(seen).toEqual([['buy milk', true]]);
  });
  it('leaves other lines and existing links alone', () => {
    const cmd = makeTask(() => 'x');
    expect(run(cmd, 'plain |text').ok).toBe(false);
    expect(run(cmd, '- [ ] [[Already]]|').ok).toBe(false);
  });
});

describe('toolbar commands', () => {
  it('cycles the heading level', () => {
    expect(run(cycleHeading, 'a|b').text).toBe('# a|b');
    expect(run(cycleHeading, '# a|b').text).toBe('## a|b');
    expect(run(cycleHeading, '### a|b').text).toBe('a|b');
  });
  it('toggles a bullet', () => {
    expect(run(toggleBullet, 'a|b').text).toBe('- a|b');
    expect(run(toggleBullet, '- a|b').text).toBe('a|b');
    expect(run(toggleBullet, '1. a|b').text).toBe('- a|b');
  });
  it('indents and outdents', () => {
    expect(run(indentLines(1), '- a|').text).toBe('  - a|');
    expect(run(indentLines(-1), '  - a|').text).toBe('- a|');
    expect(run(indentLines(-1), '- a|').text).toBe('- a|');
  });
});
