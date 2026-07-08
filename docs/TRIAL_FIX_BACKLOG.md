# CodeClaw Trial Fix Backlog

Use this after `trial:ingest-feedback`. It turns the feedback summary into a prioritized repair plan for the next tester.

## Run

From the project root:

```bash
npm.cmd run trial:ingest-feedback -- docs/trial-feedback/tester-1
npm.cmd run trial:fix-backlog
```

The backlog command reads:

```text
dist/TRIAL_FEEDBACK_SUMMARY.json
```

It writes:

```text
dist/TRIAL_FIX_BACKLOG.md
dist/TRIAL_FIX_BACKLOG.json
```

To test the parser and backlog planner without real user records:

```bash
npm.cmd run trial:ingest-feedback -- examples/trial-feedback-sample
npm.cmd run trial:fix-backlog
```

## Priority Lanes

`P0` means must fix before tester 2.

`P1` means safety or trust watch item. Tester 2 can proceed only if the host explicitly accepts the risk and watches it.

`P2` means normal friction watch item. Keep it in the observation checklist for tester 2.

`P3` means optional polish. Do not spend the next cycle here unless it repeats or becomes a blocker.

## Decisions

The backlog can return:

```text
WAITING_FOR_FEEDBACK
FIX_BLOCKERS_BEFORE_TESTER_2
HOST_REVIEW_REQUIRED
READY_FOR_TESTER_2_WITH_SAFETY_WATCH
READY_FOR_TESTER_2_WITH_WATCH
READY_FOR_TESTER_2
```

Do not invite tester 2 when the decision is `FIX_BLOCKERS_BEFORE_TESTER_2`.

Do not invite tester 2 when the decision is `HOST_REVIEW_REQUIRED` until the host fills the missing go/no-go fields.

For `READY_FOR_TESTER_2_WITH_SAFETY_WATCH`, add every `P1` item to the live observation notes and stop the trial if the concern repeats.

## Repair Loop

1. Read `dist/TRIAL_FIX_BACKLOG.md`.
2. Fix all `P0` items.
3. If code or package behavior changed, rerun:

```bash
npm.cmd run trial:simulate
npm.cmd run trial:ready
npm.cmd run trial:freeze
npm.cmd run trial:dispatch
```

4. Rerun:

```bash
npm.cmd run trial:ingest-feedback -- docs/trial-feedback/tester-1
npm.cmd run trial:fix-backlog
```

5. Invite tester 2 only after the backlog gate allows it.

6. Generate the hosted session folder:

```bash
npm.cmd run trial:session-pack -- --tester tester-2
npm.cmd run trial:host-ready -- --tester tester-2
```

Use `SESSION_BRIEF.md` from that folder during the live session only when `TRIAL_HOST_READY_REPORT.md` says `READY_TO_HOST`.
