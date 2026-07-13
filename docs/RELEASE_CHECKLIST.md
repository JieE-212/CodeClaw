# CodeClaw v0.1 Release Checklist

Use this checklist before sharing the MVP with another tester.

Current status: real-person testing is paused. This checklist does not authorize a new live session, rerunning tester-2 after-live, or creating tester-3. Tester-2 remains `AFTER_LIVE_BLOCKED` and remediation remains `REMEDIATION_HOLD`.

## Environment

- Node.js 20 or newer.
- Windows users should prefer `npm.cmd` in PowerShell if script execution policy blocks `npm`.
- No third-party package install is required for the current MVP.

## Required Checks

Run these commands sequentially because several pilots temporarily patch and restore fixture files.

`npm.cmd test` is bounded to concurrency 4. The final Stage 3.0.14 bounded full-suite baseline is 398 total, 394 pass, 0 fail, and 4 environment-only skips. The single-concurrency full baseline was 397/393/0/4; its sole subsequently added file-growth budget regression also passed at concurrency 1. i18n has 723 keys per language with 0 warnings/failures.

Run from `项目工程`:

```bash
npm.cmd test
npm.cmd run check
npm.cmd run trial:simulate
npm.cmd run trial:ready
npm.cmd run trial:freeze
npm.cmd run trial:dispatch
npm.cmd run trial:ingest-feedback
npm.cmd run trial:fix-backlog
npm.cmd run trial:session-pack -- --force
npm.cmd run trial:host-ready
npm.cmd run trial:complete-session -- --session examples/trial-feedback-sample --checklist dist/TRIAL_SAMPLE_COMPLETION_CHECKLIST.md
npm.cmd run trial:privacy-check -- examples/trial-feedback-sample
npm.cmd run trial:post-session -- --session examples/trial-feedback-sample --next-tester tester-2
npm.cmd run trial:review-session -- --session examples/trial-feedback-sample --reports dist --tester tester-1
npm.cmd run trial:after-live -- --session examples/trial-feedback-sample --tester tester-1 --next-tester tester-2 --out dist/trial-after-live/release-sample --force
npm.cmd run trial:intake-review-dry-run -- --force
npm.cmd run trial:cohort-summary -- examples/trial-cohort-sample
node --check scripts/cohort-handoff.js
node --test tests/cohort-handoff.test.js
npm.cmd run trial:archive-session -- --session dist/trial-session-packs/tester-1 --tester tester-1 --force
npm.cmd run trial:status
npm.cmd run trial:intake -- --init --force
node --check scripts/generate-intake-session.js
node --check scripts/generate-host-run.js
node --check scripts/session-completion-check.js
node --check scripts/review-trial-session.js
node --check scripts/run-intake-review-dry-run.js
node --check scripts/pre-live-gate.js
node --check scripts/live-session-capture.js
node --check scripts/after-live-recovery.js
node --check scripts/trial-remediation-gate.js
node --test tests/trial-remediation-gate.test.js
node --check scripts/next-live-gate.js
node --test tests/next-live-gate.test.js
node --check scripts/tester-launch-plan.js
node --test tests/tester-launch-plan.test.js
node --check apps\web\public\app.js
npm.cmd run smoke
npm.cmd run pilot:self
npm.cmd run pilot:fixture
npm.cmd run pilot:inbox
npm.cmd run pilot:model
npm.cmd run pilot:real:preflight -- "examples\\support-inbox-js" "add channel filtering to the support inbox API and view state"
```

Expected result:

