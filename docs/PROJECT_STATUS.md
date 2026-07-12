# CodeClaw Project Status

Updated: 2026-07-13

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

Stage 2.5 is complete: real tester intake-to-review dry run.

Implemented and verified:

- `trial:intake-review-dry-run` rehearses one anonymous tester from intake through review.
- The dry run creates an anonymous local roster under `dist/trial-dry-runs/<run-id>/`, not under `.codeclaw/`.
- The command runs package creation, intake, intake-session, host-ready, host-run, completion, post-session, review, and status in order.
- It seeds safe completed records with anonymous tester and host ids so completion, privacy, feedback, backlog, post-session, and review gates are exercised end to end.
- The final reports are generated at `dist/TRIAL_INTAKE_REVIEW_DRY_RUN_REPORT.md` and `dist/TRIAL_INTAKE_REVIEW_DRY_RUN_REPORT.json`.
- Package hygiene checks confirm dry-run tester roster and dry-run artifacts are not copied into the generated local trial package.
- `trial:status` now links the dry-run report when present without making it a hard blocker.
- Trial runbook, local package guide, release checklist, status guide, dispatch docs, and package readiness were updated.
- Automated tests cover the full anonymous dry run and package hygiene.

Latest verification:

- `node --check scripts\run-intake-review-dry-run.js`: passed.
- `node --check tests\intake-review-dry-run.test.js`: passed.
- `npm.cmd run check`: passed.
- `npm.cmd test`: passed, 82 tests.
- `npm.cmd run health`: passed.
- `npm.cmd run trial:ready`: passed in source and generated local trial package.
- `npm.cmd run trial:intake-review-dry-run -- --force --run-id intake-review-latest`: `DRY_RUN_READY_FOR_REAL_INTAKE`.
- `npm.cmd run trial:status`: `NEEDS_TESTER_INTAKE`.

Stage 2.6 is complete: real tester roster handoff and first live-session launch gate.

Implemented and verified:

- `trial:pre-live` final gate for the first real hosted tester session.
- The gate checks dry-run readiness, real tester intake, local roster hygiene, intake-session, session pack files, host-ready, host-run, and status evidence.
- It blocks dry-run tester ids such as `tester-dry-run-1` before a real live session.
- It checks the selected tester id, consent, privacy acceptance, and allowed scope across roster, intake report, session manifest, host-ready, and host-run reports.
- It requires `HOST_RUNBOOK.md` and generated session records to exist before hosting.
- `dist/TRIAL_PRE_LIVE_REPORT.md` and `dist/TRIAL_PRE_LIVE_REPORT.json` record `PRE_LIVE_HOLD`, `PRE_LIVE_READY_WITH_HOST_REVIEW`, or `PRE_LIVE_READY_TO_HOST`.
- `trial:status` now recommends `trial:pre-live` after host-run and before `READY_TO_HOST`.
- Trial runbook, local package guide, release checklist, status guide, dispatch docs, and package readiness were updated.
- Automated tests cover a ready pre-live gate, dry-run tester blocking, and the status transition.

Latest verification:

- `node --check scripts\pre-live-gate.js`: passed.
- `node --check tests\pre-live-gate.test.js`: passed.
- `node --check scripts\trial-status.js`: passed.
- `npm.cmd run check`: passed.
- `npm.cmd test`: passed, 85 tests.
- `npm.cmd run health`: passed.
- `npm.cmd run trial:ready`: passed in source and generated local trial package.
- `npm.cmd run trial:status`: `NEEDS_TESTER_INTAKE`.

Stage 2.7 is complete: first real tester live-session operator capture.

Implemented and verified:

- `trial:live-capture` generates the host's live-session capture files before the first real tester call.
- The command writes `LIVE_SESSION_CAPTURE.md` and `LIVE_SESSION_HOST_SUMMARY.md` into the selected session folder.
- It reads `TRIAL_PRE_LIVE_REPORT.json` and blocks when pre-live is missing, held, or not ready.
- It blocks dry-run tester ids before live capture.
- It checks the session folder for screenshots, logs, archives, source files, env/key/cert files, obvious contact data, personal identity fields, and secret tokens.
- It prints the beginner-safe after-call command sequence: completion, privacy, post-session, review, archive, and status.
- `dist/TRIAL_LIVE_CAPTURE_REPORT.md` and `dist/TRIAL_LIVE_CAPTURE_REPORT.json` record `LIVE_CAPTURE_HOLD`, `LIVE_CAPTURE_READY_WITH_REVIEW`, or `LIVE_CAPTURE_READY`.
- `trial:status` now recommends `trial:live-capture` after pre-live and before `READY_TO_HOST`.
- Trial runbook, local package guide, release checklist, status guide, dispatch docs, and package readiness were updated.
- Automated tests cover capture file generation, screenshot/contact-data blocking, and the status transition.

Latest verification:

