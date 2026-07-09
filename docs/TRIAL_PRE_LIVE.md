# CodeClaw Trial Pre-Live Gate

Use this after real tester intake, intake-session, host-ready, and host-run are ready. It is the final gate before scheduling or starting the first real hosted tester session.

## Command

```bash
npm.cmd run trial:pre-live
```

For a specific tester:

```bash
npm.cmd run trial:pre-live -- --tester tester-1
```

## Required Order

Run these from the project root:

```bash
npm.cmd run trial:intake-review-dry-run -- --force
npm.cmd run trial:intake -- --init
npm.cmd run trial:intake
npm.cmd run trial:intake-session -- --force
npm.cmd run trial:host-ready
npm.cmd run trial:host-run
npm.cmd run trial:pre-live
npm.cmd run trial:status
```

## What It Checks

- The anonymous intake-to-review dry run passed.
- The real tester intake report is ready.
- The selected tester is not a dry-run tester id.
- The local roster exists and does not contain personal identity fields.
- Consent, privacy acceptance, allowed scope, and tester id match across reports.
- The session pack exists outside dry-run output.
- `HOST_RUNBOOK.md` exists.
- `trial:host-ready` says `READY_TO_HOST`.
- `trial:host-run` says `HOST_RUN_READY` or `HOST_RUN_READY_WITH_REVIEW`.

## Outputs

```text
dist/TRIAL_PRE_LIVE_REPORT.md
dist/TRIAL_PRE_LIVE_REPORT.json
```

## Decisions

```text
PRE_LIVE_HOLD
PRE_LIVE_READY_WITH_HOST_REVIEW
PRE_LIVE_READY_TO_HOST
```

Only start the live tester session when the decision is `PRE_LIVE_READY_TO_HOST`, or when it is `PRE_LIVE_READY_WITH_HOST_REVIEW` and the host explicitly accepts every warning.

## Roster Rules

Keep `.codeclaw/trial-intake/TESTER_ROSTER.json` local-only.

Allowed tester fields:

- `id`
- `language`
- `hostLanguage`
- `consent`
- `privacyAccepted`
- `allowedScope`
- `projectPermission`
- `status`
- `notes`

Do not add:

- real names
- email
- phone
- company
- GitHub or Gitee account
- WeChat
- private project name
- repository name

Use anonymous ids such as:

```text
tester-1
pilot-zh-1
pilot-en-1
pilot-ru-1
```
