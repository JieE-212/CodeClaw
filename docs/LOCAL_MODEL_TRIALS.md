# CodeClaw Local Model Trial Records

This document records manual trials against real OpenAI-compatible model endpoints, including cloud, private, self-hosted, and local providers.

Use [`LOCAL_MODEL_TRIAL.md`](LOCAL_MODEL_TRIAL.md) for the step-by-step trial guide and [`MODEL_PROVIDER_STRATEGY.md`](MODEL_PROVIDER_STRATEGY.md) for the stage-two provider route. This file is the ledger for completed runs, issue patterns, and follow-up decisions.

## Current Status

DeepSeek managed-cloud trials have been recorded for the demo project.

`deepseek-v4-flash` and `deepseek-v4-pro` both passed the basic demo patch loop. A controlled failure-fix comparison initially exposed a prompt-context gap: the model only received the failure output, not the recent patch evidence, so Flash leaned toward changing implementation even when the test expectation had just been edited. After adding recent applied patch diffs, recent tool calls, verification details, and read context files to the failure-fix prompt, both Flash and Pro correctly recommended reverting the changed test expectation from `5` back to `4`.

Stage three has started with a larger `examples/task-board-js` fixture. `deepseek-v4-flash` and `deepseek-v4-pro` both passed the real-provider fixture run by producing valid two-file patches for priority filtering, passing fixture tests, completing the task, and reverting both changed files. Flash remains the recommended default for cost; Pro remains the quality mode when a task is ambiguous or higher-risk.

The second stage-three fixture, `examples/support-inbox-js`, now covers API query behavior plus view-state derivation. The first real Flash run produced a valid behavior patch and passed tests, but it did not update the available test file. Patch prompting was tightened so behavior changes with test context should include focused test updates or explain why not. After restart, Flash produced a four-file patch covering API, inbox state, API tests, and inbox tests. Pro matched that result on the same fixture, so Flash remains the low-cost default and Pro remains the higher-quality fallback for ambiguous work.

### Stage 3.0.12 outbound contract

The current implementation routes suggest, context selection, patch generation, and failure-fix through the same server-authoritative Preview/review/Send boundary. Preview shows the exact UTF-8 body, bytes, SHA-256, endpoint/channel/device boundary, data categories, and transmitted file components. Approval is single-use and bound to the task revision, workspace identity, complete Data Boundary Manifest, model-configuration generation, and prepared request. Cancel, expiry, source/task/configuration races, a second concurrent send, a replay after failure, and a response that reflects the API key all fail closed.

Online transport now permits HTTP only to loopback and requires public-address HTTPS with all DNS results checked, the selected address pinned and rechecked, redirects disabled, and time/size/JSON Content-Type limits enforced. API keys are memory-only. Persisted context and model events contain minimized metadata and hashes rather than prompt, response, or source bodies; startup migrates legacy state and redacts legacy model/server-error audit detail.

Stage 3.0.12 is machine verified. Its focused evidence is 46/46 Preview/UI/provider tests, 8/8 server outbound integration tests, and 8/8 automation-finalizer fault-injection tests. The final single-concurrency full suite reported 319 total, 318 pass, 0 fail, and 1 environment-only file-symlink skip; `npm.cmd run check` passed with 714 keys in each of `en`, `zh-CN`, and `ru`. Health, smoke, `pilot:self`, `pilot:fixture`, `pilot:inbox`, `pilot:model`, real-repo preflight, and first-trial simulation all passed; `pilot:model` made 9 fake-model sends with 9 exact-body checks. These remain local/fake-provider checks, not a new managed-cloud trial. No DeepSeek, DashScope, OpenAI, or other real remote provider was rerun for Stage 3.0.12.

The remaining low-severity concurrency limit is explicit: Manifest revalidation and the later TaskStore rename are not one filesystem-atomic snapshot, so an extreme external edit can leave a stale proposal draft. Apply's baseline-hash check prevents that draft from overwriting the changed file; this is not a claim that every external TOCTOU is closed.

