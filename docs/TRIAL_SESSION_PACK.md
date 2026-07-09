# CodeClaw Trial Session Pack

Use this immediately before a hosted tester session. It creates a session folder with the three files the host must fill, plus a brief that carries over watch items from `TRIAL_FIX_BACKLOG`.

## Run

Generate the default tester 1 session pack:

```bash
npm.cmd run trial:session-pack
```

For a real external tester, run `npm.cmd run trial:intake` first and proceed only when intake says `READY_FOR_SESSION` or `READY_FOR_SESSION_WITH_REVIEW`. Prefer `npm.cmd run trial:intake-session -- --force` so the session brief includes intake language and scope.

This writes:

```text
dist/trial-session-packs/tester-1/
```

Generate a specific tester pack:

```bash
npm.cmd run trial:session-pack -- --tester tester-2
```

Replace an existing generated pack:

```bash
npm.cmd run trial:session-pack -- --tester tester-2 --force
```

The default `dist/` location is intentional. Session packs may contain real tester notes after the session, and `dist/` is excluded from source control and local trial packages.

## Files

The generated folder contains:

```text
SESSION_BRIEF.md
HUMAN_TRIAL_OBSERVATION.md
TRIAL_FEEDBACK_TEMPLATE.md
TRIAL_RESULT_RECORD.md
SESSION_PACK_MANIFEST.json
```

`SESSION_BRIEF.md` includes:

- The current backlog decision.
- Tester 2 gate instructions.
- P0/P1/P2 watch items from `dist/TRIAL_FIX_BACKLOG.json`.
- Commands to run after the session.

The generated observation and result files include session-specific headers before the standard templates.

## After The Session

Run the post-session loop against the generated folder:

```bash
npm.cmd run trial:privacy-check -- dist/trial-session-packs/tester-1
npm.cmd run trial:post-session -- --session dist/trial-session-packs/tester-1 --next-tester tester-2
```

After at least two completed tester folders exist, run:

```bash
npm.cmd run trial:cohort-summary -- <completed-trials-folder>
```

Create a local-only archive after privacy passes:

```bash
npm.cmd run trial:archive-session -- --session dist/trial-session-packs/tester-1 --tester tester-1
```

If the next step is unclear, run:

```bash
npm.cmd run trial:status
```

Then review:

```text
dist/TRIAL_FEEDBACK_SUMMARY.md
dist/TRIAL_FIX_BACKLOG.md
dist/TRIAL_PRIVACY_REPORT.md
dist/TRIAL_POST_SESSION_REPORT.md
dist/TRIAL_COHORT_SUMMARY.md
dist/TRIAL_ARCHIVE_REPORT.md
dist/TRIAL_STATUS_REPORT.md
```

Before the next hosted session, run:

```bash
npm.cmd run trial:host-ready
```

Host only when `dist/TRIAL_HOST_READY_REPORT.md` says `READY_TO_HOST`.

## Privacy

Do not put API keys, real project source, logs, or screenshots with secrets in a session pack.

`docs/trial-feedback/` and `trial-session-packs/` are excluded from local trial packages so completed tester records are not accidentally redistributed.
