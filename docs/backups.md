# Backups: reference

The user guide is `user/backups.md` (shown in the app under Help).
This file keeps the details behind it: encryption, the folder layout and restore rules.

## Encrypted backups

For a device whose folder others can read (a shared computer, a cloud-synced folder), set a passphrase (the Passphrase line on Settings) and tick **Write only encrypted backups from this device**.

- One passphrase per account. The key is derived from it (PBKDF2-SHA256) and stays on each device that entered it; a device that has not entered it writes no encrypted backups and says so.
- Every file is encrypted (AES-GCM): restore points, `current/`, history segments and the indexes. There are no readable exports, so a folder of encrypted backups shows only opaque files.
- The salt and a check value are stored in the account document and in `<account>/encryption.json`. They are not secret; the check value lets a wrong passphrase be refused before any file is read.
- **If you forget the passphrase, the encrypted backups cannot be opened, and nobody can recover it.**
- Files already in the folder stay as they are. Delete older readable backups yourself if they must not stay.
- Downloaded backup files are not encrypted, so the download buttons are off while encryption is on.
- To restore: type the passphrase under **Restore** (a device that has it needs nothing), then restore as usual, also to a time and also in a fresh browser.

## The status dot and the warning banner

The dot in the header turns amber, and its panel says why, when:

- the last backup is older than the warning threshold (24 hours unless you change it on the Backups screen);
- the last backup failed;
- the app has data but no backup was ever made;
- the browser needs permission again for the folder, or the folder cannot be reached (moved, renamed or deleted).

Except for "no backup was ever made", a banner appears on every screen too.
**Remind me tomorrow** hides the banner for a day on this device; the dot stays amber.

## What is in the folder

Everything of this account is in one sub-folder, named after the account:

```
Time backups/
  <account>/
    manifest.json                  index (restore points, segments); written last
    current/                       the latest state, rewritten in place (same layout as one backup, below)
    history/<document>/<start>_<end>_<hash>.seg    change-log segments, copied once
    blobs/<hash>                   files in notes, one per hash, copied once (encrypted: named by an HMAC of the hash)
    restore-points/
      2026-10-15T09-05-01-002Z_ab12cd34/   full backups, named after the time (UTC) and the device
        manifest.json
        docs/…
  2026-10-01T…_ab12cd34/           older full backups from earlier versions, kept as they are
```

A full backup (a restore point, `current/`, or an older one) looks like this:

```
  2026-10-15T09-05-01-002Z_ab12cd34/
    manifest.json
    docs/
      space~personal/
        update.ybin
        state-vector.ybin
        time_entries/
          2026-09.jsonl
          2026-10.jsonl
        projects.json
        clients.json
        tags.json
        notes.json
        notes/
          Projects/Acme.md
        settings.json
        meta.json
      space~work/
        …
```

| File | What it is for |
| --- | --- |
| `manifest.json` | Says what the backup holds: format version, time, device, reason, the time-entry partition scheme, each document with its state vector and counts, and the size and SHA-256 checksum of every other file. Written last: a folder without it is an interrupted backup and is never offered for restore. |
| `docs/<document>/` | One folder per document. The document id `space/work` becomes `space~work`. |
| `update.ybin` | The whole document, history of deletions included, in Yjs's binary format. **This is what a restore reads.** |
| `state-vector.ybin` | What `update.ybin` contains (one counter per device that edited it). A restore checks the update against it. |
| `time_entries/<YYYY-MM>.jsonl` | Time entries, one JSON object per line, one file per month in which the entry started (UTC). Every field is kept, including running timers (`"stop": null`) and deleted entries (`"deleted": true`). |
| `projects.json`, `clients.json`, `tags.json` | All records of each kind, deleted ones included, each with its `id`. |
| `notes/…` | Each note that is not deleted, as a Markdown file at its path. Unsafe characters in names become `_`; two notes with the same path get the note id added to the second name. |
| `notes.json` | Every note's id, path, dates, deleted flag and the file it was written to (`null` for deleted notes). |
| `settings.json`, `meta.json` | Shared settings and the document's schema version. |

The readable files are there so your data is never locked in: open them with any text editor or script.
They are covered by the checksums, but a restore does not read them; it reads `update.ybin`, which holds everything losslessly.

A segment file is one JSON line (document, time span) followed by the Yjs update; its name carries the hash of its content, so copying twice, or from two devices, never duplicates it.

A downloaded backup (`backup-<name>.json`) holds the same manifest and files in one JSON file: text files as text, `.ybin` files as base64.
It leaves out the files in notes (`blob_storage: none`), and the screen says so.
`backup-<name>.zip` is the same folder as a store-only zip (ZIP64, so it may pass 4 GB) with the files in notes at `docs/<space>/attachments/<name>`.

Files in notes (format version 2): the manifest lists them under `blobs` (space, hash, name, size, type) and `blob_storage` says where the bytes are: `folder` (the account's `blobs/`, and a readable copy in `current/`), `zip`, or `none`.
A restore point keeps that list, never a copy of the bytes.
`blobs_missing` counts files the notes list that the backing-up device had not received yet.

## Restoring

On the Backups screen, choose a backup from the history, **Restore from a backup file…** (a downloaded `.zip` or `.json`), or **Restore from a folder…** (a single backup folder, or a folder of backups, in which case the newest is used).

Before anything changes, the app reads every file, checks its size and SHA-256 checksum, and checks that each document decodes to the state recorded in the manifest.
It then shows when and on which device the backup was made, and how many entries, notes, projects, clients and tags each document holds.
A damaged backup is shown with its problems and cannot be restored; pick an older one.

**Restore to a time…** rebuilds the data as it was at a moment you pick: the newest restore point before it, then every logged change up to it (also from older full backups).
It works from a folder in a fresh browser too: choose **Restore from a folder…** on the folder (or its account folder), then **Restore to a time…**.
You see what the rebuilt state holds, and restore it like any backup.
The log is this device's own record, so the time is accurate to about a minute, and a change the device never logged (it was closed) is only in the next restore point.

Two ways to restore:

- **Merge into this device** (the default and the safe choice) adds whatever is missing on this device and keeps everything else, including edits made after the backup.
  Use it on a new or wiped browser, or when something is missing.
  Merging cannot undo later changes: a record edited or deleted after the backup stays edited or deleted.
- **Replace local data…** makes this device's data exactly what the backup holds and removes later changes.
  It asks for confirmation, then writes one more backup of the current data to the folder (when one is set up), keeps the current data on this device, clears the local databases, reloads, and loads the backup.
  Afterwards, **Merge it back** on the Backups screen merges the data from before the replace back in, if you change your mind.
  Close other tabs of the app first; they are reloaded automatically if still open.
  On a paired device, replace only changes this device: the other devices send their data back when they connect.
