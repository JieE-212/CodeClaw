# CodeClaw Trial Host Ready Gate

Use this immediately before a hosted tester session. It checks that the shareable package, feedback backlog, and generated session pack are aligned.

## Run

Recommended pre-host sequence:

```bash
npm.cmd run trial:simulate
npm.cmd run trial:ready
npm.cmd run trial:freeze
npm.cmd run trial:dispatch
npm.cmd run trial:session-pack -- --force
npm.cmd run trial:host-ready
```

The host-ready command reads:

```text
dist/TRIAL_DISPATCH_NOTE.json
dist/TRIAL_FIX_BACKLOG.json
dist/trial-session-packs/tester-1/SESSION_PACK_MANIFEST.json
```

It writes:

```text
dist/TRIAL_HOST_READY_REPORT.md
dist/TRIAL_HOST_READY_REPORT.json
```

Generate and check a specific tester:

```bash
npm.cmd run trial:session-pack -- --tester tester-2 --force
npm.cmd run trial:host-ready -- --tester tester-2
```

## Ready Criteria

The report says `READY_TO_HOST` only when:

- Dispatch is `READY_TO_SEND`.
- The package path exists.
- Required package docs are present.
- No hosted-trial feedback/session folders leaked into the package.
- Fix backlog has no P0 items.
- Session pack manifest exists.
- `SESSION_BRIEF.md`, `HUMAN_TRIAL_OBSERVATION.md`, `TRIAL_FEEDBACK_TEMPLATE.md`, and `TRIAL_RESULT_RECORD.md` exist.
- Watch items from the backlog appear in the session brief and observation checklist.

P1/P2 watch items do not block hosting, but the host must explicitly accept them before starting.

## Stop Conditions

Do not host the session if the decision is `HOLD`.

Fix the listed blockers, then rerun:

```bash
npm.cmd run trial:dispatch
npm.cmd run trial:session-pack -- --force
npm.cmd run trial:host-ready
```

If the package contents changed, rerun the full readiness/freeze path before dispatch.

After the session records are filled, run:

```bash
npm.cmd run trial:post-session -- --session dist/trial-session-packs/tester-1 --next-tester tester-2
```