- `node --check scripts\live-session-capture.js`: passed.
- `node --check tests\live-session-capture.test.js`: passed.
- `node --check scripts\trial-status.js`: passed.
- `npm.cmd run check`: passed.
- `npm.cmd test`: passed, 88 tests.
- `npm.cmd run health`: passed.
- `npm.cmd run trial:ready`: passed in source and generated local trial package.
- `npm.cmd run trial:status`: `NEEDS_TESTER_INTAKE`.

Stage 2.8 is complete: first real tester after-call recovery and evidence packaging.

Implemented and verified:

- `trial:after-live` guarded after-call workflow.
- The command runs completion, privacy, post-session, review, archive, and status in order.
- It stops on incomplete records, privacy hold, post-session failure, review fix-now/block, or archive hold.
- `dist/TRIAL_AFTER_LIVE_REPORT.md` and `dist/TRIAL_AFTER_LIVE_REPORT.json` record the after-live decision.
- A local-only evidence packet is generated under `dist/trial-after-live/<tester-id>-<timestamp>/`.
- Evidence packets copy generated reports and safe session context such as `LIVE_SESSION_HOST_SUMMARY.md`, but exclude raw tester records, screenshots, logs, source files, contact data, and secrets.
- `trial:post-session` now supports an alternate `--reports` directory so isolated after-live runs can avoid report collisions.
- `trial:status` now distinguishes `READY_FOR_AFTER_LIVE`, `NEEDS_AFTER_LIVE`, and `AFTER_LIVE_BLOCKED`.
- Trial runbook, local package guide, release checklist, status guide, dispatch docs, package readiness, and freeze packet docs were updated.
- Automated tests cover successful after-live evidence packaging, incomplete-session blocking, and the new status transitions.

Latest verification:

- `node --check scripts\after-live-recovery.js`: passed.
- `node --check scripts\post-session-recovery.js`: passed.
- `node --test tests\after-live-recovery.test.js`: passed.
- `node --test tests\trial-status.test.js tests\intake-review-dry-run.test.js`: passed.
- `npm.cmd run check`: passed.
- `npm.cmd test`: passed, 92 tests.
- `npm.cmd run health`: passed.
- `npm.cmd run trial:ready`: passed in source and generated local trial package.
- `npm.cmd run trial:status`: `NEEDS_TESTER_INTAKE`.

Stage 2.9 is complete: next tester launch loop hardening.

Implemented and verified:

- `trial:next-live` guarded next-live launch gate.
- The gate confirms the previous tester passed `trial:after-live`.
- It confirms intake, intake-session, host-ready, host-run, pre-live, live-capture, session manifest, and session folder all point to the same next anonymous tester id.
- It blocks previous-tester reuse, dry-run tester ids, stale previous session folders, missing after-live, missing host acceptance, and accepted watch items that were not copied into the next session brief, host runbook, observation checklist, manifest, host-ready report, or host-run report.
- It writes `dist/TRIAL_NEXT_LIVE_REPORT.md` and `dist/TRIAL_NEXT_LIVE_REPORT.json`.
- When ready, it writes `NEXT_LIVE_HOST_HANDOFF.md` into the next tester session folder with accepted watch items, launch files, stop conditions, and after-call command.
- `trial:status` now recognizes `NEEDS_NEXT_LIVE`, `NEXT_LIVE_BLOCKED`, and `READY_TO_HOST_NEXT_LIVE`.
- Trial status, local package, release checklist, package readiness, package manifest text, and next-live docs were updated.
- Automated tests cover ready next-live, stale tester id, missing after-live, stale watch item, and status transitions.

Latest verification:

- `node --check scripts\next-live-gate.js`: passed.
- `node --test tests\next-live-gate.test.js`: passed.
- `node --test tests\trial-status.test.js tests\next-live-gate.test.js`: passed.
- `npm.cmd run check`: passed.
- `npm.cmd test`: passed, 98 tests.
- `npm.cmd run health`: passed.
- `npm.cmd run trial:ready`: passed in source and generated local trial package.
- `npm.cmd run trial:status`: `NEEDS_TESTER_INTAKE`.

Stage 3.0.1 is complete: two-tester cohort handoff hardening.

Implemented and verified:

- `trial:cohort-handoff` expansion handoff gate.
- The command reads `TRIAL_COHORT_SUMMARY.json` and after-live evidence under `dist/trial-after-live/`.
- It blocks fewer than two completed testers, missing after-live evidence, blocked after-live reports, unaccepted repeated watch items, and unaccepted privacy warnings.
- It converts repeated watch items, repeated safety themes, and privacy warnings into one of:
  - `COHORT_HANDOFF_HOLD`
  - `COHORT_HANDOFF_REVIEW_REQUIRED`
  - `COHORT_HANDOFF_EXPAND_WITH_WATCH`
  - `COHORT_HANDOFF_READY_TO_EXPAND`
