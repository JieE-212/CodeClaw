# CodeClaw Trial Cohort Summary

Use this after at least two hosted tester sessions have completed.

## Folder Layout

Keep one folder per tester. Each folder can contain the reports generated after that tester's session:

```text
completed-trials/
  tester-1/
    TRIAL_PRIVACY_REPORT.json
    TRIAL_FEEDBACK_SUMMARY.json
    TRIAL_FIX_BACKLOG.json
    TRIAL_POST_SESSION_REPORT.json
  tester-2/
    TRIAL_PRIVACY_REPORT.json
    TRIAL_FEEDBACK_SUMMARY.json
    TRIAL_FIX_BACKLOG.json
    TRIAL_POST_SESSION_REPORT.json
```

The script accepts partial folders, but expansion decisions are reliable only when privacy, feedback, backlog, and post-session reports are present.

## Run

For the default generated session-pack folder:

```bash
npm.cmd run trial:cohort-summary
```

For an explicit cohort folder:

```bash
npm.cmd run trial:cohort-summary -- completed-trials
```

The command writes:

```text
dist/TRIAL_COHORT_SUMMARY.md
dist/TRIAL_COHORT_SUMMARY.json
```

## Decisions

The cohort report can return:

```text
READY_TO_EXPAND_3_5
EXPAND_WITH_WATCH
REVIEW_REPEATED_SAFETY
WAITING_FOR_MORE_SESSIONS
HOLD_EXPANSION_FIX_FIRST
```

Proceed to 3-5 testers only when the decision is `READY_TO_EXPAND_3_5` or `EXPAND_WITH_WATCH`.

If the decision is `EXPAND_WITH_WATCH`, copy the repeated themes into the next session brief and explicitly accept the warning before hosting.

If the decision is `REVIEW_REPEATED_SAFETY` or `HOLD_EXPANSION_FIX_FIRST`, do not expand until the host has reviewed the repeated safety friction or fixed the blockers.

## Example

Use the sample cohort fixture to verify the report shape:

```bash
npm.cmd run trial:cohort-summary -- examples/trial-cohort-sample
```

