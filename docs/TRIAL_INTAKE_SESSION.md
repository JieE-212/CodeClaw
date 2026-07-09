# CodeClaw Trial Intake Session

Use this after `trial:intake` says `READY_FOR_SESSION` or `READY_FOR_SESSION_WITH_REVIEW`.

This command generates the next tester session pack from the local-only tester intake report. It avoids copying personal tester information and adds only the anonymous tester id, language, allowed scope, and review flags to the session brief.

## Run

```bash
npm.cmd run trial:intake-session -- --force
```

The command reads:

```text
dist/TRIAL_TESTER_INTAKE_REPORT.json
```

It writes:

```text
dist/TRIAL_INTAKE_SESSION_REPORT.md
dist/TRIAL_INTAKE_SESSION_REPORT.json
dist/trial-session-packs/<tester-id>/
```

The generated `SESSION_BRIEF.md` includes a `Tester Intake` section with:

- anonymous tester id
- tester language
- host language
- allowed scope
- consent recorded status
- privacy accepted status
- project permission recorded status
- whether host review is required

## Specific Tester

```bash
npm.cmd run trial:intake-session -- --tester tester-1 --force
```

## Next Step

After generation:

```bash
npm.cmd run trial:host-ready -- --tester tester-1
npm.cmd run trial:host-run -- --tester tester-1
npm.cmd run trial:status
```

Host only when `trial:host-ready` says `READY_TO_HOST`, `trial:host-run` writes `HOST_RUNBOOK.md`, and `trial:status` has no blockers.

## Blocking Rules

The command blocks when:

- the intake report is missing
- intake is `WAITING_FOR_TESTER_INTAKE`
- intake is `INTAKE_HOLD`
- the selected tester is blocked
- the selected tester is not ready
- session pack generation fails
