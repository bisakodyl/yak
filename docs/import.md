# Toggl import: reference

The user guide is `user/import.md` (shown in the app under Help).
This file keeps the column mapping and the rules behind it.

## What is imported

| Toggl column | In the app |
| --- | --- |
| Description | The entry's description |
| Project, Client | The entry's project; projects and clients are created when missing |
| Billable (Yes / No) | The entry's billable flag |
| Start date, Start time, End date, End time | Start and stop (stored as UTC; shown in your local time) |
| Duration | Used to check the times, and to choose the right hour on the night the clocks go back; also the length when there is no end time |
| Tags | Tag names on the entry; tags are created when missing |

Columns are found by their headings, in any order and in any letter case.
Extra columns are ignored.
A single combined **Start** and **End** column, or **Duration (decimal)**, also works.
The **Duration** column may be `H:MM:SS` or decimal hours (`0.13`).

## What is not imported

- **Amounts and rates.**
  Toggl's Amount column is ignored and no project rate is guessed; set rates under **Projects** if you want amounts in reports.
  New projects are not marked billable; each entry keeps its own billable flag.
- **Task names.**
  Toggl tasks have no equivalent here yet; the preview says how many rows had one.
- **Users.**
  If the file holds several people's entries (a team export) the preview warns you.
  Everything in the file is imported as yours, so export only your own entries.
- **Running timers.**
  A timer still running when you exported is not in the Detailed report; imported entries are always finished.
- **Project colours, archived state, client details, members, workspaces** are not in the Detailed report.
  New projects get a colour from the app's palette.
- **Dates in other orders.**
  Dates must be `YYYY-MM-DD` (or `DD.MM.YYYY`).
  Toggl can be set to show `MM/DD/YYYY` or `DD/MM/YYYY`; those cannot be told apart safely, so those rows are reported instead of guessed.
  Set the date format in Toggl to year-month-day before exporting if you see this.

## Importing twice

Every imported entry gets a fingerprint (`import_id`) made from its start, end, description, project and client.
An entry whose fingerprint is already in the space is skipped.
So you can import the same file again, or an export that overlaps an earlier one, and only the new entries are added.

Things to know:

- The fingerprint uses the instants after the time zone is applied.
  Importing the same file with a different time zone makes different entries, so always use the same zone for the same Toggl account.
- Two rows in one file with the same start, end, description, project and client are treated as one.
- Tags, billable flag and edits made after the import do not matter: an edited entry is still recognised.
- An imported entry you deleted stays deleted.
  Re-importing does not bring it back.
- Entries you created yourself in the app are never treated as duplicates, even if they look the same.
  If you tracked the same hours in both places, delete one set.
- Importing the same file on two devices before they have synced adds the entries twice.
  Import on one device and let it sync to the other.

A cancelled or interrupted import is safe.
Whatever was added stays; choose the same file again and only the rest is added.

## Matching projects, clients and tags

- A row's project is matched to an existing project with the same name, ignoring letter case, **under the same client**.
  A project without a client matches only projects without a client.
- A client is matched by name, ignoring case.
- Tags are matched by name, ignoring case; the spelling already in the app wins.
- Anything missing is created.
  Deleted projects, clients and tags are not matched.

## If something looks wrong

- **"None of the column headings look like a Toggl Detailed report export."**
  The file is not the Detailed CSV, or it was saved by a spreadsheet program in another layout.
  Export again from Toggl.
- **Times are off by some hours.**
  The time zone in the preview is not the one Toggl used.
  Nothing has been added yet while you are still in the preview, so change it there.
- **Rows with errors.**
  They are listed with their line number in the file.
  Fix them in the CSV (a spreadsheet program or a text editor will do) and import it again; the rows that already went in are skipped.
- **The file is larger than 100 MB.**
  Export a shorter date range.

The import was written from Toggl's documented export format and has not yet been tried on a real export.
If a real file fails, the preview names the problem; keep the file for a fix.
