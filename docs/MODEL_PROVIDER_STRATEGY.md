# CodeClaw Model Provider Strategy

This document defines the stage-two model route for CodeClaw.

## Product Direction

CodeClaw should not depend on a local model as the default user path.

Recommended product architecture:

```text
CodeClaw client
  -> local worker for repo scan, file reads, patch apply, command execution
  -> model provider layer for reasoning, context selection, patch proposals
```

The default model path should be cloud-compatible. Local or private endpoints should remain supported for privacy-sensitive and enterprise users.

## Provider Modes

| Mode | Target User | Model Key Owner | Notes |
| --- | --- | --- | --- |
| Managed Cloud | Normal users | CodeClaw | Best onboarding, requires billing and quota controls |
| Bring Your Own Key | Developers and pilots | User | Best early-stage route, avoids model resale complexity |
| Private Endpoint | Teams and enterprises | Customer | Works with self-hosted OpenAI-compatible gateways |
| Local Endpoint | Privacy-sensitive developers | User | Optional, not the default because setup and hardware vary |

## Stage-Two Trial Order

Use OpenAI-compatible endpoints first because the current `ModelProvider` already supports `/chat/completions`.

1. DashScope / Qwen
   - Preset base URL: `https://dashscope.aliyuncs.com/compatible-mode/v1`
   - Suggested first model field: `qwen-plus`
   - Goal: primary China-friendly managed-cloud candidate.

2. DeepSeek API
   - Preset base URL: `https://api.deepseek.com`
   - High-quality model field: `deepseek-v4-pro`
   - Low-cost model field: `deepseek-v4-flash`
   - Goal: compare Pro patch quality against Flash cost/performance.

3. OpenAI API
   - Preset base URL: `https://api.openai.com/v1`
   - Model field is intentionally left blank in the preset. Use the current coding-capable model available to the tester's account.
   - Goal: international benchmark.

4. Custom compatible endpoint
   - Any endpoint that exposes `{baseUrl}/chat/completions`.
   - Goal: enterprise/private gateway and local server coverage.

## Trial Scenarios

Run all model providers through the same scenarios before comparing them:

1. Suggest next steps for `examples/demo-js`.
2. Recommend context files for `add divide by zero test and verify the project`.
3. Read selected context and request a patch proposal.
4. Apply the patch only if it is small and applicable.
5. Run the detected verification command.
6. Revert the patch and confirm the demo project is clean.
7. Trigger or record one failure-fix scenario.

## Acceptance Criteria

Mark a provider as ready for wider pilot only when:

- It can produce at least one applicable JSON patch using full replacement file content.
- It does not target files that were not read into task context.
- Verification can pass after applying the patch.
- Revert restores the demo file.
- Failure or rejection messages are understandable to a tester.

## Cost-Control Policy

Use a two-tier model policy during trials:

- `deepseek-v4-flash`: default for suggestion, context selection, quick explanation, and low-risk retry.
- `deepseek-v4-pro`: quality baseline for patch generation, complex bug repair, and failure-fix suggestions.

Do not mark Pro as the product default until CodeClaw has request budgeting, token estimation, and per-task spending controls.

## Implementation Notes

- Keep the UI presets as helpers only. The saved server config should remain generic `openai-compatible` plus `baseUrl`, `model`, and `apiKey`.
- Do not store real API keys in docs, logs, trial records, screenshots, or committed files.
- Keep local execution separate from model execution. The model should never run shell commands directly.
- Before a managed-cloud product launch, add quota limits, usage accounting, key rotation, and redaction rules.
