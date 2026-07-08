# Real Repo Trial Guide

Use this guide before trying CodeClaw on a real user project.

The first pass must be read-only. Do not ask a model for a patch until the repository scan, command detection, context selection, and file reads look sane.

## Trial Levels

| Level | Purpose | Writes Allowed | Model |
| --- | --- | --- | --- |
| 0 - Read-only preflight | Check whether CodeClaw understands the project shape | No | Mock or deterministic selection |
| 1 - Real model suggestion | Ask for task/context advice only | No | Flash by default |
| 2 - Disposable patch | Apply a low-risk patch on a disposable branch or fixture copy | Yes, explicit approval | Flash first, Pro for review |
| 3 - Real workflow pilot | Use CodeClaw for a real small task | Yes, explicit approval | Flash default / Pro fallback |

## Level 0: Read-Only Preflight

In the Web workspace, use `Run preflight` before generating or applying a patch. The Patch panel shows the preflight gate:

- `Patch gate passed` means the selected source/test context is clean enough to continue.
- `Patch paused` means warnings need review before patching.
- `Patch locked` means blockers must be resolved first.

Run:

```bash
npm.cmd run pilot:real:preflight -- "C:\path\to\repo" "short goal for the trial"
```

The script starts CodeClaw with a temporary state directory and mock model config. It scans the repo, creates a task, generates a plan, suggests context files, reads selected files, performs a small code search, and prints a JSON report.

Expected result:

- `"ok": true`
- `writeAttempted` is `false`
- `commands` includes at least one useful verify/test/build command when the project has one
- `contextFiles` includes source and test/config files relevant to the goal
- `contextCoverage.sourceFiles` is greater than `0` for implementation tasks
- `nextGate.warnings` is empty or explains why the goal/context is not ready for patching
- `searchHits` is non-empty for normal code projects

## Stop Conditions

Stop before any write if:

- The scan finds too few files or misses obvious source directories.
- No verification command is detected for a project that clearly has tests.
- Context candidates miss the relevant source area.
- The preflight report warns that an implementation-looking goal selected no source files.
- The preflight report warns that a test-focused goal selected no test files.
- The project contains sensitive local data, generated output, or private secrets not covered by ignore rules.
- The goal is vague, broad, or risky.

## Before Level 2 Writes

- Use a disposable branch, copy, or throwaway repo checkout.
- Run project tests manually once outside CodeClaw if possible.
- Pick a narrow feature or test-only task.
- Read every file that the model may patch.
- Prefer Flash for the first patch proposal; use Pro when the task is ambiguous.
- Revert after the trial unless the user explicitly wants to keep the change.

## Result Template

```markdown
## Real Repo Trial YYYY-MM-DD - Project

- Repo:
- Goal:
- Trial level:
- Model:
- Result:

### Preflight

| Check | Result | Notes |
| --- | --- | --- |
| Scan | Pass / Fail |  |
| Commands | Pass / Fail |  |
| Context | Pass / Fail |  |
| Read files | Pass / Fail |  |
| Search | Pass / Fail |  |

### Decision

- Proceed to model suggestion: Yes / No
- Proceed to disposable patch: Yes / No
- Main blocker:
- Next action:
```
