# CodeClaw Trial Session Completion

Use this after a hosted tester session as the first gate inside `trial:after-live`.

`trial:complete-session` checks whether the three raw session records are filled enough to ingest. It also catches obvious personal data and secret leaks before the guarded after-live pipeline starts.

## Run

```bash
npm.cmd run trial:complete-session -- --session dist/trial-session-packs/tester-1
```

The command reads:

```text
dist/trial-session-packs/<tester-id>/HUMAN_TRIAL_OBSERVATION.md
dist/trial-session-packs/<tester-id>/TRIAL_FEEDBACK_TEMPLATE.md
dist/trial-session-packs/<tester-id>/TRIAL_RESULT_RECORD.md
```

It writes:

```text
dist/TRIAL_SESSION_COMPLETION_REPORT.md
dist/TRIAL_SESSION_COMPLETION_REPORT.json
dist/trial-session-packs/<tester-id>/HOST_COMPLETION_CHECKLIST.md
```

## Ready Criteria

The report says `SESSION_COMPLETION_READY` only when:

- observation, feedback, and result records exist
- key host summary fields are filled
- feedback has enough answered rows and issue notes
- result record has a clear `Decision after trial`
- `Proceed to the next tester` is answered
- obvious emails, phone numbers, secret tokens, and personal identity fields are not present

`SESSION_COMPLETION_READY_WITH_REVIEW` means the host must accept warnings before after-live.

`SESSION_COMPLETION_HOLD` blocks after-live.

## Next

When completion is ready, run:

```bash
npm.cmd run trial:after-live -- --session dist/trial-session-packs/tester-1 --tester tester-1 --force
npm.cmd run trial:status
```

`trial:after-live` runs `trial:complete-session` automatically before privacy check, post-session, review, and local evidence packaging.