When a future real-provider trial is authorized after the engineering and host gates, run the full baseline:

- `npm.cmd test`
- `npm.cmd run check`
- `npm.cmd run smoke`
- `npm.cmd run pilot:self`
- `npm.cmd run pilot:model`

The next authorized real-provider trial should start with `examples/demo-js` and record all four model workflow areas: suggest, context, patch, and failure-fix. Real-provider and real-person testing remain paused; machine verification does not change `REMEDIATION_HOLD`, schedule tester-3, or substitute for a later explicit host decision.

## Trial Index

| Date | Provider | Model | Project | Result | Decision |
| --- | --- | --- | --- | --- | --- |
| Pending | DashScope / Qwen | TBD | `examples/demo-js` | Not run | First BYOK cloud trial |
| 2026-07-07 | DeepSeek API | `deepseek-v4-flash` | `examples/demo-js` | Pass | Low-cost baseline passed demo patch loop |
| 2026-07-07 | DeepSeek API | `deepseek-v4-pro` | `examples/demo-js` | Pass | Quality baseline passed demo patch loop |
| 2026-07-07 | DeepSeek API | Flash vs Pro | `examples/demo-js` | Pass | Patch-aware failure-fix prompt corrected both models |
| 2026-07-07 | DeepSeek API | `deepseek-v4-flash` | `examples/task-board-js` | Pass | Stage-three fixture feature patch passed |
| 2026-07-07 | DeepSeek API | `deepseek-v4-pro` | `examples/task-board-js` | Pass | Stage-three fixture feature patch matched Flash |
| 2026-07-07 | DeepSeek API | `deepseek-v4-flash` | `examples/support-inbox-js` | Pass | Retest included behavior and test updates |
| 2026-07-07 | DeepSeek API | `deepseek-v4-pro` | `examples/support-inbox-js` | Pass | Pro matched Flash with behavior and test updates |

## Record Template

Copy this section for each real model trial.

```markdown
## Trial YYYY-MM-DD - Provider / Model

- Date:
- Tester:
- Provider:
- Base URL:
- Model:
- Project:
- CodeClaw snapshot:
- Endpoint type: managed-cloud / BYOK cloud / private / self-hosted / local

### Automated Baseline

| Check | Result | Notes |
| --- | --- | --- |
| npm.cmd test | Pass / Fail |  |
| npm.cmd run check | Pass / Fail |  |
| npm.cmd run smoke | Pass / Fail |  |
| npm.cmd run pilot:self | Pass / Fail |  |
| npm.cmd run pilot:model | Pass / Fail |  |

### Scenario Results

| Scenario | Result | Key Evidence | Follow-up |
| --- | --- | --- | --- |
| Suggest | Pass / Fail |  |  |
| Context | Pass / Fail |  |  |
| Patch | Pass / Fail |  |  |
| Missing context guard | Pass / Fail |  |  |
| Failure-fix | Pass / Fail |  |  |
| Revert and cleanup | Pass / Fail |  |  |

### Issue Log

| Issue Type | Severity | Evidence | Likely Owner | Next Action |
| --- | --- | --- | --- | --- |
|  | Low / Medium / High |  | prompt / parser / context / UI / docs |  |

### Decision

- Pilot-ready: Yes / No
- Main blocker:
- Prompt change needed:
- Retry or parser change needed:
- Context ranking change needed:
- UI copy or workflow change needed:
- Next trial target:
```

## Trial 2026-07-07 - DeepSeek API / deepseek-v4-pro

- Date: 2026-07-07
- Tester: CodeClaw local run
- Provider: DeepSeek API
- Base URL: `https://api.deepseek.com`
- Model: `deepseek-v4-pro`
- Project: `examples/demo-js`
- CodeClaw snapshot: local workspace
- Endpoint type: BYOK cloud

### Automated Baseline

