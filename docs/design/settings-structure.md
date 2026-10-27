# Settings structure: one page per thing, fixed status lines

Issue #22.
Status: proposal, waiting for the owner's decisions (end of this note).
Builds on F-326, F-326b and F-334 (`decisions/settings.md`); reverses part of F-326b.

## Problem

The owner finds Settings hard to use: things are sometimes hidden, hard to find, hard to understand.
A UI review (2026-10-27) found five causes:

| # | Cause | Example today |
| --- | --- | --- |
| 1 | Every device link opens one long page | `#/settings/devices/<id>` and `/add` only scroll inside `DevicesView.tsx` (this device, other devices, add, remove, reset, connection server, STUN, logs) |
| 2 | Lines appear and disappear with state | No Sync or Passphrase line before the first pairing (F-326b), so a newcomer cannot find where sync is |
| 3 | Time-limited requests show where you are not looking | A 15-minute join request sits below the QR code; a share request is only a "link open" chip |
| 4 | Wording describes the internals | "removed or missed a change", ids, fingerprints and "Device keys" on the main path |
| 5 | Devices go unnamed | Columns read `cf9fe69d` or "Chrome on Linux" twice |

The must-do fixes for the coworker alpha (#20) patch 3–5 in place; this note is the structural fix for 1 and 2.

## Goal and non-goals

- Every thing has one fixed place, reachable from Settings in one tap, the same whatever the state.
- What needs action now (a request, no backup) is at the top of Settings, not inside a detail page.
- Plain words on the main path; internals behind Advanced.
- Not a goal: changing sync, keys or stored data (no migration, F39).
- Not a goal: a new tab or a Settings sheet (rejected in F-326b: F14, F21).

## Proposal

### Settings home (`#/settings`)

Order, top to bottom:

1. **Needs you** (only while something is pending): "Alice asks to join · Review", "Phone asks to join · Review", "No backup yet · Set up". Each row opens the page where it is answered.
2. **Status lines, always shown**, one row each (dot, text, link):
   - Sync: "Off · Set up" / "On · waiting for your first device" / "On · 2 devices".
   - Passphrase: "Not set · Set" / "Locked" / "Unlocked · 4 min".
   - Backup: "No folder · Choose" / "Last backup 10:42".
   - Import (stays a registered line, F-326b).
3. **Your data**: the spaces × devices table and Other accounts (F-334), unchanged except device names as column heads.
4. Preferences, About & help: unchanged.

Change to F-326b: the page shows the Sync and Passphrase lines always, not only after pairing.

### One page per device

| Route | Holds |
| --- | --- |
| `#/settings/devices/<id>` (this device or another) | Name with Rename, last seen, spaces kept (ticks), Remove… (other) or Leave this account… (this one); **Advanced** fold: id, fingerprint, device keys, Reset this device's data |
| `#/settings/devices/add` | The add flow only: code/QR, the incoming request **above** the code, a name for the new device |
| `#/settings/connection` | Connection server, STUN servers, network stats, logs (today's "Advanced: connection server and logs") |

- `DevicesView.tsx` splits into `DeviceView`, `AddDeviceView` and `ConnectionView`, each lazy; the shared parts (`DeviceKeysPanel`, `LogsPanel`, `NetworkStatsView`) move without change.
- A device with no name is asked for one when it joins (#20); old unnamed devices show "Unnamed device · Rename".
- `#/settings/devices` (no id) redirects to this device's page; old anchors keep working through `legacyRoute`.

### Words

| Today | Proposed |
| --- | --- |
| Device keys | Advanced › Device keys |
| this device was removed or missed a change | (only when it is true) This device was removed from your account · Join again |
| link open | Link open · 12 min left · Cancel |
| Not syncing (before any device) | Sync off · Set up |

## Options for the one-time code (separate decision)

Today: 26 base32 characters plus 2 check characters, shown as `ABCD-EFGH-…` (`src/sync/pairing-secret.ts`); 0, 1 and 8 already read as O, I and B, and a typo is caught by the check characters.
A newcomer review still found it long to type on a phone.

| Option | For | Against |
| --- | --- | --- |
| A. Keep the code; make the QR or link the first path on phones and typing the fallback | No protocol or format change | Typing stays long when no camera |
| B. A short code (about 8 characters) used once for a PAKE-style handshake over the relay | Easy to type | New protocol and security review; the 128-bit secret's guarantees change |

Recommendation: A (part of #20's "QR first"); B only if testers still struggle.

## Slices

1. Status lines always shown and the Needs you block (small; no route change).
2. Split `DevicesView` into the three pages, with redirects and e2e updates.
3. Words and the Advanced fold (some land earlier in #20 and #21).
4. One-time code option A, if not done in #20.

Each slice is one PR with `Refs #22`; the last one closes it.

## Owner decisions

1. Status lines always shown (reverses part of F-326b): yes / no.
2. A Needs you block at the top of Settings: yes / no.
3. A page per device plus Add and Connection pages, replacing the long Devices page: yes / no.
4. One-time code: option A or B.