- All unit tests pass.
- Syntax checks pass.
- Trial simulation, readiness, and freeze reports pass.
- `dist/TRIAL_FREEZE_REPORT.md` says `Decision: GO_HOSTED_TRIAL` before a hosted first trial.
- `dist/TRIAL_DISPATCH_NOTE.md` says `Decision: READY_TO_SEND` before sending the package.
- `trial:ingest-feedback` writes `WAITING_FOR_FEEDBACK` before human records exist, or a tester-2 decision after records are collected.
- `trial:fix-backlog` writes `WAITING_FOR_FEEDBACK` before human records exist, or a P0/P1/P2/P3 repair plan after records are collected.
- `trial:session-pack` writes a generated tester folder with `SESSION_BRIEF.md` and the three fillable records.
- `trial:host-ready` says `READY_TO_HOST` before a hosted tester session.
- `trial:host-run` is syntax-checked and covered by automated tests; run it live only after intake-session and host-ready are aligned.
- `trial:complete-session` passes on completed sample records and blocks empty or personally identifying records.
- `trial:privacy-check` passes on safe sample feedback and blocks unsafe session records.
- `trial:post-session` writes a post-session decision report and next tester pack.
- `trial:review-session` writes a host decision brief with owner, action, and verification command for P0/P1 items.
- `trial:after-live` always writes the truthful after-live report; only a ready run creates a local-only evidence packet, and raw tester records stay excluded.
- `trial:remediation` preserves a blocked historical result, rejects stale/unmapped/unaccepted fixes, and emits only privacy-safe closure evidence.
- `trial:next-live` blocks stale tester ids, missing after-live, missing host acceptance, and stale watch items before the next live launch.
- `trial:intake-review-dry-run` writes `DRY_RUN_READY_FOR_REAL_INTAKE` before a real tester roster is filled.
- `trial:pre-live` is syntax-checked and covered by automated tests; run it live only after real intake-session, host-ready, and host-run are aligned.
- `trial:live-capture` is syntax-checked and covered by automated tests; run it live after pre-live and before the call.
- `trial:cohort-summary` writes a multi-tester expansion matrix and flags repeated friction.
- `trial:cohort-handoff` requires two clean post-fix after-live results; remediated historical No-Go evidence remains visible but does not count as a clean retest.
- `trial:archive-session` writes a local-only evidence archive and blocks privacy-hold sessions.
- `trial:status` writes a current operator dashboard with the next recommended command.
- `trial:intake -- --init` writes a local-only tester roster template and report.
- `trial:intake-session` is syntax-checked and covered by tests.
- `trial:tester-launch-plan` is syntax-checked and covered by tests; use it before live tester-2 to see the next safe command without creating real tester data.
- Smoke output includes `"ok": true`.
- Pilot output includes `"ok": true` and `"sourceFilesUnchanged": true`.
- Fixture pilot output includes `"ok": true`, `"verificationExitCode": 0`, and `"fixtureRestored": true`.
- Inbox fixture pilot output includes `"ok": true`, three patch files, `"verificationExitCode": 0`, and `"fixtureRestored": true`.
- Model contract output includes `"ok": true`, `"fakeModelRequests": 9`, workflow fields, and expected invalid patch reasons.
- Real repo preflight output includes `"ok": true`, `"mode": "read-only-preflight"`, and `"writeAttempted": false`.
- `examples/demo-js/test/calculator.test.js` is restored after smoke.

## Manual Demo

1. Run `npm.cmd run dev`.
2. Open `http://localhost:4173`.
3. Click `Demo`.
4. Click `Scan`.
5. Follow `Task guide` through plan, context, patch, verify, and complete.

Expected result:

- Patch proposal shows review badges and per-file line stats.
- Verification exits with code `0`.
- Current task shows a Review draft.
- Reverting the patch restores the demo test file.

## Pilot Self-Run

`npm.cmd run pilot:self` scans the CodeClaw engineering project itself without applying patches.

Expected result:

- The project scan detects files, languages, and commands.
- Context candidates are returned for a real CodeClaw task.
- `search_code` finds `MemoryStore`.
- Project memory notes are saved.
- Source files checked by the pilot remain unchanged.

## Model Contract Pilot

`npm.cmd run pilot:model` starts a local fake OpenAI-compatible server and verifies model workflow behavior.

Expected result:

- Task suggestion returns fake model content.
- Context recommendation returns deterministic candidate files plus a fake model note.
- Controlled failure repair applies a temporary failing patch, records a non-zero verification, receives fake model repair advice, and reverts the patch.
- Missing context returns `missing_context` without calling the fake model.
- Valid single-file JSON is applicable.
- Invalid JSON returns `invalid_json`.
- Diff content returns `diff_instead_of_full_content`.
- Missing fields returns `missing_fields`.
- Valid multi-file JSON is applicable and contains two files.

