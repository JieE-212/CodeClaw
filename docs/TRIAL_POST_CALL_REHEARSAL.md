# CodeClaw Post-Call Rehearsal

Use this while waiting for a real tester to rehearse the post-call flow with synthetic anonymous data.

This command does not create real tester feedback. It only verifies that the local post-call pipeline still works.

## Run

```bash
npm.cmd run trial:post-call-rehearsal -- --force
```

It writes:

```text
dist/TRIAL_POST_CALL_REHEARSAL_REPORT.md
dist/TRIAL_POST_CALL_REHEARSAL_REPORT.json
dist/trial-post-call-rehearsals/post-call-latest/
```

## What It Does

The rehearsal creates an isolated synthetic session under `dist/trial-post-call-rehearsals/` and runs:

```bash
npm.cmd run trial:record-draft
npm.cmd run trial:after-live
npm.cmd run trial:first-live-standby -- --tester tester-2
```

The synthetic tester ids must include `rehearsal`, such as:

```text
tester-rehearsal-1
tester-rehearsal-2
```

The command refuses real-looking tester ids such as `tester-2`.

## Decisions

```text
POST_CALL_REHEARSAL_READY
POST_CALL_REHEARSAL_READY_WITH_REVIEW
POST_CALL_REHEARSAL_BLOCKED
```

`POST_CALL_REHEARSAL_READY_WITH_REVIEW` is acceptable for rehearsal when after-live produces watch items that require host review.

## Rules

- Do not count rehearsal output as tester feedback.
- Do not use rehearsal output to justify product decisions that require a real human tester.
- Keep rehearsal output local.
- Continue to wait for a real tester before running the real first-live session.

## Real Tester Flow Later

When the real tester is available, use:

```bash
npm.cmd run trial:first-live-standby -- --tester tester-2
```

After the real call, use:

```bash
npm.cmd run trial:record-draft -- --session dist/trial-session-packs/tester-2
npm.cmd run trial:after-live -- --session dist/trial-session-packs/tester-2 --tester tester-2 --force
```
