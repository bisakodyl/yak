# Account and device keys, sharing between accounts

Issue #76. Replaces the shared-key trust model (S2, S19) described in `../sync.md`, "Trust limit".
Status: owner decisions of 2026-10-20 (issue comment) applied; slices 1–4 are built (S-76a–c, f, m–o, q–s, S-256–S-256e, S-257–S-257h and S-258–S-258f in `decisions/sync.md`; O-257 in `decisions/obsidian.md`).
Slices: see "Slices and issues".

## Goal and non-goals

- A device that should not have an account's data cannot get it, even if hostile and holding an old sync code.
- Sharing a space or a single note with another person's account becomes possible.
- Not a goal: taking back data a device already holds.
  A removed device or ended share keeps what it synced; keys rotate for what comes after.
- Not a goal: hiding data from the relay (already sealed, S48) or from the person's own browser (S42).
- Not a goal: read-only members, or rejecting junk edits (Yjs cannot).
- Researched and rejected as a base: Keyhive, Willow/Meadowcap, secsync, DXOS.
  None fits Yjs + P2P + cross-account sharing without a rewrite.
  Borrowed: the capability model.

## Today

- One sync code per account: 28 base32 chars → HKDF → mailbox topic, signaling/relay seal key (`src/sync/pairing-secret.ts`).
- Account id is derived from the code (`accountIdFromSecret`, `src/core/account-setup.ts`).
- Any holder can claim any device id and ask for any space; `keeps` is a courtesy filter (`allowsDoc`, `src/app/sync-filter.ts`).
- Remove is cooperative (S13); the lock-out is changing the code (S14).
- Backups: optional passphrase per account, PBKDF2 key, params in the account doc (`src/backup/crypto.ts`, `encryption-state.ts`; S18).

## Model

### Key hierarchy

```
 passphrase (the person's; backups use it too)
     │ KDF (PBKDF2 today, `src/backup/crypto.ts`)
     ▼
 passphrase key ──encrypts──▶ account PRIVATE key   (stored in account doc + backups)
                                   │ signs
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
  device certificate         removal records            share invitations
  (device pubkey, name)      (rotate keys)
        │
  device key pair ──ECDH──▶ wraps ┬ space key   (per space, per epoch)
  (non-extractable)               ├ share key   (per share, per epoch)
                                  └ backup key  (unlocked by passphrase, also wrapped here)

 account id = fingerprint of the account PUBLIC key
```

| Thing | What | Where it lives |
| --- | --- | --- |
| Account key pair | P-256 ECDSA. Owner authority: certifies devices, signs removals and share changes. Id = fingerprint of the public half | Public half and the passphrase-encrypted private half in `account/<id>`; encrypted private half also in backups. Never stored in the clear |
| Device key pair | P-256 ECDSA (sign) + ECDH (wrap). Private halves non-extractable in IndexedDB, never exported or backed up | Public halves and the account's certificate in `account/<id>` under `keys.<deviceId>`; device id stays a UUID, bound by the certificate |
| Space key | Random 256-bit AES-GCM key per space and **epoch** (starts at 1) | Wrapped to each device that keeps the space; wrapped copies sit in the account doc |
| Share key | Same, per share | Wrapped to the other **account's** public key, never its devices; that account wraps it to its own devices |
| Backup key | Key for encrypted backups (S18) | Unlocked by the passphrase; also wrapped to each device, so backing up never asks for it |
| Sync code | **One-time invite** to pair a device; expires (15 min) and is replaced | Typed, scanned or pasted; opens the join mailbox only |
| Share link | One-time invite for another account | Carries the one-time rendezvous topic and the owner's account key fingerprint |

- Changing accounts costs re-pairing devices and re-sharing; accepted.
- Space key seals relay frames and rendezvous for that space.
  Direct links are already DTLS; their protection is that both ends are authenticated.
- The account document has its own epoch key, wrapped to every device, deriving the mailbox topic and relay room for the account.
  Removal bumps it.

### Passphrase

- Must be set before adding a second device, starting a share or making an encrypted backup.
  Nudge single-device users at their first backup.
- Four-word generated option; otherwise a strong passphrase is required.
- Needed for: setting it, approving a device (approver only), removing a device, starting/changing/ending a share, restoring on a fresh browser, changing it.
- Not needed for: everyday use, sync, backups, mirror.
  Cached in memory for a few minutes after entry.
- No separate recovery key; printed words may come later.
- Forgotten: no data lost and devices keep syncing; owner actions are lost.
  Offer "start a new account with this device's data".
- A thief with an unlocked device can read its data but cannot add or remove devices.

### Roles and rules

- Roles per share: **owner** (invite, remove, end, promote) and **member**.
  Several owners allowed; content rights are equal.
  The creating account owns its own spaces, as today.
- A certificate or grant is valid if its signer chains to the account key (own devices) or to an owner of the share.
  Concurrent grant and revoke: revoke wins.

## Pairing a new device

```
 new device                      approving device              account doc
     │  sync code (one-time)          │                             │
     │──── sealed join request ──────▶│                             │
     │  (device public keys)          │  both screens show a        │
     │                                │  short fingerprint: compare │
     │                                │  passphrase → account key   │
     │                                │  signs certificate ────────▶│
     │◀── account doc + wrapped keys ─│  wraps account epoch key,   │
     │    (spaces chosen later, S9)   │  backup key to new device   │
```

- The code opens the mailbox for the join request and nothing else; someone who only has the code can ask, not get in.
- Approval needs the passphrase on the approving device only.
- Enrollment gives the account doc and account epoch key.
  Spaces still need choosing (S9): each pick wraps that space key to the device.
- The code is replaced after use or on expiry.

## Handshake and filtering

