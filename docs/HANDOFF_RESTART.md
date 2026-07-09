# CodeClaw Restart Handoff

Use this document after restarting the computer or Codex to resume work without rediscovering context.

Updated: 2026-07-09

## Restart Prompt

After restarting, open Codex in this project and send:

```text
请先读取 docs/HANDOFF_RESTART.md 和 docs/PROJECT_STATUS.md，接上 CodeClaw 当前进度。当前 2.9 已完成，下一轮按规划进入 3.0。请先深入规划，再开始执行；每轮结束后继续规划下一轮任务。
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

If PowerShell displays the Chinese path as mojibake, still use the actual folder shown in Explorer.

## Current Git State

Latest known commit before 2.9 work:

```text
2714e05 Add after-live recovery workflow
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

If the user has not pushed after 2.9, they can push with:

```powershell
git pushall
```

## Current Stage

Completed:

```text
Stage 3.0.1: two-tester cohort handoff hardening
```

3.0.1 added:

- `trial:cohort-handoff` expansion handoff gate.
- Reads `TRIAL_COHORT_SUMMARY.json` and after-live evidence under `dist/trial-after-live/`.
- Blocks fewer than two completed testers, missing after-live evidence, blocked after-live reports, unaccepted repeated watch items, and unaccepted privacy warnings.
- Converts repeated watch items, repeated safety themes, and privacy warnings into a clear hold/review/expand decision.
- Generates:

```text
dist/TRIAL_COHORT_HANDOFF.md
dist/TRIAL_COHORT_HANDOFF.json
dist/COHORT_EXPANSION_HANDOFF.md
```

Important new files:

```text
scripts/cohort-handoff.js
tests/cohort-handoff.test.js
docs/TRIAL_COHORT_HANDOFF.md
```

Important updated files:

```text
package.json
scripts/trial-status.js
scripts/trial-readiness.js
scripts/prepare-local-trial.js
tests/trial-status.test.js
docs/PROJECT_STATUS.md
docs/HANDOFF_RESTART.md
docs/LOCAL_TRIAL_PACKAGE.md
docs/RELEASE_CHECKLIST.md
docs/TRIAL_STATUS.md
docs/TRIAL_COHORT_SUMMARY.md
```

Previous completed stage:

```text
Stage 2.9: next tester launch loop hardening
```

What 2.9 added:

- `trial:next-live` guarded next-live launch gate.
- Confirms the previous tester passed `trial:after-live`.
- Confirms intake, intake-session, host-ready, host-run, pre-live, live-capture, session manifest, and session folder all point to the same next anonymous tester id.
- Blocks previous-tester reuse, dry-run tester ids, stale previous session folders, missing after-live, missing host acceptance, and stale accepted watch items.
- Generates a next tester host handoff note with accepted watch items, launch files, stop conditions, and after-call command.
- `trial:status` now recognizes:

```text
NEEDS_NEXT_LIVE
NEXT_LIVE_BLOCKED
READY_TO_HOST_NEXT_LIVE
```

Generated outputs:

```text
dist/TRIAL_NEXT_LIVE_REPORT.md
dist/TRIAL_NEXT_LIVE_REPORT.json
dist/trial-session-packs/<tester-id>/NEXT_LIVE_HOST_HANDOFF.md
```

Important new files:

```text
scripts/next-live-gate.js
tests/next-live-gate.test.js
docs/TRIAL_NEXT_LIVE.md
```

Important updated files:

```text
package.json
scripts/trial-status.js
scripts/trial-readiness.js
scripts/prepare-local-trial.js
tests/trial-status.test.js
docs/PROJECT_STATUS.md
docs/HANDOFF_RESTART.md
docs/LOCAL_TRIAL_PACKAGE.md
docs/RELEASE_CHECKLIST.md
docs/TRIAL_STATUS.md
```

2.8 remains complete and still provides the after-call workflow:

```text
trial:after-live
dist/TRIAL_AFTER_LIVE_REPORT.md
dist/trial-after-live/<tester-id>-<timestamp>/
```

## Verification Baseline

Latest completed verification after 3.0.1:

```powershell
node --check scripts\cohort-handoff.js
node --test tests\cohort-handoff.test.js
node --test tests\trial-status.test.js tests\cohort-handoff.test.js
npm.cmd run check
npm.cmd test
npm.cmd run health
npm.cmd run trial:ready
npm.cmd run trial:status
```

Results:

- `node --check scripts\cohort-handoff.js`: passed.
- `node --test tests\cohort-handoff.test.js`: passed.
- `node --test tests\trial-status.test.js tests\cohort-handoff.test.js`: passed.
- `check`: passed.
- `test`: passed, 104 tests.
- `health`: passed.
- `trial:ready`: passed in source and generated local trial package.
- `trial:status`: `NEEDS_TESTER_INTAKE`.

Current expected product status:

- The code is ready for the next local real tester intake/session cycle.
- `trial:status` should still be `NEEDS_TESTER_INTAKE` until a real anonymous tester roster is filled.
- There is no long-running server or background task that must be preserved across reboot.
- Generated/local output remains under ignored `dist/`, `.codeclaw/`, and `server-bg.log`.

## Next Planned Stage

Next:

```text
Stage 3.0.2: real tester-2 launch and after-live evidence
```

Recommended 3.0.2 goal:

Use the 2.9 next-live gate in the real tester-2 flow, then close tester 2 with after-live and generate the two-tester cohort handoff.

Planned order:

1. Fill a real anonymous tester-2 intake roster entry locally.
2. Generate tester-2 intake-session, host-ready, host-run, pre-live, and live-capture.
3. Run `trial:next-live -- --tester tester-2 --accept-review`.
4. Host tester 2 using `NEXT_LIVE_HOST_HANDOFF.md`.
5. Run `trial:after-live` for tester 2 after records are filled.
6. Run `trial:cohort-summary` across tester 1 and tester 2 evidence.
7. Run `trial:cohort-handoff`.
8. Use `COHORT_EXPANSION_HANDOFF.md` to decide whether to fix first or expand to 3-5 testers.

Suggested verification for 3.0:

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
- Keep after-live packets and next-live handoffs local-only unless a human privacy review approves a summary.
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

Before the next live tester:

```powershell
npm.cmd run trial:next-live -- --tester tester-2 --accept-review --accepted-by <host-id>
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
scripts/next-live-gate.js
```

Then begin Stage 3.0.2 planning.
