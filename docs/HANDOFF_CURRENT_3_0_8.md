# CodeClaw Current Handoff For 3.0.8

Updated: 2026-07-10

## One-Sentence State

CodeClaw is complete through 3.0.7. The pre-human-tester operator flow is polished and verified, but no real human tester has completed a session; 3.0.8 is the real tester-2 first-live and after-live phase and must wait for a real person.

## Start Here

Run:

```powershell
cd "C:\Users\ZFJJi\Desktop\AI Agent\码爪 CodeClaw\项目工程"
git status --short --branch
git log -5 --oneline
```

Latest completed implementation commit:

```text
b6fee7c Polish pre-human tester operator flow
```

The branch may be ahead until the user runs:

```powershell
git pushall
```

## Must Read

Read these before changing code or starting a real session:

```text
docs/HANDOFF_RESTART.md
docs/PROJECT_STATUS.md
docs/TRIAL_FIRST_LIVE_STANDBY.md
docs/TRIAL_RECORD_DRAFT.md
docs/TRIAL_AFTER_LIVE.md
docs/TRIAL_STATUS.md
package.json
```

For the operator UI, also read:

```text
apps/web/public/index.html
apps/web/public/app.js
apps/web/public/i18n.js
apps/web/public/styles.css
```

## What 3.0.7 Added

The in-app `Trial host checklist` now has four operational stages:

```text
while waiting -> before the call -> during the call -> immediately after
```

It includes copyable commands for:

```powershell
npm.cmd run trial:first-live-standby -- --tester tester-2
npm.cmd run trial:post-call-rehearsal -- --force
npm.cmd run trial:record-draft -- --session dist\trial-session-packs\tester-2
npm.cmd run trial:after-live -- --session dist\trial-session-packs\tester-2 --tester tester-2 --force
```

Other completed work:

- Copy success and failure feedback works with a clipboard fallback.
- English, zh-CN, and Russian operator copy has full key parity.
- Health checks require the operator guide and all four commands.
- Trial status and local package docs use the same operator rhythm.
- Tester-2 remains explicitly paused until a real person is available.

## Verification Baseline

These passed after 3.0.7:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run health
npm.cmd run i18n:check
npm.cmd run trial:ready
npm.cmd run trial:first-live-standby -- --tester tester-2
npm.cmd run trial:post-call-rehearsal -- --force
```

Results:

```text
120 tests passed
trialOperator: true
506 i18n keys per language, no warnings
trial:ready passed in source and generated package
FIRST_LIVE_STANDBY_READY_WITH_REVIEW
standby blockers: 0
standby warnings: 5
POST_CALL_REHEARSAL_READY_WITH_REVIEW
rehearsal blockers: 0
```

The in-app browser had no available browser instance during 3.0.7. HTTP health and packaged UI marker checks passed, but the first 3.0.8 action is a real-browser visual and copy check before the live call.

## Current Human-Tester Reality

There is no completed real tester session.

Do not:

- invent tester-1 or tester-2 feedback
- create fake after-live evidence for tester-2
- count `tester-rehearsal-*` output as real evidence
- start tester-2 before a real human is scheduled
- use Apply on a real project during this first-live session

Keep raw records, screenshots, logs, contact details, private paths, source snippets, and secrets out of Git.

## Next Task: 3.0.8

Start only when the user confirms a real human tester is available.

Planned order:

1. Open the local app and visually check the operator panel in English, zh-CN, and Russian at desktop and narrow widths. Test one Copy button.
2. Run `npm.cmd run trial:first-live-standby -- --tester tester-2` immediately before the call.
3. Host only on `FIRST_LIVE_STANDBY_READY` or accepted `FIRST_LIVE_STANDBY_READY_WITH_REVIEW`.
4. Read all five current warnings; refresh any stale report if the warning list changes into a blocker.
5. Keep `HOST_RUNBOOK.md`, `LIVE_SESSION_CAPTURE.md`, `HUMAN_TRIAL_OBSERVATION.md`, `TRIAL_FEEDBACK_TEMPLATE.md`, and `TRIAL_RESULT_RECORD.md` open.
6. Limit the live session to Demo plus real-project read-only preflight and stop before Apply.
7. After the call, fill only confirmed anonymous records and keep raw notes local.
8. Run `trial:record-draft`, copy only confirmed values, fill remaining human answers, then run `trial:after-live`.
9. Review the after-live decision and preserve only the local privacy-safe evidence packet.

## Stop Conditions

Do not host if standby is waiting, needs refresh, or blocked.

Stop the call if:

- consent or privacy acceptance is unclear
- the tester wants to use Apply on a real project
- a note would include contact data, secrets, private project names, screenshots, logs, or source snippets
- the host cannot explain a warning or the next action

## Local-Only Outputs

Never commit:

```text
.codeclaw/
dist/
node_modules/
server-bg.log
raw tester records
screenshots
logs
source snippets
contact info
API keys
secret tokens
private project paths
```

## Commit And Push Rhythm

For future implementation work:

1. Plan briefly.
2. Implement.
3. Verify.
4. Commit locally.
5. Tell the user to run `git pushall`.

Do not push directly unless the user explicitly asks.
