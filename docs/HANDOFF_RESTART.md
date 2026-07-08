# CodeClaw Restart Handoff

Use this document after restarting Codex to resume the current work without rediscovering context.

## Current Status

Stage: Stage 4 productization / local trial readiness.

Current product route:

- First release path is local Web workspace.
- Desktop shell comes later.
- WeChat mini program/cloud SaaS are not first core product surfaces.
- Default model policy is DeepSeek V4 Flash for normal use, Pro only for complex/high-risk/review.

Current work state:

- No long-running task needs to be resumed.
- The requested 2-hour long Codex-run nightly task has completed successfully.
- The next product work should start from the two UX improvements listed below.

## Last Long Run

Command actually run by Codex:

```bash
npm.cmd run nightly:trial -- --hours 2 --interval-minutes 10 --ready-every 3
```

Result:

- Overall: Pass.
- Run ID: `20260708-005333`.
- Duration: about 2 hours.
- Cycles: 12.
- Checks: 53 total, 53 passed, 0 failed.
- Final `trial:ready`: Pass.

Reports:

```text
dist/nightly-trial/20260708-005333/summary.md
dist/nightly-trial/20260708-005333/summary.json
dist/SIMULATED_FIRST_TRIAL_REPORT.md
dist/TRIAL_READINESS_REPORT.json
```

Latest local trial package:

```text
dist/CodeClaw-local-trial-20260708
```

Important note:

- A hidden/background launch attempt was tried first, but Windows/Codex process handling with Chinese paths was unreliable.
- The successful run was executed in the foreground through Codex tooling and completed.
- Do not assume any hidden nightly process is still running.

## Recently Added Capabilities

### Trial Readiness

Command:

```bash
npm.cmd run trial:ready
```

Purpose:

- Runs source `health/check/test`.
- Creates a clean local trial package.
- Checks package hygiene.
- Runs package `check/health/test`.
- Writes `dist/TRIAL_READINESS_REPORT.json`.

### Simulated First Trial

Command:

```bash
npm.cmd run trial:simulate
```

Purpose:

- Simulates a solo technical tester.
- Checks first-screen UI markers.
- Runs Demo read-only preflight.
- Generates Demo patch proposal without applying it.
- Runs real-project read-only preflight.
- Writes `dist/SIMULATED_FIRST_TRIAL_REPORT.md`.

### Nightly Trial

Command:

```bash
npm.cmd run nightly:trial
```

Purpose:

- Default 2.5-hour safe validation loop.
- Runs `check`, `test`, `health`, `trial:simulate`.
- Periodically runs `trial:ready`.
- Writes `dist/nightly-trial/YYYYMMDD-HHMMSS/summary.md`.

Docs:

```text
docs/NIGHTLY_TRIAL.md
```

### Persona Trial Review

Doc:

```text
docs/PERSONA_TRIAL_REVIEW.md
```

Changes made from that review:

- Added first-screen safety strip:
  - Local run.
  - Read-only preflight first.
  - Confirmation before writes and commands.
- Strengthened `Apply` confirmation copy.
- Strengthened verification command confirmation copy.
- Updated disconnected-service copy from `run-dev.cmd` to `start-codeclaw.cmd` or `npm.cmd run dev`.
- Added `trustStrip` to health checks.

## Current Verification Baseline

Known passing commands after latest changes:

```bash
npm.cmd run check
npm.cmd run health
npm.cmd run trial:simulate
npm.cmd run trial:ready
npm.cmd run nightly:trial -- --hours 2 --interval-minutes 10 --ready-every 3
```

Known passing unit tests:

- `53/53` tests passed during the 2-hour nightly run.

Package hygiene:

- Latest readiness reported `missingRequired: 0`.
- Latest readiness reported `disallowed: 0`.

## Important Files

Frontend:

```text
apps/web/public/index.html
apps/web/public/app.js
apps/web/public/styles.css
```

Server:

```text
apps/web/server.js
```

Scripts:

```text
scripts/health-check.js
scripts/prepare-local-trial.js
scripts/trial-readiness.js
scripts/simulate-first-trial.js
scripts/nightly-trial.js
```

Launchers:

```text
start-codeclaw.cmd
start-codeclaw.ps1
run-nightly-trial.cmd
```

Docs:

```text
docs/START_GUIDE.md
docs/LOCAL_TRIAL_PACKAGE.md
docs/FIRST_TRIAL_RUNBOOK.md
docs/PERSONA_TRIAL_REVIEW.md
docs/NIGHTLY_TRIAL.md
docs/TRIAL_FEEDBACK_TEMPLATE.md
docs/TRIAL_INVITE_MESSAGE.md
docs/RELEASE_STRATEGY.md
```

## Next Work To Resume

The next two product improvements, in recommended order:

### 1. Real Project Path Input UX

Goal:

Reduce first-user friction when entering a Windows project path.

Suggested scope:

- Improve placeholder and helper copy around the project path field.
- Add a small "path tips" area:
  - Paste a folder path, not a file.
  - Example: `C:\Users\you\project`.
  - Avoid protected system folders.
  - Use Demo first if unsure.
- Consider a "recent paths" / "use example" enhancement if it stays small.
- Improve friendly errors for:
  - path not found,
  - file instead of folder,
  - permission denied,
  - empty path.
- Update `trial:simulate` or `health` markers if new UI markers should not regress.

Recommended verification:

```bash
npm.cmd run check
npm.cmd run health
npm.cmd run trial:simulate
```

### 2. Dry-run Apply Review Page / Panel

Goal:

Make users safer and more confident before clicking `Apply`.

Suggested scope:

- Add an explicit pre-Apply review state/panel before writing:
  - changed files,
  - number of files,
  - patch summary,
  - risk notes,
  - "writes local files" warning,
  - rollback reminder,
  - recommendation to use Demo/copy/disposable branch.
- Keep actual write behavior gated by the existing confirm.
- Do not auto-apply.
- Do not introduce broad patch engine changes yet.
- Make it visible in the existing patch panel rather than adding a new page unless necessary.

Recommended verification:

```bash
npm.cmd run check
npm.cmd run health
npm.cmd run trial:simulate
npm.cmd run trial:ready
```

## Suggested Restart Prompt

After restarting Codex, use:

```text
请读取 docs/HANDOFF_RESTART.md，接上当前阶段。先推进“真实项目路径输入体验”，深入规划后开始实现，并在完成后跑 check、health、trial:simulate。
```

## Caveats

- PowerShell `Get-Content` may display Chinese as mojibake in some command outputs, even when files are valid UTF-8. Use Node UTF-8 reads when checking actual content.
- The repository root for actual work is:

```text
C:\Users\ZFJJi\Desktop\AI Agent\码爪 CodeClaw\项目工程
```

- The outer workspace root is:

```text
C:\Users\ZFJJi\Desktop\AI Agent\码爪 CodeClaw
```

- Avoid approving writes to unrelated external projects unless the user explicitly requests it.