## Stage-Three Fixture Pilot

`npm.cmd run pilot:fixture` scans `examples/task-board-js` and applies a realistic multi-file feature patch through a fake OpenAI-compatible model.

Expected result:

- The fixture scan detects JS source, tests, and `npm run test`.
- Context includes `src/filters.js`, `test/filters.test.js`, and `src/tasks.js`.
- Patch proposal updates both source and tests.
- Verification exits with code `0`.
- Review draft is generated.
- Both changed fixture files are reverted.

## Stage-Three Inbox Fixture Pilot

`npm.cmd run pilot:inbox` scans `examples/support-inbox-js` and applies a realistic API plus state feature patch through a fake OpenAI-compatible model.

Expected result:

- The fixture scan detects JS source, tests, and `npm run test`.
- Context includes `src/api.js`, `src/inbox.js`, `test/inbox.test.js`, and `src/tickets.js`.
- Patch proposal updates API, inbox state, and tests.
- Verification exits with code `0`.
- Review draft is generated.
- All changed fixture files are reverted.

## Real Repo Preflight

`npm.cmd run pilot:real:preflight -- "examples\\support-inbox-js" "add channel filtering to the support inbox API and view state"` verifies the read-only trial workflow.

Expected result:

- The target repo is scanned using a temporary state directory.
- The model provider is mock, so no real API credits are used.
- Plan and context candidates are produced.
- Selected files are read.
- Search returns hits.
- `contextCoverage` and `nextGate.warnings` make context quality visible.
- `writeAttempted` is `false`.
- `nextGate.proceedToPatch` is `false`.

## Optional Local Model Trial

After the required checks pass, use [`LOCAL_MODEL_TRIAL.md`](LOCAL_MODEL_TRIAL.md) for a manual run against a real local or self-hosted OpenAI-compatible endpoint. Record the result in [`LOCAL_MODEL_TRIALS.md`](LOCAL_MODEL_TRIALS.md).

Expected result:

- Provider settings save successfully in the Model panel.
- Suggest/context flow identifies relevant files.
- Patch proposal either applies cleanly or reports a clear rejection reason.
- Verification and revert are both exercised before wider sharing.
- The trial ledger has either one completed record or an explicit `Pending` entry.

## Stage 3.0.13 Beginner Workflow Gate

- Exactly one eight-step workflow is present: project, preflight, plan, context, patch, workspace, verify, complete.
- Beginner is the default; Advanced changes presentation only and never changes requests, confirmation, or workspace authority.
- Demo launches a read-only preflight and reports plan/context progress with zero writes and zero commands.
- Every workflow module exposes purpose plus read, project-write, network, command, and local-state effects.
- Navigation and workflow steps expose current state; labels, primary live status, focus-visible, reduced-motion, forced-colors, sticky navigation, 900/620/390px contracts, and AA primary-action contrast pass source checks.
- Apply is required before Verify; a successful verification bound to the current patch set is required before Complete.
- Verify and Complete reject pending patch recovery, changed patch files, stale patch-set provenance, or changed task revision.
- Completed tasks allow inspection and Revert, but do not send new model requests or start new patch/verification work. A different goal creates a new task.
- Async UI responses are rejected when workflow generation, path, workspace, task, or revision no longer matches.
- Memory notes and completion-summary mutations are atomic across instances; startup reconciles summaries before and after patch recovery.
- `npm.cmd run i18n:check` reports 710 keys for each supported language and rejects replacement characters, damaged question-mark runs, missing target script, and placeholder drift.
- Pixel, full keyboard, NVDA, and real Windows high-contrast checks remain manual and must not be inferred from static contracts.

## Stage 3.0.14 Stability and Runtime-Budget Gate

