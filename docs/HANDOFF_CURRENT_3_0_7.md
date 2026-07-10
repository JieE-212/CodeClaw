# CodeClaw Current Handoff For 3.0.7

Updated: 2026-07-10

This is the short, current handoff for the next Codex session.

## One-Sentence State

CodeClaw is complete through 3.0.6; tester-2 is prepared as the first real human tester path, but no real human tester has completed testing yet. Next work is 3.0.7: make the pre-human-tester operator experience clearer.

## Start Here

In the new Codex window, run or ask Codex to run:

```powershell
cd "C:\Users\ZFJJi\Desktop\AI Agent\码爪 CodeClaw\项目工程"
git status --short --branch
git log -5 --oneline
```

Expected latest completed commit:

```text
9984afe Add post-call rehearsal workflow
```

Expected branch state after push:

```text
## main...gitee/main
```

## Must Read

Read these before changing code:

```text
docs/HANDOFF_RESTART.md
docs/PROJECT_STATUS.md
package.json
apps/web/public/app.js
apps/web/public/i18n.js
apps/web/public/styles.css
```

If 3.0.7 touches docs or commands, also read:

```text
docs/TRIAL_FIRST_LIVE_STANDBY.md
docs/TRIAL_POST_CALL_REHEARSAL.md
docs/TRIAL_RECORD_DRAFT.md
docs/TRIAL_AFTER_LIVE.md
docs/TRIAL_STATUS.md
```

## What Just Finished

3.0.6 added:

```text
npm.cmd run trial:post-call-rehearsal -- --force
```

It rehearses the post-call flow with synthetic-only data:

```text
tester-rehearsal-* only
record-draft -> after-live -> first-live-standby
```

It must never be counted as real tester feedback.

Latest successful result:

```text
POST_CALL_REHEARSAL_READY_WITH_REVIEW
RECORD_DRAFT_READY
AFTER_LIVE_READY_WITH_REVIEW
FIRST_LIVE_STANDBY_READY_WITH_REVIEW
```

3.0.5 added:

```text
npm.cmd run trial:first-live-standby -- --tester tester-2
```

It checks whether tester-2 is still ready for first-live hosting without creating tester data.

3.0.4 added:

```text
npm.cmd run trial:record-draft -- --session dist\trial-session-packs\tester-2
```

It maps explicit notes into draft record fields and does not invent feedback.

3.0.3 added the in-app host checklist.

## Current Real Tester Status

There is no completed real tester session yet.

Use these rules:

- Do not invent tester-1 or tester-2 feedback.
- Do not turn rehearsal output into real evidence.
- Do not create fake after-live for tester-2.
- Keep real tester raw records local-only.
- Keep tester-2 limited to Demo plus real-read-only.
- Stop before Apply on any real project.

## Next Task: 3.0.7

Recommended goal:

```text
Pre-human-tester operator polish
```

Recommended implementation shape:

1. Improve the existing in-app host checklist so the user can see:
   - waiting-for-tester actions
   - before-call actions
   - during-call actions
   - after-call commands
2. Surface these commands in a beginner-friendly way:
   - `npm.cmd run trial:first-live-standby -- --tester tester-2`
   - `npm.cmd run trial:post-call-rehearsal -- --force`
   - `npm.cmd run trial:record-draft -- --session dist\trial-session-packs\tester-2`
   - `npm.cmd run trial:after-live -- --session dist\trial-session-packs\tester-2 --tester tester-2 --force`
3. Update i18n keys for English, zh-CN, and Russian if UI text changes.
4. Avoid making a new landing page or marketing section.
5. Keep the UI quiet and operational: checklist, compact command hints, clear stop conditions.

Likely files:

```text
apps/web/public/app.js
apps/web/public/i18n.js
apps/web/public/styles.css
docs/PROJECT_STATUS.md
docs/LOCAL_TRIAL_PACKAGE.md
docs/TRIAL_STATUS.md
```

## Verification For 3.0.7

At minimum:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run health
npm.cmd run i18n:check
npm.cmd run trial:ready
npm.cmd run trial:first-live-standby -- --tester tester-2
```

If changing only docs, still run at least:

```powershell
npm.cmd run check
npm.cmd test
```

## Commit And Push Habit

After finishing 3.0.7:

```powershell
git status --short --branch
git add <changed source/docs/tests>
git commit -m "<clear commit message>"
```

Then tell the user:

```powershell
git pushall
```

Do not push directly unless the user explicitly asks and credentials/network allow it.

## Local-Only Outputs

Do not commit:

```text
dist/
.codeclaw/
server-bg.log
node_modules/
```

The following are expected to exist locally but stay ignored:

```text
dist/TRIAL_FIRST_LIVE_STANDBY.*
dist/TRIAL_POST_CALL_REHEARSAL_REPORT.*
dist/trial-post-call-rehearsals/
dist/trial-session-packs/
```

## Tone For User

Respond in Chinese. The user is a beginner and appreciates explicit next steps. Keep explanations concrete:

- what changed
- what passed
- what commit was made
- what to run next
