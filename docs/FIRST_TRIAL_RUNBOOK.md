# CodeClaw First Trial Runbook

Use this runbook for the first real local trial with one technically comfortable tester.

## Goal

Validate whether a new user can launch CodeClaw, understand the safety gates, run Demo, and run one real-project read-only preflight without help.

Do not optimize for a perfect feature demo yet. Optimize for discovering friction, confusion, and trust issues.

## Trial Scope

Recommended first session:

1. Demo flow.
2. Real project read-only preflight.
3. Feedback collection.

Do not attempt a real write during the first external trial unless all of these are true:

- The tester uses a disposable copy or branch.
- Preflight has no blockers.
- Context files look obviously relevant.
- The verification command is clear.
- The tester can explain what `Apply` will do before clicking it.

## Host Preparation

Run this before sending the package:

```bash
npm.cmd run trial:simulate
npm.cmd run trial:ready
npm.cmd run trial:freeze
npm.cmd run trial:dispatch
```

This writes:

```text
dist/SIMULATED_FIRST_TRIAL_REPORT.md
dist/SIMULATED_FIRST_TRIAL_REPORT.json
dist/TRIAL_FREEZE_REPORT.md
dist/TRIAL_FREEZE_REPORT.json
dist/TRIAL_DISPATCH_NOTE.md
dist/TRIAL_DISPATCH_NOTE.json
```

The simulation checks the first-run UI markers, Demo preflight, Demo patch proposal without applying it, and one real-project read-only preflight.

Read this review after simulation:

```text
docs/PERSONA_TRIAL_REVIEW.md
```

Confirm:

- `dist/TRIAL_READINESS_REPORT.json` has `"ok": true`.
- `dist/TRIAL_FREEZE_REPORT.md` says `Decision: GO_HOSTED_TRIAL`.
- `dist/TRIAL_DISPATCH_NOTE.md` says `Decision: READY_TO_SEND`.
- `hygiene.missingRequired` is `0`.
- `hygiene.disallowed` is `0`.
- Package path exists under `dist/CodeClaw-local-trial-YYYYMMDD`.

Share these with the tester:

- The generated `CodeClaw-local-trial-YYYYMMDD` folder or zip.
- `docs/START_GUIDE.md`.
- `docs/TRIAL_HOST_BRIEF.md`.
- `docs/TRIAL_GO_NO_GO.md`.
- `docs/TRIAL_5_MIN_PRECHECK.md`.
- `docs/HUMAN_TRIAL_OBSERVATION.md`.
- `docs/TRIAL_FEEDBACK_TEMPLATE.md`.
- `docs/TRIAL_RESULT_RECORD.md`.
- `docs/TRIAL_FEEDBACK_INGEST.md`.
- `docs/TRIAL_FIX_BACKLOG.md`.
- `docs/TRIAL_SESSION_PACK.md`.
- `docs/TRIAL_COHORT_SUMMARY.md`.
- `docs/TRIAL_ARCHIVE_SESSION.md`.
- `docs/TRIAL_INVITE_MESSAGE.md` if you want a ready-to-send message.

Generate a session-specific folder before the hosted run:

```bash
npm.cmd run trial:session-pack
npm.cmd run trial:host-ready
```

Host only when `dist/TRIAL_HOST_READY_REPORT.md` says `Decision: READY_TO_HOST`. Use the generated `dist/trial-session-packs/tester-1/SESSION_BRIEF.md` as the live host brief.

## Tester Requirements

- Windows 10 or later.
- Node.js 20 or later.
- A local project they are comfortable letting CodeClaw read.
- 20-30 minutes.

The first trial should not require the tester to provide an API key. Use Mock/Demo first.

## Session Script

### 1. Before Start

Ask the tester:

- What OS and Node version are you using?
- What project type will you use for read-only preflight?
- Is the project safe for local read-only inspection?

### 2. Launch

Tester action:

1. Open the trial folder.
2. Double-click `start-codeclaw.cmd`.
3. Keep the launcher window open.

Observe:

- Did the browser open automatically?
- Did any Windows warning or terminal error appear?
- Did the tester understand that closing the launcher stops CodeClaw?

### 3. Demo