| Check | Result | Notes |
| --- | --- | --- |
| npm.cmd test | Pass | 42 tests passed before trial |
| npm.cmd run check | Pass | Syntax check passed before trial |
| npm.cmd run smoke | Pass | Demo restored |
| npm.cmd run pilot:self | Not run in this trial | Previously available as baseline |
| npm.cmd run pilot:model | Not run in this trial | Previously available as baseline |

### Scenario Results

| Scenario | Result | Key Evidence | Follow-up |
| --- | --- | --- | --- |
| Suggest | Not run separately | Trial focused on context and patch loop | Include in next comparison run |
| Context | Pass | Selected `src/calculator.js`, `test/calculator.test.js`, `package.json` | Compare against Flash |
| Patch | Pass | Proposed one-file patch for `test/calculator.test.js` | Compare patch wording against Flash |
| Missing context guard | Not run | Guard already covered by automated contract | Run manually before wider pilot |
| Failure-fix | Not run | Verification passed | Add controlled failure trial |
| Revert and cleanup | Pass | Demo test file restored after revert | Keep as required cleanup step |

### Issue Log

| Issue Type | Severity | Evidence | Likely Owner | Next Action |
| --- | --- | --- | --- | --- |
| `status_after_revert` | Low | API result showed task status `running` after complete + revert, while review draft existed and demo restored | task-store / UI | Check whether revert should preserve `completed` status |

### Decision

- Pilot-ready: Partial
- Main blocker: Need Flash comparison and failure-fix scenario
- Prompt change needed: None from this run
- Retry or parser change needed: None from this run
- Context ranking change needed: None from this run
- UI copy or workflow change needed: Investigate task status after revert
- Next trial target: DeepSeek API / `deepseek-v4-flash`

## Trial 2026-07-07 - DeepSeek API / deepseek-v4-flash

- Date: 2026-07-07
- Tester: CodeClaw local run
- Provider: DeepSeek API
- Base URL: `https://api.deepseek.com`
- Model: `deepseek-v4-flash`
- Project: `examples/demo-js`
- CodeClaw snapshot: local workspace
- Endpoint type: BYOK cloud

### Automated Baseline

| Check | Result | Notes |
| --- | --- | --- |
| npm.cmd test | Pass | 42 tests passed before provider trials |
| npm.cmd run check | Pass | Syntax check passed before provider trials |
| npm.cmd run smoke | Pass | Demo restored |
| npm.cmd run pilot:self | Not run in this trial | Previously available as baseline |
| npm.cmd run pilot:model | Not run in this trial | Previously available as baseline |

### Scenario Results

| Scenario | Result | Key Evidence | Follow-up |
| --- | --- | --- | --- |
| Suggest | Not run separately | Trial focused on context and patch loop | Include in next broader provider run |
| Context | Pass | Selected `src/calculator.js`, `test/calculator.test.js`, `package.json` | Same context as Pro |
| Patch | Pass | Proposed one-file patch for `test/calculator.test.js` | Good low-cost baseline |
| Missing context guard | Not run | Guard already covered by automated contract | Run manually before wider pilot |
| Failure-fix | Not run | Verification passed | Add controlled failure trial |
| Revert and cleanup | Pass | Demo test file restored after revert | Keep as required cleanup step |

### Issue Log

| Issue Type | Severity | Evidence | Likely Owner | Next Action |
| --- | --- | --- | --- | --- |
| `status_after_revert` | Low | API result showed task status `running` after complete + revert, while review draft existed and demo restored | task-store / UI | Same issue seen in Pro trial |

### Decision

- Pilot-ready: Partial
- Main blocker: Need failure-fix scenario and status-after-revert cleanup
- Prompt change needed: None from this run
- Retry or parser change needed: None from this run
- Context ranking change needed: None from this run
- UI copy or workflow change needed: Investigate task status after revert
- Next trial target: Controlled failure-fix comparison between Flash and Pro

## Trial 2026-07-07 - DeepSeek API / Controlled Failure-Fix Comparison

