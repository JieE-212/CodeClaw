# CodeClaw Release Strategy

This document records the stage-four productization strategy and the boundary between development source, historical trial artifacts, a Stage 4B machine candidate, and a future real-user release.

## Current Decision

Continue with the local Web architecture and a candidate-aware Windows launcher before considering a desktop shell.

Stage 4B produces a machine candidate only. It is not a signed installer or a final Windows release.

Real-person testing remains paused:

- tester-2 remains `AFTER_LIVE_BLOCKED`.
- remediation remains `REMEDIATION_HOLD`.
- tester-3 is not scheduled.
- after-live must not be rerun for tester-2.
- no package may be sent to a new tester without a later host-controlled decision.

Completing machine engineering does not change those facts.

## Why Local Web Remains The Base

CodeClaw's core value depends on local developer capabilities:

- read local repositories.
- apply the server-authoritative data boundary.
- select source and test context.
- propose reviewable patches.
- write only after explicit approval and only in an authorized workspace.
- run a reviewed allowlisted verification command.
- keep project memory and audit state local.

A mini program or pure cloud service cannot perform that local workflow without a companion agent. Requiring source upload or remote-repository access would introduce privacy, authentication, command-execution, and cost questions before the local product loop is proven.

The local Web architecture keeps file, command, and state authority on the user's machine while allowing a future desktop shell to wrap the same service.

## Package Taxonomy

These paths have different authority and must not be described interchangeably.

| Path | Creation | Valid use | Invalid claim |
| --- | --- | --- | --- |
| Git source checkout | Clone or working tree | `npm.cmd run dev`, development, source checks | Runnable Stage 4B package |
| Legacy local-trial regression package | `npm.cmd run package:local-trial` | Historical package hygiene and trial-workflow regression | Shareable or launchable candidate |
| Stage 4B machine candidate | `npm.cmd run stage4b:machine` from a clean commit | Candidate-aware Windows launch verification | Signed installer or final Windows-ready release |

`trial:ready`, `trial:freeze`, and `trial:dispatch` are historical trial-workflow gates. Their output cannot grant Stage 4B Authority or resume a human session.

## Route Comparison

| Route | Fit now | Strengths | Main risks | Decision |
| --- | --- | --- | --- | --- |
| Local Web plus verified launcher | High | Reuses current architecture and preserves local authority | Requires Node.js and browser/console handling | Current route |
| Desktop shell | Medium | App-like startup and future installer integration | Toolchain, signing, updates, repair, platform testing | Stage 4C decision after evidence |
| Pure cloud SaaS | Low | Central accounts and billing | Source privacy, remote authentication, no direct local command authority | Defer |
| WeChat mini program companion | Low for core, possible later | Familiar notification/approval surface | Cannot access local repos or run local commands alone | Companion only |
| Mobile editor | Very low | Portable viewing | Poor fit for repository and command workflows | Not planned as core |

## Stage 4A - Local Web Evidence

Stage 4A's remaining human evidence is deferred while real-person testing is paused.

Machine work may improve the product, but it cannot substitute for:

- new-user comprehension.
- subjective trust in read/write/network/command boundaries.
- host acceptance of the remediation items.
- two or more clean post-fix sessions.
- a cohort decision to expand.

The earlier legacy local-trial packaging workflow remains available only for regression maintenance. It is no longer the distribution path.

## Stage 4B - Candidate-Aware Windows Launcher

Stage 4B reduces startup and diagnosis friction without changing CodeClaw's local Web authority model.

### Machine Candidate Creation

The sole runnable-candidate command is:

```powershell
npm.cmd run stage4b:machine
```

It runs only from a clean committed source checkout. It creates an ignored candidate below `dist/`, verifies source and candidate checks, and re-verifies the candidate after candidate-side execution.

The generated artifact includes:

- canonical candidate Authority and SHA-256 sidecar.
- exact file and empty-directory inventory.
- candidate ID, package version, and clean source identity.
- candidate-aware Node launcher.
- Windows start and stop wrappers.
- server health proof and authenticated shutdown protocol.
- browser candidate/instance binding.

### Runtime Boundary

The verified candidate payload remains immutable. Mutable state lives under:

```text
%LOCALAPPDATA%\CodeClaw\launcher-v1\<candidate-id>\
```

The launcher copies the Authority-verified Demo template into that runtime namespace and passes the external Demo path to the server. Demo Apply/Revert therefore does not self-modify the packaged candidate.

Original projects remain read-only. Only the runtime Demo or an explicitly created, registered, activated, and revalidated disposable copy may write or run an allowlisted project command.

### Startup And Port Routing

The launcher:

