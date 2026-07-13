# CodeClaw Stage 4B Machine Candidate

This document defines the Stage 4B Windows launcher and candidate-package boundary.

## Current Status

Stage 4B produces a machine-verifiable candidate. It does not produce a signed installer or establish final Windows release readiness.

Real-person testing remains paused:

- tester-2's historical result remains `AFTER_LIVE_BLOCKED`.
- remediation remains `REMEDIATION_HOLD`.
- tester-3 is not scheduled and must not be created automatically.
- tester-2 after-live must not be rerun.
- original projects remain server-enforced read-only.
- writes and project commands remain limited to the built-in runtime Demo or an explicitly created, registered, activated, and revalidated disposable copy.

Machine-candidate work cannot change any of those human or workspace decisions.

## The Three Package Types

| Type | Identity | Runnable path | Distribution status |
| --- | --- | --- | --- |
| Git source checkout | Git may identify the source, but it is not a packaged candidate | `npm.cmd run dev` | Development only |
| Legacy local-trial package | No Stage 4B Authority | None; launcher use must fail closed | Historical regression artifact; do not share |
| Stage 4B machine candidate | Clean commit plus canonical Authority and sidecar | Candidate wrappers or launcher CLI | Machine candidate only; manual Windows acceptance pending |

`package:local-trial`, `trial:ready`, `trial:freeze`, and `trial:dispatch` do not create or authorize a Stage 4B candidate.

## Build From Clean Source

Run from the Git source checkout:

```powershell
git status --short
npm.cmd run stage4b:machine
```

The source must resolve to a clean, committed, exact 40-hex Git identity. Dirty, uncommitted, unavailable, or ambiguous source identity fails closed.

The gate:

1. Runs the source syntax/i18n check.
2. Runs the focused candidate-integrity, package, launcher, launcher-integration, and server-protocol tests.
3. Runs source health.
4. Materializes the bounded allowlisted payload from exact tracked Git blobs into an ignored pending directory.
5. Writes the human package manifest, Authority, and sidecar.
6. Verifies the complete candidate.
7. Runs candidate check, then starts the real packaged launcher and verifies independent status, stop, restart, external runtime Demo, browser API identity, and port release.
8. Verifies candidate integrity again after execution and only then renames pending output to the final candidate name.

The final folder is a direct child of the source checkout's ignored `dist/` directory. Its name contains non-secret version and identity prefixes, but tracked documentation must not hard-code a final candidate ID, commit hash, absolute output path, or machine-specific path.

Run `stage4b:machine` only from source. A generated candidate excludes `.git/` and cannot generate a new trustworthy candidate from itself.

## Candidate Contents

The candidate packager copies an explicit source allowlist and excludes local or generated state, including:

```text
.git/
.codeclaw/
node_modules/
coverage/
dist/
build/
trial-feedback/
trial-session-packs/
environment files
local override files
logs
development-only run-dev.cmd
```

Runtime state is not added to the candidate after packaging.

## Authority

Every runnable candidate contains:

```text
CODECLAW_CANDIDATE_AUTHORITY.json
CODECLAW_CANDIDATE_AUTHORITY.json.sha256
```

The canonical Authority binds:

- Authority schema and version.
- package version.
- exact 40-hex source commit.
- `sourceDirty: false`.
- candidate ID derived from the canonical payload digest.
- every payload file path, size, and SHA-256.
- every payload directory, including empty directories.
- exact file, directory, and total-byte counts.

Verification rejects:

- missing, malformed, non-canonical, changed, or mismatched Authority files.
- sidecar mismatch.
- extra, missing, changed, reordered, duplicated, or colliding inventory entries.
- unsafe Windows names or non-canonical relative paths.
- symbolic links, junctions, hard links, and special objects.
- candidate-root or ancestor redirection.
- file growth, replacement, or identity change during stable-handle reads.
- file, directory, entry, depth, single-file, total-byte, or Authority budget overflow.

Authority files do not list or authorize themselves as payload files; the sidecar covers the canonical Authority bytes, and the verifier separately handles both authority paths.

### Integrity Is Not Publisher Authentication

