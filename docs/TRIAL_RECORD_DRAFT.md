# CodeClaw Trial Record Draft

Use this after a hosted tester call when the host has raw local notes, but before copying anything into the final session record files.

The helper is local-only. It does not edit tester records, does not invent feedback, and writes only generated draft reports under `dist/`.

## Run

Use the generated session folder:

```bash
npm.cmd run trial:record-draft -- --session dist/trial-session-packs/tester-2
```

Or point it at a separate local notes file:

```bash
npm.cmd run trial:record-draft -- --session dist/trial-session-packs/tester-2 --notes <local-notes.md>
```

## Outputs

```text
dist/TRIAL_RECORD_DRAFT.md
dist/TRIAL_RECORD_DRAFT.json
```

The report suggests fields for:

```text
HUMAN_TRIAL_OBSERVATION.md
TRIAL_FEEDBACK_TEMPLATE.md
TRIAL_RESULT_RECORD.md
```

It also lists missing fields that still need the tester or host to answer.

## Decisions

```text
RECORD_DRAFT_HOLD
RECORD_DRAFT_READY_WITH_GAPS
RECORD_DRAFT_READY
```

`RECORD_DRAFT_HOLD` means there are no notes yet, the session folder is missing, or the notes include privacy blockers such as personal email, phone numbers, or secret tokens.

`RECORD_DRAFT_READY_WITH_GAPS` means safe explicit notes were found, but some final record fields still need human confirmation.

`RECORD_DRAFT_READY` means all tracked fields have explicit values.

## Privacy

Do not commit raw tester notes or generated session folders. Keep names, contacts, account URLs, private project names, screenshots, logs, source snippets, local paths, API keys, and secret tokens out of tester records.

If the report warns about a path, account URL, screenshot, log, or source snippet, redact the raw note before sharing or archiving anything.
