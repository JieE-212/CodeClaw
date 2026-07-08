# CodeClaw Local Model Trial Guide

This guide is for manual trials with a real local or self-hosted OpenAI-compatible model endpoint. It complements `npm.cmd run pilot:model`, which uses a fake local server to verify the model workflow contract automatically.

## Goal

Use a real model only after the core automated checks pass. Record completed runs in [`LOCAL_MODEL_TRIALS.md`](LOCAL_MODEL_TRIALS.md). The manual trial should answer four questions:

- Can the model follow the CodeClaw patch JSON contract?
- Does it choose useful context after files are read?
- Are rejection reasons understandable when the model gives bad output?
- Is the UI flow clear enough for a tester who did not build the project?

## Before You Start

Run the required local checks from the project root:

```bash
npm.cmd test
npm.cmd run check
npm.cmd run smoke
npm.cmd run pilot:self
npm.cmd run pilot:model
```

The manual trial should not begin until these pass.

## Provider Setup

Start a model server that exposes an OpenAI-compatible chat completions API.

In CodeClaw:

1. Run `npm.cmd run dev`.
2. Open `http://localhost:4173`.
3. In the `Model` panel, choose `OpenAI-compatible`.
4. Set `Base URL` to the endpoint prefix before `/chat/completions`.
5. Set `Model` to the model name accepted by the server.
6. Set `API key` to the real key, or to the dummy value required by the local server.
7. Click `Save`.

Examples:

```text
OpenAI-compatible server:
Base URL: http://127.0.0.1:8080/v1
Model: your-model-name
API key: your-key

Ollama-style OpenAI-compatible server:
Base URL: http://127.0.0.1:11434/v1
Model: qwen2.5-coder:7b
API key: ollama
```

CodeClaw calls `${Base URL}/chat/completions`, so do not include `/chat/completions` in the Base URL field.

## Recommended Trial Scenarios

### Scenario 1: Suggest And Context

Repository: `examples/demo-js`

Goal:

```text
add divide by zero test and verify the project
```

Steps:

1. Click `Demo`, then `Scan`.
2. Click `Generate plan`.
3. Click `Context` / `Suggest`.
4. Read the recommended test file.

Expected result:

- The plan is short and action-oriented.
- Context candidates include `test/calculator.test.js`.
- Reading the file saves it to the current task context.

### Scenario 2: Valid Patch Proposal

Continue from Scenario 1 after reading context.

Steps:

1. Click `Generate patch`.
2. Review the proposal.
3. Apply only if the proposal changes the expected test file and is easy to understand.
4. Run the detected test command.
5. Revert the patch after recording the result.

Expected result:

- Proposal is applicable.
- Output is complete-file JSON, not a unified diff.
- Patch summary and file-level stats are understandable.
- Verification exits with code `0`.
- Revert restores the demo file.

### Scenario 3: Missing Context Guard

Repository: `examples/demo-js`

Goal:

```text
add divide by zero test and verify the project
```

Steps:

1. Click `Demo`, then `Scan`.
2. Generate a plan.
3. Do not read any context file.
4. Click `Generate patch`.

Expected result:

- Proposal is rejected with `missing_context`.
- The model should not be asked to invent a patch without read context.

### Scenario 4: Failure Repair Suggestion

Repository: `examples/demo-js`

Steps:

1. Run a verification command while the expected test is absent, or create a controlled failing assertion in a disposable branch.
2. After a non-zero verification result, click `Fix failure`.

Expected result:

- Failure summary is saved on the task.
- Model suggestion is concrete and scoped to the failing command output.

## Output Quality Checklist

Record each scenario with these criteria:

| Criterion | Good Signal | Bad Signal |
| --- | --- | --- |
| Contract | Valid JSON with `path`, `content`, `summary`, or `{ summary, files }` | Markdown-only answer, diff text, missing fields |
| Context use | Only edits files that were read into context | Invents unseen files or changes unrelated files |
| Patch size | Small, focused, easy to review | Large rewrite for a small task |
| Safety | Rejection reason is clear when output is invalid | Silent failure or confusing message |
| Verification | Suggested command is from the scanned allowlist | Asks to run arbitrary command |
| UX | Tester can recover by reading context, retrying, or reverting | Tester gets stuck after failure |

## Trial Record Template

```markdown
## Local Model Trial

- Date:
- Tester:
- Project:
- Provider:
- Base URL:
- Model:
- CodeClaw commit or snapshot:

### Automated Baseline

- npm.cmd test:
- npm.cmd run check:
- npm.cmd run smoke:
- npm.cmd run pilot:self:
- npm.cmd run pilot:model:

### Scenario Results

| Scenario | Result | Notes | Follow-up |
| --- | --- | --- | --- |
| Suggest and context | Pass / Fail |  |  |
| Valid patch proposal | Pass / Fail |  |  |
| Missing context guard | Pass / Fail |  |  |
| Failure repair suggestion | Pass / Fail |  |  |

### Model Output Issues

- Invalid JSON:
- Diff instead of full content:
- Missing fields:
- Unsafe path:
- Unchanged content:
- Other:

### Decision

- Ready for wider pilot: Yes / No
- Prompt changes needed:
- UI changes needed:
- Retry/error handling needed:
```

## Interpreting Rejection Reasons

- `missing_context`: read one or more relevant files before asking for a patch.
- `invalid_json`: the model did not return a parseable JSON object.
- `missing_fields`: required patch fields are absent.
- `diff_instead_of_full_content`: the model returned a diff instead of full replacement file content.
- `unsafe_path`: the model tried to edit outside the repo or a refused file.
- `unchanged_content`: the proposed content matches the current file.

## Safety Notes

- Use a disposable branch or the bundled demo project for first trials.
- Keep writes and commands behind CodeClaw approval prompts.
- Do not paste secrets into goals, notes, or model prompts.
- Do not mark the model as pilot-ready until revert and verification have both been exercised.
- Move the final notes into `LOCAL_MODEL_TRIALS.md` so later trials can be compared.