SHA-256 detects changes relative to the included Authority. It is not a code-signing certificate or publisher signature. An attacker who can replace the candidate payload, Authority, sidecar, and launcher together can create a different self-consistent folder.

Do not describe the machine candidate as signed, installed, trusted by SmartScreen, or authenticated to a legal publisher.

## Candidate Immutability And Runtime State

Treat the generated candidate folder as immutable:

- do not edit candidate files.
- do not fill feedback templates inside it.
- do not run packaging, freeze, dispatch, after-live, or other artifact-producing trial commands inside it.
- do not add `dist/`, `.codeclaw/`, logs, screenshots, or notes below it.

The launcher stores mutable state outside the candidate:

```text
%LOCALAPPDATA%\CodeClaw\launcher-v1\<candidate-id>\
```

That candidate-specific directory contains:

- application state.
- the owned instance control record (Windows start/stop mutual exclusion uses a candidate-scoped OS Named Pipe, which disappears when its launcher process exits).
- the writable runtime Demo.

The control record contains local launch authority and must never be copied into diagnostics, documentation, Git, or a shared package. Launcher output exposes only bounded public candidate identity, port, URL, state, warnings, and stable error codes.

### External Runtime Demo

The packaged `examples/demo-js` directory is an immutable, Authority-covered template.

Before a new candidate instance starts, the launcher:

1. derives the Demo inventory from the verified Authority.
2. copies each template file through stable handles into a candidate-specific staging directory under `%LOCALAPPDATA%`.
3. checks source file identity, size, path, and SHA-256 while copying.
4. atomically installs the runtime Demo.
5. verifies the candidate again before spawning the server.
6. passes only the external Demo path to the server.

Demo Apply, Verify, Complete, and Revert therefore operate on the runtime copy rather than changing the candidate payload. An existing normal runtime Demo is reused for the same candidate identity; generating a different candidate identity creates a separate runtime namespace.

## Start

From the generated candidate folder:

```powershell
.\start-codeclaw.cmd
```

Equivalent CLI:

```powershell
node scripts\codeclaw-launcher.js start --candidate-root .
```

Supported start options:

```powershell
.\start-codeclaw.cmd --no-browser
.\start-codeclaw.cmd --port 4174
node scripts\codeclaw-launcher.js start --candidate-root . --json --no-browser
```

The launcher opens a browser only after candidate verification, runtime Demo preparation, server spawn, authenticated health proof, and ready state all succeed.

Startup uses a crash-safe handoff order:

1. atomically publish a reserved control record.
2. spawn the child with piped stdin, but do not let it initialize state or listen.
3. atomically publish the actual child PID and starting phase.
4. send the exact launch nonce plus EOF through a bounded stdin gate.
5. let the server initialize and listen only after that gate validates.

If the launcher exits before step 4, the pipe closes and the child rejects startup. A later launcher may remove a dead-owner reservation, or use monotonic system uptime rollback to prove a reboot; ambiguous same-boot PID reuse remains fail closed. This prevents both a delayed second listener and a permanent pre-spawn tombstone in the proven recovery cases.

## Port Selection

The default bounded range is `127.0.0.1:4173-4199`.

- The first safe free port is used.
- An unrelated service or another candidate is not killed or reused; the launcher tries the next port.
- A service claiming the same candidate without the matching local HMAC capability stops startup immediately. A second instance is not opened.
- An explicit `--port` uses only that port and fails closed when occupied.
- Exhausting the bounded range stops startup.

CodeClaw does not bind the Stage 4B service to a public interface.

## Candidate And Instance Proof

The launcher provides the server with a candidate ID, package version, source commit, random instance ID, launch nonce, and private shutdown capability through a minimized child environment.

For each health challenge, the server returns:

- launcher protocol.
- candidate, package, source, and instance identity.
- launch nonce.
- loopback host, actual port, and server PID.
- accepting/ready state.
- an HMAC proof bound to candidate, instance, nonce, server PID, port, and the fresh challenge.

The launcher accepts or reuses a service only when that proof matches its local capability. A claimed identity without proof is not treated as CodeClaw ownership.

Launcher health and shutdown requests set `redirect: error`, require the exact expected response URL and JSON content type, and bound both time and response bytes. A redirect is never followed with the shutdown capability.

