# CodeClaw Trial Feedback Ingest

Use this after the first hosted tester finishes. The goal is to turn completed Markdown feedback into a repeatable tester-2 decision instead of relying on memory from the session.

## Inputs

Create a folder for completed trial notes, for example:

```text
docs/trial-feedback/tester-1/
```

Place any completed Markdown files there. Recommended minimum:

```text
TRIAL_FEEDBACK_TEMPLATE.md
HUMAN_TRIAL_OBSERVATION.md
TRIAL_RESULT_RECORD.md
```

Do not put real project source code, API keys, logs, or screenshots with secrets in this folder.

## Run

From the project root:

```bash
npm.cmd run trial:ingest-feedback -- docs/trial-feedback/tester-1
```

If no folder is passed, the command reads:

```text
docs/trial-feedback
```

The command writes:

```text
dist/TRIAL_FEEDBACK_SUMMARY.md
dist/TRIAL_FEEDBACK_SUMMARY.json
```

To test the parser without real user records, run:

```bash
npm.cmd run trial:ingest-feedback -- examples/trial-feedback-sample
```

## Decisions

The summary can return:

```text
WAITING_FOR_FEEDBACK
NO_GO_FIX_FIRST
REVIEW_BEFORE_TESTER_2
NEEDS_HOST_DECISION
READY_WITH_WATCH_ITEMS
READY_FOR_TESTER_2
```

Treat `NO_GO_FIX_FIRST` as a stop. Fix the listed blockers, rerun the trial package checks, and do not invite tester 2 yet.

Treat `REVIEW_BEFORE_TESTER_2` or `NEEDS_HOST_DECISION` as a host review step. Fill the missing go/no-go fields or explicitly accept the warnings.

Treat `READY_WITH_WATCH_ITEMS` as acceptable for tester 2 only when the host agrees the warnings are not safety blockers.

## What It Extracts

The ingest script reads:

- Completed table rows with `Result` columns.
- Completed bullet fields such as `Proceed to tester 2: Yes / No`.
- Numbered issue lists under issue, friction, trust, host note, and go/no-go sections.
- Safety signals involving Apply, Verify, writes, preflight, commands, API keys, or trust.

It groups friction into themes such as startup, language, Demo vs real project mode, path entry, preflight, safety, model setup, patch review, verification, audit, docs, and feedback completeness.

## Recommended Loop

1. Run `trial:ingest-feedback` after tester 1.
2. Run `trial:fix-backlog`.
3. Read `dist/TRIAL_FEEDBACK_SUMMARY.md` and `dist/TRIAL_FIX_BACKLOG.md`.
4. Fix any `P0` item before tester 2.
5. Rerun:

```bash
npm.cmd run trial:simulate
npm.cmd run trial:ready
npm.cmd run trial:freeze
npm.cmd run trial:dispatch
```

6. Invite tester 2 only after the feedback summary, fix backlog, and freeze/dispatch reports agree.

7. Generate a session pack before the next tester:

```bash
npm.cmd run trial:session-pack -- --tester tester-2
```
