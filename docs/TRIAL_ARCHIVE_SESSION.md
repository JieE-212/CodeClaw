# CodeClaw Trial Archive Session

Use this after `trial:post-session` and, when applicable, `trial:cohort-summary`.

The archive workflow creates a local evidence package for one completed tester session. It intentionally does not copy raw tester records by default.

## Run

For the default tester 1 session:

```bash
npm.cmd run trial:archive-session
```

For a specific session:

```bash
npm.cmd run trial:archive-session -- --session dist/trial-session-packs/tester-1 --tester tester-1
```

For a specific reports folder:

```bash
npm.cmd run trial:archive-session -- --session dist/trial-session-packs/tester-1 --reports dist --tester tester-1
```

The command writes:

```text
dist/TRIAL_ARCHIVE_REPORT.md
dist/TRIAL_ARCHIVE_REPORT.json
dist/trial-archives/<tester-id>-<timestamp>/
```

The archive folder contains:

```text
ARCHIVE_MANIFEST.json
ARCHIVE_MANIFEST.md
SHARING_CHECKLIST.md
reports/
session-context/
```

`session-context/` may include `SESSION_PACK_MANIFEST.json`, `SESSION_BRIEF.md`, and `HOST_RUNBOOK.md`. It still excludes raw tester records by default.

## Privacy Gate

The command requires `TRIAL_PRIVACY_REPORT.json`.

It blocks when privacy is:

```text
PRIVACY_HOLD
MISSING
```

It creates a local-only review archive when privacy is:

```text
PRIVACY_REVIEW
```

It creates a local-only ready archive when privacy is:

```text
PRIVACY_OK
```

## Raw Records

The archive does not copy these by default:

- `HUMAN_TRIAL_OBSERVATION.md`
- `TRIAL_FEEDBACK_TEMPLATE.md`
- `TRIAL_RESULT_RECORD.md`
- tester screenshots
- logs
- source files

Keep raw records in the original session folder unless a separate human privacy review approves sharing them.

## Sharing Rule

Default stance: keep the archive local.

Only share high-level summaries after a human review removes tester names, personal paths, source code, screenshots, logs, and secrets.

After archiving, run:

```bash
npm.cmd run trial:status
```

Use the status report to decide whether to host the next tester, expand the cohort, or fix blockers.