- When allowed, it writes `dist/COHORT_EXPANSION_HANDOFF.md` for the next 3-5 testers.
- `trial:status` now recommends `trial:cohort-handoff` after cohort summary and waits for it before `READY_TO_EXPAND`.
- Local package, release checklist, cohort summary guide, status guide, package readiness, and package manifest text were updated.
- Automated tests cover accepted watch expansion, missing host acceptance, missing after-live evidence, repeated safety review, and status transitions.

Latest verification:

- `node --check scripts\cohort-handoff.js`: passed.
- `node --test tests\cohort-handoff.test.js`: passed.
- `node --test tests\trial-status.test.js tests\cohort-handoff.test.js`: passed.
- `npm.cmd run check`: passed.
- `npm.cmd test`: passed, 104 tests.
- `npm.cmd run health`: passed.
- `npm.cmd run trial:ready`: passed in source and generated local trial package.
- `npm.cmd run trial:status`: `NEEDS_TESTER_INTAKE`.

Stage 3.0.2a is complete: real tester-2 launch plan guard.

Implemented and verified:

- `trial:tester-launch-plan` privacy-safe tester launch planning report.
- The command reads existing trial reports and does not create real tester data or run a live session.
- It emits the next safe command for tester-2 launch prep.
- It safely waits at `TESTER_LAUNCH_WAITING_FOR_INTAKE` when `.codeclaw/trial-intake/TESTER_ROSTER.json` has no tester entries.
- It ignores stale downstream tester reports until the current intake/session step is ready, avoiding false blockers from old dry-run or tester-1 outputs.
- It blocks dry-run tester ids, previous-tester reuse, and relevant downstream tester-id mismatches once those stages become active.
- It writes `dist/TRIAL_TESTER_LAUNCH_PLAN.md` and `dist/TRIAL_TESTER_LAUNCH_PLAN.json`.
- Trial status links the tester launch plan report when present.
- Local package, release checklist, status guide, package readiness, package manifest text, and tester launch plan docs were updated.
- Automated tests cover waiting for intake, ready for intake-session, ready-to-host, and mismatched tester ids.

Latest verification:

- `node --check scripts\tester-launch-plan.js`: passed.
- `node --test tests\tester-launch-plan.test.js`: passed.
- `npm.cmd run trial:tester-launch-plan -- --tester tester-2`: `TESTER_LAUNCH_WAITING_FOR_INTAKE`.
- `npm.cmd run check`: passed.
- `npm.cmd test`: passed, 108 tests.
- `npm.cmd run health`: passed.
- `npm.cmd run trial:ready`: passed in source and generated local trial package.
- `npm.cmd run trial:status`: `NEEDS_TESTER_INTAKE`.

Stage 3.0.2b is paused: real tester-2 launch is waiting for a human tester.

Current local status:

- `tester-1` has no completed real session records; only empty templates exist.
- `tester-2` has a local anonymous roster entry and a generated session pack.
- `trial:tester-launch-plan -- --tester tester-2 --first-live` allows tester-2 to be hosted as the first real tester without inventing tester-1 after-live evidence.
- The current decision is `TESTER_LAUNCH_READY_TO_HOST` in first-live mode.
- The host must keep tester-2 limited to Demo and real-read-only; do not use Apply on a real project.

Stage 3.0.2c is complete: first-live launch and tester-friction UI hardening.

Implemented and verified:

- Added first-live mode to `trial:tester-launch-plan`.
- Isolated intake-review dry-run reports under the dry-run output folder so local `dist` reports cannot pollute the test.
- Made Demo, example, and real project path modes visually distinct in the workspace.
- Strengthened Apply and Verify safety copy around write and command execution boundaries.

Latest verification:

- `npm.cmd run check`: passed.
- `npm.cmd test`: passed, 110 tests.
- `npm.cmd run health`: passed.
- `npm.cmd run trial:tester-launch-plan -- --tester tester-2 --first-live`: `TESTER_LAUNCH_READY_TO_HOST`.
- Local dev server responded at `http://localhost:4173/`.

Stage 3.0.3 is complete: in-app host checklist for first real tester sessions.

Implemented and verified:

- Added a `Trial host checklist` panel to the workspace.
- The checklist is split into before-call, during-call, and after-call steps.
- It keeps tester-2 scope explicit: Demo plus real-read-only only.
- It makes stop conditions visible in the app: stop before Apply on any real project.
- It reminds the host to keep raw tester records local-only and out of public repos.
- English, zh-CN, and ru dictionaries were updated.

Latest verification:

- `npm.cmd run check`: passed.
- `npm.cmd test`: passed, 110 tests.
- `npm.cmd run health`: passed.
- `npm.cmd run i18n:check`: passed.
- Local dev server responded at `http://localhost:4173/`.

Stage 3.0.4 is complete: local-only post-test record draft handoff.

Implemented and verified:

