---
name: work-issue
description: Work through one or more GitHub issues of this repo (`dynamodal/yak`), one PR each, following CLAUDE.md. Use when the owner says "/work-issue 163 168" or "work on issue #n".
---

# Work on issues

Arguments: issue numbers, in the order to do them.
They are `dynamodal/yak` numbers; earlier decisions and docs cite old issue numbers of the private repo `dynamodal/punchdeck` (F-201).

## For each issue

1. `git fetch origin` and `gh issue view <n>`. Read the design note or decisions it links; skip anything already covered.
2. Branch from up-to-date `origin/main`: `git switch -c <type>/<topic> origin/main` (`feat/`, `fix/`, `docs/`, `chore/`), in a worktree if another session uses the main folder.
3. Build it. While working run `npx tsc --noEmit`, the unit tests you touch, and `npm run e2e <suite>` for the suites you touch.
4. Before the PR: `npm test` and `npx tsc --noEmit`, plus `npm run e2e <suite>` for the suites you touched. Hosted CI runs the full browser suites on every non-draft PR (F-6); `scripts/ci-local.sh` only if Actions is unavailable.
5. PR **into `main`, never another branch**: `gh pr create --base main`, using the template; first line `Closes #<n>`.
   - Push once when it is ready; every push to an open PR runs CI. Open it as a draft if you expect more pushes, and mark it ready at the end.
6. Decisions made on the way: one row at the end of the matching `docs/decisions/*.md` in the same PR, id = file prefix + issue number (`F-195`, then `F-195b`). `.gitattributes` merges these files by union, so merging `main` keeps both sides' rows without a conflict; check the table afterwards.
7. Reply with one line: `#<n> → PR #<m>: <title>`.

## Between issues

- The next issue needs the previous one's code: wait until that PR has merged (`gh pr view <m> --json state`), then branch from fresh `main`. Never stack branches.
- It does not: branch from `main` and carry on.
- Never push to a branch whose PR has merged; check `gh pr view --json state` first.

## Stop and ask only when

- A product or design decision is needed that the issue and docs do not settle.
- Tests fail for reasons outside the issue.
- The issue is too big for one PR: propose the split as an issue comment.

Ask in chat (or the session that started you), or as a comment on the issue; never as a questions section in a PR or a design note. The PR says only what changed and what is left.

## When all are done

- One line per PR, then remove your worktrees.
