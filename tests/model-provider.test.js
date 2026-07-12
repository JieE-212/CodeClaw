import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import { ModelProvider, parsePatchProposal, parsePatchProposalResult, publicModelConfig, sanitizeModelConfig, selectContextFiles } from "../packages/model-provider/src/index.js";

function executeOperation(provider, operation, input) {
  return provider.executePrepared(provider.prepare(operation, input));
}

test("ModelProvider mock returns actionable suggestions", async () => {
  const provider = new ModelProvider({ type: "mock", name: "mock", model: "mock-codeclaw" });
  const suggestion = await executeOperation(provider, "task-suggest", {
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
  assert.equal(publicModelConfig(config).apiKeyConfigured, true);
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
  const suggestion = await executeOperation(provider, "context-files", {
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
    const proposal = await executeOperation(provider, "patch-proposal", {
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
  const suggestion = await executeOperation(provider, "failure-fix", { task: { goal: "fix tests", failureSummary: "AssertionError" } });
  assert.match(suggestion.content, /failure fix/);
  assert.match(suggestion.content, /AssertionError/);
});

test("ModelProvider failure fix prompt includes recent patch evidence", async () => {
  const provider = new ModelProvider({ type: "openai-compatible", name: "test", baseUrl: "http://localhost/v1", apiKey: "key", model: "m" });
  const prepared = provider.prepare("failure-fix", {
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
  const capturedMessages = prepared.messages;

  assert.match(capturedMessages[0].content, /Do not assume implementation is wrong/);
  assert.match(capturedMessages[1].content, /Recent applied patches/);
  assert.match(capturedMessages[1].content, /test\/calculator\.test\.js/);
  assert.match(capturedMessages[1].content, /-  assert\.equal\(divide\(8, 2\), 4\);/);
  assert.match(capturedMessages[1].content, /\+  assert\.equal\(divide\(8, 2\), 5\);/);
  assert.match(capturedMessages[1].content, /npm run test/);
});

test("ModelProvider mock refuses summary-only patch content", async () => {
  const provider = new ModelProvider({ type: "mock" });
  const proposal = await executeOperation(provider, "patch-proposal", {
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
  const missingContext = await executeOperation(provider, "patch-proposal", {
    goal: "添加除以零测试，并验证项目",
    task: {
      goal: "添加除以零测试，并验证项目",
      contextFiles: [{ path: "src/calculator.js", content: "export function divide(a, b) { return a / b; }\n" }]
    }
  });
  const unsupportedGoal = await executeOperation(provider, "patch-proposal", {
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
  const proposal = await executeOperation(provider, "patch-proposal", { goal: "change code", task: { goal: "change code", contextFiles: [] } });
  assert.equal(proposal.path, null);
  assert.equal(proposal.reason, "missing_context");
  assert.equal(proposal.applicable, false);
});

test("ModelProvider patch prompt asks for tests when test context is available", async () => {
  const provider = new ModelProvider({ type: "openai-compatible", name: "test", baseUrl: "http://localhost/v1", apiKey: "key", model: "m" });
  const prepared = provider.prepare("patch-proposal", {
    goal: "add channel filtering",
    task: {
      goal: "add channel filtering",
      contextFiles: [
        { path: "src/api.js", content: "export function api() { return false; }\n" },
        { path: "test/api.test.js", content: "import test from \"node:test\";\n" }
      ]
    }
  });
  const capturedMessages = prepared.messages;

  assert.match(capturedMessages[0].content, /Relevant test context is available: test\/api\.test\.js/);
  assert.match(capturedMessages[0].content, /If the task changes behavior, include focused test updates/);
  assert.match(capturedMessages[0].content, /if no test file is changed, explain the reason/);
});

test("ModelProvider openai-compatible returns invalid proposal reason for bad model output", async () => {
  await withModelServer(async (request, response) => {
    for await (const _chunk of request) {}
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: "```json\n{\"path\":\"src/a.js\",\"content\":\"--- a/src/a.js\\n+++ b/src/a.js\\n@@\\n-a\\n+b\\n\"}\n```" } }] }));
  }, async ({ baseUrl }) => {
    const provider = new ModelProvider({ type: "openai-compatible", name: "test", baseUrl, apiKey: "key", model: "m" });
    const proposal = await executeOperation(provider, "patch-proposal", {
      goal: "change code",
      task: { goal: "change code", contextFiles: [{ path: "src/a.js", content: "export const a = 1;\n" }] }
    });
    assert.equal(proposal.path, null);
    assert.equal(proposal.reason, "diff_instead_of_full_content");
    assert.match(proposal.summary, /diff/);
    assert.doesNotMatch(proposal.note, /--- a\/src\/a\.js/);
  });
});

test("prepared model preview exposes frozen exact bytes and disclosure metadata", () => {
  const provider = new ModelProvider({ type: "mock", name: "preview-mock", model: "mock-codeclaw" });
  const prepared = provider.prepare("patch-proposal", {
    goal: "change the calculator test",
    repoProfile: { name: "demo" },
    task: {
      goal: "change the calculator test",
      contextFiles: [{ path: "test/calculator.test.js", content: "test('old', () => {});\n" }]
    }
  });

  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(prepared.messages), true);
  assert.equal(Object.isFrozen(prepared.messages[0]), true);
  assert.equal(prepared.exactBody, prepared.bodyText);
  assert.equal(prepared.byteLength, Buffer.byteLength(prepared.bodyText, "utf8"));
  assert.equal(prepared.sha256, createHash("sha256").update(prepared.bodyText, "utf8").digest("hex"));
  assert.deepEqual(JSON.parse(prepared.bodyText).messages, prepared.messages);
  assert.equal(prepared.endpoint, null);
  assert.equal(prepared.networkRequired, false);
  assert.deepEqual(prepared.target, { channel: "local", willLeaveDevice: false, endpoint: null });
  assert.equal(prepared.disclosure.sendsNetworkRequest, false);
  assert.deepEqual(prepared.disclosure.files, [{
    path: "test/calculator.test.js",
    mode: "full-content",
    transmittedUtf8Bytes: Buffer.byteLength("test('old', () => {});\n", "utf8")
  }]);
  assert.throws(() => {
    prepared.messages[0].content = "mutated";
  }, TypeError);
});

test("online prepare performs no DNS lookup or transport work", () => {
  let lookups = 0;
  const provider = new ModelProvider({
    type: "openai-compatible",
    name: "preview-only",
    baseUrl: "https://models.example.test/v1",
    apiKey: "not-sent",
    model: "m",
    transport: {
      lookup: async () => {
        lookups += 1;
        throw new Error("prepare must not resolve DNS");
      }
    }
  });
  const prepared = provider.prepare("task-suggest", { goal: "preview without sending" });
  assert.equal(lookups, 0);
  assert.equal(prepared.networkRequired, true);
  assert.deepEqual(prepared.target, {
    channel: "network",
    willLeaveDevice: true,
    endpoint: "https://models.example.test/v1/chat/completions"
  });
});

test("task suggestion preview whitelists verification metadata instead of serializing output", () => {
  const provider = new ModelProvider({ type: "mock" });
  const sentinel = "VERIFICATION-OUTPUT-SECRET-SENTINEL";
  const prepared = provider.prepare("task-suggest", {
    goal: "explain the next step",
    repoProfile: { name: "demo", languages: [{ name: "JavaScript" }], commands: [] },
    task: {
      status: "failed",
      toolCalls: [],
      verification: {
        command: "npm test",
        exitCode: 1,
        timedOut: false,
        durationMs: 25,
        stdout: sentinel,
        stderr: sentinel
      }
    }
  });

  assert.doesNotMatch(prepared.bodyText, new RegExp(sentinel));
  assert.match(prepared.bodyText, /command=npm test/);
  assert.match(prepared.bodyText, /exitCode=1/);
});

test("failure-fix disclosure keeps context and clipped patch-diff components for the same path", () => {
  const provider = new ModelProvider({ type: "mock" });
  const path = "test/calculator.test.js";
  const context = "assert.equal(divide(8, 2), 5);\n";
  const diff = `${"x".repeat(1700)}\n`;
  const prepared = provider.prepare("failure-fix", {
    goal: "repair the failed test",
    task: {
      goal: "repair the failed test",
      failureSummary: "4 !== 5",
      contextFiles: [{ path, content: context }],
      appliedPatches: [{ path, diff, revertedAt: null }]
    }
  });

  assert.deepEqual(prepared.disclosure.files.map((file) => [file.path, file.mode]), [
    [path, "full-content"],
    [path, "patch-diff"]
  ]);
  assert.equal(prepared.disclosure.files[0].transmittedUtf8Bytes, Buffer.byteLength(context, "utf8"));
  assert.equal(
    prepared.disclosure.files[1].transmittedUtf8Bytes,
    Buffer.byteLength(`${"x".repeat(1585)}\n...<truncated>`, "utf8")
  );
});

test("mock prepare and execute supports all four operations without transport", async () => {
  let lookups = 0;
  const provider = new ModelProvider({
    type: "mock",
    name: "mock",
    model: "mock-codeclaw",
    transport: { lookup: async () => { lookups += 1; throw new Error("must not resolve"); } }
  });
  const contextFile = {
    path: "test/calculator.test.js",
    content: "import test from \"node:test\";\nimport { divide } from \"../src/calculator.js\";\n"
  };
  const baseInput = {
    goal: "add divide by zero test",
    repoProfile: {
      name: "demo",
      files: [
        { path: contextFile.path, name: "calculator.test.js", textLike: true },
        { path: "src/calculator.js", name: "calculator.js", textLike: true }
      ]
    },
    task: { goal: "add divide by zero test", failureSummary: "AssertionError", contextFiles: [contextFile] }
  };

  const suggestion = await provider.executePrepared(provider.prepare("task-suggest", baseInput));
  const files = await provider.executePrepared(provider.prepare("context-files", baseInput));
  const patch = await provider.executePrepared(provider.prepare("patch-proposal", baseInput));
  const fix = await provider.executePrepared(provider.prepare("failure-fix", baseInput));

  assert.match(suggestion.content, /Mock suggestion/);
  assert.equal(files.files[0].path, "src/calculator.js");
  assert.equal(patch.applicable, true);
  assert.match(fix.content, /Mock failure fix suggestion/);
  assert.equal(lookups, 0);
});

test("online execute sends the privately retained preview buffer exactly once", async () => {
  const requests = [];
  await withModelServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
      body: Buffer.concat(chunks)
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: "Inspect src/a.js first." } }] }));
  }, async ({ baseUrl }) => {
    const provider = new ModelProvider({ type: "openai-compatible", name: "local", baseUrl, apiKey: "test-key", model: "m" });
    const prepared = provider.prepare("task-suggest", { goal: "inspect a", repoProfile: { name: "demo" } });
    const expected = Buffer.from(prepared.bodyText, "utf8");
    const exposedCopy = prepared.bodyBuffer;
    exposedCopy.fill(0);

    const result = await provider.executePrepared(prepared);
    assert.equal(result.content, "Inspect src/a.js first.");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/v1/chat/completions");
    assert.equal(requests[0].authorization, "Bearer test-key");
    assert.deepEqual(requests[0].body, expected);
    assert.deepEqual(prepared.target, { channel: "loopback", willLeaveDevice: false, endpoint: `${baseUrl}/chat/completions` });
    await assert.rejects(provider.executePrepared(prepared), { code: "prepared_request_consumed" });
    assert.equal(requests.length, 1);
  });
});

