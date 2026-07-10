# CodeClaw Trial Live Capture

Use this after `trial:pre-live` and before the live tester call. It generates the host's live note file and an anonymous host summary template inside the session folder.

## Command

```bash
npm.cmd run trial:live-capture
```

For a specific tester or session folder:

```bash
npm.cmd run trial:live-capture -- --tester tester-1
npm.cmd run trial:live-capture -- --session dist/trial-session-packs/tester-1
```

## Outputs

```text
dist/TRIAL_LIVE_CAPTURE_REPORT.md
dist/TRIAL_LIVE_CAPTURE_REPORT.json
<session-folder>/LIVE_SESSION_CAPTURE.md
<session-folder>/LIVE_SESSION_HOST_SUMMARY.md
```

## What It Checks

- `trial:pre-live` is ready.
- The selected tester is not a dry-run tester id.
- The session folder is not inside `dist/trial-dry-runs/`.
- Required session files exist.
- The session folder does not contain screenshots, logs, archives, source files, env files, keys, or certificates.
- Markdown records do not contain obvious contact data, personal identity fields, or secret tokens.

## Decisions

```text
LIVE_CAPTURE_HOLD
LIVE_CAPTURE_READY_WITH_REVIEW
LIVE_CAPTURE_READY
```

Host only when the decision is `LIVE_CAPTURE_READY`, or when it is `LIVE_CAPTURE_READY_WITH_REVIEW` and the host explicitly accepts warnings.

## During The Call

Open:

```text
<session-folder>/BEGINNER_FIRST_LIVE_GUIDE.md
<session-folder>/HOST_RUNBOOK.md
<session-folder>/HUMAN_TRIAL_OBSERVATION.md
<session-folder>/LIVE_SESSION_CAPTURE.md
```

Record only anonymous observations. Do not paste real names, contact data, screenshots, logs, project paths, source snippets, or secrets.

## After The Call

Add explicit local notes to the observation file, then run record-draft:

```bash
npm.cmd run trial:record-draft -- --session <session-folder>
```

Copy only confirmed values and ask the human for missing answers before filling:

```text
<session-folder>/HUMAN_TRIAL_OBSERVATION.md
<session-folder>/TRIAL_FEEDBACK_TEMPLATE.md
<session-folder>/TRIAL_RESULT_RECORD.md
<session-folder>/LIVE_SESSION_HOST_SUMMARY.md
```

When the three final records are complete, run the guarded recovery command printed in `TRIAL_LIVE_CAPTURE_REPORT.md`:

```bash
npm.cmd run trial:after-live -- --session <session-folder> --tester <tester-id> --force
```
