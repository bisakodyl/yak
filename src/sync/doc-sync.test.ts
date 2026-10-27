import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { counterTotal, getText, incrementCounter, snapshot } from '../core/space-doc';
import { DocSync } from './doc-sync';

interface Link {
  close(): void;
}

/** Connect two documents with an in-memory ordered channel and run the sync protocol. */
function connect(a: Y.Doc, b: Y.Doc): Link {
  // eslint-disable-next-line prefer-const
  let syncB: DocSync;
  const syncA = new DocSync(a, (m) => syncB.receive(m));
  syncB = new DocSync(b, (m) => syncA.receive(m));
  syncA.start();
  syncB.start();
  return {
    close() {
      syncA.close();
      syncB.close();
    },
  };
}

describe('DocSync', () => {
  it('merges edits made while disconnected when the link opens', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    getText(a).insert(0, 'hello');
    getText(b).insert(0, 'world');
    incrementCounter(a, 'a', 2);
    incrementCounter(b, 'b', 3);

    connect(a, b);

    expect(snapshot(a)).toEqual(snapshot(b));
    expect(counterTotal(a)).toBe(5);
    expect(getText(a).toString()).toHaveLength(10);
  });

  it('propagates live edits in both directions', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    connect(a, b);

    getText(a).insert(0, 'from a');
    expect(getText(b).toString()).toBe('from a');
    getText(b).insert(6, ' and b');
    expect(getText(a).toString()).toBe('from a and b');
  });

  it('catches up after a disconnect and reconnect', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const link = connect(a, b);
    getText(a).insert(0, 'one');
    link.close();

    getText(a).insert(3, ' two');
    getText(b).insert(0, 'zero ');
    incrementCounter(b, 'b');
    expect(snapshot(a)).not.toEqual(snapshot(b));

    connect(a, b);
    expect(snapshot(a)).toEqual(snapshot(b));
    expect(counterTotal(b)).toBe(1);
  });

  it('relays updates through a middle device', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const c = new Y.Doc();
    connect(a, b);
    connect(b, c);

    getText(a).insert(0, 'relayed');
    expect(getText(c).toString()).toBe('relayed');
  });

  it('stops sending after close', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const link = connect(a, b);
    link.close();
    getText(a).insert(0, 'unseen');
    expect(getText(b).toString()).toBe('');
  });

  it('ignores messages of an unknown type', () => {
    const a = new Y.Doc();
    const sync = new DocSync(a, () => {
      throw new Error('should not reply');
    });
    expect(() => sync.receive(new Uint8Array([9, 1, 2, 3]))).not.toThrow();
  });

  it('repairs a lost update when the exchange is re-run', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    let dropNext = false;
    // eslint-disable-next-line prefer-const
    let syncB: DocSync;
    const syncA = new DocSync(a, (m) => {
      if (dropNext) {
        dropNext = false;
        return;
      }
      syncB.receive(m);
    });
    syncB = new DocSync(b, (m) => syncA.receive(m));
    syncA.start();
    syncB.start();

    dropNext = true;
    getText(a).insert(0, 'lost on the way');
    expect(getText(b).toString()).toBe('');

    syncB.start();
    expect(getText(b).toString()).toBe('lost on the way');
  });

  it('counts what the peer has not announced having', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    getText(a).insert(0, 'shared');
    const link = connect(a, b);
    const probe = new DocSync(a, () => undefined);
    expect(probe.missingOnPeer()).toBeUndefined();
    link.close();
    getText(a).insert(0, 'more');
    // b announces its state again; a now has 4 operations b lacks.
    const fromA = new DocSync(a, () => undefined);
    const fromB = new DocSync(b, (m) => fromA.receive(m));
    fromB.start();
    expect(fromA.missingOnPeer()).toBe(4);
  });
});
