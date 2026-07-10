# CodeClaw Project Status

Updated: 2026-07-10

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

## Next Planned Phase

Stage 3.0.6: simulated post-call record-to-after-live rehearsal.

Recommended order:

1. Add a safe anonymous fixture that clearly marks itself as rehearsal, not real tester feedback.
2. Rehearse `trial:record-draft` into completion, privacy, and after-live without inventing real tester data.
3. Confirm the first-live standby path still remains ready for tester-2 after the rehearsal.
4. When a human tester is available, host tester-2 using first-live mode.
