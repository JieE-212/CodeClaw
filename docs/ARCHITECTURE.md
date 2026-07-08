# CodeClaw Architecture

```text
Browser UI -> Node local server -> packages -> local workspace
```

## Core Loop

1. User selects a local repository path.
2. Repo Indexer scans structure, language, commands, and candidate files.
3. Agent Core turns the user goal into a transparent plan.
4. Permission Engine classifies actions before they run.
5. Tool Registry executes approved tools.
6. UI renders timeline, findings, and next actions.

## Safety Defaults

- Read-only by default.
- Write and command execution require approval.
- Sensitive files are skipped by scanning rules.
- Tool calls are designed to be auditable.
