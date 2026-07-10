# CodeClaw Restart Handoff

Updated: 2026-07-10

Use this file after restarting Codex or opening a new terminal.

## New Window Prompt

Send this to the new Codex window:

```text
请先读取 docs/HANDOFF_RESTART.md、docs/HANDOFF_CURRENT_3_0_8.md、docs/PROJECT_STATUS.md 和 package.json，接上 CodeClaw 当前进度。当前已完成到 3.0.8a，初次真人测试的小白主持流程和会后收尾链路已经加固；下一轮必须等待我的朋友或另一位真人测试者到位后，执行 tester-2 首次真人测试和 after-live 证据收尾。真人未到位前不要创建反馈或启动真实会话。请先检查 git 状态，再按既有节奏：规划、实现、验证、提交，最后告诉我运行 git pushall。
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

Latest completed implementation commit:

```text
31be5fb Harden beginner first-live session flow
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

## Completed Through 3.0.8a

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

3.0.7 completed:

- Expanded the in-app host checklist into waiting, before-call, during-call, and immediately-after-call stages.
- Added copyable operator commands for standby, synthetic rehearsal, confirmed-note drafting, and after-live.
- Added localized copy feedback for English, zh-CN, and Russian.
- Added the operator guide to health-check UI markers.
- Kept tester-2 paused until a real human tester is available.
- Current real local state remains:

```text
FIRST_LIVE_STANDBY_READY_WITH_REVIEW
blockers: 0
warnings: 5
```

3.0.8a completed:

- Added the generated Chinese `BEGINNER_FIRST_LIVE_GUIDE.md` for beginner hosts.
- Required the guide across host-run, pre-live, live-capture, launch-plan, and first-live standby.
- Standardized the post-call host flow:

```text
explicit local notes -> trial:record-draft -> human confirmation -> trial:after-live
```

- Replaced ambiguous template wording with neutral next-tester labels while keeping legacy tester-2 aliases.
- Extended feedback ingest for neutral labels and question-style bullets.
- Confirmed the synthetic feedback decision is `READY_WITH_WATCH_ITEMS`, not a false missing host decision.
- Kept the real tester-2 session empty and paused.

## Latest Verification Baseline

After 3.0.8a, these passed:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run health
npm.cmd run i18n:check
npm.cmd run trial:ready
npm.cmd run trial:tester-launch-plan -- --tester tester-2 --first-live
npm.cmd run trial:first-live-standby -- --tester tester-2
npm.cmd run trial:record-draft -- --session dist\trial-session-packs\tester-2
npm.cmd run trial:post-call-rehearsal -- --force
```

Known test count:

```text
124 tests passed in source and generated package
package hygiene: missingRequired 0, disallowed 0, files 170
tester-2 launch: TESTER_LAUNCH_READY_TO_HOST, blockers 0
tester-2 standby: FIRST_LIVE_STANDBY_READY_WITH_REVIEW, blockers 0, warnings 5
empty tester-2 record draft: 0 suggestions, 20 missing fields, blockers 0
post-call rehearsal feedback: READY_WITH_WATCH_ITEMS, blockers 0
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

## Next Stage: 3.0.8

Planned next phase:

```text
Stage 3.0.8: first real tester-2 session and after-live evidence
```

Goal:

Run the first real tester-2 session safely, then close it with privacy-safe after-live evidence.

Recommended order:

1. Do not start until a real human tester is available.
2. Run a real-browser visual pass of the operator panel in English, zh-CN, and Russian at desktop and narrow widths, including one copy action.
3. Rerun `trial:first-live-standby -- --tester tester-2` immediately before the call.
4. Read and accept every warning before hosting.
5. Keep `BEGINNER_FIRST_LIVE_GUIDE.md`, `HOST_RUNBOOK.md`, `LIVE_SESSION_CAPTURE.md`, and the three final record templates open.
6. Host only Demo plus real-project read-only preflight; stop before Apply on every real project.
7. After the call, capture explicit privacy-safe notes, run `trial:record-draft`, confirm every copied or missing value with the human, then run `trial:after-live`.
8. Verify with:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run health
npm.cmd run trial:ready
npm.cmd run trial:first-live-standby -- --tester tester-2
npm.cmd run trial:record-draft -- --session dist\trial-session-packs\tester-2
npm.cmd run trial:after-live -- --session dist\trial-session-packs\tester-2 --tester tester-2 --force
```

## Important Files

Read these first:

```text
docs/HANDOFF_CURRENT_3_0_8.md
docs/PROJECT_STATUS.md
docs/TRIAL_BEGINNER_FIRST_LIVE_GUIDE.md
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
scripts/ingest-trial-feedback.js
scripts/tester-launch-plan.js
scripts/live-session-capture.js
scripts/after-live-recovery.js
```

Recent tests:

```text
tests/trial-record-draft.test.js
tests/first-live-standby.test.js
tests/post-call-rehearsal.test.js
tests/trial-feedback-ingest.test.js
tests/tester-launch-plan.test.js
```

Recent docs:

```text
docs/TRIAL_RECORD_DRAFT.md
docs/TRIAL_BEGINNER_FIRST_LIVE_GUIDE.md
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