- Built in slice 2 (S-256): offers and answers are signed over the session description (binding the DTLS link); certificates come from the account document.
  With keys required, a peer without a valid certificate gets no document.
- Per document, `allowsDoc` asks "does this peer hold the key for this space at this epoch?" instead of "does this peer keep it?".
  `keeps` stays as the choice of what *this* device wants; the key decides what it may have.
- Relay fallback and signaling seal with a pair key from ECDH of the two device keys (HKDF with topic and pair tag), not a shared account key.
  The relay still sees only ciphertext, sizes and timing, and learns no device id.

## Removing a device

- Built in slice 4 (S-258), then cut back to signed removals without rotation (S-295, `src/core/key-removals.ts`): nothing is encrypted with space keys yet.
- Shares (slice 5) do not rotate anything either: ending a member is a signed, pinned record (S-259e).

## Sharing with an account

Built in slice 5 (#259): see `architecture.md` (Sharing between accounts) and decisions S-259 to S-259f in `decisions/sync.md`.
The first design (a share key wrapped to account keys, epochs, single-note shares) was dropped: account keys only sign, and the owner chose simplicity over convenience.

## Migration (decision F39: testers keep their data)

Superseded by S-311 to S-311c in `decisions/sync.md`: keys are always on for new accounts and the switch below is a banner on Devices for older ones; devices that are not ready no longer block it and join again instead.
The text below is the history.

Two modes per account, chosen once and one way.

| Mode | Behaviour |
| --- | --- |
| Compatible (default after slice 1) | Each updated device publishes its public keys; the owner sets the passphrase, which creates the account key. Devices page shows a lock state per device. Sync code still admits everyone. No new protection, no breakage |
| Keys required (slice 3) | Owner presses "Require device keys". Allowed only when every non-removed, non-left device shows a key. Current devices are certified in one signed batch, every space gets epoch 1, the sync code is replaced by a one-time invite |

- Existing accounts move to the fingerprint id in slice 1: the account document is copied to `account/<fingerprint>` by the migration framework (#261, lands before #255); F39 applies.
  Devices follow the move through the compatible-mode account doc; the old document stays until every device has moved.
- Two devices creating the account key at once: the lower fingerprint wins, the other adopts it.
- Straggler devices (old build, offline, lost) block the switch until updated, removed or marked left; the page lists them.
- After the switch an unsigned `hello` is refused with a clear "update this device" status.
- Trust on first use is the weak point of compatible mode: a hostile device could publish a key first.
  Mitigation: the owner reviews names and fingerprints before pressing the button.
- Sharing is only offered in keys-required mode.
- Backups: the account doc in a backup holds the passphrase-encrypted account key, so restoring on a fresh browser with the passphrase brings back the **same** account and its shares (changes S12).
  The restored device still gets a new device key and certificate.

## Obsidian

- A device like any other: own key pair, approval by fingerprint, keys only for the spaces mapped to the vault.
- Key storage: protected (non-extractable IndexedDB) when available, else the plugin settings file (`data.json`, which vault sync can copy).
  The plugin says which it uses.

## Code touched

| Area | Files |
| --- | --- |
| Crypto helpers (sign, ECDH wrap, fingerprint, KDF) | `src/core/keys.ts`, `src/core/crypto.ts` (shared with backups) |
| Account records | new `src/core/account-keys.ts`; `src/core/account.ts`, `account-setup.ts` (`accountIdFromSecret`), `devices.ts` |
| Passphrase | `src/backup/encryption-state.ts`, `service.ts`, `BackupsView.tsx`; new passphrase prompt in `src/devices/` |
| Handshake, seals | `src/sync/envelope.ts`, `peer-mesh.ts`, `peer-link.ts`, `relay-link.ts`, `doc-mux.ts`, `sync-service.ts` |
| Pairing, join | `src/sync/pairing-secret.ts`, `src/app/join.ts`, `Welcome.tsx`, `leave.ts` |
| Filtering | `src/app/sync-filter.ts` (+ test), `src/core/keeps.ts` unchanged |
| Shares | new `src/core/shares.ts`; `doc-store.ts` (`spaceOfDoc`), `spaces.ts`, `src/notes/`, `src/mirror/engine.ts` (delete path) |
| UI | `src/devices/DevicesView.tsx`, `RelayStatsLine.tsx` (connection display) |
| Obsidian | `obsidian/src/main.ts`, `doc-persist.ts` (key storage), `vault-obsidian.ts` (marker) |
| Worker | none: rooms and pair tags derive from epoch material; relay stays blind |
| Other docs | `docs/sync.md` (Trust limit, Sync code, Removing), `docs/user/privacy.md` (connection display), `docs/user/changes.md` |

## Effects elsewhere

| Area | Effect |
| --- | --- |
| Relay (Worker) | No change to routing or limits. Rooms move on rotation; old rooms idle and close (10 min) |
| ntfy.sh | Same: topic from epoch material. Pairing through ntfy unchanged |
| History / log (S35, S38) | Space logs follow the key, not `keeps`. Still left out of backups |
| Reset, leave (S21, S24) | Reset keeps the device key and erases data. "Leave" revokes itself and deletes its private key |
| Tabs (S41, S42) | Unchanged: one tab holds the mesh; private key is origin-wide in IndexedDB |

## Slices and issues

Each ships alone.

| Slice | What | Issue |
| --- | --- | --- |
| 1 | Keys, passphrase, compatible mode | old issue 255 |
| 2 | Signed handshake, keys for own devices, pair-key seals | old issue 256 |
| 3 | Approval pairing, keys required | old issue 257 |
| 4 | Removal with key rotation | old issue 258 |
| 5 | Sharing between accounts: spaces (S-259) | old issue 259 |

## Proposed decisions

All rows now live in `decisions/`; the sharing rows S-76g to S-76l are confirmed or dropped by S-259g.
