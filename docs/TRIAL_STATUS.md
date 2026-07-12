# CodeClaw Trial Status

Use this whenever you are unsure what the next hosted-trial command should be.

## Run

```bash
npm.cmd run trial:status
```

The command reads the current `dist/` reports and writes:

```text
dist/TRIAL_STATUS_REPORT.md
dist/TRIAL_STATUS_REPORT.json
```

It summarizes:

- current trial stage
- next recommended command
- latest package folder
- latest session pack
- latest archive folder
- intake-to-review dry-run report link when available
- report decisions
- blockers and warnings

## Decisions

Common status decisions:

```text
NEEDS_READINESS
NEEDS_FREEZE
NEEDS_DISPATCH
NEEDS_HOST_READY
NEEDS_HOST_RUN
HOST_RUN_BLOCKED
NEEDS_PRE_LIVE
PRE_LIVE_BLOCKED
NEEDS_LIVE_CAPTURE
LIVE_CAPTURE_BLOCKED
READY_TO_HOST
READY_FOR_AFTER_LIVE
SESSION_COMPLETION_BLOCKED
PRIVACY_HOLD
NEEDS_AFTER_LIVE
AFTER_LIVE_BLOCKED
NEEDS_NEXT_LIVE
NEXT_LIVE_BLOCKED
READY_TO_HOST_NEXT_LIVE
NEEDS_SESSION_REVIEW
SESSION_REVIEW_BLOCKED
POST_SESSION_REVIEW
NEEDS_ARCHIVE
NEEDS_TESTER_INTAKE
TESTER_INTAKE_BLOCKED
READY_FOR_NEXT_TESTER
COHORT_REVIEW
NEEDS_COHORT_HANDOFF
COHORT_HANDOFF_BLOCKED
COHORT_HANDOFF_REVIEW
READY_TO_EXPAND
```

When the status report lists blockers, fix those before hosting or expanding.

When there are no blockers, run the `Next command` shown at the top of `TRIAL_STATUS_REPORT.md`.

## Tester-2 Operator Rhythm

While no real human tester is available, keep tester-2 paused. Use these two commands only:

```bash
npm.cmd run trial:first-live-standby -- --tester tester-2
npm.cmd run trial:post-call-rehearsal -- --force
```

The standby command checks the real first-live path without creating tester data. The rehearsal uses only synthetic `tester-rehearsal-*` records and never counts as real feedback.

When a real human tester is scheduled, rerun standby and host only when it returns `FIRST_LIVE_STANDBY_READY` or `FIRST_LIVE_STANDBY_READY_WITH_REVIEW`. Read and accept every warning before hosting. During the call, keep these files open:

```text
HOST_RUNBOOK.md
LIVE_SESSION_CAPTURE.md
HUMAN_TRIAL_OBSERVATION.md
TRIAL_FEEDBACK_TEMPLATE.md
TRIAL_RESULT_RECORD.md
```

Keep the session limited to Demo plus real-project read-only preflight, and stop before Apply on every real project.

Immediately after the real call, keep raw notes local and run:

```bash
npm.cmd run trial:record-draft -- --session dist\trial-session-packs\tester-2
npm.cmd run trial:after-live -- --session dist\trial-session-packs\tester-2 --tester tester-2 --force
```

Run `trial:after-live` only after a human has confirmed and filled the three final record files. Do not turn rehearsal output or missing answers into tester feedback.

## Examples

Use an alternate report folder:

```bash
npm.cmd run trial:status -- --dist dist
```

After running any trial command, rerun:

```bash
npm.cmd run trial:status
```

Before filling the first real tester roster, run:

```bash
npm.cmd run trial:intake-review-dry-run -- --force
```

If the decision is `NEEDS_TESTER_INTAKE`, run:

```bash
npm.cmd run trial:intake -- --init
```

Then fill the local roster and rerun `npm.cmd run trial:intake`.

To see a privacy-safe tester-2 launch checklist before or after filling the roster, run:

```bash
npm.cmd run trial:tester-launch-plan -- --tester tester-2
```

If tester-2 is the first real human tester and you are waiting for the tester to be available, run:

```bash
npm.cmd run trial:first-live-standby -- --tester tester-2
```

This confirms the first-live path is still ready without creating real tester data.

If no human tester is available yet and you want to rehearse the post-call loop safely, run:

```bash
npm.cmd run trial:post-call-rehearsal -- --force
```

This uses synthetic `tester-rehearsal-*` ids and must not be counted as real tester feedback.

If intake is ready, the next command should be:

```bash
npm.cmd run trial:intake-session -- --force
```

If the decision is `NEEDS_HOST_RUN`, run:

```bash
npm.cmd run trial:host-run
```

Host only after the host run report says `HOST_RUN_READY`, or after the host accepts every warning in `HOST_RUN_READY_WITH_REVIEW`.

If the decision is `NEEDS_PRE_LIVE`, run:

```bash
npm.cmd run trial:pre-live
```

Host only after the pre-live report says `PRE_LIVE_READY_TO_HOST`, or after the host accepts every warning in `PRE_LIVE_READY_WITH_HOST_REVIEW`.

If the decision is `NEEDS_LIVE_CAPTURE`, run:

```bash
npm.cmd run trial:live-capture
```

Host only after the live-capture report says `LIVE_CAPTURE_READY`, or after the host accepts every warning in `LIVE_CAPTURE_READY_WITH_REVIEW`.

After the hosted session records are filled, run:

```bash
npm.cmd run trial:complete-session -- --session <session-folder>
```

If the decision is `READY_FOR_AFTER_LIVE`, run:

```bash
npm.cmd run trial:after-live -- --session <session-folder> --tester <tester-id>
```

This runs completion, privacy, post-session, review, archive, status, and local evidence packaging in order.

If the decision is `NEEDS_AFTER_LIVE`, run the real session's guarded after-live once its records are confirmed. If a truthful real result is `AFTER_LIVE_BLOCKED` because the host chose Fix first, do not edit the answers or rerun it to make it green.

If the decision is `NEEDS_REMEDIATION` or `REMEDIATION_BLOCKED`, run:

```bash
npm.cmd run trial:remediation -- --tester <previous-tester-id>
```

The independent remediation gate preserves the original blocked decision and requires mapped fixes, a clean current readiness commit, and manual host checks before status can return to next-tester intake.

If the decision is `NEEDS_NEXT_LIVE`, run:

```bash
npm.cmd run trial:next-live -- --tester <tester-id> --accept-review --accepted-by <host-id>
```

This confirms the previous tester is closed and the next tester's intake, host-ready, host-run, pre-live, live-capture, and watch items all point to the same anonymous tester id.

If the decision is `NEXT_LIVE_BLOCKED`, fix the listed blocker before hosting another tester.

If the decision is `NEEDS_COHORT_HANDOFF`, run:

```bash
npm.cmd run trial:cohort-handoff -- --accept-review --accept-privacy --accepted-by <host-id>
```

If the decision is `COHORT_HANDOFF_BLOCKED`, close missing after-live evidence or fix cohort blockers before expanding.

If the decision is `READY_TO_EXPAND`, open `COHORT_EXPANSION_HANDOFF.md` and follow it for the next 3-5 testers.

If the decision is `NEEDS_SESSION_REVIEW`, run:

```bash
npm.cmd run trial:review-session
```

Proceed only when the review decision is `REVIEW_WATCH_NEXT_TESTER` with host acceptance or `REVIEW_PROCEED`.
