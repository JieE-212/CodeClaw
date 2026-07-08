# CodeClaw Windows Start Guide

This guide is for local Windows trial users.

## Requirements

- Windows 10 or later.
- Node.js 20 or later.
- A local project folder you are allowed to inspect.

Check Node:

```bash
node -v
```

If Node is missing or older than 20, install a current LTS version from <https://nodejs.org/>.

## Start CodeClaw

Double-click:

```text
start-codeclaw.cmd
```

Or run it from PowerShell:

```bash
.\start-codeclaw.cmd
```

`start-codeclaw.cmd` calls `start-codeclaw.ps1`. The launcher messages are intentionally English-only so older Windows command-line encodings do not break the script. The CodeClaw browser UI supports English, Simplified Chinese, and Russian.

The launcher will:

- Check Node.js.
- Check whether port `4173` is free.
- Open <http://localhost:4173> in your browser.
- Start the local CodeClaw service.

Keep the launcher window open while using CodeClaw. Closing it stops the local service.

## If The Port Is Busy

If the launcher says port `4173` is busy, first open:

```text
http://localhost:4173
```

If CodeClaw is already running, use that page.

To use another port:

```bash
set CODECLAW_PORT=4174
.\start-codeclaw.cmd
```

Then open:

```text
http://localhost:4174
```

## First Run

Recommended first path:

1. Click `Demo`.
2. Confirm the path mode says Demo mode.
3. Let CodeClaw run read-only preflight.
4. Follow `Quick Start` or `Task guide`.
5. Do not apply patches to a real project until preflight passes.

For a real project, paste the project folder path, not a single file such as `README.md` or `package.json`. CodeClaw should show Real project mode before preflight.

## Validate A Local Build

Before sharing a local trial package, run:

```bash
npm.cmd run health
npm.cmd run check
npm.cmd test
```

`health` does not modify real project files. It starts a temporary service, validates the UI/API, runs read-only preflight on a fixture, and then exits.
