# CodeClaw Trial Host Runbook

Use this after `trial:host-ready` says `READY_TO_HOST`.

`trial:host-run` generates the live host runbook for one tester session. It does not replace the gate. It only writes `HOST_RUNBOOK.md` when the host-ready gate and intake-session report are aligned.

## Run

```bash
npm.cmd run trial:host-run
```

The command reads:

```text
dist/TRIAL_HOST_READY_REPORT.json
dist/TRIAL_INTAKE_SESSION_REPORT.json
dist/trial-session-packs/<tester-id>/SESSION_PACK_MANIFEST.json
```

It writes:

```text
dist/TRIAL_HOST_RUN_REPORT.md
dist/TRIAL_HOST_RUN_REPORT.json
dist/trial-session-packs/<tester-id>/HOST_RUNBOOK.md
```

## Specific Tester

```bash
npm.cmd run trial:host-run -- --tester tester-1
```

## Ready Criteria

The report says `HOST_RUN_READY` only when:

- `trial:host-ready` says `READY_TO_HOST`.
- The session folder exists.
- `SESSION_BRIEF.md`, `HUMAN_TRIAL_OBSERVATION.md`, `TRIAL_FEEDBACK_TEMPLATE.md`, `TRIAL_RESULT_RECORD.md`, and `SESSION_PACK_MANIFEST.json` exist.
- The tester id matches across host-ready, intake-session, and the session manifest.
- Intake-session says `INTAKE_SESSION_READY` or `INTAKE_SESSION_READY_WITH_REVIEW`.

`HOST_RUN_READY_WITH_REVIEW` is allowed only when the host explicitly accepts the listed warnings before the call.

## Live Use

Open the generated `HOST_RUNBOOK.md` before the call. Keep these files open next to it:

- `SESSION_BRIEF.md`
- `HUMAN_TRIAL_OBSERVATION.md`
- `TRIAL_FEEDBACK_TEMPLATE.md`
- `TRIAL_RESULT_RECORD.md`

After the session, fill the records and run:

```bash
npm.cmd run trial:post-session -- --session dist/trial-session-packs/tester-1 --next-tester tester-2
npm.cmd run trial:status
```