- Added `trial:record-draft` for turning explicit host/tester notes into draft values for the three session record files.
- The helper writes `dist/TRIAL_RECORD_DRAFT.md` and `dist/TRIAL_RECORD_DRAFT.json`.
- It reports missing fields instead of inventing feedback.
- It blocks personal email, phone numbers, and likely secret tokens.
- It warns on local paths, public account URLs, screenshots, logs, and source snippets.
- It supports generated session files or a separate local notes file.
- Generated session packs now include stronger local-only privacy guardrails.
- Trial package, session-pack, after-live, and package manifest docs were updated.
- Automated tests cover explicit extraction, privacy blocking, zh-CN labels, and tester wording that should not be mistaken for instructions.

Latest verification:

- `node --check scripts\trial-record-draft.js`: passed.
- `node --check scripts\generate-trial-session-pack.js`: passed.
- `node --test tests\trial-record-draft.test.js`: passed, 3 tests.
- `npm.cmd run check`: passed.
- `npm.cmd test`: passed, 113 tests.
- `npm.cmd run health`: passed.
- `npm.cmd run trial:ready`: passed in source and generated local trial package.
- `npm.cmd run trial:record-draft -- --session dist\trial-session-packs\tester-2`: `RECORD_DRAFT_READY_WITH_GAPS` with no privacy blockers.
- `npm.cmd run trial:tester-launch-plan -- --tester tester-2 --first-live`: `TESTER_LAUNCH_READY_TO_HOST`.

Stage 3.0.5 is complete: first-live standby checker while tester-2 is pending.

Implemented and verified:

- Added `trial:first-live-standby` to confirm tester-2 remains ready for first-live hosting without creating real tester data.
- The checker reads intake, intake-session, host-ready, host-run, pre-live, live-capture, tester-launch-plan, and status reports.
- It verifies all active reports point to the same anonymous tester id.
- It checks the session folder for `HOST_RUNBOOK.md`, `LIVE_SESSION_CAPTURE.md`, host summary, final record templates, and the session manifest.
- It blocks dry-run tester ids, tester mismatches, missing live files, raw screenshots/logs/source-like files, personal contact data, and likely secret tokens.
- It emits `FIRST_LIVE_STANDBY_WAITING_FOR_TESTER`, `FIRST_LIVE_STANDBY_NEEDS_REFRESH`, `FIRST_LIVE_STANDBY_READY_WITH_REVIEW`, `FIRST_LIVE_STANDBY_READY`, or `FIRST_LIVE_STANDBY_BLOCKED`.
- Trial package, status, tester launch, and package manifest docs were updated.
- Automated tests cover ready standby, waiting for tester intake, stale launch plan refresh, tester mismatch blocking, and missing live capture blocking.

Latest verification:

- `node --check scripts\first-live-standby.js`: passed.
- `node --test tests\first-live-standby.test.js`: passed, 5 tests.
- `npm.cmd run check`: passed.
- `npm.cmd test`: passed, 118 tests.
- `npm.cmd run health`: passed.
- `npm.cmd run trial:ready`: passed in source and generated local trial package.
- `npm.cmd run trial:first-live-standby -- --tester tester-2`: `FIRST_LIVE_STANDBY_READY_WITH_REVIEW` with no blockers.

Stage 3.0.6 is complete: synthetic post-call record-to-after-live rehearsal.

Implemented and verified:

- Added `trial:post-call-rehearsal` for an isolated synthetic rehearsal of the post-call pipeline.
- The rehearsal creates only `tester-rehearsal-*` synthetic records and refuses real-looking tester ids such as `tester-2`.
- The command runs `trial:record-draft`, verifies the draft is local-only and not held, then runs `trial:after-live`.
- It marks reports with `rehearsalOnly: true` and `realTesterFeedback: false`.
- It writes `dist/TRIAL_POST_CALL_REHEARSAL_REPORT.md` and `.json`.
- Rehearsal output stays under `dist/trial-post-call-rehearsals/<run-id>/`.
- It confirms the tester-2 first-live standby check still works after rehearsal.
- Trial package, status, first-live standby, and package manifest docs were updated.
- Automated tests cover successful rehearsal and refusal of real-looking tester ids.

Latest verification:

- `node --check scripts\post-call-rehearsal.js`: passed.
- `node --test tests\post-call-rehearsal.test.js`: passed, 2 tests.
- `npm.cmd run check`: passed.
- `npm.cmd test`: passed, 120 tests.
- `npm.cmd run health`: passed.
- `npm.cmd run trial:ready`: passed in source and generated local trial package.
- `npm.cmd run trial:post-call-rehearsal -- --force`: `POST_CALL_REHEARSAL_READY_WITH_REVIEW`; `RECORD_DRAFT_READY`; `AFTER_LIVE_READY_WITH_REVIEW`; first-live standby remained `FIRST_LIVE_STANDBY_READY_WITH_REVIEW`.

Stage 3.0.7 is complete: pre-human-tester operator polish.

Implemented and verified:

