# CodeClaw First-Live Standby

Use this while waiting for the first real human tester. It checks whether the tester-2 first-live path is still ready without creating real tester data or running a live session.

## Run

```bash
npm.cmd run trial:first-live-standby -- --tester tester-2
```

It writes:

```text
dist/TRIAL_FIRST_LIVE_STANDBY.md
dist/TRIAL_FIRST_LIVE_STANDBY.json
```

## What It Checks

- Tester intake, intake-session, host-ready, host-run, pre-live, live-capture, and first-live launch-plan reports.
- All reports point to the same anonymous tester id.
- The session folder has `BEGINNER_FIRST_LIVE_GUIDE.md`, `HOST_RUNBOOK.md`, `LIVE_SESSION_CAPTURE.md`, the host summary, the three final record files, and the session manifest.
- The manifest keeps the first-live scope to Demo plus real-read-only.
- The session folder does not contain screenshots, logs, source files, env files, contact data, or likely secret tokens.

## Decisions

```text
FIRST_LIVE_STANDBY_WAITING_FOR_TESTER
FIRST_LIVE_STANDBY_NEEDS_REFRESH
FIRST_LIVE_STANDBY_READY_WITH_REVIEW
FIRST_LIVE_STANDBY_READY
FIRST_LIVE_STANDBY_BLOCKED
```

Host only when the decision is `FIRST_LIVE_STANDBY_READY` or `FIRST_LIVE_STANDBY_READY_WITH_REVIEW`.

If the decision is `FIRST_LIVE_STANDBY_READY_WITH_REVIEW`, the host must read and accept the warnings first. Keep the session limited to Demo and real read-only preflight.

## Refresh Loop

If standby needs a refresh, rerun:

```bash
npm.cmd run trial:intake
npm.cmd run trial:intake-session -- --tester tester-2 --force
npm.cmd run trial:host-ready -- --tester tester-2
npm.cmd run trial:host-run -- --tester tester-2
npm.cmd run trial:pre-live -- --tester tester-2
npm.cmd run trial:live-capture -- --tester tester-2
npm.cmd run trial:tester-launch-plan -- --tester tester-2 --first-live
npm.cmd run trial:first-live-standby -- --tester tester-2
```

## After The Call

After the real tester call, capture explicit local notes and run:

```bash
npm.cmd run trial:record-draft -- --session dist/trial-session-packs/tester-2
```

Copy only confirmed values into the three final records and ask the human for missing answers. Then run:

```bash
npm.cmd run trial:after-live -- --session dist/trial-session-packs/tester-2 --tester tester-2 --force
```

## Rehearsal While Waiting

If no human tester is available yet, rehearse the post-call pipeline with synthetic data:

```bash
npm.cmd run trial:post-call-rehearsal -- --force
```

This does not count as tester feedback. It only confirms `trial:record-draft`, `trial:after-live`, and this standby check still work together.
