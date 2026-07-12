# CodeClaw Architecture

```text
Browser UI -> Node loopback server -> workspace capability gate -> packages -> local workspace
```

## Core Loop

1. User selects a local repository path.
2. The server resolves it as `original-readonly`, `built-in-demo`, or a signed `disposable-copy`; the client cannot choose this capability.
3. Repo Indexer scans structure, language, commands, and candidate files for display and task context.
4. Agent Core turns the user goal into a transparent plan.
5. Permission Engine classifies interaction risk; the workspace capability independently decides whether mutation is allowed.
6. Tool Registry executes server-bound reads, transactional patch writes, or allowlisted commands.
7. UI renders timeline, findings, capability state, and one safe next action.

## Workspace capabilities

- `original-readonly`: scan, preflight, read, search, and patch-draft review only.
- `built-in-demo`: resolved from the server installation path and startup directory identity; supports Apply, Revert, and allowlisted commands.
- `disposable-copy`: created under a server-managed private root, signed into local state, explicitly activated, and revalidated before every mutation.

Task records persist `workspaceId`, root identity, proposal approval digest, and patch identities. Apply, Revert, and `run_command` bind to the task or active server workspace and reacquire the same canonical project lock. `approved: true` is interaction confirmation, never capability authority. Existing crash journals are reconciled before the server begins listening, including after capability-state failures.

## Data Boundary Policy

The Data Boundary Policy is separate from Repo Indexer's 800-file display scan. It performs a complete bounded walk, applies strict root and nested `.gitignore` rules, records exclusions, detects sensitive names and unsafe filesystem entries, and produces per-file SHA-256 plus source entity identities. Create rescans the source, streams each file while hashing, verifies the complete target before and after its signed ownership marker, verifies again after the final rename, and only then commits the registry record. Recovery and first activation use the same exact-target verifier; the marker must be the only target exclusion.

This policy protects the original from CodeClaw patch writes; it does not anonymize ordinary source code, prove that no private information exists in file contents, make a copy safe to share, or sandbox project commands. Stage 3.0.12 reuses this policy for model-outbound preview and approval.

An unusual repository can make a `.gitignore` ignore itself. In that case the rule file and its ignored payload are both excluded, but the rule file is not present to constrain future paths created inside the copy. CodeClaw does not claim that the original ignore-policy snapshot is preserved in this case; Stage 3.0.12 must either bind a reviewed rule snapshot or retain this as an explicit outbound-policy limitation.

## Safety Defaults

- Original projects are read-only by default and cannot be elevated by client input or confirmation.
- Write and command execution require both a server-verified Demo/copy capability and explicit approval.
- Sensitive files are skipped by scanning rules.
- Tool calls are designed to be auditable.
