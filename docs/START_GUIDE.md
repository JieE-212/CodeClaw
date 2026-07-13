# CodeClaw Windows Start Guide

This guide distinguishes the three CodeClaw folders that can exist on a development machine. Only one of them is a runnable Stage 4B candidate.

Real-person testing is currently paused. This guide does not authorize another live session, rerun tester-2 after-live, or create tester-3.

## Choose The Correct Folder

| Folder | Purpose | How to run |
| --- | --- | --- |
| Git source checkout | Development and source verification | Run `npm.cmd run dev`. Do not use the candidate wrappers from an ordinary source checkout. |
| Legacy local-trial package | Historical packaging and trial-workflow regression only | Do not launch or share it. It has no Stage 4B Authority. |
| Stage 4B machine candidate | Candidate-aware Windows launch testing | Use `start-codeclaw.cmd`, `stop-codeclaw.cmd`, or the launcher CLI inside the generated candidate folder. |

The only command that creates a runnable Stage 4B candidate is:

```powershell
npm.cmd run stage4b:machine
```

Run that command from a clean, committed Git source checkout, not from a generated package. The command rejects dirty or uncommitted source and writes an ignored candidate below `dist/`.

The generated folder is a machine candidate, not a signed installer or a final Windows release.

## Requirements

- Windows 10 or later.
- Node.js 20 or later.
- A local project folder that you are allowed to inspect.

Check Node.js:

```powershell
node -v
```

The wrappers stop before startup when Node.js is missing or older than version 20.

## Keep The Candidate Immutable

Do not edit, add, or delete files inside the generated candidate folder. Every candidate payload file and empty directory is covered by its Authority inventory. Do not run trial-packaging commands or save feedback records inside the candidate.

Normal launcher use keeps mutable data outside the candidate:

```text
%LOCALAPPDATA%\CodeClaw\launcher-v1\<candidate-id>\
```

This runtime area contains local state, launcher control data, and a writable Demo copy. The launcher materializes that Demo from the Authority-verified template and the server uses the runtime copy, so Demo Apply/Revert does not modify the candidate payload.

## Start A Verified Candidate

From the generated candidate folder, double-click:

```text
start-codeclaw.cmd
```

Or run:

```powershell
.\start-codeclaw.cmd
```

The launcher:

1. Checks Node.js 20+.
2. Verifies `CODECLAW_CANDIDATE_AUTHORITY.json`, its SHA-256 sidecar, and the complete candidate inventory.
3. Prepares candidate-specific runtime state and the external writable Demo.
4. Reuses only a locally authenticated instance of the same candidate.
5. Selects a bounded loopback port.
6. Starts the server on `127.0.0.1`.
7. Waits for the server's candidate/instance proof and ready state.
8. Opens the exact candidate URL only after readiness succeeds.

Keep the launcher window available. Press Enter or Ctrl+C in that window to request a bounded stop, or use the separate stop command below.

### Start Without Opening A Browser

```powershell
.\start-codeclaw.cmd --no-browser
```

The ready URL is still printed. Open that exact URL, including its `candidate` and `instance` query parameters.

### Request A Specific Port

```powershell
.\start-codeclaw.cmd --port 4174
```

Do not use the old `CODECLAW_PORT` environment-variable instructions for the Stage 4B launcher.

## Port Behavior

Without `--port`, the launcher tries the bounded range `4173` through `4199`:

- A free port is selected.
- An unrelated or differently identified service is not opened, stopped, or reused; the launcher tries the next port.
- A service claiming the same candidate without the matching local HMAC authority causes a fail-closed error. The launcher does not start a second instance.
- If no port in the bounded range is safe, startup stops with an actionable error.

With an explicit `--port`, an occupied port fails closed. There is no automatic fallback from an explicitly requested port.

## Old Browser Tabs

Launcher URLs bind the page to one candidate ID and one instance ID. During boot, the page compares those values with the authenticated health response.

If an old tab points at a different candidate or instance, CodeClaw shows an identity error and disables buttons, inputs, selects, and text areas. Close the stale tab and use the exact URL printed by the current launcher. Refreshing or manually removing the identity query does not grant authority.

## Status

From the candidate folder:

```powershell
node scripts\codeclaw-launcher.js status --candidate-root . --json
```

Status verifies the candidate before reading candidate-specific runtime control state. It reports bounded public identity and state fields, not the shutdown token or local project paths.

## Stop

Double-click:

```text
stop-codeclaw.cmd
```

Or run:

```powershell
.\stop-codeclaw.cmd
```

The stop path verifies both the candidate and the running server identity. It sends the candidate-specific authenticated shutdown request and waits long enough for the server's bounded graceful-shutdown ceiling. PID-tree termination is considered only while the same HMAC identity is still verifiable. The launcher never kills an unrelated or unverifiable process.

After a successful stop, the server process, loopback listener, and owned instance control file should be gone. Candidate-specific application state and the runtime Demo may remain under `%LOCALAPPDATA%` for later use.

## If Startup Fails

- **Authority missing or invalid:** this is not a runnable candidate, or the candidate changed. Re-extract or regenerate it from a clean source commit. Do not hand-edit or regenerate only the Authority files.
- **Explicit port occupied:** stop the known service or choose another explicit port.
- **No bounded port available:** release a port in `4173-4199` and retry.
- **Identity unverified:** do not terminate the process manually based only on a PID. Inspect which local service owns the port, then stop it through its own verified launcher.
- **Browser open failed:** CodeClaw may still be ready. Open the exact printed `127.0.0.1` URL.
- **Old page disabled:** close it and use the current launcher URL.

## Source Development

For development from the Git checkout:

```powershell
npm.cmd run dev
```

Then open the development URL reported by the command. Source development is not candidate launch verification and does not create a machine candidate identity.

Useful source checks are:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run health
```

## Manual Acceptance Still Required

Machine verification does not establish acceptance on clean Windows 10/11, a non-administrator account, Defender/SmartScreen, default-browser policy, real double-click behavior, console-window close behavior, or real Windows `taskkill /T` descendant cleanup. Pixel rendering, complete keyboard use, NVDA, and Windows high-contrast behavior also remain manual.

The candidate hashes are integrity evidence, not a publisher signature. If an attacker can replace the payload, Authority, and launcher together, SHA-256 alone cannot authenticate the publisher.

See [`STAGE_4B_MACHINE_CANDIDATE.md`](STAGE_4B_MACHINE_CANDIDATE.md) for the complete boundary.
