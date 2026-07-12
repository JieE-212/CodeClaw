import test from "node:test";
import assert from "node:assert/strict";
import { ModelProvider, parsePatchProposal, parsePatchProposalResult, publicModelConfig, sanitizeModelConfig, selectContextFiles } from "../packages/model-provider/src/index.js";

test("ModelProvider mock returns actionable suggestions", async () => {
  const provider = new ModelProvider({ type: "mock", name: "mock", model: "mock-codeclaw" });
  const suggestion = await provider.suggestTask({
    goal: "add tests",
    repoProfile: { name: "demo", languages: [{ name: "JavaScript" }], commands: [{ name: "test", command: "npm run test" }] }
  });

  assert.equal(suggestion.provider, "mock");
  assert.equal(suggestion.model, "mock-codeclaw");
  assert.match(suggestion.content, /Mock suggestion/);
});

test("ModelProvider status reflects configuration", () => {
  assert.equal(new ModelProvider({ type: "mock" }).status().configured, true);
  assert.equal(new ModelProvider({ type: "openai-compatible", baseUrl: "", apiKey: "", model: "x" }).status().configured, false);
  assert.equal(new ModelProvider({ type: "openai-compatible", baseUrl: "http://localhost/v1", apiKey: "key", model: "x" }).status().configured, true);
});

test("model config helpers sanitize public output", () => {
  const config = sanitizeModelConfig({ type: "openai-compatible", baseUrl: "http://localhost/v1", apiKey: "secret", model: "m" });
  assert.equal(config.apiKey, "secret");
  assert.equal(publicModelConfig(config).apiKey, "configured");
});

test("selectContextFiles ranks key source and test files", () => {
  const files = selectContextFiles({
    goal: "add calculator test",
    repoProfile: {
      keyFiles: ["package.json"],
      files: [
        { path: "package.json", name: "package.json", textLike: true },
        { path: "src/calculator.js", name: "calculator.js", textLike: true },
        { path: "test/calculator.test.js", name: "calculator.test.js", textLike: true },
        { path: "debug.log", name: "debug.log", textLike: false }
      ]
    }
  });
  assert.ok(files.some((item) => item.path === "src/calculator.js"));
  assert.ok(files.some((item) => item.path === "test/calculator.test.js"));
  assert.ok(!files.some((item) => item.path === "debug.log"));
});

test("selectContextFiles uses summaries and symbols in ranking reasons", () => {
  const files = selectContextFiles({
    goal: "fix divide rounding",
    repoProfile: {
      files: [
        { path: "src/calculator.js", name: "calculator.js", textLike: true, summary: "export function divide handles numbers", symbols: [{ name: "divide", kind: "function", line: 1 }] },
        { path: "src/other.js", name: "other.js", textLike: true, summary: "unrelated helper", symbols: [{ name: "formatDate", kind: "function", line: 1 }] }
      ]
    }
  });
  assert.equal(files[0].path, "src/calculator.js");
  assert.match(files[0].reason, /symbol match: divide/);
  assert.match(files[0].reason, /summary match: divide/);
});

test("selectContextFiles ignores common stop words", () => {
  const files = selectContextFiles({
    goal: "explain memory and context flow",
    repoProfile: {
      files: [
        { path: "src/memory.js", name: "memory.js", textLike: true, summary: "memory context", symbols: [{ name: "memoryContext", kind: "function", line: 1 }, { name: "and", kind: "function", line: 2 }] }
      ]
    }
  });
  assert.equal(files[0].path, "src/memory.js");
  assert.doesNotMatch(files[0].reason, /match: and/);
});

test("ModelProvider mock suggests context files", async () => {
  const provider = new ModelProvider({ type: "mock" });
  const suggestion = await provider.suggestContextFiles({
    goal: "test calculator",
    repoProfile: {
      files: [{ path: "test/calculator.test.js", name: "calculator.test.js", textLike: true }]
    }
  });
  assert.equal(suggestion.provider, "mock");
  assert.equal(suggestion.files[0].path, "test/calculator.test.js");
});

