# CodeClaw Project Status

Updated: 2026-07-09

## Completed Phase

Stage 1.3 is complete: hosted trial privacy protection and redaction checks.

Implemented and verified:

- `trial:privacy-check` privacy gate for completed trial session records.
- `trial:post-session` now stops before feedback ingest if privacy checks fail.
- Privacy reports are generated at `dist/TRIAL_PRIVACY_REPORT.md` and `dist/TRIAL_PRIVACY_REPORT.json`.
- Risk fixture is excluded from the local trial package.
- Automated privacy tests cover safe feedback, unsafe feedback blocking, and secret redaction.

Latest verification:

- `npm.cmd run test`: passed, 55 tests.
- `npm.cmd run check`: passed.
- `npm.cmd run health`: passed.

Stage 1.4 is complete: real trial cohort summary and multi-tester result matrix.

Implemented and verified:

- `trial:cohort-summary` multi-tester expansion gate.
- `dist/TRIAL_COHORT_SUMMARY.md` and `dist/TRIAL_COHORT_SUMMARY.json` outputs.
- Tester matrix with privacy, feedback, backlog, post-session, must-fix, and watch status.
- Repeated friction and repeated safety theme detection.
- Sample cohort fixture at `examples/trial-cohort-sample`.
- Automated cohort summary tests for watched expansion and privacy-hold blocking.
- Trial runbook, go/no-go checklist, release checklist, session-pack guide, post-session guide, dispatch docs, and trial package readiness were updated.

Latest verification:

- `npm.cmd run test`: passed, 57 tests.
- `npm.cmd run check`: passed.
- `npm.cmd run health`: passed.
- `npm.cmd run trial:ready`: passed in source and generated local trial package.
- `npm.cmd run trial:simulate`: passed.
- `npm.cmd run trial:freeze`: `GO_HOSTED_TRIAL`.
- `npm.cmd run trial:dispatch`: `READY_TO_SEND`.

Stage 1.5 is complete: local trial archive workflow and evidence packaging.

Implemented and verified:

- `trial:archive-session` local-only archive workflow.
- Privacy gate blocks missing privacy reports and `PRIVACY_HOLD` sessions.
- `PRIVACY_REVIEW` archives are marked local-only and require host review.
- Archives copy report evidence and session context only.
- Raw tester records, screenshots, logs, and source files are excluded by default.
- Archive manifest and sharing checklist are generated inside `dist/trial-archives/<tester-id>-<timestamp>/`.
- Automated archive tests cover safe archive creation and privacy-hold blocking.

Latest verification:

- `npm.cmd run test`: passed, 59 tests.
- `npm.cmd run check`: passed.
- `npm.cmd run health`: passed.
- `npm.cmd run trial:ready`: passed in source and generated local trial package.
- `npm.cmd run trial:simulate`: passed.
- `npm.cmd run trial:archive-session`: `ARCHIVE_READY_LOCAL`.
- `npm.cmd run trial:freeze`: `GO_HOSTED_TRIAL`.
- `npm.cmd run trial:dispatch`: `READY_TO_SEND`.

## Next Planned Phase

Stage 1.6: hosted trial operator dashboard and command guide.

Planned order:

1. Add a concise operator dashboard report that reads readiness, dispatch, host-ready, post-session, cohort, and archive reports.
2. Generate one current status page with next command, current blocker, latest package path, latest session pack, and latest archive path.
3. Add `trial:status` as the single command to orient the host before or after each trial step.
4. Add tests for empty-state, ready-to-host, post-session-ready, and archive-ready states.
