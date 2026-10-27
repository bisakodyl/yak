import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { required: false, proof: undefined as object | undefined, unlocked: false, requireKeys: vi.fn(async () => {}) };
vi.mock('./account-keys-runtime', () => ({
  keyTrust: {
    required: () => state.required,
    get proof() {
      return state.proof;
    },
  },
  ownerKeys: { current: { unlocked: () => state.unlocked, requireKeys: (...a: unknown[]) => state.requireKeys(...(a as [])) } },
}));

const { keyPrompt, withKey } = await import('./key-prompt');

describe('withKey (F-324)', () => {
  beforeEach(() => {
    Object.assign(state, { required: false, proof: undefined, unlocked: false });
    state.requireKeys.mockClear();
    keyPrompt.close(false);
    keyPrompt.configure({ me: 'me', paired: () => false });
  });

  it('runs the action at once when the key is unlocked and the device is set up', async () => {
    Object.assign(state, { required: true, proof: {}, unlocked: true });
    const run = vi.fn(async () => {});
    expect(await withKey({ verb: 'x', run })).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(keyPrompt.current).toBeUndefined();
  });

  it('opens the sheet when locked, and resolves false when it is closed', async () => {
    Object.assign(state, { required: true, proof: {}, unlocked: false });
    const run = vi.fn(async () => {});
    const p = withKey({ verb: 'make a link', run });
    expect(keyPrompt.current?.kind).toBe('key');
    keyPrompt.close(false);
    expect(await p).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('an action that needs no unlock still opens the sheet on a device that is not set up', () => {
    void withKey({ verb: 'ask', unlock: false, run: async () => {} });
    expect(keyPrompt.current?.kind).toBe('key');
    keyPrompt.close(false);
    Object.assign(state, { required: true, proof: {} });
    expect(keyPrompt.needed({ verb: 'ask', unlock: false, run: async () => {} })).toBe(false);
  });

  it('a "fresh" action always asks, even when unlocked', () => {
    Object.assign(state, { required: true, proof: {}, unlocked: true });
    expect(keyPrompt.needed({ verb: 'x', fresh: true, run: async () => {} })).toBe(true);
  });

  it('finish approves a lone device (device keys, no pairing) before the action; a paired one is left alone', async () => {
    const run = vi.fn(async () => {});
    await keyPrompt.finish({ verb: 'x', run });
    expect(state.requireKeys).toHaveBeenCalledWith(['me']);
    expect(run).toHaveBeenCalledOnce();
    state.requireKeys.mockClear();
    keyPrompt.configure({ me: 'me', paired: () => true });
    await keyPrompt.finish({ verb: 'x', run });
    expect(state.requireKeys).not.toHaveBeenCalled();
    state.required = true;
    keyPrompt.configure({ me: 'me', paired: () => false });
    await keyPrompt.finish({ verb: 'x', run });
    expect(state.requireKeys).not.toHaveBeenCalled();
  });
});
