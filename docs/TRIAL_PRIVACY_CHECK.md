# CodeClaw Trial Privacy Check

Use this before ingesting completed hosted-trial records. It scans a session or feedback folder for accidental sensitive content.

## Run

Check the default tester 1 session folder:

```bash
npm.cmd run trial:privacy-check
```

Check a specific folder:

```bash
npm.cmd run trial:privacy-check -- dist/trial-session-packs/tester-1
```

The command writes:

```text
dist/TRIAL_PRIVACY_REPORT.md
dist/TRIAL_PRIVACY_REPORT.json
```

## Decisions

```text
PRIVACY_OK
PRIVACY_REVIEW
PRIVACY_HOLD
```

`PRIVACY_HOLD` blocks `trial:post-session`.

`PRIVACY_REVIEW` means the host should review warnings, such as absolute personal paths or stack traces, before continuing.

## What It Blocks

- API keys and tokens.
- Private key material.
- `.env`, key, certificate, and log files.
- Source-like files accidentally copied into feedback.
- Long or source-like fenced code blocks.
- Very large files that may contain logs or source dumps.

## What It Warns About

- Absolute personal paths such as `C:\Users\...`, `/Users/...`, or `/home/...`.
- Stack trace lines.
- Smaller code blocks that may need host review.

## Post-Session Flow

`trial:post-session` runs `trial:complete-session` first, then this privacy check before feedback ingest:

```bash
npm.cmd run trial:post-session -- --session dist/trial-session-packs/tester-1 --next-tester tester-2
```

If privacy check fails, redact the files and rerun the same command.