- Date: 2026-07-07
- Tester: CodeClaw local run
- Provider: DeepSeek API
- Base URL: `https://api.deepseek.com`
- Model: `deepseek-v4-flash` and `deepseek-v4-pro`
- Project: `examples/demo-js`
- CodeClaw snapshot: local workspace
- Endpoint type: BYOK cloud

### Automated Baseline

| Check | Result | Notes |
| --- | --- | --- |
| npm.cmd test | Pass | 45 tests passed after prompt-context fix |
| npm.cmd run check | Pass | Syntax check passed after prompt-context fix |
| npm.cmd run smoke | Pass | Demo restored |
| npm.cmd run pilot:self | Pass | Self-pilot workflow passed |
| npm.cmd run pilot:model | Pass | Contract model workflow passed; fake failure-fix inspected changed assertion |

### Scenario Results

| Scenario | Result | Key Evidence | Follow-up |
| --- | --- | --- | --- |
| Controlled failing test | Pass | Demo expectation was intentionally changed from `4` to `5`, and `npm run test` failed with `4 !== 5` | Keep this as the repeatable failure-fix probe |
| Failure summary quality | Pass | Summary kept `failing tests`, `divide returns the quotient`, and `4 !== 5` | No further summary change needed yet |
| Flash failure-fix before prompt fix | Partial | Suggested checking/fixing implementation rather than prioritizing the changed assertion | Prompt context was expanded |
| Pro failure-fix before prompt fix | Partial | Mentioned implementation check and also said to inspect `calculator.test.js` / expected value | Prompt context was expanded |
| Flash failure-fix after prompt fix | Pass | Task `task-1783406527830-y4dwbt`: suggested reverting `test/calculator.test.js` from `5` back to `4` because the recent patch artificially broke the test | Keep Flash as low-cost default |
| Pro failure-fix after prompt fix | Pass | Task `task-1783406537022-zlls3l`: suggested changing `assert.equal(divide(8, 2), 5)` back to `4` without modifying production code | Keep Pro as quality mode |
| Prompt-context fix | Pass | `suggestFailureFix()` now sends recent applied patch diffs, recent tool calls, verification details, and context files | Keep contract test coverage |
| Revert and cleanup | Pass | Demo test file restored after controlled failure | Keep as required cleanup step |

### Issue Log

| Issue Type | Severity | Evidence | Likely Owner | Next Action |
| --- | --- | --- | --- | --- |
| `failure_fix_context_missing` | Medium | Failure-fix request only sent task goal and failure summary, so the model could not see that a test expectation had just changed | prompt / context | Fixed and verified with Flash + Pro |
| `weak_failure_fix` | Medium | Flash focused on implementation before prompt-context fix; after fix it identified the bad test expectation | prompt | Resolved for demo; watch on larger projects |

### Decision

- Pilot-ready: Yes for demo project
- Main blocker: None for stage-two demo workflow
- Prompt change needed: Implemented
- Retry or parser change needed: Not yet
- Context ranking change needed: Not yet
- UI copy or workflow change needed: None from this run
- Next trial target: Broader project trial with a slightly larger repo and one real user-facing feature change

## Trial 2026-07-07 - DeepSeek API / deepseek-v4-flash on Task Board Fixture

- Date: 2026-07-07
- Tester: CodeClaw local run
- Provider: DeepSeek API
- Base URL: `https://api.deepseek.com`
- Model: `deepseek-v4-flash`
- Project: `examples/task-board-js`
- CodeClaw snapshot: local workspace
- Endpoint type: BYOK cloud

### Automated Baseline

| Check | Result | Notes |
| --- | --- | --- |
| npm.cmd run check | Pass | Syntax check passed before fixture trial |
| npm.cmd test | Pass | 45 unit tests passed before fixture trial |
| npm.cmd run test | Pass | Fixture tests passed before trial from `examples/task-board-js` |
| npm.cmd run pilot:fixture | Pass | Offline fake-model stage-three pilot passed before real-provider run |

### Scenario Results

