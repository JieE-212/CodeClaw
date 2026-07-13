# CodeClaw Legacy Local-Trial Regression Package

This document defines the remaining purpose of `package:local-trial`.

## Current Decision

The local-trial package is a historical packaging and trial-workflow regression artifact. It is not a runnable Stage 4B candidate, must not be sent to a tester, and must not be used for Windows launcher acceptance.

Real-person testing is paused. Do not use this workflow to:

- rerun tester-2 after-live.
- alter tester-2's historical `AFTER_LIVE_BLOCKED` result.
- change remediation from `REMEDIATION_HOLD`.
- create or schedule tester-3.
- produce a package for a new live session.

The only command that creates a runnable Stage 4B candidate is:

```powershell
npm.cmd run stage4b:machine
```

See [`STAGE_4B_MACHINE_CANDIDATE.md`](STAGE_4B_MACHINE_CANDIDATE.md).

## Package Types Must Not Be Mixed

| Folder | Command | Authority | Intended use |
| --- | --- | --- | --- |
| Git source checkout | none | No candidate Authority | Development with `npm.cmd run dev` |
| Legacy regression package | `npm.cmd run package:local-trial` | None | Historical package hygiene and regression checks only |
| Stage 4B machine candidate | `npm.cmd run stage4b:machine` | Canonical Authority plus SHA-256 sidecar | Candidate-aware Windows start/status/stop |

Passing `trial:ready`, `trial:freeze`, or `trial:dispatch` does not convert a legacy package into a machine candidate and does not authorize a human trial.

## Why The Legacy Package Is Not Runnable

The legacy packager:

- can be invoked without the clean committed source identity required by Stage 4B.
- copies a bounded historical include set while removing `.git/` and local state.
- writes a human `PACKAGE_MANIFEST.md`.
- does not write `CODECLAW_CANDIDATE_AUTHORITY.json`.
- does not write `CODECLAW_CANDIDATE_AUTHORITY.json.sha256`.
- does not bind the package to an exact candidate ID and complete payload inventory.

Candidate launch must therefore fail closed.

An older generated legacy folder may contain `start-codeclaw.cmd`, `start-codeclaw.ps1`, `stop-codeclaw.cmd`, or `stop-codeclaw.ps1` because those source files were copied historically. Their presence is not launch authority. The verified launcher must reject that folder because its Authority pair is absent.

Do not add an Authority to a legacy package merely to make the wrappers run. That would misrepresent a dirty or unidentified source copy as a verified candidate.

## Regression Command

From the Git source checkout:

```powershell
npm.cmd run package:local-trial
```

The default ignored output is:

```text
dist/CodeClaw-local-trial-YYYYMMDD
```

To replace that ignored output intentionally:

```powershell
npm.cmd run package:local-trial -- --force
```

This command is useful only when maintaining historical trial automation or checking that local/private files stay out of the copied regression tree.

Do not run `stage4b:machine` from the generated legacy folder. The package excludes `.git/`, so it cannot prove a clean source commit.

## Historical Readiness Command

```powershell
npm.cmd run trial:ready
```

This workflow historically:

1. runs source health, check, and tests.
2. creates the legacy package.
3. checks its required and excluded paths.
4. runs check, health, and tests inside that package.
5. writes an ignored readiness report.

Its result means only that the historical source/package regression completed. Any old report wording such as “share,” “ready to send,” or “start with START_GUIDE” is superseded by this document while real-person testing is paused.

`trial:ready` does not verify:

- the Stage 4B Authority.
- a clean 40-hex source commit for the package.
- candidate identity.
- candidate-aware port routing.
- authenticated start/status/stop.
- old-browser-tab protection.
- the external runtime Demo boundary.
- a clean Windows machine.

Use `stage4b:machine` for those machine-candidate checks.

## Historical Include Boundary

The regression packager copies selected project source such as:

```text
apps/
docs/
examples/
packages/
scripts/
tests/
.gitignore
package.json
README.md
```

Some historical support wrappers may also be copied. No copied filename grants candidate authority.

The package excludes local and generated state such as:

```text
.git/
.codeclaw/
node_modules/
coverage/
dist/
build/
trial-feedback/
trial-session-packs/
examples/trial-privacy-risk/
environment files
local override files
logs
```

The package must also exclude:

- API keys and secret tokens.
- real project source, names, and paths.
- tester rosters and raw records.
- screenshots, recordings, and terminal logs.
- personal audit and memory state.
- after-live evidence packets.
- temporary projects and one-use debug code.

This exclusion list reduces accidental copying. It is not the complete cryptographic inventory provided by the Stage 4B Authority.

## Do Not Use It For A Live Session

Do not:

- zip or send the legacy output to a tester.
- ask someone to double-click a copied launcher wrapper.
- fill tester records inside the package.
- run intake, pre-live, live-capture, after-live, next-live, freeze, or dispatch to manufacture authorization.
- interpret a historical `GO_HOSTED_TRIAL` or `READY_TO_SEND` artifact as current permission.
- modify original projects through a legacy package.

Human-trial documents remain historical inputs for a later host-controlled decision. They are not current commands to execute.

## Runnable Candidate Path

From a clean, committed Git source checkout:

```powershell
npm.cmd run stage4b:machine
```

The machine gate creates a separate ignored folder whose manifest explicitly identifies it as a Stage 4B machine candidate. That folder contains the Authority pair and candidate-aware wrappers.

Inside that candidate:

- keep the payload immutable.
- use `start-codeclaw.cmd`, launcher `status`, and `stop-codeclaw.cmd`.
- let the launcher store state and the writable Demo under `%LOCALAPPDATA%`.
- do not run legacy package or trial-artifact commands.

## Cleanup And Git Boundary

Both legacy regression output and machine candidates remain below ignored `dist/`. Neither belongs in Git.

After a legacy regression:

- remove no-longer-needed output folders.
- confirm temporary listeners and processes are stopped.
- confirm fixture files are restored.
- remove one-use test switches and temporary code.
- do not retain commented-out implementations or tombstone branches.

Before any commit, inspect:

```powershell
git diff --check
git status --short
git diff --cached --name-only
```

Never stage `dist/`, `.codeclaw/`, logs, screenshots, real-person records, private project data, runtime control records, or evidence packets.

## Future Human Distribution

A future host-controlled Windows trial requires a fresh Stage 4B machine candidate plus the still-pending manual Windows, accessibility, remediation, privacy, and live-session decisions. Machine-candidate readiness alone is not permission to resume testing.
