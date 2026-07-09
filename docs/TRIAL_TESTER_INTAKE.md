# CodeClaw Trial Tester Intake

Use this before generating a session pack for a real external tester.

The intake roster is local-only. It must not contain real names, contact details, company names, private project names, or repo names.

## Create Local Roster

```bash
npm.cmd run trial:intake -- --init
```

This creates:

```text
.codeclaw/trial-intake/TESTER_ROSTER.json
```

That folder is ignored by Git and excluded from local trial packages.

## Fill A Tester Entry

Copy `exampleTester` into `testers` and edit it locally:

```json
{
  "id": "tester-1",
  "language": "zh-CN",
  "hostLanguage": "zh-CN",
  "consent": true,
  "privacyAccepted": true,
  "allowedScope": ["demo", "real-read-only"],
  "projectPermission": "Tester confirmed they may inspect the selected local project.",
  "status": "ready",
  "notes": "No personal details."
}
```

Allowed languages:

```text
en
zh-CN
ru
```

Recommended early scope:

```text
demo
real-read-only
```

Avoid `real-apply` for early external sessions.

## Validate

```bash
npm.cmd run trial:intake
```

The command writes:

```text
dist/TRIAL_TESTER_INTAKE_REPORT.md
dist/TRIAL_TESTER_INTAKE_REPORT.json
```

Proceed only when the decision is:

```text
READY_FOR_SESSION
READY_FOR_SESSION_WITH_REVIEW
```

Do not proceed when the decision is:

```text
WAITING_FOR_TESTER_INTAKE
INTAKE_HOLD
```

## Privacy Rules

Never put these in the roster:

- real name
- email
- phone
- WeChat or other contact id
- company
- GitHub or Gitee username
- private project name
- private repo name

Use anonymous ids like `tester-1`, `pilot-zh-1`, or `pilot-en-1`.

## Next Step

After intake passes:

```bash
npm.cmd run trial:intake-session -- --force
npm.cmd run trial:status
```

Then follow the status report's next command.
