# CodeClaw Trial Next-Live Gate

Use this after the previous tester has passed `trial:after-live` and the next tester has already passed intake, host-ready, host-run, pre-live, and live-capture.

## Command

```bash
npm.cmd run trial:next-live -- --tester tester-2 --accept-review --accepted-by <host-id>
```

Use `--accept-review` only after the host has reviewed and accepted watch items or ready-with-review warnings.

## What It Checks

The gate blocks when:

- the previous tester has not passed `trial:after-live`
- the next tester id matches the previous tester id
- a dry-run tester id is selected
- intake, session pack, host-ready, host-run, pre-live, and live-capture point to different tester ids
- the session folder or manifest still points to the previous tester
- accepted watch items are missing from the session manifest, host-ready report, host-run report, session brief, host runbook, or observation checklist
- host acceptance is required but `--accept-review` was not provided

## Outputs

```text
dist/TRIAL_NEXT_LIVE_REPORT.md
dist/TRIAL_NEXT_LIVE_REPORT.json
dist/trial-session-packs/<tester-id>/NEXT_LIVE_HOST_HANDOFF.md
```

The handoff note includes:

- previous tester closed
- next anonymous tester id
- accepted watch items
- stop conditions
- launch files
- after-call command

## Decisions

```text
NEXT_LIVE_HOLD
NEXT_LIVE_READY_WITH_REVIEW
NEXT_LIVE_READY
```

Host only when the decision is `NEXT_LIVE_READY` or `NEXT_LIVE_READY_WITH_REVIEW` after the host has accepted every warning.

## Recommended Loop

```bash
npm.cmd run trial:intake
npm.cmd run trial:intake-session -- --tester tester-2 --force
npm.cmd run trial:host-ready -- --tester tester-2
npm.cmd run trial:host-run -- --tester tester-2
npm.cmd run trial:pre-live -- --tester tester-2
npm.cmd run trial:live-capture -- --tester tester-2
npm.cmd run trial:next-live -- --tester tester-2 --accept-review --accepted-by <host-id>
npm.cmd run trial:status
```

Keep the real tester roster and raw session records local-only.
