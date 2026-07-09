# CodeClaw Trial Intake-To-Review Dry Run

Use this before filling the first real tester roster. It rehearses one anonymous tester from intake through review, without using `.codeclaw/` or real tester data.

## Command

```bash
npm.cmd run trial:intake-review-dry-run -- --force
```

## What It Does

The dry run creates an anonymous tester fixture under `dist/trial-dry-runs/`, then runs:

1. `package:local-trial`
2. `trial:intake`
3. `trial:intake-session`
4. `trial:host-ready`
5. `trial:host-run`
6. `trial:complete-session`
7. `trial:post-session`
8. `trial:review-session`
9. `trial:status`

It also writes safe completed session records so the post-session and review gates can be exercised end to end.

## Outputs

- `dist/TRIAL_INTAKE_REVIEW_DRY_RUN_REPORT.md`
- `dist/TRIAL_INTAKE_REVIEW_DRY_RUN_REPORT.json`
- `dist/trial-dry-runs/<run-id>/`

The dry-run roster is generated inside `dist/trial-dry-runs/<run-id>/TESTER_ROSTER.json`, not inside `.codeclaw/`.

## Passing Decision

The target decision is:

```text
DRY_RUN_READY_FOR_REAL_INTAKE
```

After that, fill the real local-only roster and continue:

```bash
npm.cmd run trial:intake
npm.cmd run trial:intake-session -- --force
npm.cmd run trial:status
```

## Privacy Rules

- Do not copy real tester names, contact details, company names, account URLs, or private project names into dry-run files.
- Keep generated dry-run artifacts under ignored `dist/`.
- Treat the generated package as a rehearsal package, not a tester-facing package.
- Run this again after changing trial scripts or package docs.
