# CodeClaw Pilot Runs

This document records repeatable pilot runs beyond the tiny demo patch flow.

Run pilots sequentially when doing release validation. Some pilots temporarily patch and restore fixture files, so parallel runs can interfere with each other.

## Pilot 1: Demo Patch Flow

Command:

```bash
npm.cmd run smoke
```

Purpose:

- Verify the full write path on `examples/demo-js`.
- Apply a mock patch.
- Run the detected test command.
- Generate a Review draft.
- Revert the patch.
- Confirm the demo file is restored.

Expected output:

- `"ok": true`
- `"verificationExitCode": 0`
- `"demoRestored": true`

## Pilot 2: CodeClaw Self-Run

Command:

```bash
npm.cmd run pilot:self
```

Purpose:

- Scan the CodeClaw engineering project itself.
- Verify commands and key files can be discovered in a larger local project.
- Create a read-only task.
- Generate a plan and context candidates.
- Read selected context files.
- Search for `MemoryStore`.
- Save project memory notes.
- Confirm selected source files remain unchanged.

Expected output:

- `"ok": true`
- `"sourceFilesUnchanged": true`
- `commands` includes available project scripts.
- `contextCandidates` contains CodeClaw source files.
- `searchHits` includes `packages/memory-store/src/index.js`.

## Current Observations

- The demo patch flow is good for verifying safe write, verify, review, and rollback.
- The self-run is better for checking scan quality, context selection, search, and memory on a non-trivial project.
- `.codeclaw` local state is intentionally skipped from repository scans.
- The self-run uses only read tools and memory notes; it does not apply patches to CodeClaw source files.
- Pilot scripts use isolated temporary state through `CODECLAW_STATE_DIR`, so repeated runs do not pollute `.codeclaw`.
- The self-run exposed noisy context-ranking tokens such as `and` and project-wide `codeclaw`; these are now filtered as stop tokens.

## Latest Verified Output Shape

`npm.cmd run pilot:self` should report:

```json
{
  "ok": true,
  "project": "项目工程",
  "sourceFilesUnchanged": true
}
```

The first context candidate should usually be `packages/memory-store/src/index.js` for the current self-run goal.

## Pilot 3: Fake OpenAI-Compatible Model Contract

Command:

```bash
npm.cmd run pilot:model
```

Purpose:

- Start a local fake OpenAI-compatible chat completions server.
- Configure CodeClaw to use the fake provider.
- Verify model workflow handling without external network or a real API key.
- Cover task suggestions, context notes, controlled failure repair, and structured patch proposals.
- Cover both valid and invalid model outputs.

Cases:

- `suggestion`: fake model returns an actionable next-step suggestion.
- `context`: fake model returns a context note while CodeClaw keeps deterministic candidate files.
- `failure_fix`: a controlled failing patch is applied, verification fails, and fake model returns repair advice before the patch is reverted.
- `missing_context`: no context has been read; CodeClaw should refuse before calling the fake model.
- `good_single_file_json`: valid `{ path, content, summary }`.
- `bad_json`: non-JSON model output.
- `diff_instead_of_full_content`: JSON where `content` is a diff instead of complete file content.
- `missing_fields`: JSON missing required fields.
- `multi_file_json`: valid `{ summary, files: [...] }`.

Expected output:

```json
{
  "ok": true,
  "fakeModelRequests": 9,
  "workflow": {
    "controlledFailureExitCode": 1
  },
  "demoFilesUnchanged": true
}
```

The `missing_context` case should not call the fake model. The current pilot covers the model workflow with nine fake model requests.

## Pilot 4: Task Board Fixture Feature Change

Command:

```bash
npm.cmd run pilot:fixture
```

Purpose:

- Scan `examples/task-board-js`, a slightly larger multi-module JS fixture.
- Exercise a realistic feature request: add `priority` filtering to the task board list.
- Read several context files before patch generation.
- Use a fake OpenAI-compatible model to return a valid multi-file full-content patch.
- Apply source and test changes.
- Run the fixture test command.
- Complete the task and generate a Review draft.
- Revert both changed files and confirm the fixture is restored.

Expected output:

```json
{
  "ok": true,
  "patchFiles": [
    "src/filters.js",
    "test/filters.test.js"
  ],
  "verificationExitCode": 0,
  "fixtureRestored": true
}
```

This is the first stage-three pilot: it is still deterministic and offline, but it is closer to a user-facing project workflow than the tiny calculator demo.

## Pilot 5: Support Inbox API and State Fixture

Command:

```bash
npm.cmd run pilot:inbox
```

Purpose:

- Scan `examples/support-inbox-js`, a small API/state/view fixture.
- Exercise a realistic software task: add `channel` filtering to ticket queries and inbox state.
- Read API, state, test, and seed data context before patch generation.
- Use a fake OpenAI-compatible model to return a valid three-file full-content patch.
- Apply API, state, and test changes.
- Run the fixture test command.
- Complete the task and generate a Review draft.
- Revert all changed files and confirm the fixture is restored.

Expected output:

```json
{
  "ok": true,
  "patchFiles": [
    "src/api.js",
    "src/inbox.js",
    "test/inbox.test.js"
  ],
  "verificationExitCode": 0,
  "fixtureRestored": true
}
```

This pilot expands stage three beyond pure business-logic filtering into a shape closer to app or mini-program work: API query behavior plus view-state derivation.

## Pilot 6: Real Repo Read-Only Preflight

Command:

```bash
npm.cmd run pilot:real:preflight -- "C:\path\to\repo" "short trial goal"
```

Purpose:

- Provide a safe entry point before using CodeClaw on a real project.
- Start CodeClaw with a temporary state directory and mock provider.
- Scan the target repo.
- Create a read-only task for the trial goal.
- Generate a plan and context candidates.
- Read selected files and run a code search.
- Print a JSON preflight report.
- Avoid patch proposal, writes, and command execution.

Expected output:

```json
{
  "ok": true,
  "mode": "read-only-preflight",
  "writeAttempted": false,
  "contextCoverage": {
    "sourceFiles": 1
  },
  "nextGate": {
    "warnings": [],
    "proceedToPatch": false
  }
}
```

Use [`REAL_REPO_TRIAL.md`](REAL_REPO_TRIAL.md) to decide whether the repo is ready for model suggestions or disposable patch trials.

## Follow-Up Candidates

- Run the support inbox fixture flow against a real provider, starting with `deepseek-v4-flash`.
- Add one external small JS/TS project as a documented manual pilot.
- Add a Python pilot once Python command detection and context ranking are stronger.
- Run a real local model trial with `docs/LOCAL_MODEL_TRIAL.md` and record it in `docs/LOCAL_MODEL_TRIALS.md`.
- Record pilot output snapshots in release notes.