- checks Node.js 20+.
- verifies the complete candidate before process or browser handoff.
- reuses only an HMAC-authenticated instance of the same candidate.
- binds only to `127.0.0.1`.
- selects a free port from the bounded `4173-4199` range when no explicit port is requested.
- skips unrelated or differently identified services without terminating them.
- fails closed for an occupied explicit port.
- fails closed when a service claims the same candidate without matching local authority.
- publishes reserved control before spawn, publishes the child PID before releasing a bounded stdin nonce gate, and prevents an ungated child from initializing state or listening.
- rejects redirects, unexpected response URLs, oversized bodies, wrong content types, and deadlines on launcher HTTP requests.
- opens the exact candidate/instance URL only after authenticated readiness.

### Stop And Old-Tab Safety

Stop uses a candidate-specific local capability and refuses PID termination when service identity cannot still be verified. Its wait covers the server's bounded graceful-shutdown ceiling.

Browser boot compares URL candidate/instance values with the current health proof. A stale tab is disabled rather than silently controlling a different instance. Launcher-mode assets and APIs use no-store caching.

### Stage 4B Deliverable

The deliverable is:

```text
Stage 4B machine candidate
```

It must not be called:

- Windows release ready.
- signed.
- installed.
- SmartScreen accepted.
- human accepted.
- ready to send to tester-3.

The complete contract is in [`STAGE_4B_MACHINE_CANDIDATE.md`](STAGE_4B_MACHINE_CANDIDATE.md).

## Stage 4C - Desktop Shell Decision

Stage 4C is deferred and not automatically started by Stage 4B completion.

Candidate routes remain:

- Electron when mature desktop integration outweighs package size and signing/update cost.
- Tauri when smaller binaries outweigh the Rust/toolchain and cross-platform validation cost.
- continued local Web plus launcher when workflow clarity remains more important than installer form.

Before selecting a desktop shell, require evidence that:

- later host-controlled real-person testing has resumed safely.
- the remediation gate is no longer on hold.
- multiple independent post-fix sessions are clean.
- users find the core workflow valuable.
- setup friction, rather than workflow confusion, is a material remaining blocker.
- the team is ready to own installer signing, updates, repair, uninstall, and platform testing.

Without that evidence, Stage 4C remains a decision record rather than an implementation commitment.

## Stage 4D - Multi-User Or Cloud Layer

Cloud accounts, team billing, model proxying, remote sharing, and multi-user coordination remain later candidates.

If implemented:

- the local agent should retain file, patch, and command authority.
- source should remain local by default.
- cloud transfer must be separately previewed and approved.
- cloud success must not weaken local workspace, write, command, or audit boundaries.

## WeChat Mini Program Position

A WeChat mini program may later serve as a companion for:

- task summaries.
- notifications.
- high-level approval prompts.
- privacy-safe audit summaries.

It is not suitable as the first core agent because it cannot directly inspect a local repository, apply a local patch, or run a local verification command.

## Model Policy

Keep Mock available for Demo, health, and offline contract verification.

For real providers:

- the user chooses and configures the provider.
- preview must disclose the exact request, destination, bytes, hashes, paths, and selected context.
- sending requires explicit single-use approval.
- local HTTP is limited to loopback.
- public endpoints require the hardened HTTPS transport boundary.
- provider retention remains outside CodeClaw's control.

Do not make a provider choice or price assumption part of launcher identity.

## Machine Candidate Gate

From a clean Git source checkout:

```powershell
npm.cmd run stage4b:machine
```

This is the single Stage 4B machine-candidate gate. Source `check`/`health`, focused launcher tests, exact tracked-blob packaging, candidate `check`, real packaged launcher start/status/stop/restart, and final integrity verification are parts of that command. Direct candidate `npm run health` is intentionally unsupported because a candidate must start through its identity-aware launcher.

Do not run the gate from a legacy package or generated candidate. Both exclude `.git/` and cannot provide a new clean source identity.

The generated candidate remains ignored and must not be staged in Git.

## Manual Release Gate

A later Windows release decision still requires human evidence for:

- clean Windows 10 and 11.
- non-administrator launch.
- Node.js installation and PATH.
- PowerShell execution policy.
- Defender and SmartScreen.
- default-browser behavior.
- double-click and console-window-close behavior.
- real process-tree cleanup.
- pixel layout, complete keyboard use, NVDA, and high contrast.
- clear recovery from integrity, port, browser, and identity errors.
- new-user comprehension and trust.

SHA-256 candidate integrity is not publisher code signing. A signed installer, update channel, repair, uninstall, and publisher reputation are separate future work.

## Current Next Step

The engineering loop stops at the Stage 4B machine-candidate boundary.

While real-person testing remains paused:

1. keep the generated candidate as an ignored local artifact.
2. retain truthful machine evidence without adding dynamic candidate IDs, hashes, absolute paths, logs, or screenshots to Git.
3. remove temporary test code, staging folders, listeners, processes, and ports.
4. do not run tester-2 after-live.
5. do not create tester-3.
6. do not treat legacy readiness/freeze/dispatch output as authorization.
7. do not begin Stage 4C automatically.

Only a later explicit host decision can start manual Windows acceptance or another human-test plan.