- Test fixtures that can write use owned temporary project copies, register cleanup immediately, close listeners/servers, avoid fixed ports, and leave no repository-local `dist` or `.codeclaw` residue.
- JSON bodies, repository traversal, file/depth/summary/Manifest/rule evaluation, preflight context, tool read/search bytes, long lines, and serialized results have explicit limits. Data Boundary manifests reject stat-known oversized files before hashing and fail closed rather than returning partial authority.
- Partial scans and reads expose structured `partial`, `truncated`, and bounded reasons; they are never presented as complete results.
- Sensitive traversal revalidates the stable parent-directory chain and rejects persistent replacement as `TRAVERSAL_PATH_CHANGED`.
- Scan, Preflight, model Send, tool work, and Verify run as managed operations with global/per-kind concurrency, deadlines, explicit cancellation, and a one-way `running -> committing -> committed` boundary. A confirmed authoritative write wins a deadline overlap instead of being misreported as an unsaved 504.
- Scan, Preflight, model Send, and Verify expose active/cancelling/cancelled UI states. Client disconnect cancels running work; late commit cancellation is rejected with a specific explanation.
- SIGINT/SIGTERM stops new API work and aborts running operations. Running cleanup has a 2.5-second wait; an in-flight commit receives its separate 10-second deadline plus a 750 ms margin, followed by up to 1 second for connection close. The force-exit ceiling is 13.25 seconds.
- Task, memory, and audit state have file/record/history limits and startup migration. Audit rotation is locked and digest-linked; active patch/recovery evidence is not silently evicted.
- POSIX process groups receive TERM then KILL. Windows uses a parameterized, deadline-bound `taskkill.exe /PID <pid> /T /F` attempt and fails closed when descendant termination cannot be verified.
- The final default bounded full suite reports 398 total, 394 pass, 0 fail, and 4 environment-only skips. The single-concurrency full baseline reports 397/393/0/4, and the sole subsequently added file-growth budget regression passes separately at concurrency 1. `check` passes; i18n reports 723 keys per language, 0 warnings, and 0 failures.
- Explicit in-flight model cancellation and bounded SIGTERM integration tests release operation capacity and do not persist a successful model result.

Manual/unverified boundary: the current sandbox cannot execute the real Windows `taskkill /T` descendant-tree case. A wrapper that already exited may require Job Object ownership for reliable child cleanup. Node has no `openat`-style directory-handle-relative traversal, so path-identity revalidation does not eliminate every external replacement race. Do not infer real power-loss, large-project subjective performance, pixel, complete keyboard, NVDA, high-contrast, clean Windows 10/11, non-admin, Defender/SmartScreen, default-browser, or real double-click acceptance from this gate.

## Safety Review

- Writes still require explicit approval.
- Commands still require approval and must come from the scanned allowlist.
- Sensitive files and ignored files are skipped or refused.
- Real model patch output must be complete file JSON, not diff text.
- `.codeclaw` local state is skipped during repository scans.

## Known Limits

- UI diff is file-level text, not a side-by-side diff.
- Project memory is local JSON only, with no sync or delete UI yet.
- JS/TS symbol indexing is regex-based and intentionally conservative.
- OpenAI-compatible providers need user-supplied `baseUrl`, `model`, and `apiKey`.
- Real local model quality varies; use the manual trial template and ledger before treating a model as pilot-ready.

## Release Notes Skeleton

```text
CodeClaw v0.1

Highlights:
- Local repo scan, task planning, controlled tool calls, patch review, verification, rollback.
- Mock and OpenAI-compatible model provider.
- Project memory, context ranking, review draft, audit log, smoke, pilot self-run, and model workflow contract pilot.

Validation:
- npm.cmd test
- npm.cmd run check
- node --check apps\web\public\app.js
- npm.cmd run smoke
- npm.cmd run pilot:self
- npm.cmd run pilot:fixture
- npm.cmd run pilot:inbox
- npm.cmd run pilot:model
- npm.cmd run pilot:real:preflight -- "examples\\support-inbox-js" "add channel filtering to the support inbox API and view state"

Optional manual validation:
- docs/LOCAL_MODEL_TRIAL.md
- docs/LOCAL_MODEL_TRIALS.md
```