| Scenario | Result | Key Evidence | Follow-up |
| --- | --- | --- | --- |
| Scan fixture | Pass | Detected 7 files and `npm run test` | Use this fixture as stage-three baseline |
| Context | Pass | Model candidates included `src/tasks.js`, `src/filters.js`, `src/summary.js`, `src/index.js`, `package.json`, and tests | Consider ranking test file slightly earlier for feature requests |
| Patch | Pass | Returned applicable multi-file patch for `src/filters.js` and `test/filters.test.js` | Good low-cost default signal |
| Verification | Pass | `npm run test` exited `0` in about 1 second | Keep command in allowlist flow |
| Complete and review | Pass | Review draft title: `add priority filtering to the task board list` | No change needed |
| Revert and cleanup | Pass | Both changed files reverted; active patch count returned to `0` | Keep as required cleanup step |

### Issue Log

| Issue Type | Severity | Evidence | Likely Owner | Next Action |
| --- | --- | --- | --- | --- |
| `context_order_test_late` | Low | Context candidates included the relevant test file, but after source and package entries | context | Watch in next real fixture runs before changing ranking |

### Decision

- Pilot-ready: Yes for this fixture
- Main blocker: None
- Prompt change needed: None from this run
- Retry or parser change needed: None
- Context ranking change needed: Maybe, if repeated on larger feature trials
- UI copy or workflow change needed: None
- Next trial target: Run the same fixture with `deepseek-v4-pro`, then try one manually selected real repo

## Trial 2026-07-07 - DeepSeek API / deepseek-v4-pro on Task Board Fixture

- Date: 2026-07-07
- Tester: CodeClaw local run
- Provider: DeepSeek API
- Base URL: `https://api.deepseek.com`
- Model: `deepseek-v4-pro`
- Project: `examples/task-board-js`
- CodeClaw snapshot: local workspace
- Endpoint type: BYOK cloud

### Automated Baseline

| Check | Result | Notes |
| --- | --- | --- |
| npm.cmd run check | Pass | Syntax check passed before fixture comparison |
| npm.cmd test | Pass | 45 unit tests passed before fixture comparison |
| npm.cmd run test | Pass | Fixture tests passed before trial from `examples/task-board-js` |
| npm.cmd run pilot:fixture | Pass | Offline fake-model stage-three pilot previously passed |

### Scenario Results

| Scenario | Result | Key Evidence | Follow-up |
| --- | --- | --- | --- |
| Scan fixture | Pass | Detected 7 files and `npm run test` | Same as Flash |
| Context | Pass | Model candidates included `src/tasks.js`, `src/filters.js`, `src/summary.js`, `src/index.js`, `package.json`, and tests | Same ordering pattern as Flash |
| Patch | Pass | Returned applicable multi-file patch for `src/filters.js` and `test/filters.test.js` | Matched Flash quality for this task |
| Verification | Pass | `npm run test` exited `0` in about 1 second | No quality gap visible on this fixture |
| Complete and review | Pass | Review draft title: `add priority filtering to the task board list` | No change needed |
| Revert and cleanup | Pass | Both changed files reverted; local provider config restored to Flash | Keep Flash as default |

### Issue Log

| Issue Type | Severity | Evidence | Likely Owner | Next Action |
| --- | --- | --- | --- | --- |
| `context_order_test_late` | Low | Same context ordering pattern as Flash: relevant test file appeared after source and package entries | context | Watch in next real repo run before tuning |

### Decision

- Pilot-ready: Yes for this fixture
- Main blocker: None
- Prompt change needed: None from this run
- Retry or parser change needed: None
- Context ranking change needed: Maybe, if repeated on real repos
- UI copy or workflow change needed: None
- Next trial target: Use Flash on a manually selected real project or add a second fixture with a UI/API shape

## Trial 2026-07-07 - DeepSeek API / deepseek-v4-flash on Support Inbox Fixture

- Date: 2026-07-07
- Tester: CodeClaw local run
- Provider: DeepSeek API
- Base URL: `https://api.deepseek.com`
- Model: `deepseek-v4-flash`
- Project: `examples/support-inbox-js`
- CodeClaw snapshot: local workspace
- Endpoint type: BYOK cloud

