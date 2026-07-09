# CodeClaw v0.1 Release Checklist

Use this checklist before sharing the MVP with another tester.

## Environment

- Node.js 20 or newer.
- Windows users should prefer `npm.cmd` in PowerShell if script execution policy blocks `npm`.
- No third-party package install is required for the current MVP.

## Required Checks

Run these commands sequentially because several pilots temporarily patch and restore fixture files.

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
npm.cmd run trial:intake-review-dry-run -- --force
npm.cmd run trial:cohort-summary -- examples/trial-cohort-sample
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
- `trial:intake-review-dry-run` writes `DRY_RUN_READY_FOR_REAL_INTAKE` before a real tester roster is filled.
- `trial:pre-live` is syntax-checked and covered by automated tests; run it live only after real intake-session, host-ready, and host-run are aligned.
- `trial:live-capture` is syntax-checked and covered by automated tests; run it live after pre-live and before the call.
- `trial:cohort-summary` writes a multi-tester expansion matrix and flags repeated friction.
- `trial:archive-session` writes a local-only evidence archive and blocks privacy-hold sessions.
- `trial:status` writes a current operator dashboard with the next recommended command.
- `trial:intake -- --init` writes a local-only tester roster template and report.
- `trial:intake-session` is syntax-checked and covered by tests.
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
