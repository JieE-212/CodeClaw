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

## Next Planned Phase

Stage 2.2: guided first real tester host run.

Planned order:

1. Fill the local tester roster for the first real tester using an anonymous id.
2. Run `trial:intake`, then `trial:intake-session -- --force`.
3. Run `trial:host-ready` and `trial:status` immediately before hosting.
4. Use the generated `SESSION_BRIEF.md` as the live host script.
5. Record the first real session using the generated observation, feedback, and result files.
