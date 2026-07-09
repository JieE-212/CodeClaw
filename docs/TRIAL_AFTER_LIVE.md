# CodeClaw Trial After-Live Recovery

Use this after the first real tester call, after the host has filled the generated session records.

## Command

```bash
npm.cmd run trial:after-live -- --session dist/trial-session-packs/tester-1 --tester tester-1
```

Optional:

```bash
npm.cmd run trial:after-live -- --session <session-folder> --tester <tester-id> --next-tester <next-tester-id> --force
```

## What It Runs

The command runs these gates in order and stops at the first unsafe step:

1. `trial:complete-session`
2. `trial:privacy-check`
3. `trial:post-session`
4. `trial:review-session`
5. `trial:archive-session`
6. `trial:status`

It stops immediately when records are incomplete, privacy is held, post-session fails, review says fix now, or archive is held.

## Outputs

```text
dist/TRIAL_AFTER_LIVE_REPORT.md
dist/TRIAL_AFTER_LIVE_REPORT.json
dist/trial-after-live/<tester-id>-<timestamp>/
```

The evidence packet copies generated reports and safe session context only.

It may include:

```text
LIVE_SESSION_HOST_SUMMARY.md
SESSION_PACK_MANIFEST.json
SESSION_BRIEF.md
HOST_RUNBOOK.md
HOST_COMPLETION_CHECKLIST.md
```

It excludes:

```text
HUMAN_TRIAL_OBSERVATION.md
TRIAL_FEEDBACK_TEMPLATE.md
TRIAL_RESULT_RECORD.md
screenshots
logs
source files
contact details
secret tokens
```

## Decisions

```text
AFTER_LIVE_BLOCKED
AFTER_LIVE_READY_WITH_REVIEW
AFTER_LIVE_READY
```

Proceed only when the decision is `AFTER_LIVE_READY`, or when it is `AFTER_LIVE_READY_WITH_REVIEW` and the host accepts the watch items or privacy/archive warnings.

## After It Passes

Run:

```bash
npm.cmd run trial:status
```

Then follow the next command in `dist/TRIAL_STATUS_REPORT.md`.

Keep the after-live packet local by default. Share only high-level decisions and anonymous counts unless a human privacy review approves more.
