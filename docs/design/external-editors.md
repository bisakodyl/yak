# Editing notes in Obsidian and other editors

Route 3 (browser mirror) and route 1 (Obsidian plugin) are built; see `architecture.md`, "Mirror" and "Obsidian plugin". Owner decisions 2026-10-17 at the end.

## Why

- Obsidian and other Markdown editors already edit well, on phones too. Let them be a way into the same notes and tasks; Yak keeps time tracking and remains the editor for anyone without one.
- Time entries are not Markdown and stay in the app.

## Constraint

- Only the File System Access API lets a page write a folder: Chrome and Edge on a computer. Not Firefox, not Safari; Android Chrome unconfirmed.
- So phones and Firefox need something outside the browser.

## Routes

| # | Route | Phone | Firefox | Other editors | Size |
| --- | --- | --- | --- | --- | --- |
| 1 | Obsidian plugin that is a device in the account (sync code, same protocol, writes through Obsidian's vault API) | Yes | Yes | No | L |
| 2 | Desktop helper that keeps a folder current; the user syncs the folder (Syncthing, a drive) | Via the user's sync tool | Yes | Yes | L |
| 3 | Browser mirror: the app writes the folder itself | No | No | Yes | M–L |
| 4 | Cloud drive as the bridge | Fragile (Obsidian says Drive is not officially supported) | — | Yes | M |
| 5 | Zip export and import of Markdown | By hand | Yes | Yes | S |

- Prior art for 1 on phones: Live Cursor (y-webrtc mesh) and Self-hosted LiveSync (WebRTC mode, experimental) run in Obsidian mobile.

## Mirror engine (shared by 1, 2, 3)

- Built: see `architecture.md`, "Mirror".

## Vault layout

- One folder per space (`Personal/`, `Work/`).
- Notes as `.md`; tasks with TaskNotes front matter (works with TaskNotes and Bases).
- Time entries, projects and rates stay out.

## Spike (#63)

- Code: `obsidian/` (see its README). It reuses `src/sync`, joins with the sync code and lists the account document's spaces and devices.
- Checked by machine (`npm run e2e obsidian`): the bundle loads with a stand-in for the Obsidian API, joins through the site relay, receives the account document and nothing else, and shows it in the status window.
- Run by the owner on 2026-10-17 from a saved plugin log: a computer. Android is assumed to work and is untested (owner decision, 2026-10-17: installing on the phone costs more than it tells; test it when #64 gives a plugin worth installing). Not yet checked: the ntfy path, background behaviour. Results in the table below.
- Seen in the log: space documents are refused as designed ("not syncing space/… with this device"), so only the account document reached the plugin.
- Known before trying: `ensureRealAddresses` asks for camera permission, which a plugin should not do; the real plugin needs a way around it.

| Question | Android | Desktop |
| --- | --- | --- |
| Relay path joins | assumed | Yes: stored pairing resumed, signal connected in 0.2 s |
| WebRTC data channel opens | assumed | Yes: channel open about 0.9 s after start; a second device linked 12 s later in 0.03 s |
| Link survives 5 min in the background | assumed | _not run_ |
| Link returns after the screen was locked | assumed | _not run_ |

## Plugin (#64)

- Built and covered by unit tests and `npm run e2e obsidian` against an in-memory stand-in for Obsidian's API.
- Not yet run in real Obsidian or on a phone. Record here when it is: edits both ways on the phone, and the background results the spike table above still lacks.

## Risks to test first

- WebRTC and the relay inside Obsidian mobile; behaviour in the background.
- Typing in both editors at once: diff-based merging is good for turn-taking, poor for simultaneous typing.

## Owner decisions (2026-10-17)

- Order: mirror engine, then the browser mirror (route 3), then the Obsidian plugin (route 1).
- Two-way from the start; one-way export alone is not useful.
- Obsidian is the first editor to target; the owner will install their own plugin.
- PRs easy to review and roll back: engine with an in-memory file system first, then the browser adapter and screen.