### Automated Baseline

| Check | Result | Notes |
| --- | --- | --- |
| npm.cmd run check | Pass | Syntax check passed before prompt tightening |
| npm.cmd test | Pass | 46 unit tests passed after prompt tightening |
| npm.cmd run test | Pass | Fixture tests passed from `examples/support-inbox-js` |
| npm.cmd run pilot:inbox | Pass | Offline fake-model inbox pilot passed |

### Scenario Results

| Scenario | Result | Key Evidence | Follow-up |
| --- | --- | --- | --- |
| Scan fixture | Pass | Detected 7 files and `npm run test` | Use this fixture for API/state workflow testing |
| Context | Pass | Model candidates included `src/inbox.js`, `test/inbox.test.js`, `src/index.js`, `src/tickets.js`, `src/api.js`, `package.json`, and `test/api.test.js` | Context was sufficient |
| Patch behavior | Pass | Returned applicable patch for `src/api.js` and `src/inbox.js` adding channel filters | Good functionality signal |
| Test update | Partial | `test/inbox.test.js` was available in context, but the model did not include a test patch | Prompt tightened to require focused tests for behavior changes |
| Retest after prompt tightening | Pass | Task `task-1783409720223-56zvjx`: returned patch for `src/api.js`, `src/inbox.js`, `test/api.test.js`, and `test/inbox.test.js` | Keep strengthened patch prompt |
| Verification | Pass | Existing fixture test command exited `0` in about 1 second | Passing existing tests was not enough coverage |
| Complete and review | Pass | Review draft title: `add channel filtering to the support inbox API and view state` | No change needed |
| Revert and cleanup | Pass | Both changed files reverted; fixture restored | Keep cleanup step |

### Issue Log

| Issue Type | Severity | Evidence | Likely Owner | Next Action |
| --- | --- | --- | --- | --- |
| `missing_test_update` | Medium | First run changed behavior while relevant tests were in context, but patch only changed `src/api.js` and `src/inbox.js` | prompt | Fixed and verified after restart; Flash included both API and inbox tests |

### Decision

- Pilot-ready: Yes for this fixture
- Main blocker: None after retest
- Prompt change needed: Implemented
- Retry or parser change needed: Not yet
- Context ranking change needed: Not from this run
- UI copy or workflow change needed: None
- Next trial target: Compare `deepseek-v4-pro` on `examples/support-inbox-js` or start a manually selected real repo trial

## Trial 2026-07-07 - DeepSeek API / deepseek-v4-pro on Support Inbox Fixture

- Date: 2026-07-07
- Tester: CodeClaw local run
- Provider: DeepSeek API
- Base URL: `https://api.deepseek.com`
- Model: `deepseek-v4-pro`
- Project: `examples/support-inbox-js`
- CodeClaw snapshot: local workspace
- Endpoint type: BYOK cloud

### Automated Baseline

| Check | Result | Notes |
| --- | --- | --- |
| npm.cmd run check | Pass | Syntax check passed after strengthened test-aware prompt |
| npm.cmd test | Pass | 46 unit tests passed after strengthened test-aware prompt |
| npm.cmd run test | Pass | Fixture tests passed from `examples/support-inbox-js` |
| npm.cmd run pilot:inbox | Pass | Offline fake-model inbox pilot previously passed |

### Scenario Results

| Scenario | Result | Key Evidence | Follow-up |
| --- | --- | --- | --- |
| Scan fixture | Pass | Detected 7 files and `npm run test` | Same as Flash |
| Context | Pass | Model candidates included `src/inbox.js`, `test/inbox.test.js`, `src/index.js`, `src/tickets.js`, `src/api.js`, `package.json`, and `test/api.test.js` | Context was sufficient |
| Patch behavior | Pass | Returned applicable patch for `src/api.js` and `src/inbox.js` adding channel filters | Matched Flash |
| Test update | Pass | Returned test patches for `test/api.test.js` and `test/inbox.test.js` | Keep strengthened patch prompt |
| Verification | Pass | `npm run test` exited `0` in about 1 second | Good quality signal |
| Complete and review | Pass | Review draft title: `add channel filtering to the support inbox API and view state` | No change needed |
| Revert and cleanup | Pass | All changed files reverted; provider config restored to Flash | Keep Flash as default |

