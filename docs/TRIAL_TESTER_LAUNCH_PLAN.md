# CodeClaw Tester Launch Plan

Use this when preparing the next real tester launch and you want a safe, local-only checklist before running the full host gates.

The command does not create real tester data and does not run a live session. It reads existing reports and tells the host the next safe command.

## Command

```bash
npm.cmd run trial:tester-launch-plan -- --tester tester-2
```

It writes:

```text
dist/TRIAL_TESTER_LAUNCH_PLAN.md
dist/TRIAL_TESTER_LAUNCH_PLAN.json
```

## Decisions

```text
TESTER_LAUNCH_WAITING_FOR_INTAKE
TESTER_LAUNCH_READY_FOR_INTAKE_SESSION
TESTER_LAUNCH_READY_FOR_HOST_READY
TESTER_LAUNCH_READY_FOR_HOST_RUN
TESTER_LAUNCH_READY_FOR_PRE_LIVE
TESTER_LAUNCH_READY_FOR_LIVE_CAPTURE
TESTER_LAUNCH_READY_FOR_NEXT_LIVE
TESTER_LAUNCH_READY_TO_HOST
TESTER_LAUNCH_BLOCKED
```

Host only when the decision is:

```text
TESTER_LAUNCH_READY_TO_HOST
```

## Local Roster Checklist

Fill `.codeclaw/trial-intake/TESTER_ROSTER.json` locally. Keep it ignored and never commit it.

Required anonymous fields:

```json
{
  "id": "tester-2",
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

Do not include real names, email, phone, company, GitHub, Gitee, WeChat, private project names, private repo names, screenshots, logs, source snippets, project paths, or secrets.

## Recommended Loop

```bash
npm.cmd run trial:intake
npm.cmd run trial:tester-launch-plan -- --tester tester-2
npm.cmd run trial:intake-session -- --tester tester-2 --force
npm.cmd run trial:host-ready -- --tester tester-2
npm.cmd run trial:host-run -- --tester tester-2
npm.cmd run trial:pre-live -- --tester tester-2
npm.cmd run trial:live-capture -- --tester tester-2
npm.cmd run trial:next-live -- --tester tester-2 --accept-review --accepted-by <host-id>
npm.cmd run trial:tester-launch-plan -- --tester tester-2
```
