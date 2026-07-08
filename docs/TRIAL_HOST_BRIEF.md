# CodeClaw Hosted Trial Brief

Use this brief when sending the first frozen local trial package to one hosted tester.

## Purpose

Validate whether a first-time tester can:

- Launch CodeClaw locally.
- Start with Demo.
- Understand Demo mode versus real project mode.
- Run real-project read-only preflight without writes.
- Explain the Apply and Verify confirmation boundaries.

Do not treat this as a feature showcase. Treat it as a friction and trust audit.

## Host Packet

Open these before the session:

- `docs/START_GUIDE.md`
- `docs/TRIAL_5_MIN_PRECHECK.md`
- `docs/HUMAN_TRIAL_OBSERVATION.md`
- `docs/TRIAL_FEEDBACK_TEMPLATE.md`
- `docs/TRIAL_RESULT_RECORD.md`
- `docs/TRIAL_GO_NO_GO.md`
- `dist/TRIAL_FREEZE_REPORT.md` in the source project, if you are the package owner.

## Tester Message

Send the tester:

```text
Please start with docs/START_GUIDE.md.
Use Demo first.
For your own project, run read-only preflight only.
Do not apply patches to a real project during this first session unless it is a disposable copy or branch.
```

## Session Flow

1. Confirm Node.js 20 or later.
2. Complete `docs/TRIAL_5_MIN_PRECHECK.md`.
3. Ask the tester to double-click `start-codeclaw.cmd`.
4. Ask them to switch language if needed.
5. Ask them to click Demo and say what mode they think they are in.
6. Let Demo run read-only preflight.
7. Ask them to follow Quick Start until a patch proposal or patch gate is visible.
8. Ask them to paste a real local project folder and run read-only preflight only.
9. Ask them to describe when CodeClaw reads files, writes files, and runs commands.
10. Stop and fill feedback.
11. Fill `docs/TRIAL_RESULT_RECORD.md` before deciding whether to invite tester 2.

## Host Rules

- Do not explain the UI unless the tester is blocked for more than 30 seconds.
- Do not let the tester apply to a non-disposable real project.
- Do not ask for an API key during the first hosted trial.
- Record exact words when the tester hesitates.

## Minimum Success

The session is successful if:

- The app launches.
- Demo reaches patch proposal or patch gate.
- Real-project preflight completes without writes.
- The tester can describe Apply as the write boundary.
- At least one concrete friction item is captured.
