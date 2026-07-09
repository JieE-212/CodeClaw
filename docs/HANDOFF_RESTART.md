# CodeClaw Restart Handoff

Use this document after restarting the computer or Codex to resume work without rediscovering context.

Updated: 2026-07-09

## Restart Prompt

After restarting, open Codex in this project and send:

```text
请先读取 docs/HANDOFF_RESTART.md 和 docs/PROJECT_STATUS.md，接上 CodeClaw 当前进度。当前 2.8 已完成，下一轮按规划进入 2.9。请先深入规划，再开始执行；每轮结束后继续规划下一轮任务。
```

## Project Location

Main repo:

```text
C:\Users\ZFJJi\Desktop\AI Agent\码爪 CodeClaw\项目工程
```

Outer workspace:

```text
C:\Users\ZFJJi\Desktop\AI Agent\码爪 CodeClaw
```

If PowerShell displays the Chinese path as mojibake, still use the actual folder shown above in Explorer.

## Current Git State

Latest commit:

```text
2714e05 Add after-live recovery workflow
```

Recent commits:

```text
2714e05 Add after-live recovery workflow
1e1ba1a Add live session capture workflow
e0dd3d8 Add pre-live gate for real tester launch
```

Current branch:

```text
main tracking gitee/main
```

Before starting new code work after restart, check:

```powershell
cd "C:\Users\ZFJJi\Desktop\AI Agent\码爪 CodeClaw\项目工程"
git status --short --branch
git log -3 --oneline
```

If the user has not pushed after 2.8, they can push with:

```powershell
git pushall
```

## Current Stage

Completed:

```text
Stage 2.8: first real tester after-call recovery and evidence packaging
```

What 2.8 added:

- `trial:after-live` guarded after-call workflow.
- Runs completion, privacy, post-session, review, archive, and status in order.
- Stops on incomplete records, privacy hold, post-session failure, review fix-now/block, or archive hold.
- Generates:

```text
dist/TRIAL_AFTER_LIVE_REPORT.md
dist/TRIAL_AFTER_LIVE_REPORT.json
dist/trial-after-live/<tester-id>-<timestamp>/
```

- Evidence packets copy generated reports and safe context such as `LIVE_SESSION_HOST_SUMMARY.md`.
- Evidence packets exclude raw tester records, screenshots, logs, source files, contact data, and secret tokens.
- `trial:post-session` now supports `--reports` for isolated report directories.
- `trial:status` now recognizes:

```text
READY_FOR_AFTER_LIVE
NEEDS_AFTER_LIVE
AFTER_LIVE_BLOCKED
```

Important new files:

```text
scripts/after-live-recovery.js
tests/after-live-recovery.test.js
docs/TRIAL_AFTER_LIVE.md
```

Important updated files:

```text
package.json
scripts/post-session-recovery.js
scripts/trial-status.js
scripts/trial-readiness.js
scripts/freeze-trial-candidate.js
scripts/generate-trial-dispatch.js
scripts/prepare-local-trial.js
scripts/run-intake-review-dry-run.js
tests/trial-status.test.js
docs/PROJECT_STATUS.md
docs/FIRST_TRIAL_RUNBOOK.md
docs/LOCAL_TRIAL_PACKAGE.md
docs/RELEASE_CHECKLIST.md
docs/TRIAL_STATUS.md
docs/TRIAL_LIVE_CAPTURE.md
```

## Verification Baseline

Latest completed verification after 2.8:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run health
npm.cmd run trial:ready
npm.cmd run trial:status
```

Results:

- `check`: passed.
- `test`: passed, 92 tests.
- `health`: passed.
- `trial:ready`: passed in source and generated local trial package.
- `trial:status`: `NEEDS_TESTER_INTAKE`.

Current product status:

- The code is ready for the next local real tester intake/session cycle.
- There is no long-running server or background task that must be preserved across reboot.
- Generated/local output remains under ignored `dist/`, `.codeclaw/`, and `server-bg.log`.

## Next Planned Stage

Next:

```text
Stage 2.9: next tester launch loop hardening
```

Recommended 2.9 goal:

Build a guarded tester-2 launch loop check that confirms the project is ready to move from tester 1 after-live recovery into tester 2 hosting.

Planned order:

1. Add a command such as `trial:next-live` or `trial:next-tester-ready`.
2. Confirm `trial:after-live` passed for the previous tester.
3. Confirm current tester intake is ready and anonymous.
4. Confirm next session pack, host-ready, host-run, pre-live, and live-capture are aligned to the same tester id.
5. Block stale tester 1 session folders, stale watch items, dry-run ids, or missing host acceptance.
6. Generate a concise tester-2 host handoff note with accepted watch items and stop conditions.
7. Update `trial:status` to recommend the new loop check after 2.8 passes.
8. Add tests for ready, stale tester id, missing after-live, and stale watch item cases.
9. Update docs and package/readiness required docs.

Suggested verification for 2.9:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run health
npm.cmd run trial:ready
npm.cmd run trial:status
```

## User Working Preference

The user wants every future task to:

- First do deeper thinking and planning.
- Then implement.
- Then verify.
- Then summarize in beginner-friendly Chinese.
- Then plan the next task.
- Prefer longer, complete task runs rather than stopping halfway.

Keep this rhythm unless the user explicitly asks for a shorter answer.

## Push Workflow

The user usually pushes with:

```powershell
cd "C:\Users\ZFJJi\Desktop\AI Agent\码爪 CodeClaw\项目工程"
git pushall
```

If push has problems, inspect:

```powershell
git remote -v
git status --short --branch
git log -3 --oneline
```

Do not use destructive git commands. Do not reset or checkout user changes unless explicitly requested.

## Safety Notes

- Never commit real tester rosters.
- Never commit raw real tester feedback/session records.
- Keep `.codeclaw/`, `dist/`, and `server-bg.log` ignored/local.
- Keep after-live packets local-only unless a human privacy review approves a summary.
- Do not copy screenshots, logs, source files, contact details, project paths, or secrets into shareable packets.

## Useful Commands

Status:

```powershell
npm.cmd run trial:status
```

After a live tester session:

```powershell
npm.cmd run trial:after-live -- --session dist/trial-session-packs/tester-1 --tester tester-1 --force
```

Real tester intake:

```powershell
npm.cmd run trial:intake -- --init
npm.cmd run trial:intake
npm.cmd run trial:intake-session -- --force
```

Host gates:

```powershell
npm.cmd run trial:host-ready
npm.cmd run trial:host-run
npm.cmd run trial:pre-live
npm.cmd run trial:live-capture
```

Full verification:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run health
npm.cmd run trial:ready
npm.cmd run trial:status
```

## Suggested First Action After Restart

Do not immediately code. First ask Codex to read:

```text
docs/HANDOFF_RESTART.md
docs/PROJECT_STATUS.md
package.json
scripts/trial-status.js
scripts/after-live-recovery.js
```

Then begin Stage 2.9 planning.