- Expanded the in-app trial host checklist into waiting, before-call, during-call, and immediately-after-call stages.
- Kept the real-session boundary explicit: tester-2 remains paused until a real human tester is scheduled.
- Added the files the host should keep open during the call and repeated the stop-before-Apply boundary for every real project.
- Added beginner-friendly command rows for `trial:first-live-standby`, `trial:post-call-rehearsal`, `trial:record-draft`, and `trial:after-live`.
- Added working copy actions with localized success/failure feedback and a legacy clipboard fallback.
- Updated English, zh-CN, and Russian operator copy with full dictionary parity.
- Added the operator guide to the health-check UI markers and documented the same rhythm in the trial status and local package guides.

Latest verification:

- `npm.cmd run check`: passed.
- `npm.cmd test`: passed, 120 tests.
- `npm.cmd run health`: passed with `trialOperator: true`.
- `npm.cmd run i18n:check`: passed with 506 keys in each language and no warnings.
- `npm.cmd run trial:ready`: passed in source and the generated local trial package; package hygiene had no missing or disallowed files.
- `npm.cmd run trial:first-live-standby -- --tester tester-2`: `FIRST_LIVE_STANDBY_READY_WITH_REVIEW`, 0 blockers and 5 warnings that still require host review.
- `npm.cmd run trial:post-call-rehearsal -- --force`: `POST_CALL_REHEARSAL_READY_WITH_REVIEW`; record draft, after-live, and tester-2 standby all remained ready with no rehearsal blockers.
- The in-app browser was unavailable in this Codex session, so screenshot and real-click layout verification remains a launch-day check; HTTP health and packaged UI marker checks passed.

Stage 3.0.8a is complete: beginner first-live session flow hardening while the real tester is unavailable.

Implemented and verified:

- Added `TRIAL_BEGINNER_FIRST_LIVE_GUIDE.md`, a concise Chinese host sheet with live consent, beginner instructions, stop conditions, anonymous identity values, required decision values, and guarded after-call commands.
- Generated each session pack with a tester-specific `BEGINNER_FIRST_LIVE_GUIDE.md` and made it required by host-run, pre-live, live-capture, and first-live standby gates.
- Replaced ambiguous `Proceed to tester 2` template fields with neutral next-tester wording.
- Kept completion, record-draft, and feedback-ingest parsers compatible with legacy tester-2 field names while accepting the neutral next-tester fields and question-style bullets.
- Unified session brief, host-ready, host-run, pre-live, live-capture, completion, launch-plan, and standby guidance around:

```text
explicit local notes -> trial:record-draft -> human confirmation -> trial:after-live
```

- Removed direct post-session command sequences from newly generated host-facing files while keeping `trial:after-live` responsible for the guarded lower-level pipeline.
- Regenerated the local empty tester-2 session pack and refreshed intake-session, host-ready, host-run, pre-live, live-capture, first-live launch-plan, and standby reports without creating tester feedback.
- Added regression coverage for the generated beginner guide, the two-command after-call flow, neutral fields, legacy aliases, feedback ingest decisions, and the missing-guide standby blocker.

Latest verification:

- Focused standby, feedback-ingest, and post-call rehearsal tests: passed, 11 tests.
- `npm.cmd run check`: passed.
- `npm.cmd test`: passed, 124 tests.
- `npm.cmd run health`: passed.
- `npm.cmd run trial:ready`: passed in source and generated local package; package hygiene reported 0 missing, 0 disallowed, and 170 files.
- `npm.cmd run trial:post-call-rehearsal -- --force`: `POST_CALL_REHEARSAL_READY_WITH_REVIEW`; feedback ingest returned `READY_WITH_WATCH_ITEMS` with 0 blockers instead of requesting a missing host decision.
- Empty tester-2 `trial:record-draft`: `RECORD_DRAFT_READY_WITH_GAPS`, 0 suggestions, 20 missing human fields, 0 blockers, 0 warnings.
- `trial:tester-launch-plan -- --tester tester-2 --first-live`: `TESTER_LAUNCH_READY_TO_HOST`, 0 blockers.
- `trial:first-live-standby -- --tester tester-2`: `FIRST_LIVE_STANDBY_READY_WITH_REVIEW`, 0 blockers and 5 warnings.

Stage 3.0.8b is complete: first real tester-2 session and truthful after-live stop.

Confirmed session facts:

- The session was hosted on 2026-07-12 by `host-1` with anonymous `tester-2` in `zh-CN` and lasted about 120 minutes.
- Live consent was explicitly confirmed. The tester used Demo only; real-project read-only preflight was `N/A` because no safe copy was available.
- Apply was never clicked. No project file was written, no project command was confirmed, and no temporary project or test code was created.
- The three final records were explicitly confirmed by host-1. They remain local under the ignored tester-2 session folder and must never be committed.
- The final host decision was `Fix first`; proceeding to another tester was `No`.
- `trial:after-live` was run exactly once after confirmation and truthfully returned:

