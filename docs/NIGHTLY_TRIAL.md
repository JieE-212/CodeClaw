# CodeClaw Nightly Trial

Use this when you want a safe 2-3 hour unattended validation run.

The nightly trial does not edit product code. It repeatedly runs automated checks and simulated trial paths, then writes logs and a summary.

## Recommended 2.5 Hour Run

Double-click:

```text
run-nightly-trial.cmd
```

Or run from PowerShell:

```bash
npm.cmd run nightly:trial
```

Default behavior:

- Runs for 150 minutes.
- Runs `check`, `test`, `health`, and `trial:simulate` each cycle.
- Waits 10 minutes between cycles.
- Runs `trial:ready` every 3 cycles.
- Runs final `trial:ready` before finishing.
- Writes reports under `dist/nightly-trial/YYYYMMDD-HHMMSS`.

## Shorter Or Longer Runs

Two hours:

```bash
npm.cmd run nightly:trial -- --hours 2
```

Three hours:

```bash
npm.cmd run nightly:trial -- --hours 3
```

Use a different interval:

```bash
npm.cmd run nightly:trial -- --hours 2.5 --interval-minutes 15
```

## Use A Specific Read-only Trial Repo

```bash
npm.cmd run nightly:trial -- --real-repo "C:\path\to\repo"
```

The repo is used by `trial:simulate` for read-only preflight. The nightly script does not approve writes.

## Fast Verification

For a quick script sanity check:

```bash
npm.cmd run nightly:trial -- --minutes 0.05 --commands health --skip-final-ready
```

## Reports

After the run, open:

```text
dist/nightly-trial/YYYYMMDD-HHMMSS/summary.md
dist/nightly-trial/YYYYMMDD-HHMMSS/summary.json
```

Each step also writes:

```text
cycle-N-step.out.log
cycle-N-step.err.log
```

## Pass Criteria

Treat the run as good only if:

- `summary.md` says `Overall: Pass`.
- No step has a nonzero exit code.
- `trial:simulate` reports no Demo or read-only preflight blocker.
- `trial:ready` reports `missingRequired: 0` and `disallowed: 0`.

## Stop And Investigate

Do not share a trial package if:

- Any step fails.
- Health no longer reports the first-screen safety marker.
- Simulated trial reports a write attempt in a read-only path.
- Package hygiene reports excluded files.
