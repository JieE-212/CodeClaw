# CodeClaw Trial Session Review

Use this after `trial:post-session`.

`trial:review-session` turns the completed tester evidence into a host decision brief. It reads the completion, privacy, feedback, backlog, post-session, and archive reports, then decides whether to fix now, proceed with watch items, or continue.

## Run

```bash
npm.cmd run trial:review-session
```

For a specific session or reports folder:

```bash
npm.cmd run trial:review-session -- --session dist/trial-session-packs/tester-1 --reports dist --tester tester-1
```

The command reads:

```text
dist/TRIAL_SESSION_COMPLETION_REPORT.json
dist/TRIAL_PRIVACY_REPORT.json
dist/TRIAL_FEEDBACK_SUMMARY.json
dist/TRIAL_FIX_BACKLOG.json
dist/TRIAL_POST_SESSION_REPORT.json
dist/TRIAL_ARCHIVE_REPORT.json
```

It writes:

```text
dist/TRIAL_REVIEW_REPORT.md
dist/TRIAL_REVIEW_REPORT.json
```

## Decisions

```text
REVIEW_WAITING_FOR_REPORTS
REVIEW_BLOCKED
REVIEW_FIX_NOW
REVIEW_WATCH_NEXT_TESTER
REVIEW_PROCEED
```

`REVIEW_FIX_NOW` means do not invite another tester until P0 items are fixed and verified.

`REVIEW_WATCH_NEXT_TESTER` means the next tester can proceed only after the host accepts the listed P1/P2 watch items.

`REVIEW_PROCEED` means no must-fix or watch item remains in this review.

## Action Items

Every P0/P1 item in the review report includes:

- owner
- action
- verification command
- evidence

Use this report as the host decision record before archiving or inviting another tester.