```text
SESSION_COMPLETION_READY
PRIVACY_OK
NO_GO_FIX_FIRST          11 blockers, 10 warnings
REVIEW_BLOCKED            3 blockers,  4 warnings
AFTER_LIVE_BLOCKED       10 blockers, 27 warnings
```

- Archive did not run and no evidence packet was produced. The report surfaced a stale 2026-07-09 archive result; that display/freshness defect was fixed later, but the tester-2 run must not be described as archived.
- Do not rerun tester-2 after-live or edit the human answers to obtain a green result. `AFTER_LIVE_BLOCKED` is the immutable historical outcome.

Main confirmed findings:

- A Chinese Demo goal could not produce a Mock patch, and the failure message was misleading English copy.
- Clicking Demo moved directly into automatic plan/context preparation without explaining that read-only transition.
- Existing sessions could be restored without an explicit continue/fresh-start decision.
- The tester requested a sticky desktop navigation area, clearer information hierarchy, and beginner explanations for each module.
- Plan created the most trust; patch was the most valuable expected capability.
- The initial leakage concern became `No` after local/read-only behavior was explained. The tester would try a disposable patch and would consider a real project in a future safe session.

Stage 3.0.8c is complete: first-live feedback implementation and regression verification.

Commit `61f3786 Fix first-live feedback issues` implemented:

- Chinese/English/Russian divide-by-zero Demo patch support and structured localized failure reasons.
- Explicit saved-session `Continue` / `Start fresh` choice, with clean Demo client state and stale-response protection.
- An explanation that preflight automatically prepares a plan and reads selected context without writes or commands.
- Sticky desktop navigation, responsive layout, reduced host-only clutter, and beginner module-purpose descriptions.
- Explicit Apply write wording and full Verify command, purpose, and risk disclosure before confirmation.
- Accurate online-model privacy copy covering goals, metadata, paths, and selected context.
- Current-run archive freshness enforcement in after-live and a prohibition on evidence packets without a successful current archive.

Latest verification for that commit:

- Focused tests: 28/28.
- Source test suite: 132/132.
- Packaged test suite: 132/132.
- `npm.cmd run check`: passed.
- i18n: 544 keys per language, 0 warnings/failures.
- `npm.cmd run health`: passed, including a Chinese Demo patch with 1 applicable file.
- `npm.cmd run smoke`: Apply, Verify, and Revert passed; the Demo was restored.
- `npm.cmd run trial:ready`: source/package checks, health, and tests passed; package hygiene reported 0 missing, 0 disallowed, and 169 files.
- The ignored candidate package is `dist/CodeClaw-local-trial-20260712`.
- Automated visual QA was not available because the in-app browser had no connected instance. Pixel-level visual verification remains an explicit host acceptance item; it has not been claimed as passed.

## Stage 3.0.9 remediation status clarification

The remediation mapping, candidate-binding checks, and engineering safeguards are implemented, but the seven required host-1 manual acceptance checks have not been completed. The truthful current gate remains `REMEDIATION_HOLD`; it is not `REMEDIATION_READY_FOR_RETEST`. This does not modify tester-2's historical `AFTER_LIVE_BLOCKED`, schedule tester-3, or authorize writes to an original real project.

## Next Planned Phase

Stage 3.0.12 is machine verified and awaits only its final Git audit and independent commit. Stage 3.0.13 is next. Real-person testing remains intentionally postponed.

The engineering order is:

1. Complete Stage 3.0.12's final Git audit and independent commit without adding local artifacts or pushing.
2. Stage 3.0.13 beginner UI and accessibility semantics, with real visual/NVDA checks kept manual.
3. Stage 3.0.14 stability, performance budgets, cancellation, and fully isolated test fixtures.
4. Stage 4B candidate-aware Windows launcher and hashed candidate package.

Local tester records, `dist`, screenshots, logs, private project details, and evidence packets remain forbidden from Git. Temporary test code and fixture copies must be deleted after verification; do not retain tombstone code.

## Stage 3.0.10 - Crash-safe patch transactions

Stage 3.0.10 is machine verified. Real-person testing remains paused, tester-3 is not scheduled, and tester-2's historical `AFTER_LIVE_BLOCKED` result is unchanged.

Implemented:

