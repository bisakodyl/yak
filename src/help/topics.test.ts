import { describe, expect, it } from 'vitest';
import { allTopics, titleOf } from './topics';

describe('topics', () => {
  it('lists every guide topic, ending with Report a problem', () => {
    const ids = allTopics().map((t) => t.id);
    for (const id of ['getting-started', 'timer', 'reports', 'notes', 'spaces', 'devices', 'backups', 'browsers', 'obsidian', 'import', 'offline', 'shortcuts', 'privacy']) expect(ids).toContain(id);
    expect(ids.at(-1)).toBe('report');
  });
  it('gives every topic with a file a title from its first heading', () => {
    for (const t of allTopics()) {
      if (t.source) expect(t.title).toBe(titleOf(t.source, ''));
      expect(t.title.length).toBeGreaterThan(0);
    }
  });
});
