# CodeClaw Trial Go/No-Go Checklist

Use this before sharing a package and immediately after the first hosted trial.

## Before Sharing

Run:

```bash
npm.cmd run trial:simulate
npm.cmd run trial:ready
npm.cmd run trial:freeze
npm.cmd run trial:dispatch
```

Go only if:

- `dist/TRIAL_FREEZE_REPORT.md` says `Decision: GO_HOSTED_TRIAL`.
- `dist/TRIAL_DISPATCH_NOTE.md` says `Decision: READY_TO_SEND`.
- `trial:ready` passed in source and generated package.
- Package hygiene has `missingRequired: 0` and `disallowed: 0`.
- Simulated first trial has no Demo blockers.
- Simulated real-project preflight has no blockers and no writes.
- Empty path returns `PATH_EMPTY`.
- File path returns `PATH_IS_FILE`.
- Unconfirmed Apply is blocked.
- Unconfirmed Verify is blocked.
- All friction audit areas are `pass` or explicitly accepted as `watch`.

## No-Go Before Sharing

Do not share if:

- The launcher fails.
- The package contains `.codeclaw`, `.git`, `node_modules`, `.env`, logs, or build output.
- Demo cannot reach a visible patch proposal or patch gate.
- Preflight writes files or runs project commands.
- Apply or Verify can proceed without confirmation.
- The host packet is missing `START_GUIDE`, `HUMAN_TRIAL_OBSERVATION`, or `TRIAL_FEEDBACK_TEMPLATE`.
- The dispatch packet is missing `TRIAL_5_MIN_PRECHECK` or `TRIAL_RESULT_RECORD`.

## During Hosted Trial

Go to real-project read-only preflight only if:

- Demo mode is understood.
- The tester can identify the path mode label.
- The tester understands read-only preflight.
- The tester is using a local project they are allowed to inspect.

Stop before Apply unless:

- The project is a disposable copy or branch.
- Preflight has no blockers.
- Context files are relevant.
- The tester can explain that Apply writes files.
- A verification command is available and understood.

## After Hosted Trial

Proceed to tester 2 only if:

- The tester launched with little or no help.
- No trust-breaking confusion occurred.
- Real-project read-only preflight completed without writes.
- The tester filled `TRIAL_FEEDBACK_TEMPLATE.md`.
- The host filled `HUMAN_TRIAL_OBSERVATION.md`.
- The host filled `TRIAL_RESULT_RECORD.md`.
- `npm.cmd run trial:ingest-feedback -- <completed-feedback-folder>` does not return `NO_GO_FIX_FIRST`.
- `npm.cmd run trial:fix-backlog` has no `P0` items.
- `npm.cmd run trial:session-pack` has generated the current tester folder.
- `npm.cmd run trial:host-ready` says `READY_TO_HOST`.
- Completed session records pass `npm.cmd run trial:privacy-check -- <session-folder>`.
- After a completed session, `npm.cmd run trial:post-session -- --session <session-folder>` says `READY_FOR_NEXT_TESTER` before inviting another tester.
- After at least two completed sessions, `npm.cmd run trial:cohort-summary -- <completed-trials-folder>` says `READY_TO_EXPAND_3_5` or `EXPAND_WITH_WATCH` before expanding to 3-5 testers.
- The next product fix is clear and not a safety blocker.

Do not proceed to tester 2 if:

- The tester could not recover from path errors.
- The tester misunderstood Apply or Verify.
- The tester thought preflight wrote files.
- The host had to coach most steps.
- Any safety gate felt surprising.
- `TRIAL_FEEDBACK_SUMMARY.md` lists safety or trust blockers.
- `TRIAL_FIX_BACKLOG.md` says `FIX_BLOCKERS_BEFORE_TESTER_2`.
- The host does not have a current `SESSION_BRIEF.md` for the tester.
- `TRIAL_HOST_READY_REPORT.md` says `HOLD`.
- `TRIAL_PRIVACY_REPORT.md` says `PRIVACY_HOLD`.
- `TRIAL_POST_SESSION_REPORT.md` says `FIX_BEFORE_NEXT_TESTER`, `HOST_READY_HOLD`, or `POST_SESSION_PIPELINE_FAILED`.
- `TRIAL_COHORT_SUMMARY.md` says `REVIEW_REPEATED_SAFETY` or `HOLD_EXPANSION_FIX_FIRST`.