- Added a durable local patch transaction store with before/after hashes, private before-content backups, startup reconciliation, idempotent Apply/Revert commit markers, and fail-closed conflict handling.
- Added a persistent per-user project ownership claim with `reserved -> journaled -> complete` phases and a random state-directory owner identity. A foreign state directory, missing claim, missing journal, or mismatched transaction stops recovery and subsequent writes.
- Switched project writes and TaskStore JSON updates to same-directory fsync + atomic rename. TaskStore mutations are serialized to prevent concurrent read-modify-write loss.
- Serialized Apply/Revert per real canonical project root across processes and state directories, and placed locked recovery before the server listen barrier. TaskStore mutations also coordinate across instances.
- Bound tasks, approvals, journals, live writes, rollback, and cleanup to the reviewed workspace root and every target parent-directory entity. Same-path normal-directory replacement and junction replacement both fail closed.
- Persisted each patch temporary file's 64-bit filesystem identity in the journal; recovery never deletes an unowned same-name file. Lock and atomic cleanup identities use bigint-backed device/inode/birth-time values.
- Bound approval to immutable proposal digests and applied-patch identities, with a second check after queue/lock acquisition.
- Removed the direct `write_patch` advanced-UI entry and blocked the generic API bypass with `PATCH_TRANSACTION_REQUIRED`.
- Added Windows-safe portable path validation, protected metadata-directory refusal, bounded file-lock retries, strict UTF-8 refusal, and BOM preservation for exact text rollback.
- Bound the local web service to `127.0.0.1` and exposed only anonymized patch-recovery status.

Machine evidence for this stage: `npm.cmd test` passed `187/187`; `npm.cmd run check` passed with 563 keys in each of `en`, `zh-CN`, and `ru` and no warnings/failures; `health`, `smoke`, `pilot:self`, `pilot:fixture`, `pilot:inbox`, and `pilot:model` passed. Fault tests cover partial Apply, pre-commit interruption, both uncommitted Revert shapes, committed cleanup, human-edit conflict, corrupted backup, temporary-file impersonation, root/parent replacement, startup recovery, cross-state durable ownership, double-instance competition, and direct-write bypass refusal.

Honest remaining limits:

- Windows directory fsync and sudden-power durability are best effort, not an absolute filesystem guarantee.
- Automated tests construct post-interruption disk states; they are not evidence of real power loss or process termination at every machine instruction.
- Different operating-system users or instances explicitly configured with different project-lock directories do not share the same lock; Stage 4B must still enforce candidate-aware single-instance behavior.
- Windows custom ACL preservation is not guaranteed by Node's POSIX-style mode handling. Antivirus/file-lock contention, network drives, and unusual filesystems remain unverified.
- Node path APIs leave a very small, unavoidable interval between the final identity check and rename/unlink; the implementation is fail-closed and best effort, not a distributed transaction guarantee.
- Browser automation is unavailable because the bundled browser plugin is missing `scripts/browser-client.mjs`; no pixel-level or real keyboard/NVDA acceptance is claimed.
- The seven host-1 manual checks, a disposable-copy real-project exercise, and real forced-termination/power-loss acceptance remain pending. Original-project writes are not declared open.

## Stage 3.0.11 - Server-authoritative disposable workspaces

Stage 3.0.11 is machine verified. Original projects remain server-enforced read-only; only the built-in Demo and an explicitly activated, registered disposable copy can Apply, Revert, or run an allowlisted project command.

Implemented:

- Added a complete bounded Data Boundary Policy independent of the 800-file display scan, with strict nested `.gitignore`, SHA-256, filesystem entity identities, portable-path collision detection, and fail-closed handling for sensitive names, links, hard links, and special objects.
- Added server-authoritative `original-readonly`, `built-in-demo`, and `disposable-copy` capabilities. Client paths, modes, workspace IDs, and `approved: true` cannot elevate authority.
- Added copy Preview/Create/List/Activate/Cleanup APIs and UI. Creation uses durable phases, a private copy-root owner claim, signed state, an ownership marker, quarantine-based recovery, and exact target verification before the marker, after the marker, after rename, during recovery, and before first activation.
- Required the marker to be the target's only exclusion, so injected `.git`, `node_modules`, gitignored/generated content, sensitive files, or unexpected objects cannot be registered as a verified copy.
- Bound tasks and read/write/command tools to workspace ID plus root identity. Same-path replacement with a junction cannot redirect task reads into CodeClaw private state.
- Rejected linked source roots before server canonicalization and rejected missing copy roots below linked ancestors before mkdir or ownership-claim writes.
- Prevented Git discovery above the workspace, cleared inherited `GIT_*` behavior, and kept original-project Apply, Revert, Git tools, and project commands blocked.
- Kept the user-facing disclosure explicit: a copy contains ordinary source, is not anonymized, is not automatically safe to share, and does not sandbox project scripts.

Machine evidence: `npm.cmd test` reported 246 total, 245 pass, 0 fail, and 1 environment-only file-symlink skip; `npm.cmd run check` passed with 665 keys in each of `en`, `zh-CN`, and `ru`; `health`, `smoke`, `pilot:self`, `pilot:fixture`, `pilot:inbox`, and `pilot:model` passed. The model contract made 9 fake local requests; Demo and disposable fixtures were restored and source fixtures remained unchanged.

Honest limits: Node path operations retain a very small documented TOCTOU interval; real power loss, unusual filesystems, ACL/antivirus interference, and real-person copy use remain unverified. If a `.gitignore` ignores itself, it is excluded with its ignored payload and the original ignore-rule snapshot is not preserved for future paths created inside the copy. The bundled browser automation helper is unavailable, so no pixel, keyboard, NVDA, high-contrast, or clean-Windows acceptance is claimed.

