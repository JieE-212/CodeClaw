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

If the decision is `NEEDS_AFTER_LIVE` or `AFTER_LIVE_BLOCKED`, rerun `trial:after-live` after fixing the listed blocker.

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
