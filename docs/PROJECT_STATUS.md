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

Stage 1.6 is complete: hosted trial operator dashboard and command guide.

Implemented and verified:

- `trial:status` operator dashboard.
- `dist/TRIAL_STATUS_REPORT.md` and `dist/TRIAL_STATUS_REPORT.json` outputs.
- Current stage, next command, next action, quick links, report matrix, blockers, warnings, and command guide.
- Latest package, session pack, and archive detection.
- Empty-state, ready-to-host, privacy-hold, and archived expansion-ready tests.
- Trial runbook, go/no-go checklist, release checklist, session-pack guide, post-session guide, archive guide, dispatch docs, and trial package readiness were updated.

Latest verification:

- `npm.cmd run test`: passed, 63 tests.
- `npm.cmd run check`: passed.
- `npm.cmd run health`: passed.
- `npm.cmd run trial:ready`: passed in source and generated local trial package.
- `npm.cmd run trial:simulate`: passed.
- `npm.cmd run trial:freeze`: `GO_HOSTED_TRIAL`.
- `npm.cmd run trial:dispatch`: `READY_TO_SEND`.
- `npm.cmd run trial:status`: `READY_TO_EXPAND`.

Stage 2.0 is complete: real tester intake and first external session preparation.

Implemented and verified:

- `trial:intake` local-only tester intake workflow.
- `.codeclaw/trial-intake/TESTER_ROSTER.json` local roster template.
- `dist/TRIAL_TESTER_INTAKE_REPORT.md` and `dist/TRIAL_TESTER_INTAKE_REPORT.json` outputs.
- Anonymous tester id, language, consent, privacy acceptance, allowed scope, and project permission validation.
- Personal fields such as real name, email, phone, company, GitHub, Gitee, and private project names are blocked.
- `.codeclaw/trial-intake/` is ignored by Git and excluded from local trial packages.
- `trial:status` now requires tester intake before recommending the next real session pack.
- Trial runbook, go/no-go checklist, release checklist, status guide, session-pack guide, dispatch docs, and trial package readiness were updated.

Latest verification:

- `npm.cmd run test`: passed, 68 tests.
- `npm.cmd run check`: passed.
- `npm.cmd run health`: passed.
- `npm.cmd run trial:ready`: passed in source and generated local trial package.
- `npm.cmd run trial:intake -- --init --force`: `WAITING_FOR_TESTER_INTAKE`.
- `npm.cmd run trial:status`: `NEEDS_TESTER_INTAKE`.
- `npm.cmd run trial:simulate`: passed.
- `npm.cmd run trial:freeze`: `GO_HOSTED_TRIAL`.
- `npm.cmd run trial:dispatch`: `READY_TO_SEND`.

Stage 2.1 is complete: first real tester session pack from intake.

Implemented and verified:

- `trial:intake-session` generates a session pack from `TRIAL_TESTER_INTAKE_REPORT.json`.
- The command selects the first ready anonymous tester or a specific `--tester`.
- It blocks when intake is missing, not ready, held, or the selected tester is blocked.
- Generated `SESSION_BRIEF.md` includes a tester intake section with language, host language, allowed scope, consent status, privacy status, and review flag.
- Generated `SESSION_PACK_MANIFEST.json` includes intake metadata.
- `trial:status` now recommends `trial:intake-session -- --force` after intake is ready.
- Automated tests cover ready intake session generation and intake hold blocking.

Latest verification:

- `node --check scripts\generate-intake-session.js`: passed.
- `node --check tests\intake-session.test.js`: passed.
- `npm.cmd run test`: passed, 70 tests.
- `npm.cmd run check`: passed.
- `npm.cmd run health`: passed.
- `npm.cmd run trial:ready`: passed in source and generated local trial package.
- `npm.cmd run trial:intake-session -- --force`: correctly blocked with `INTAKE_SESSION_HOLD` because no ready local tester is filled yet.
- `npm.cmd run trial:status`: `NEEDS_TESTER_INTAKE`.
- `npm.cmd run trial:simulate`: passed.
- `npm.cmd run trial:freeze`: `GO_HOSTED_TRIAL`.
- `npm.cmd run trial:dispatch`: `READY_TO_SEND`.

Stage 2.2 is complete: guided first real tester host run.

Implemented and verified:

- `trial:host-run` generates a live `HOST_RUNBOOK.md` after `trial:host-ready` passes.
- `dist/TRIAL_HOST_RUN_REPORT.md` and `dist/TRIAL_HOST_RUN_REPORT.json` record the host-run gate.
- The command blocks when host-ready is missing, held, tester ids do not match, session files are missing, or intake-session is held.
- Generated runbooks include pre-call gates, accepted warnings, tester language and scope, live script steps, watch items, stop conditions, and post-session commands.
- `trial:status` now recommends `trial:host-run` between host-ready and hosting.
- Local archives can include `HOST_RUNBOOK.md` as session context while still excluding raw tester records.
- Trial runbook, local package guide, release checklist, status guide, host-ready guide, session-pack guide, archive guide, dispatch docs, and package readiness were updated.
- Automated tests cover ready host-run generation, host-run blocking, and the new status transition.

Latest verification:

- `node --check scripts\generate-host-run.js`: passed.
- `node --check scripts\trial-status.js`: passed.
- `npm.cmd run test`: passed, 73 tests.
- `npm.cmd run check`: passed.
- `npm.cmd run health`: passed.
- `npm.cmd run trial:ready`: passed in source and generated local trial package.
- `npm.cmd run trial:host-run`: correctly blocked with `HOST_RUN_HOLD` because current local intake-session is not ready.
- `npm.cmd run trial:status`: `NEEDS_TESTER_INTAKE`.
- `npm.cmd run trial:simulate`: passed.
- `npm.cmd run trial:freeze`: `GO_HOSTED_TRIAL`.
- `npm.cmd run trial:dispatch`: `READY_TO_SEND`.

Stage 2.3 is complete: first real tester completion and post-session capture.

Implemented and verified:

- `trial:complete-session` checks completed observation, feedback, and result records before post-session.
- `dist/TRIAL_SESSION_COMPLETION_REPORT.md` and `dist/TRIAL_SESSION_COMPLETION_REPORT.json` record completion readiness.
- The command writes `HOST_COMPLETION_CHECKLIST.md` for session folders.
- It blocks missing required records, empty placeholders, missing go/no-go decisions, obvious personal identity fields, emails, phone numbers, and secret tokens.
- It supports both generated session-pack file names and completed sample names such as `tester-1-feedback.md`.
- `trial:post-session` now runs completion check before privacy check, feedback ingest, backlog generation, next session pack, and host-ready.
- `trial:status` now distinguishes `READY_TO_HOST`, `SESSION_COMPLETION_BLOCKED`, and `READY_FOR_POST_SESSION`.
- Local archives can include `HOST_COMPLETION_CHECKLIST.md` as session context while still excluding raw tester records.
- Trial runbook, local package guide, release checklist, go/no-go guide, status guide, privacy guide, session-pack guide, archive guide, post-session guide, dispatch docs, and package readiness were updated.
- Automated tests cover completed anonymous records, empty placeholders, personal contact data blocking, and the new status transitions.

Latest verification:

- `node --check scripts\session-completion-check.js`: passed.
- `node --check scripts\post-session-recovery.js`: passed.
- `node --check scripts\trial-status.js`: passed.
- `npm.cmd run test`: passed, 77 tests.
- `npm.cmd run check`: passed.
- `npm.cmd run health`: passed.
- `npm.cmd run trial:complete-session -- --session examples\trial-feedback-sample --checklist dist\TRIAL_SAMPLE_COMPLETION_CHECKLIST.md`: `SESSION_COMPLETION_READY`.
- `npm.cmd run trial:post-session -- --session examples\trial-feedback-sample --next-tester tester-2`: `READY_FOR_NEXT_TESTER`.
- `npm.cmd run trial:ready`: passed in source and generated local trial package.
- `npm.cmd run trial:status`: `NEEDS_TESTER_INTAKE`.
- `npm.cmd run trial:simulate`: passed.
- `npm.cmd run trial:freeze`: `GO_HOSTED_TRIAL`.
- `npm.cmd run trial:dispatch`: `READY_TO_SEND`.

Stage 2.4 is complete: first real tester artifact review and fix selection.

Implemented and verified:

- `trial:review-session` combines completion, privacy, feedback, backlog, post-session, and archive evidence into one host decision brief.
- `dist/TRIAL_REVIEW_REPORT.md` and `dist/TRIAL_REVIEW_REPORT.json` record fix-now, watch-next-tester, or proceed decisions.
- Review decisions include `REVIEW_WAITING_FOR_REPORTS`, `REVIEW_BLOCKED`, `REVIEW_FIX_NOW`, `REVIEW_WATCH_NEXT_TESTER`, and `REVIEW_PROCEED`.
- Every generated P0/P1 action item includes owner, action, verification command, and evidence.
- `trial:status` now requires session review after post-session and before archive/next-tester flow.
- Local archives copy review reports as evidence.
- Trial runbook, local package guide, release checklist, go/no-go guide, status guide, post-session guide, archive guide, dispatch docs, and package readiness were updated.
- Automated tests cover clean proceed, P1 watch with ownership and verification, P0 fix-now blocking, and the new status transition.

Latest verification:

- `node --check scripts\review-trial-session.js`: passed.
- `node --check scripts\trial-status.js`: passed.
- `npm.cmd run test`: passed, 81 tests.
- `npm.cmd run check`: passed.
- `npm.cmd run health`: passed.
- `npm.cmd run trial:review-session -- --session examples\trial-feedback-sample --reports dist --tester tester-1`: `REVIEW_WATCH_NEXT_TESTER`.
- `npm.cmd run trial:ready`: passed in source and generated local trial package.
- `npm.cmd run trial:status`: `NEEDS_TESTER_INTAKE`.
- `npm.cmd run trial:simulate`: passed.
- `npm.cmd run trial:freeze`: `GO_HOSTED_TRIAL`.
- `npm.cmd run trial:dispatch`: `READY_TO_SEND`.

## Next Planned Phase

Stage 2.5: real tester intake-to-review dry run.

Planned order:

1. Add a non-private fixture that simulates one anonymous ready tester from intake through review.
2. Run the whole scripted path: intake, intake-session, host-ready, host-run, completion, post-session, review, status.
3. Ensure generated live artifacts stay in ignored folders.
4. Ensure no local roster or raw real tester data can enter the package.
5. Use the dry run as the final rehearsal before filling the real tester roster.