test("online execute rejects an assistant response that reflects the configured credential", async () => {
  const apiKey = "MODEL_API_KEY_ECHO_MUST_NOT_PERSIST";
  await withModelServer(async (request, response) => {
    for await (const _chunk of request) {}
    assert.equal(request.headers.authorization, `Bearer ${apiKey}`);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: `Never persist ${apiKey}` } }] }));
  }, async ({ baseUrl }) => {
    const provider = new ModelProvider({ type: "openai-compatible", name: "echo", baseUrl, apiKey, model: "m" });
    const prepared = provider.prepare("task-suggest", { goal: "reject credential reflection" });
    await assert.rejects(provider.executePrepared(prepared), (error) => {
      assert.equal(error.code, "MODEL_RESPONSE_CREDENTIAL_REFLECTION");
      assert.doesNotMatch(error.message, new RegExp(apiKey));
      return true;
    });
  });
});

test("short loopback dummy credentials do not create substring false positives", async () => {
  await withModelServer(async (request, response) => {
    for await (const _chunk of request) {}
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: "Keep the patch small." } }] }));
  }, async ({ baseUrl }) => {
    const provider = new ModelProvider({ type: "openai-compatible", name: "local", baseUrl, apiKey: "k", model: "m" });
    const result = await provider.executePrepared(provider.prepare("task-suggest", { goal: "suggest a patch" }));
    assert.equal(result.content, "Keep the patch small.");
  });
});

