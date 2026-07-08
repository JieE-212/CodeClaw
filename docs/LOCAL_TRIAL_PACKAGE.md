# CodeClaw Local Trial Package

This document defines what to include when sharing CodeClaw with a small group of local Windows trial users.

## Package Goal

Share a runnable local Web trial without turning CodeClaw into an installer yet.

The trial user should be able to:

1. Unzip or open the folder.
2. Run `start-codeclaw.cmd`.
3. Open the browser workspace automatically.
4. Try Demo first.
5. Run read-only preflight on one local project.
6. Optionally configure a real model and try a narrow disposable task.

## Include

Include these paths:

```text
apps/
docs/
examples/
packages/
scripts/
tests/
.gitignore
package.json
README.md
run-nightly-trial.cmd
start-codeclaw.cmd
start-codeclaw.ps1
```

Recommended docs to point testers to:

```text
docs/START_GUIDE.md
docs/FIRST_TRIAL_RUNBOOK.md
docs/HANDOFF_RESTART.md
docs/HUMAN_TRIAL_OBSERVATION.md
docs/PERSONA_TRIAL_REVIEW.md
docs/REAL_REPO_TRIAL.md
docs/TRIAL_HOST_BRIEF.md
docs/TRIAL_GO_NO_GO.md
docs/TRIAL_5_MIN_PRECHECK.md
docs/TRIAL_FEEDBACK_TEMPLATE.md
docs/TRIAL_FEEDBACK_INGEST.md
docs/TRIAL_FIX_BACKLOG.md
docs/TRIAL_SESSION_PACK.md
docs/TRIAL_HOST_READY.md
docs/TRIAL_POST_SESSION.md
docs/TRIAL_PRIVACY_CHECK.md
docs/TRIAL_RESULT_RECORD.md
docs/TRIAL_INVITE_MESSAGE.md
docs/RELEASE_STRATEGY.md
```

## Exclude

Do not include:

```text
.git/
.codeclaw/
node_modules/
coverage/
dist/
build/
docs/trial-feedback/
trial-session-packs/
examples/trial-privacy-risk/
server-bg.log
*.local
*.env
```

Also do not include:

- User API keys.
- Real project source code.
- Personal audit logs.
- Personal memory files.
- Temporary output from smoke or pilot runs.

## Pre-share Validation

Run these commands before preparing a package:

```bash
npm.cmd run health
npm.cmd run check
npm.cmd test
```

Optional deeper validation:

```bash
npm.cmd run smoke
npm.cmd run pilot:self
npm.cmd run pilot:fixture
npm.cmd run pilot:inbox
npm.cmd run pilot:model
npm.cmd run pilot:real:preflight -- "examples\support-inbox-js" "add channel filtering to the support inbox API and view state"
```

Expected minimum:

- `health` returns `"ok": true`.
- `check` exits with code `0`.
- `test` passes all tests.
- `health.preflight.writeAttempted` is `false`.
- `health.preflight.tools` contains only read/search tools.

## Prepare The Folder

After validation passes, create the local trial folder:

```bash
npm.cmd run package:local-trial
```

By default this writes:

```text
dist/CodeClaw-local-trial-YYYYMMDD
```

If the folder already exists and you intentionally want to replace it:

```bash
npm.cmd run package:local-trial -- --force
```

The package script copies only the include list above and skips local state, logs, env files, `node_modules`, build output, and git metadata. It also writes `PACKAGE_MANIFEST.md` into the package folder so the shared copy can be checked before zipping.

## One-command Readiness

For the safest pre-share path, run the full readiness command:

```bash
npm.cmd run trial:ready
```

This command:

1. Runs `health`, `check`, and `test` in the source project.
2. Creates a fresh local trial package.
3. Checks that required package files exist.
4. Checks that excluded state, env, log, dependency, build, and git paths are absent.
5. Runs `check`, `health`, and `test` again inside the generated package.
6. Writes `dist/TRIAL_READINESS_REPORT.json`.

Treat a package as shareable only when this command exits successfully.

## Freeze Candidate

After `trial:simulate` and `trial:ready` pass, freeze the candidate:

```bash
npm.cmd run trial:freeze
```

This reads:

```text
dist/SIMULATED_FIRST_TRIAL_REPORT.json
dist/TRIAL_READINESS_REPORT.json
```

It writes:

```text
dist/TRIAL_FREEZE_REPORT.md
dist/TRIAL_FREEZE_REPORT.json
```

Treat the package as ready for one hosted tester only when the freeze report says:

```text
Decision: GO_HOSTED_TRIAL
```

Then generate the final dispatch note:

```bash
npm.cmd run trial:dispatch
```

This writes:

```text
dist/TRIAL_DISPATCH_NOTE.md
dist/TRIAL_DISPATCH_NOTE.json
```

Send the package only when the dispatch note says:

```text
Decision: READY_TO_SEND
```

## Feedback Ingest

After tester 1 completes the hosted trial, place completed Markdown records in a folder such as:

```text
docs/trial-feedback/tester-1/
```

Then run:

