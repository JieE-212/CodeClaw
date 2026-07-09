# CodeClaw Trial Post-Session Loop

Use this after a hosted tester session is complete and the generated feedback files are filled.

## Run

For the default tester 1 session:

```bash
npm.cmd run trial:post-session
```

This is equivalent to:

```bash
npm.cmd run trial:complete-session -- --session dist/trial-session-packs/tester-1
npm.cmd run trial:privacy-check -- dist/trial-session-packs/tester-1
npm.cmd run trial:ingest-feedback -- dist/trial-session-packs/tester-1
npm.cmd run trial:fix-backlog
npm.cmd run trial:session-pack -- --tester tester-2 --force
npm.cmd run trial:host-ready -- --tester tester-2
```

For a specific completed session and next tester:

```bash
npm.cmd run trial:complete-session -- --session dist/trial-session-packs/tester-1
npm.cmd run trial:post-session -- --session dist/trial-session-packs/tester-1 --next-tester tester-2
```

`trial:post-session` runs `trial:complete-session` automatically first. Run completion manually when you want to check missing fields before starting the full post-session pipeline.

The command writes:

```text
dist/TRIAL_POST_SESSION_REPORT.md
dist/TRIAL_POST_SESSION_REPORT.json
```

## Decisions

The post-session report can return:

```text
READY_FOR_NEXT_TESTER
FIX_BEFORE_NEXT_TESTER
HOST_READY_HOLD
REVIEW_BEFORE_NEXT_TESTER
POST_SESSION_PIPELINE_FAILED
```

Proceed only when it says `READY_FOR_NEXT_TESTER`.

If it says `FIX_BEFORE_NEXT_TESTER` or `HOST_READY_HOLD`, fix the listed blockers before inviting the next tester.

If it says `POST_SESSION_PIPELINE_FAILED` because completion or privacy check failed, finish or redact the completed session records and rerun the same command.

After at least two completed tester folders exist, run:

```bash
npm.cmd run trial:cohort-summary -- <completed-trials-folder>
```

Use `TRIAL_COHORT_SUMMARY.md` before expanding to 3-5 testers.

Create a local-only archive after privacy and post-session reports are ready:

```bash
npm.cmd run trial:review-session
npm.cmd run trial:archive-session -- --session <session-folder> --tester <tester-id>
```

Then run `npm.cmd run trial:status` to confirm the next command.

## Notes

`trial:post-session` intentionally allows the final host-ready step to produce `HOLD` without hiding the report. A real tester can reveal blockers; the command should preserve that decision rather than crash before writing the summary.
