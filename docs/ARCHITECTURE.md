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

This policy protects the original from CodeClaw patch writes; it does not anonymize ordinary source code, prove that no private information exists in file contents, make a copy safe to share, or sandbox project commands. Model-outbound preparation reuses the same complete policy and never treats Repo Indexer's display scan as an outbound allowlist. Ignored files do not enter the request and do not contribute command, framework, package-manager, or other derived repository metadata.

An unusual repository can make a `.gitignore` ignore itself. In that case the rule file and its ignored payload are both excluded, but the rule file is not present to constrain future paths created inside the copy. CodeClaw does not claim that the original ignore-policy snapshot is preserved for future files created in that copy. Each reviewed model request instead binds the current complete Manifest digest and policy version; a source or policy change invalidates the send and requires a new Preview.

## Model Outbound Boundary

Every model operation follows one server-authoritative flow: `POST /api/model/preview`, explicit review, then `POST /api/model/send`; an abandoned review uses `POST /api/model/cancel`. The browser may submit only `operation` and `taskId` to Preview. Goal text, workspace root and identity, repository profile, context, and model configuration are reconstructed from the revisioned server task and active server workspace.

Preview discloses the complete UTF-8 request body, byte count, SHA-256, endpoint, channel, whether data leaves the device, data categories, and every transmitted file component with its transmitted byte count. Its approval digest binds the prepared request to the task revision, workspace ID and root identity, Data Boundary Manifest digest and policy version, and in-memory model-configuration generation. Send consumes that approval synchronously before transport, so concurrent sends cannot both run and a failed send cannot be replayed. Cancel, TTL expiry, and configuration changes release the Preview and overwrite the retained request buffer on a best-effort basis. Task, workspace, Manifest, and configuration bindings are checked before and after transport to stop stale or raced results from being committed.

Online transport permits plaintext HTTP only for loopback endpoints. HTTPS endpoints must contain no embedded credentials, query, or fragment, must resolve exclusively to public addresses, and are connected with a pinned lookup whose actual remote address is checked. Redirects are disabled; request time, request/response size, and JSON Content-Type are bounded. A response that reflects the configured API key is rejected. These controls constrain where the reviewed bytes can go; they do not make an online request local, control a provider's later retention, or turn best-effort JavaScript buffer overwriting into a cryptographic erasure guarantee.

One low-severity concurrency boundary remains: final Manifest revalidation and the later TaskStore atomic rename are not one filesystem-atomic snapshot. An extreme external edit in that interval can leave a stale patch proposal for review. Apply rechecks the patch baseline hash and therefore blocks that proposal from writing over the changed file, but CodeClaw does not claim that every external-editor TOCTOU can be eliminated or that every stored draft is a live filesystem snapshot.

## Persistence and Recovery

API keys live only in process memory. `model.json` persists public provider metadata but no credential; malformed, unknown, non-canonical, or legacy credential-bearing configuration is atomically replaced or rewritten to a credential-free safe configuration during startup. Startup also removes legacy context bodies and suggestion/model-response bodies from tasks and rewrites legacy model and server-error audit detail to minimal metadata.

TaskStore assigns a monotonic revision and supports compare-and-swap updates. Persisted context entries retain only path, validated UTF-8 line/byte metadata, size, SHA-256, completeness/source flags, and time. Persisted model events retain only operation, provider, model, request/response hashes, status, and time. A model patch proposal and its model event commit in the same revisioned TaskStore mutation, so a stale response cannot append an event or overwrite newer task state.

## Automation Resource Scope

Automation scripts that start CodeClaw use one finalizer scope for child processes, server listeners, temporary state/lock/copy directories, and mutable fixtures. Children are awaited and force-terminated on a bounded timeout; listeners close before directories are removed; fixture restoration and cleanup are best effort but all work and cleanup failures are aggregated. Temporary-directory deletion validates the expected parent, prefix, and filesystem identity before recursive removal. The scope prevents successful work from hiding cleanup failures and prevents a work failure from skipping cleanup.

## Safety Defaults

- Original projects are read-only by default and cannot be elevated by client input or confirmation.
- Write and command execution require both a server-verified Demo/copy capability and explicit approval.
- Sensitive files are skipped by scanning rules.
- No model operation may send data without an exact, unexpired, single-use Preview approval.
- Tool calls are designed to be auditable.