```bash
npm.cmd run trial:ingest-feedback -- docs/trial-feedback/tester-1
npm.cmd run trial:fix-backlog
npm.cmd run trial:session-pack
npm.cmd run trial:host-ready
npm.cmd run trial:privacy-check
npm.cmd run trial:post-session
```

This writes:

```text
dist/TRIAL_FEEDBACK_SUMMARY.md
dist/TRIAL_FEEDBACK_SUMMARY.json
dist/TRIAL_FIX_BACKLOG.md
dist/TRIAL_FIX_BACKLOG.json
dist/trial-session-packs/tester-1/
dist/TRIAL_HOST_READY_REPORT.md
dist/TRIAL_HOST_READY_REPORT.json
dist/TRIAL_POST_SESSION_REPORT.md
dist/TRIAL_POST_SESSION_REPORT.json
dist/TRIAL_PRIVACY_REPORT.md
dist/TRIAL_PRIVACY_REPORT.json
```

Proceed to tester 2 only when privacy check is not `PRIVACY_HOLD`, the summary is not `NO_GO_FIX_FIRST`, the fix backlog has no `P0` items, `trial:host-ready` says `READY_TO_HOST`, `trial:post-session` says `READY_FOR_NEXT_TESTER`, and the host accepts any watch items. Generate a fresh `trial:session-pack` for every hosted tester.

## Simulated First Trial

If you do not have a human tester yet, run:

```bash
npm.cmd run trial:simulate
```

This simulates the first safe trial path:

1. Checks first-run UI markers.
2. Runs Demo read-only preflight.
3. Generates a Demo patch proposal without applying it.
4. Runs one real-project read-only preflight.
5. Confirms no write or command tool was used in read-only paths.
6. Writes `dist/SIMULATED_FIRST_TRIAL_REPORT.md` and `.json`.

Read the persona review when deciding what to fix before a broader trial:

```text
docs/PERSONA_TRIAL_REVIEW.md
```

## Tester Setup Instructions

Send testers this short flow:

1. Install Node.js 20 or later from <https://nodejs.org/>.
2. Unzip the CodeClaw trial folder.
3. Double-click `start-codeclaw.cmd`.
4. Keep the launcher window open.
5. In the browser, click `Demo`.
6. Follow `快速开始` in the UI.
7. Before using a real project, run read-only preflight first.

## Suggested Trial Tasks

Use these in order:

### Trial 1 - Demo Only

Purpose: Check whether the tester can launch and understand the workflow.

Expected:

- Demo runs read-only preflight.
- Quick Start shows a clear next action.
- Patch gate is understandable.

### Trial 2 - Real Project Read-only Preflight

Purpose: Check whether CodeClaw understands a real local project without writes.

Suggested goal:

```text
understand this project and identify safe first context files
```

Expected:

- No writes.
- Source/test context is selected.
- Warnings are understandable.

### Trial 3 - Disposable Patch

Purpose: Check a narrow real workflow on a disposable branch or copied repo.

Rules:

- Use DeepSeek V4 Flash first.
- Use Pro only for review or ambiguous tasks.
- Apply only one small patch.
- Run verification.
- Revert unless the user explicitly wants to keep the change.

## Feedback Collection

Ask testers to fill:

```text
docs/TRIAL_FEEDBACK_TEMPLATE.md
```

Use this host runbook for the first external trial:

```text
docs/FIRST_TRIAL_RUNBOOK.md
```

Use these host-facing checklists while freezing and observing the package:

```text
docs/TRIAL_HOST_BRIEF.md
docs/TRIAL_GO_NO_GO.md
docs/TRIAL_5_MIN_PRECHECK.md
docs/HUMAN_TRIAL_OBSERVATION.md
docs/TRIAL_RESULT_RECORD.md
docs/TRIAL_FEEDBACK_INGEST.md
docs/TRIAL_FIX_BACKLOG.md
docs/TRIAL_SESSION_PACK.md
docs/TRIAL_HOST_READY.md
docs/TRIAL_POST_SESSION.md
docs/TRIAL_PRIVACY_CHECK.md
```

Use this ready-to-send invite if helpful:

```text
docs/TRIAL_INVITE_MESSAGE.md
```

Collect feedback on:

- Startup.
- First-run clarity.
- Preflight trust.
- Model configuration.
- Patch confidence.
- Verification.
- Errors or confusing copy.
- Whether they would use it again on a real project.

## Trial Stop Conditions

Stop the trial before writes if:

- Preflight has blockers.
- Context misses obvious source or test files.
- No verification command is available for a project that should have tests.
- The goal is broad or risky.
- The tester is unsure what a button will do.
- A real API key or cost risk is unclear.

## Package Naming

Use a simple folder name:

```text
CodeClaw-local-trial-YYYYMMDD
```

Example:

```text
CodeClaw-local-trial-20260707
```

## Current Recommendation

Share this package with 3-5 technically comfortable testers before building an installer or desktop shell.

Only consider Electron/Tauri packaging after testers confirm that:

- The local workflow is useful.
- The safety gates feel trustworthy.
- Setup friction is the main blocker.