### Issue Log

| Issue Type | Severity | Evidence | Likely Owner | Next Action |
| --- | --- | --- | --- | --- |
| None | Low | Pro produced behavior and test patches on first run after prompt tightening | n/a | Move to real-repo trial planning |

### Decision

- Pilot-ready: Yes for this fixture
- Main blocker: None
- Prompt change needed: None from this run
- Retry or parser change needed: None
- Context ranking change needed: Not from this run
- UI copy or workflow change needed: None
- Next trial target: Start a manually selected real repo trial, preferably read-only first and then one low-risk feature patch

## Issue Taxonomy

Use these categories so different model trials can be compared.

| Issue Type | Signal | Next Action |
| --- | --- | --- |
| `invalid_json` | Model replies with prose, markdown, or malformed JSON for patch output | Tighten patch prompt; consider one retry with a JSON-only repair prompt |
| `diff_instead_of_full_content` | Model returns unified diff instead of full replacement content | Emphasize full-file contract in prompt; show clearer UI rejection copy |
| `missing_fields` | JSON lacks `path`, `content`, or valid `files[]` entries | Add examples to prompt; consider schema repair retry |
| `missing_context` | Patch targets a file not read into task context | Improve context read workflow; keep guard strict |
| `unsafe_path` | Model tries absolute, parent, ignored, or sensitive paths | Keep rejection strict; inspect prompt for path ambiguity |
| `unchanged_content` | Model proposes no actual change | Ask model for smaller, concrete change; improve UI retry hint |
| `context_miss` | Suggested files omit the obvious source or test file | Improve context ranking, memory input, or task wording |
| `context_order_test_late` | Suggested context includes the right test file but ranks it after less relevant files | Tune scoring only if repeated across larger tasks |
| `missing_test_update` | Behavior patch changes source while relevant tests were available but not updated | Strengthen patch prompt and retest; consider UI warning for source-only behavior patches |
| `patch_too_large` | Model rewrites unrelated code for a small task | Lower temperature or strengthen minimal-change prompt |
| `weak_failure_fix` | Failure-fix suggestion is generic or ignores failure output | Include tighter failure summary and ask for one next step |
| `failure_fix_context_missing` | Failure-fix suggestion cannot see recent changed files or patch evidence | Include recent applied patch diffs, tool calls, verification, and context files |
| `command_confusion` | Model suggests commands outside the scan allowlist | Keep execution gated; improve provider instruction text |
| `ux_dead_end` | Tester cannot tell how to recover from rejection | Add UI hints or docs for retry, read context, or revert |

## Decision Rules

- Mark a model `pilot-ready` only if patch, verification, and revert are all exercised successfully.
- Treat one isolated JSON failure as a prompt/retry candidate, not a model rejection.
- Treat repeated unsafe paths, unrelated rewrites, or ignored failure output as blocker issues.
- Do not widen testing to another project until the demo project has a clean record.
- Keep real API keys and secrets out of trial records.

## Next Trial Candidate

Recommended first manual trials:

- Project: `examples/demo-js`
- Endpoint 1: DashScope OpenAI-compatible endpoint
- Endpoint 2: DeepSeek OpenAI-compatible endpoint with `deepseek-v4-flash`
- Endpoint 3: DeepSeek OpenAI-compatible endpoint with `deepseek-v4-pro`
- Endpoint 4: Optional OpenAI or custom compatible endpoint
- Model family: coding-capable general or coder-oriented model
- Goal: `add divide by zero test and verify the project`
- Required outcome: at least one clean patch proposal, one verification run, one revert, and one recorded decision.
