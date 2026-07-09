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
READY_TO_HOST
PRIVACY_HOLD
POST_SESSION_REVIEW
NEEDS_ARCHIVE
NEEDS_TESTER_INTAKE
TESTER_INTAKE_BLOCKED
READY_FOR_NEXT_TESTER
COHORT_REVIEW
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

If the decision is `NEEDS_TESTER_INTAKE`, run:

```bash
npm.cmd run trial:intake -- --init
```

Then fill the local roster and rerun `npm.cmd run trial:intake`.

If intake is ready, the next command should be:

```bash
npm.cmd run trial:intake-session -- --force
```

If the decision is `NEEDS_HOST_RUN`, run:

```bash
npm.cmd run trial:host-run
```

Host only after the host run report says `HOST_RUN_READY`, or after the host accepts every warning in `HOST_RUN_READY_WITH_REVIEW`.