test("prepared online operations parse existing result shapes", async () => {
  const responses = [
    "Suggested next step.",
    "Read the test first.",
    JSON.stringify({ path: "src/a.js", content: "export const a = 2;\n", summary: "Update a." }),
    "Restore the assertion."
  ];
  await withModelServer(async (request, response) => {
    for await (const _chunk of request) {}
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: responses.shift() } }] }));
  }, async ({ baseUrl }) => {
    const provider = new ModelProvider({ type: "openai-compatible", name: "local", baseUrl, apiKey: "test-key", model: "m" });
    const input = {
      goal: "update a",
      repoProfile: {
        name: "demo",
        files: [
          { path: "src/a.js", name: "a.js", textLike: true },
          { path: "test/a.test.js", name: "a.test.js", textLike: true }
        ]
      },
      task: {
        goal: "update a",
        failureSummary: "1 !== 2",
        contextFiles: [{ path: "src/a.js", content: "export const a = 1;\n" }]
      }
    };
    const suggestion = await provider.executePrepared(provider.prepare("task-suggest", input));
    const context = await provider.executePrepared(provider.prepare("context-files", input));
    const patch = await provider.executePrepared(provider.prepare("patch-proposal", input));
    const failure = await provider.executePrepared(provider.prepare("failure-fix", input));

    assert.equal(suggestion.content, "Suggested next step.");
    assert.equal(context.note, "Read the test first.");
    assert.equal(context.files[0].path, "test/a.test.js");
    assert.equal(patch.applicable, true);
    assert.equal(patch.content, "export const a = 2;\n");
    assert.equal(failure.content, "Restore the assertion.");
    assert.equal(responses.length, 0);
  });
});

test("prepared online patch with no readable context remains local", async () => {
  const provider = new ModelProvider({
    type: "openai-compatible",
    name: "unused",
    baseUrl: "http://127.0.0.1:1/v1",
    apiKey: "test-key",
    model: "m"
  });
  const prepared = provider.prepare("patch-proposal", { goal: "change a", task: { contextFiles: [] } });
  assert.equal(prepared.networkRequired, false);
  assert.equal(prepared.disclosure.sendsNetworkRequest, false);
  const result = await provider.executePrepared(prepared);
  assert.equal(result.reason, "missing_context");
  assert.equal(result.applicable, false);
});

test("prepared requests are provider-bound", async () => {
  const first = new ModelProvider({ type: "mock" });
  const second = new ModelProvider({ type: "mock" });
  const prepared = first.prepare("task-suggest", { goal: "x" });
  await assert.rejects(second.executePrepared(prepared), { code: "invalid_prepared_request" });
});

async function withModelServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  try {
    await run({ baseUrl: `http://127.0.0.1:${address.port}/v1` });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