## Browser Identity And Old Tabs

The ready URL includes candidate and instance query parameters. Browser boot requests health and compares both values before enabling the workspace.

If the URL belongs to an old candidate or old instance, the page:

- shows a launcher identity mismatch.
- disables buttons, inputs, selects, and text areas.
- does not grant authority after refresh or query removal.

Use the exact URL printed by the current launcher. Static assets and APIs use `Cache-Control: no-store` in launcher mode to reduce stale-candidate reuse.

## Status

```powershell
node scripts\codeclaw-launcher.js status --candidate-root . --json
```

Status verifies the candidate, reads only its candidate-specific runtime record, challenges the recorded service, and reports `not-running`, `running`, `stale-control`, or `identity-unverified` without exposing the private capability.

## Stop

```powershell
.\stop-codeclaw.cmd
```

Equivalent CLI:

```powershell
node scripts\codeclaw-launcher.js stop --candidate-root .
```

Stop:

1. verifies the candidate.
2. reads the owned candidate-specific instance record.
3. proves the live server identity.
4. sends an authenticated loopback shutdown request.
5. waits through the server's bounded graceful-shutdown ceiling.
6. considers process-tree termination only while the same identity remains verifiable.
7. removes the owned instance control file only after the service and port are stopped.

The launcher refuses PID-based termination when identity is missing or changes. It does not kill an unknown process merely because a port or PID matches.

The supervising start window can also request stop with Enter or Ctrl+C while it still owns the in-memory started-instance context.

## Failure Recovery

| Failure | Safe response |
| --- | --- |
| Authority missing | This is source, a legacy package, or an incomplete candidate. Do not bypass the gate. |
| Integrity mismatch | Re-extract or regenerate the complete candidate from clean source. Do not repair individual hashes. |
| Browser did not open | Use the exact ready URL printed by the launcher. |
| Explicit port occupied | Stop the known owner or choose another explicit port. |
| Same-candidate identity unverified | Do not start a second instance or kill by PID alone; inspect the local service and runtime ownership. |
| Old tab disabled | Close it and open the current launcher URL. |
| Runtime directory unsafe | Inspect the candidate-specific path; do not replace links or delete a computed path blindly. |

## Legacy Local-Trial Boundary

`npm.cmd run package:local-trial` creates a legacy regression package without the Stage 4B Authority pair. It may be used to exercise historical package hygiene and source/package checks, but it is not runnable, shareable, or eligible for Stage 4B launch claims.

If an older legacy folder contains candidate-named start/stop wrappers, they must fail closed because Authority is absent. Their presence does not convert the folder into a candidate.

`npm.cmd run trial:ready` validates that historical regression workflow. Its success cannot substitute for `npm.cmd run stage4b:machine`.

## Git And Cleanup Boundary

Never commit:

```text
dist/
.codeclaw/
node_modules/
logs
screenshots or recordings
real-person records or rosters
real project names, paths, or source
evidence packets
runtime instance records or shutdown capabilities
temporary test projects or one-off debug code
```

The generated machine candidate remains an ignored local artifact. Temporary staging directories, test state, listeners, processes, and ports must be removed after verification. Do not retain commented-out implementations, one-use switches, or tombstone branches.

## Manual And Unverified Boundary

The machine gate does not establish:

- clean Windows 10/11 acceptance.
- non-administrator account acceptance.
- Node installer/PATH behavior on a new machine.
- PowerShell execution-policy behavior in every environment.
- Defender or SmartScreen reputation.
- default-browser policy behavior.
- real double-click or console-window-close behavior.
- real Windows `taskkill /T` descendant-tree acceptance.
- installer, code-signing, update, repair, or uninstall behavior.
- pixel-level layout, complete keyboard use, NVDA, or Windows high contrast.
- real power-loss recovery or every antivirus, ACL, network-drive, and unusual-filesystem case.
- large-project subjective performance.
- new-user understanding, trust, consent, or willingness to use the product.

The local service and confirmation gates are not an operating-system sandbox. A disposable copy still contains ordinary source, and an approved project command still executes project code.

Until host-controlled manual acceptance and a separately authorized future live-test plan exist, the truthful label is `Stage 4B machine candidate`.