Tester action:

1. Click `Demo`.
2. Confirm the path mode says Demo mode.
3. Follow `Quick Start` or `Task guide`.
4. Stop after seeing the patch gate or patch proposal.

Observe:

- Could they find Demo without help?
- Did they understand that preflight is read-only?
- Did the next action feel clear?
- Did they trust the patch gate?

### 4. Real Project Read-only Preflight

Tester action:

1. Enter a local project path.
2. Enter a narrow goal, for example:

```text
understand this project and identify the safest first files for a small UI bug fix
```

3. Run preflight only.

Observe:

- Did path input cause confusion?
- Did context files look relevant?
- Were warnings or blockers understandable?
- Did CodeClaw avoid writes?

### 5. Stop And Collect Feedback

Ask the tester to fill:

```text
docs/TRIAL_FEEDBACK_TEMPLATE.md
```

Also ask these three questions verbally:

1. What was the first moment you felt unsure?
2. What made you trust or distrust the tool?
3. Would you try this on a real disposable task?

## Stop Conditions

Stop the trial immediately before writes if:

- Preflight reports blockers.
- The context files are mostly docs when source/test files should be selected.
- The tester is unsure what a button will do.
- A real API key or model cost question appears.
- The project has no safe verification command.
- The task goal is broad, vague, or risky.

## Success Criteria

The first trial is successful if:

- The tester launches CodeClaw with little or no help.
- Demo reaches the patch-gate stage.
- Real-project preflight runs without writes.
- The tester can describe when CodeClaw reads files and when it writes files.
- At least one concrete product friction is captured.

## After The Trial

Use the generated session folder, or put completed trial files in a folder such as:

```text
dist/trial-session-packs/tester-1/
```

Then run:

```bash
npm.cmd run trial:privacy-check -- dist/trial-session-packs/tester-1
npm.cmd run trial:post-session -- --session dist/trial-session-packs/tester-1 --next-tester tester-2
```

This writes:

```text
dist/TRIAL_FEEDBACK_SUMMARY.md
dist/TRIAL_FEEDBACK_SUMMARY.json
dist/TRIAL_FIX_BACKLOG.md
dist/TRIAL_FIX_BACKLOG.json
dist/TRIAL_HOST_READY_REPORT.md
dist/TRIAL_HOST_READY_REPORT.json
dist/TRIAL_POST_SESSION_REPORT.md
dist/TRIAL_POST_SESSION_REPORT.json
dist/TRIAL_PRIVACY_REPORT.md
dist/TRIAL_PRIVACY_REPORT.json
```

After at least two completed tester folders exist, run:

```bash
npm.cmd run trial:cohort-summary -- <completed-trials-folder>
```

This writes:

```text
dist/TRIAL_COHORT_SUMMARY.md
dist/TRIAL_COHORT_SUMMARY.json
```

After privacy and post-session reports are ready, create a local-only archive:

```bash
npm.cmd run trial:archive-session -- --session dist/trial-session-packs/tester-1 --tester tester-1
```

This writes:

```text
dist/TRIAL_ARCHIVE_REPORT.md
dist/TRIAL_ARCHIVE_REPORT.json
dist/trial-archives/<tester-id>-<timestamp>/
```

Create a short follow-up note if you need a lightweight human summary:

```text
Tester:
Date:
Package:
Trial type:
Main friction:
Trust issue:
Bug found:
Suggested next product fix:
Proceed to tester 2? Yes / No
```

Only expand to 3-5 testers after at least two completed sessions show no launch blocker, no trust-breaking safety confusion, `TRIAL_PRIVACY_REPORT.md` does not say `PRIVACY_HOLD`, `TRIAL_FEEDBACK_SUMMARY.md` does not say `NO_GO_FIX_FIRST`, `TRIAL_FIX_BACKLOG.md` has no `P0` items, `TRIAL_HOST_READY_REPORT.md` says `READY_TO_HOST` for the next session, `TRIAL_POST_SESSION_REPORT.md` says `READY_FOR_NEXT_TESTER`, and `TRIAL_COHORT_SUMMARY.md` says `READY_TO_EXPAND_3_5` or `EXPAND_WITH_WATCH`.