for (const [language, goal] of [
  ["English", "Add a divide-by-zero test and verify the project"],
  ["Simplified Chinese", "添加除以零测试，并验证项目"],
  ["Russian", "Добавить тест деления на ноль и проверить проект"]
]) {
  test(`ModelProvider mock proposes the divide-by-zero patch for the ${language} Demo goal`, async () => {
    const provider = new ModelProvider({ type: "mock" });
    const proposal = await provider.proposePatch({
      goal,
      task: {
        goal,
        contextFiles: [{
          path: "test/calculator.test.js",
          content: "import test from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { add, divide } from \"../src/calculator.js\";\n"
        }]
      }
    });
    assert.equal(proposal.path, "test/calculator.test.js");
    assert.equal(proposal.applicable, true);
    assert.match(proposal.content, /divide throws on zero denominator/);
    assert.match(proposal.diff, /\+test\("divide throws on zero denominator"/);
  });
}

test("ModelProvider mock suggests a failure fix", async () => {
  const provider = new ModelProvider({ type: "mock" });
  const suggestion = await provider.suggestFailureFix({ task: { goal: "fix tests", failureSummary: "AssertionError" } });
  assert.match(suggestion.content, /failure fix/);
  assert.match(suggestion.content, /AssertionError/);
});

test("ModelProvider failure fix prompt includes recent patch evidence", async () => {
  const provider = new ModelProvider({ type: "openai-compatible", name: "test", baseUrl: "http://localhost/v1", apiKey: "key", model: "m" });
  let capturedMessages = null;
  provider.chat = async (messages) => {
    capturedMessages = messages;
    return { provider: "test", model: "m", content: "Inspect the changed test expectation first." };
  };

  const suggestion = await provider.suggestFailureFix({
    task: {
      goal: "fix failing calculator test",
      status: "failed",
      failureSummary: "4 !== 5",
      verification: { exitCode: 1, command: "npm run test" },
      toolCalls: [{ tool: "run_command", args: { command: "npm run test" }, summary: "exitCode=1" }],
      contextFiles: [{ path: "test/calculator.test.js", content: "assert.equal(divide(8, 2), 5);\n" }],
      appliedPatches: [{
        path: "test/calculator.test.js",
        summary: "Change quotient expectation.",
        previousContent: "assert.equal(divide(8, 2), 4);\n",
        nextContent: "assert.equal(divide(8, 2), 5);\n",
        diff: "--- a/test/calculator.test.js\n+++ b/test/calculator.test.js\n@@\n-  assert.equal(divide(8, 2), 4);\n+  assert.equal(divide(8, 2), 5);",
        revertedAt: null
      }]
    }
  });

  assert.equal(suggestion.content, "Inspect the changed test expectation first.");
  assert.match(capturedMessages[0].content, /Do not assume implementation is wrong/);
  assert.match(capturedMessages[1].content, /Recent applied patches/);
  assert.match(capturedMessages[1].content, /test\/calculator\.test\.js/);
  assert.match(capturedMessages[1].content, /-  assert\.equal\(divide\(8, 2\), 4\);/);
  assert.match(capturedMessages[1].content, /\+  assert\.equal\(divide\(8, 2\), 5\);/);
  assert.match(capturedMessages[1].content, /npm run test/);
});

test("ModelProvider mock refuses summary-only patch content", async () => {
  const provider = new ModelProvider({ type: "mock" });
  const proposal = await provider.proposePatch({
    goal: "add divide by zero test",
    task: {
      goal: "add divide by zero test",
      contextFiles: [{ path: "test/calculator.test.js", summary: "truncated summary" }]
    }
  });
  assert.equal(proposal.path, null);
  assert.equal(proposal.applicable, false);
  assert.equal(proposal.reason, "missing_context_content");
  assert.match(proposal.summary, /full content has not been read/);
});

test("ModelProvider mock distinguishes missing test context from an unsupported goal", async () => {
  const provider = new ModelProvider({ type: "mock" });
  const missingContext = await provider.proposePatch({
    goal: "添加除以零测试，并验证项目",
    task: {
      goal: "添加除以零测试，并验证项目",
      contextFiles: [{ path: "src/calculator.js", content: "export function divide(a, b) { return a / b; }\n" }]
    }
  });
  const unsupportedGoal = await provider.proposePatch({
    goal: "rename the calculator function",
    task: {
      goal: "rename the calculator function",
      contextFiles: [{ path: "test/calculator.test.js", content: "import { divide } from \"../src/calculator.js\";\n" }]
    }
  });

  assert.equal(missingContext.path, null);
  assert.equal(missingContext.applicable, false);
  assert.equal(missingContext.reason, "missing_test_context");
  assert.match(missingContext.summary, /relevant divide-by-zero test context/);
  assert.equal(unsupportedGoal.path, null);
  assert.equal(unsupportedGoal.applicable, false);
  assert.equal(unsupportedGoal.reason, "unsupported_goal");
  assert.match(unsupportedGoal.summary, /only supports the divide-by-zero test demo goal/);
});

test("parsePatchProposal parses plain and fenced JSON patches", () => {
  const task = { contextFiles: [{ path: "src/a.js", content: "export const a = 1;\n" }] };
  const plain = parsePatchProposal('{"path":"src/a.js","content":"export const a = 2;\\n","summary":"change a"}', { provider: "p", model: "m", task });
  const fenced = parsePatchProposal('```json\n{"path":"src/a.js","content":"export const a = 3;\\n"}\n```', { provider: "p", model: "m", task });
  assert.equal(plain.path, "src/a.js");
  assert.match(plain.diff, /-export const a = 1;/);
  assert.match(plain.diff, /\+export const a = 2;/);
  assert.match(fenced.diff, /\+export const a = 3;/);
});

test("parsePatchProposal returns null for invalid patch JSON", () => {
  assert.equal(parsePatchProposal("not json"), null);
  assert.equal(parsePatchProposal('{"path":"src/a.js"}'), null);
});

test("parsePatchProposalResult reports invalid patch reasons", () => {
  const task = { contextFiles: [{ path: "src/a.js", content: "export const a = 1;\n" }] };
  assert.equal(parsePatchProposalResult("not json", { task }).reason, "invalid_json");
  assert.equal(parsePatchProposalResult('{"path":"src/a.js"}', { task }).reason, "missing_fields");
  assert.equal(parsePatchProposalResult('{"path":"src/a.js","content":"--- a/src/a.js\\n+++ b/src/a.js\\n@@\\n-a\\n+b\\n"}', { task }).reason, "diff_instead_of_full_content");
  assert.equal(parsePatchProposalResult('{"path":"src/a.js","content":"export const a = 1;\\n"}', { task }).reason, "unchanged_content");
  assert.equal(parsePatchProposalResult('{"path":"src/missing.js","content":"export const missing = true;\\n"}', { task }).reason, "missing_context");
  assert.equal(parsePatchProposalResult('{"path":"../escape.js","content":"export const a = 2;\\n"}', { task: { contextFiles: [{ path: "../escape.js", content: "old\n" }] } }).reason, "unsafe_path");
});

test("parsePatchProposal supports multi-file JSON patches", () => {
  const task = {
    contextFiles: [
      { path: "src/a.js", content: "export const a = 1;\n" },
      { path: "src/b.js", content: "export const b = 1;\n" }
    ]
  };
  const proposal = parsePatchProposal(JSON.stringify({
    summary: "update two files",
    files: [
      { path: "src/a.js", content: "export const a = 2;\n" },
      { path: "src/b.js", content: "export const b = 2;\n" }
    ]
  }), { provider: "p", model: "m", task });
  assert.equal(proposal.files.length, 2);
  assert.match(proposal.diff, /\+export const a = 2;/);
  assert.match(proposal.diff, /\+export const b = 2;/);
});

test("ModelProvider openai-compatible refuses patch generation without context", async () => {
  const provider = new ModelProvider({ type: "openai-compatible", name: "test", baseUrl: "http://localhost/v1", apiKey: "key", model: "m" });
  provider.chat = async () => {
    throw new Error("chat should not be called without context");
  };
  const proposal = await provider.proposePatch({ goal: "change code", task: { goal: "change code", contextFiles: [] } });
  assert.equal(proposal.path, null);
  assert.equal(proposal.reason, "missing_context");
  assert.equal(proposal.applicable, false);
});

test("ModelProvider patch prompt asks for tests when test context is available", async () => {
  const provider = new ModelProvider({ type: "openai-compatible", name: "test", baseUrl: "http://localhost/v1", apiKey: "key", model: "m" });
  let capturedMessages = null;
  provider.chat = async (messages) => {
    capturedMessages = messages;
    return {
      provider: "test",
      model: "m",
      content: JSON.stringify({
        summary: "Add channel filtering with tests.",
        files: [
          { path: "src/api.js", content: "export function api() { return true; }\n" },
          { path: "test/api.test.js", content: "import test from \"node:test\";\n" }
        ]
      })
    };
  };

  await provider.proposePatch({
    goal: "add channel filtering",
    task: {
      goal: "add channel filtering",
      contextFiles: [
        { path: "src/api.js", content: "export function api() { return false; }\n" },
        { path: "test/api.test.js", content: "import test from \"node:test\";\n" }
      ]
    }
  });

  assert.match(capturedMessages[0].content, /Relevant test context is available: test\/api\.test\.js/);
  assert.match(capturedMessages[0].content, /If the task changes behavior, include focused test updates/);
  assert.match(capturedMessages[0].content, /if no test file is changed, explain the reason/);
});

test("ModelProvider openai-compatible returns invalid proposal reason for bad model output", async () => {
  const provider = new ModelProvider({ type: "openai-compatible", name: "test", baseUrl: "http://localhost/v1", apiKey: "key", model: "m" });
  provider.chat = async () => ({ provider: "test", model: "m", content: "```json\n{\"path\":\"src/a.js\",\"content\":\"--- a/src/a.js\\n+++ b/src/a.js\\n@@\\n-a\\n+b\\n\"}\n```" });
  const proposal = await provider.proposePatch({
    goal: "change code",
    task: { goal: "change code", contextFiles: [{ path: "src/a.js", content: "export const a = 1;\n" }] }
  });
  assert.equal(proposal.path, null);
  assert.equal(proposal.reason, "diff_instead_of_full_content");
  assert.match(proposal.summary, /diff/);
});