Next: complete the final Git audit/commit for Stage 3.0.12, then proceed to Stage 3.0.13. See [`NEXT_PHASE_PLAN.md`](NEXT_PHASE_PLAN.md).

## Stage 3.0.12 - Exact model outbound review and minimized local state

Stage 3.0.12 is machine verified. Its implementation, focused regressions, single-concurrency full suite, check/i18n, automation runs, state migration, and cleanup gates passed; only the final Git audit and independent commit remain.

Implemented:

- Replaced direct model calls with a server-authoritative `POST /api/model/preview`, explicit review, `POST /api/model/send` flow for every operation, plus `POST /api/model/cancel`. Preview accepts only `operation` and `taskId`; all request-bearing task, workspace, repository, context, and provider inputs are derived server-side.
- Made Preview disclose the complete UTF-8 body, byte count and SHA-256, destination endpoint/channel/device boundary, data categories, and every file component with transmitted bytes.
- Bound approval to task revision, workspace ID/root identity, Data Boundary Manifest digest/policy version, model-configuration generation, and the prepared request. Approval is synchronously single-use; concurrent sends, failed-send replay, cancellation, expiry, and stale task/source/workspace/configuration state fail closed. The same authorities are rechecked before and after transport.
- Restricted plaintext HTTP to loopback. Public HTTPS checks every DNS answer, pins and rechecks the actual remote address, rejects redirects and endpoint credentials/query/fragment, bounds time and request/response size, requires JSON Content-Type, and rejects API-key reflection in a response.
- Kept API keys in process memory only and removed credentials from persisted `model.json`. Startup atomically replaces or rewrites corrupt, unknown, non-canonical, or legacy credential-bearing configuration to a safe credential-free document.
- Added TaskStore revisions/CAS and minimized persistence: context stores path plus validated line/byte metadata, size, hash, source/completeness and time; model events store operation/provider/model/request-response hashes/status/time. Patch proposal and model event commit atomically in one CAS update. Startup removes legacy context/suggestion/model bodies and redacts legacy model/server-error audit detail.
- Excluded ignored Manifest content from both model request components and derived command/framework/package-manager metadata.
- Unified automation finalization across eight scripts: child exit/timeout termination, listener shutdown, fixture restoration, parent/prefix/filesystem-identity-checked directory cleanup, and aggregation of work plus cleanup errors.

Machine evidence:

- Preview/UI/provider tests: 46/46.
- Server model-outbound integration: 8/8.
- Automation resource-scope fault injection: 8/8.
- `health`, `smoke`, `pilot:self`, `real-repo-preflight`, `simulate-first-trial`, `pilot:fixture`, `pilot:inbox`, and `pilot:model` each completed successfully in direct focused runs.
- `pilot:model` made 9 fake-model requests and passed 9 exact-body checks.
- The final single-concurrency `npm.cmd test` reported 319 total, 318 pass, 0 fail, and 1 environment-only file-symlink skip. A default-concurrency run had one shared-state interference failure; that case passed independently, and the isolated single-concurrency full run is the authoritative result.
- `npm.cmd run check` passed with 714 keys in each of `en`, `zh-CN`, and `ru`; relevant `node --check` and `git diff --check` passed.
- Default local state was migrated to 26 tasks and 59 context records with zero persisted bodies, all 59 sources equal to the allowed `read_file` value, zero legacy suggestion entries, no credential field in `model.json`, and blank detail in all model/server-error audit entries.
- All 14 automation `%TEMP%` prefixes had zero remaining directories; the known historical leftovers and `server-bg.log` were removed, port 4173 had no listener, and the Demo, task-board, and support-inbox examples were unchanged.

Pending before the stage commit:

- Review the complete combined diff, rerun `git diff --check`, and stage only an explicit source/test/document list.
- Confirm `dist`, `.codeclaw`, logs, screenshots, evidence, and real-person records remain outside the index; then create the independent Stage 3.0.12 commit without pushing.

Honest limits: this stage did not rerun a real managed-cloud provider. An approved online request still leaves the device and provider retention is outside CodeClaw's control; a local provider still receives bytes over loopback HTTP; retained request-buffer overwriting is best effort rather than cryptographic erasure. Manifest revalidation and the later TaskStore rename are not one filesystem-atomic snapshot, so an extreme external edit can leave a stale draft; Apply's baseline-hash check prevents it from overwriting the changed file, but not every external TOCTOU is claimed closed. No real-person, pixel-level, keyboard/NVDA, high-contrast, clean-Windows, real-power-loss, unusual-filesystem, or provider-retention acceptance is claimed. `REMEDIATION_HOLD`, tester-2's `AFTER_LIVE_BLOCKED`, tester-3's `not scheduled` state, and the original-project write prohibition remain unchanged.
