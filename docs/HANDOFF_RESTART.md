# CodeClaw Restart Handoff

Updated: 2026-07-10

Use this file after restarting Codex or opening a new terminal.

## New Window Prompt

Send this to the new Codex window:

```text
请先读取 docs/HANDOFF_RESTART.md、docs/HANDOFF_CURRENT_3_0_7.md、docs/PROJECT_STATUS.md 和 package.json，接上 CodeClaw 当前进度。当前已完成到 3.0.6，下一轮按规划推进 3.0.7：pre-human-tester operator polish。请先检查 git 状态，再按既有节奏：规划、实现、验证、提交，最后告诉我运行 git pushall。
```

## Project Location

Main repo:

```text
C:\Users\ZFJJi\Desktop\AI Agent\码爪 CodeClaw\项目工程
```

Outer workspace:

```text
C:\Users\ZFJJi\Desktop\AI Agent\码爪 CodeClaw
```

## Current Git Baseline

Current branch:

```text
main tracking gitee/main
```

Latest completed commit:

```text
9984afe Add post-call rehearsal workflow
```

Before coding, run:

```powershell
cd "C:\Users\ZFJJi\Desktop\AI Agent\码爪 CodeClaw\项目工程"
git status --short --branch
git log -5 --oneline
```

Expected status after the user has pushed:

```text
## main...gitee/main
```

If local commits are ahead, ask the user to run:

```powershell
git pushall
```

## Completed Through 3.0.6

3.0.3 completed:

- In-app Trial host checklist.
- Before-call, during-call, and after-call steps.
- Tester-2 scope stays Demo plus real-read-only.
- Stop before Apply on any real project.

3.0.4 completed:

- `trial:record-draft`.
- Maps explicit local notes into draft fields for:
  - `HUMAN_TRIAL_OBSERVATION.md`
  - `TRIAL_FEEDBACK_TEMPLATE.md`
  - `TRIAL_RESULT_RECORD.md`
- Does not invent missing feedback.
- Blocks contact data and likely secrets.
- Warns on paths, account URLs, screenshots, logs, and source snippets.

3.0.5 completed:

- `trial:first-live-standby`.
- Checks tester-2 first-live readiness without creating real tester data.
- Current real local state has been:

```text
FIRST_LIVE_STANDBY_READY_WITH_REVIEW
blockers: 0
```

3.0.6 completed:

- `trial:post-call-rehearsal`.
- Synthetic-only post-call rehearsal:

```text
synthetic notes -> trial:record-draft -> trial:after-live -> tester-2 standby check
```

- Refuses real-looking tester ids such as `tester-2`.
- Uses only `tester-rehearsal-*` ids.
- Marks output:

```text
rehearsalOnly: true
realTesterFeedback: false
```

Latest real run result:

```text
POST_CALL_REHEARSAL_READY_WITH_REVIEW
RECORD_DRAFT_READY
AFTER_LIVE_READY_WITH_REVIEW
FIRST_LIVE_STANDBY_READY_WITH_REVIEW
```

## Latest Verification Baseline

After 3.0.6, these passed:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run health
npm.cmd run trial:ready
npm.cmd run trial:post-call-rehearsal -- --force
```

Known test count:

```text
120 tests passed
```

## Current Human-Tester Reality

Important: no real external tester has completed a live test yet.

Do not fabricate tester feedback.
Do not treat rehearsal output as real tester feedback.
Do not create fake after-live evidence for tester-2.

Tester-2 is prepared as the first real human tester path, but actual hosting is paused until the user finds a real person.

When a real human tester is available, first run:

```powershell
npm.cmd run trial:first-live-standby -- --tester tester-2
```

Then host only if it says:

```text
FIRST_LIVE_STANDBY_READY
```

or:

```text
FIRST_LIVE_STANDBY_READY_WITH_REVIEW
```

For `READY_WITH_REVIEW`, host must read and accept warnings first.

## Next Stage: 3.0.7

Planned next phase:

```text
Stage 3.0.7: pre-human-tester operator polish
```

Goal:

Make the operator experience clearer before the user finds a real tester.

Recommended order:

1. Inspect existing in-app host checklist UI and i18n strings.
2. Improve the in-app checklist around:
   - what to do while waiting for a tester
   - what to keep open during the call
   - what to run immediately after the call
3. Surface these commands in beginner-friendly UI or docs:
   - `trial:first-live-standby`
   - `trial:post-call-rehearsal`
   - `trial:record-draft`
   - `trial:after-live`
4. Keep tester-2 first-live paused until a real human tester is available.
5. Verify with:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run health
npm.cmd run trial:ready
npm.cmd run trial:first-live-standby -- --tester tester-2
```

If UI changes are made, also run:

```powershell
npm.cmd run i18n:check
```

## Important Files

Read these first:

```text
docs/HANDOFF_CURRENT_3_0_7.md
docs/PROJECT_STATUS.md
package.json
apps/web/public/app.js
apps/web/public/i18n.js
apps/web/public/index.html
apps/web/public/styles.css
```

Recent scripts:

```text
scripts/trial-record-draft.js
scripts/first-live-standby.js
scripts/post-call-rehearsal.js
scripts/tester-launch-plan.js
scripts/live-session-capture.js
scripts/after-live-recovery.js
```

Recent tests:

```text
tests/trial-record-draft.test.js
tests/first-live-standby.test.js
tests/post-call-rehearsal.test.js
tests/tester-launch-plan.test.js
```

Recent docs:

```text
docs/TRIAL_RECORD_DRAFT.md
docs/TRIAL_FIRST_LIVE_STANDBY.md
docs/TRIAL_POST_CALL_REHEARSAL.md
docs/TRIAL_TESTER_LAUNCH_PLAN.md
docs/TRIAL_STATUS.md
docs/LOCAL_TRIAL_PACKAGE.md
```

## Safety Rules

Never commit:

```text
.codeclaw/
dist/
node_modules/
server-bg.log
raw tester records
screenshots
logs
source snippets
contact info
API keys
secret tokens
private project paths
```

Do not run destructive git commands.
Do not reset, checkout, or revert user changes unless explicitly requested.

## Work Rhythm

The user prefers:

1. Plan briefly.
2. Implement.
3. Verify.
4. Commit locally.
5. Tell the user to run:

```powershell
git pushall
```

Use Chinese, be beginner-friendly, and explain command results in plain language.
