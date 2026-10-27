import { describe, expect, it } from 'vitest';
import { BACKUP_NAME, BackupFormatError, FORMAT_VERSION, backupName, docFolder, notePath, partitionKey, safeSegment, upgradeManifest } from './format';

describe('partitionKey', () => {
  it('puts an entry in the UTC month it started in', () => {
    expect(partitionKey({ start: '2026-10-15T09:00:00.000Z' })).toBe('2026-10');
    expect(partitionKey({ start: '2026-10-31T23:30:00-05:00' })).toBe('2026-11');
    expect(partitionKey({ start: '2027-01-01T00:00:00Z' })).toBe('2027-01');
  });

  it('sends unreadable starts to undated', () => {
    expect(partitionKey({ start: 'yesterday' })).toBe('undated');
    expect(partitionKey({})).toBe('undated');
    expect(partitionKey({ start: 42 })).toBe('undated');
  });
});

describe('names and paths', () => {
  it('names backup folders so they sort by time', () => {
    const a = backupName(new Date('2026-10-15T09:05:01.002Z'), 'ab12cd34-0000-4000-8000-000000000000');
    const b = backupName(new Date('2026-10-15T10:00:00.000Z'), '99999999-0000');
    expect(a).toBe('2026-10-15T09-05-01-002Z_ab12cd34');
    expect(BACKUP_NAME.test(a)).toBe(true);
    expect(BACKUP_NAME.test(`${a}-2`)).toBe(true);
    expect([b, a].sort()).toEqual([a, b]);
  });

  it('maps document ids to folders without collisions', () => {
    expect(docFolder('space/work')).toBe('docs/space~work');
    expect(docFolder('space/work/notes/x')).toBe('docs/space~work~notes~x');
  });

  it('makes note paths safe on every file system', () => {
    const taken = new Set<string>();
    expect(notePath('Projects/Acme.md', 'id1', taken)).toBe('Projects/Acme.md');
    expect(notePath('projects/acme.md', 'id2abcdefgh', taken)).toBe('projects/acme (id2abcde).md');
    expect(notePath('../../etc/passwd', 'id3', taken)).toBe('_/_/etc/passwd.md');
    expect(notePath('a:b?c*', 'id4', taken)).toBe('a_b_c_.md');
    expect(notePath('', 'id5', taken)).toBe('Untitled.md');
    expect(notePath('CON', 'id6', taken)).toBe('_CON.md');
    expect(safeSegment('trailing. ')).toBe('trailing');
  });
});

describe('upgradeManifest', () => {
  const base = { format: 'backup', format_version: 1, documents: [], files: {} };

  it('accepts the current version and fills defaults for fields older backups may lack', () => {
    const m = upgradeManifest(base);
    expect(m.partition).toEqual({ scheme: 'monthly', field: 'start', timezone: 'UTC' });
    expect(m.reason).toBe('unknown');
    expect(m.counts.time_entries).toEqual({ total: 0, deleted: 0 });
  });

  it('reads a version 1 backup as one that carries no files', () => {
    const m = upgradeManifest(base);
    expect(m.format_version).toBe(1);
    expect(m.blobs).toEqual([]);
    expect(m.blob_storage).toBe('none');
    expect(m.blobs_missing).toBe(0);
  });

  it('keeps the files of a version 2 backup', () => {
    const blobs = [{ unit: 's1', hash: 'ab', name: 'a.png', size: 3, type: 'image/png' }];
    const m = upgradeManifest({ ...base, format_version: 2, blobs, blob_storage: 'zip', blobs_missing: 2 });
    expect(m).toMatchObject({ blobs, blob_storage: 'zip', blobs_missing: 2 });
  });

  it('rejects a backup from a newer app instead of guessing', () => {
    expect(() => upgradeManifest({ ...base, format_version: FORMAT_VERSION + 1 })).toThrow(/newer version/);
  });

  it('rejects things that are not manifests', () => {
    expect(() => upgradeManifest(null)).toThrow(BackupFormatError);
    expect(() => upgradeManifest({ format: 'other' })).toThrow(BackupFormatError);
    expect(() => upgradeManifest({ ...base, format_version: 0 })).toThrow(BackupFormatError);
    expect(() => upgradeManifest({ ...base, documents: undefined })).toThrow(BackupFormatError);
  });
});
