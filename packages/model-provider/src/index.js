export class ModelProvider {
  constructor({ type = "mock", name = "mock", baseUrl = "", apiKey = "", model = "mock-codeclaw" } = {}) {
    this.type = type || "mock";
    this.name = name || this.type;
    this.baseUrl = baseUrl || "";
    this.apiKey = apiKey || "";
    this.model = model || "mock-codeclaw";
  }

  status() {
    return {
      type: this.type,
      name: this.name,
      model: this.model,
      configured: this.type === "mock" || Boolean(this.baseUrl && this.apiKey && this.model)
    };
  }

  async chat(messages) {
    if (this.type === "mock") return mockChat(this, messages);
    if (this.type === "openai-compatible") return chatOpenAICompatible(this, messages);
    throw new Error(`Unsupported model provider: ${this.type}`);
  }

  async suggestTask({ goal, repoProfile = {}, task = null } = {}) {
    const messages = buildSuggestionMessages({ goal, repoProfile, task });
    const response = await this.chat(messages);
    return {
      provider: response.provider,
      model: response.model,
      content: response.content,
      createdAt: new Date().toISOString()
    };
  }

  async suggestContextFiles({ goal, repoProfile = {}, task = null, limit = 8 } = {}) {
    const candidates = selectContextFiles({ goal: goal || task?.goal, repoProfile, task, limit });
    if (this.type === "mock") {
      return {
        provider: this.name,
        model: this.model,
        files: candidates,
        createdAt: new Date().toISOString()
      };
    }

    const messages = buildContextFileMessages({ goal, repoProfile, task, candidates });
    const response = await this.chat(messages);
    return {
      provider: response.provider,
      model: response.model,
      files: candidates,
      note: response.content,
      createdAt: new Date().toISOString()
    };
  }

  async proposePatch({ goal, repoProfile = {}, task = null } = {}) {
    if (this.type === "mock") return mockPatchProposal(this, { goal, repoProfile, task });
    if (!hasReadableContext(task)) {
      return invalidPatchProposal({
        provider: this.name,
        model: this.model,
        reason: "missing_context",
        summary: "Read at least one relevant context file before asking the model for a patch.",
        note: "Patch generation is limited to files whose full content has already been read into the current task."
      });
    }

    const messages = buildPatchMessages({ goal, repoProfile, task });
    const response = await this.chat(messages);
    const parsed = parsePatchProposalResult(response.content, { provider: response.provider, model: response.model, task });
    if (parsed.ok) return parsed.proposal;
    return invalidPatchProposal({
      provider: response.provider,
      model: response.model,
      reason: parsed.reason,
      summary: parsed.summary,
      note: parsed.note || response.content
    });
  }

  async suggestFailureFix({ task = null } = {}) {
    const failure = task?.failureSummary || "No failure summary available.";
    const messages = buildFailureFixMessages({ task, failure });
    if (this.type === "mock") {
      return {
        provider: this.name,
        model: this.model,
        content: [
          "Mock failure fix suggestion:",
          "- Read the file mentioned nearest to the failure output.",
          "- Compare the failure with recent applied patch diffs before blaming implementation.",
          "- Compare the failed assertion with the intended behavior.",
          "- Generate a smaller patch and rerun the verification command.",
          "",
          messages.at(-1)?.content.slice(0, 900)
        ].join("\n"),
        createdAt: new Date().toISOString()
      };
    }
    const response = await this.chat(messages);
    return { provider: response.provider, model: response.model, content: response.content, createdAt: new Date().toISOString() };
  }

  async embedding(input) {
    return {
      provider: this.name,
      vector: simpleEmbedding(input)
    };
  }
}

export function sanitizeModelConfig(config = {}) {
  return {
    type: config.type || "mock",
    name: config.name || config.type || "mock",
    baseUrl: config.baseUrl || "",
    apiKey: config.apiKey || "",
    model: config.model || (config.type === "openai-compatible" ? "" : "mock-codeclaw")
  };
}

export function publicModelConfig(config = {}) {
  const sanitized = sanitizeModelConfig(config);
  return {
    ...sanitized,
    apiKey: sanitized.apiKey ? "configured" : ""
  };
}

export function parsePatchProposal(content, { provider = "model", model = "unknown", task = null } = {}) {
  const result = parsePatchProposalResult(content, { provider, model, task });
  return result.ok ? result.proposal : null;
}

export function parsePatchProposalResult(content, { provider = "model", model = "unknown", task = null } = {}) {
  const jsonText = extractJsonObject(content);
  if (!jsonText) return invalidPatchParse("invalid_json", "Model response did not contain a JSON object.", content);

  try {
    const parsed = JSON.parse(jsonText);
    const normalized = normalizePatchFiles(parsed);
    if (!normalized.ok) return normalized;

    const files = normalized.files;
    if (!hasReadableContext(task)) {
      return invalidPatchParse("missing_context", "No full context file content is available for patch validation.", content);
    }

    const enrichedFiles = files.map((file) => {
      const contextFile = findContextFile(task, file.path);
      if (!contextFile || typeof contextFile.content !== "string") {
        throw new PatchValidationError("missing_context", `Patch target was not read into context: ${file.path}`);
      }
      if (isUnsafePatchPath(file.path)) {
        throw new PatchValidationError("unsafe_path", `Patch path is unsafe: ${file.path}`);
      }
      if (looksLikeUnifiedDiff(file.content)) {
        throw new PatchValidationError("diff_instead_of_full_content", `Patch content for ${file.path} looks like a diff, not full file content.`);
      }
      if (normalizeTrailingNewline(contextFile.content) === normalizeTrailingNewline(file.content)) {
        throw new PatchValidationError("unchanged_content", `Patch content for ${file.path} is unchanged.`);
      }
      const before = contextFile.content;
      return {
        path: file.path,
        content: file.content,
        summary: file.summary || `Update ${file.path}.`,
        diff: createSimpleDiff(file.path, before, file.content)
      };
    });
    const primary = enrichedFiles[0];
    return {
      ok: true,
      proposal: {
        provider,
        model,
        path: primary.path,
        content: primary.content,
        diff: enrichedFiles.map((file) => file.diff).join("\n\n"),
        files: enrichedFiles,
        applicable: true,
        reason: "",
        summary: parsed.summary || primary.summary,
        note: parsed.note || "",
        createdAt: new Date().toISOString()
      }
    };
  } catch (error) {
    if (error instanceof PatchValidationError) return invalidPatchParse(error.reason, error.message, content);
    return invalidPatchParse("invalid_json", "Model response JSON could not be parsed.", content);
  }
}

function normalizePatchFiles(parsed) {
  if (Array.isArray(parsed?.files)) {
    if (!parsed.files.length) return invalidPatchParse("missing_fields", "Patch JSON has an empty files array.");
    const files = [];
    for (const [index, file] of parsed.files.entries()) {
      if (!file?.path || typeof file.path !== "string" || typeof file.content !== "string") {
        return invalidPatchParse("missing_fields", `Patch JSON file entry ${index + 1} must include string path and content fields.`);
      }
      files.push({ path: file.path, content: file.content, summary: file.summary || "" });
    }
    return { ok: true, files };
  }
  if (parsed?.path && typeof parsed.path === "string" && typeof parsed.content === "string") {
    return { ok: true, files: [{ path: parsed.path, content: parsed.content, summary: parsed.summary || "" }] };
  }
  return invalidPatchParse("missing_fields", "Patch JSON must include either path/content or files[].");
}

function buildSuggestionMessages({ goal, repoProfile, task }) {
  const languages = repoProfile.languages?.map((item) => item.name).join(", ") || "unknown";
  const commands = repoProfile.commands?.map((item) => `${item.name}: ${item.command}`).join("\n") || "none";
  const taskContext = task ? `Task status: ${task.status}\nTool calls: ${task.toolCalls?.length || 0}\nVerification: ${task.verification ? JSON.stringify(task.verification) : "not run"}` : "No task yet.";
  return [
    {
      role: "system",
      content: "You are CodeClaw. Suggest safe next steps for a local-first developer agent. Do not claim to have modified files. Keep output concise and actionable."
    },
    {
      role: "user",
      content: `Goal: ${goal || task?.goal || "unknown"}\nProject: ${repoProfile.name || "unknown"}\nLanguages: ${languages}\nCommands:\n${commands}\n${taskContext}`
    }
  ];
}

function buildContextFileMessages({ goal, repoProfile, task, candidates }) {
  return [
    {
      role: "system",
      content: "You are CodeClaw. Review candidate context files for a developer task. Do not read files yourself or claim file contents. Explain which files should be read first."
    },
    {
      role: "user",
      content: `Goal: ${goal || task?.goal || "unknown"}\nProject: ${repoProfile.name || "unknown"}\nCandidates:\n${candidates.map((item) => `- ${item.path}: ${item.reason}`).join("\n")}`
    }
  ];
}

function buildPatchMessages({ goal, repoProfile, task }) {
  const context = (task?.contextFiles || []).map((file) => `File: ${file.path}\n${file.content || file.summary || ""}`).join("\n\n");
  const testFiles = (task?.contextFiles || []).filter((file) => /(^|\/)(test|tests|__tests__)\/|\.test\.|\.spec\./i.test(file.path)).map((file) => file.path);
  const testGuidance = testFiles.length
    ? `Relevant test context is available: ${testFiles.join(", ")}. If the task changes behavior, include focused test updates in the JSON patch unless there is a clear reason not to; if no test file is changed, explain the reason in the JSON note.`
    : "No test file context is available; do not invent unseen test files.";
  return [
    {
      role: "system",
      content: [
        "You are CodeClaw. Propose a minimal patch for the task using only provided context.",
        "Return only valid JSON, with no markdown or prose outside JSON.",
        "For one file, use: {\"path\":\"relative/file\",\"content\":\"complete new file content\",\"summary\":\"short summary\"}.",
        "For multiple files, use: {\"summary\":\"short summary\",\"files\":[{\"path\":\"relative/file\",\"content\":\"complete new file content\",\"summary\":\"short summary\"}]}",
        "The content field must be the complete replacement file content, not a diff, not a snippet, and not instructions.",
        "Only target files that appear in the provided context. Do not claim the patch has been applied.",
        testGuidance
      ].join(" ")
    },
    {
      role: "user",
      content: `Goal: ${goal || task?.goal || "unknown"}\nProject: ${repoProfile.name || "unknown"}\nContext:\n${context || "No context files read yet."}`
    }
  ];
}

function buildFailureFixMessages({ task, failure }) {
  const recentPatches = formatRecentAppliedPatches(task);
  const recentToolCalls = formatRecentToolCalls(task);
  const contextFiles = formatFailureContextFiles(task);
  const verification = task?.verification
    ? [
        `Exit code: ${task.verification.exitCode}`,
        `Timed out: ${Boolean(task.verification.timedOut)}`,
        task.verification.command ? `Command: ${task.verification.command}` : ""
      ].filter(Boolean).join("\n")
    : "No verification result recorded.";

  return [
    {
      role: "system",
      content: [
        "You are CodeClaw. Suggest exactly one safe next repair step based on failed verification evidence.",
        "Use the failure output, assertion location, recent tool calls, and recent applied patch diffs together.",
        "Do not assume implementation is wrong if a recent patch changed a test, assertion, fixture, or expectation.",
        "Prefer inspecting or correcting the file closest to the assertion before suggesting broad implementation changes.",
        "Do not claim to modify files. Keep the answer concise and actionable."
      ].join(" ")
    },
    {
      role: "user",
      content: [
        `Task: ${task?.goal || "unknown"}`,
        `Task status: ${task?.status || "unknown"}`,
        "",
        "Failed verification:",
        verification,
        "",
        "Failure summary:",
        failure,
        "",
        "Recent applied patches:",
        recentPatches,
        "",
        "Recent tool calls:",
        recentToolCalls,
        "",
        "Task context files:",
        contextFiles
      ].join("\n")
    }
  ];
}

function formatRecentAppliedPatches(task) {
  const patches = task?.appliedPatches || [];
  if (!patches.length) return "No applied patch records are available.";
  return patches.slice(-4).map((patch, index) => {
    const status = patch.revertedAt ? `reverted at ${patch.revertedAt}` : "active";
    const diff = patch.diff || createSimpleDiff(patch.path || "unknown", patch.previousContent || "", patch.nextContent || "");
    return [
      `Patch ${patches.length - patches.slice(-4).length + index + 1}: ${patch.path || "unknown"} (${status})`,
      patch.summary ? `Summary: ${patch.summary}` : "",
      "Diff:",
      clipText(diff, 1600)
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

function formatRecentToolCalls(task) {
  const calls = task?.toolCalls || [];
  if (!calls.length) return "No tool calls recorded.";
  return calls.slice(-8).map((call) => {
    const args = call.args ? ` args=${JSON.stringify(call.args)}` : "";
    const result = call.summary ? ` -> ${call.summary}` : "";
    return `- ${call.tool || "unknown"}${args}${result}`;
  }).join("\n");
}

function formatFailureContextFiles(task) {
  const files = task?.contextFiles || [];
  if (!files.length) return "No context files have been read into this task.";
  return files.slice(-8).map((file) => {
    const content = typeof file.content === "string" && file.content ? `\nContent excerpt:\n${clipText(file.content, 1200)}` : "";
    return `- ${file.path}${file.summary ? `: ${clipText(file.summary, 240)}` : ""}${content}`;
  }).join("\n\n");
}

function clipText(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 15)}\n...<truncated>`;
}

function mockPatchProposal(provider, { goal, task }) {
  const normalizedGoal = normalizeMockGoal(goal || task?.goal);
  if (!isDivideByZeroTestGoal(normalizedGoal)) {
    return invalidPatchProposal({
      provider: provider.name,
      model: provider.model,
      reason: "unsupported_goal",
      summary: "Mock provider only supports the divide-by-zero test demo goal.",
      note: "Use an equivalent divide-by-zero test goal in English, Simplified Chinese, or Russian."
    });
  }

  const contextFiles = task?.contextFiles || [];
  const testFile = findDivideByZeroTestContext(contextFiles);
  if (!testFile) {
    return invalidPatchProposal({
      provider: provider.name,
      model: provider.model,
      reason: "missing_test_context",
      summary: "Mock provider needs a relevant divide-by-zero test context file before it can propose this patch.",
      note: "Read a calculator test/spec file containing divide behavior into the current task first."
    });
  }
  if (typeof testFile.content !== "string" || !testFile.content.length) {
    return invalidPatchProposal({
      provider: provider.name,
      model: provider.model,
      reason: "missing_context_content",
      summary: "Mock provider found a relevant test context file, but its full content has not been read.",
      note: `Read the full content of ${testFile.path} before generating a patch.`
    });
  }

  const before = normalizeTrailingNewline(testFile.content);
  const extra = [
    "",
    "test(\"divide throws on zero denominator\", () => {",
    "  assert.throws(() => divide(1, 0), /Cannot divide by zero/);",
    "});",
    ""
  ].join("\n");
  const content = before.includes("divide throws on zero denominator") ? before : `${before}${extra}`;
  return {
    provider: provider.name,
    model: provider.model,
    path: testFile.path,
    content,
    diff: createSimpleDiff(testFile.path, before, content),
    files: [{ path: testFile.path, content, summary: `Add a divide-by-zero assertion to ${testFile.path}.`, diff: createSimpleDiff(testFile.path, before, content) }],
    applicable: true,
    summary: `Add a divide-by-zero assertion to ${testFile.path}.`,
    createdAt: new Date().toISOString()
  };
}

function normalizeMockGoal(goal) {
  return String(goal || "").normalize("NFKC").toLocaleLowerCase();
}

function isDivideByZeroTestGoal(goal) {
  const hasDivide = /\b(?:divide|division|dividing)\b/.test(goal)
    || /(?:除以|除法|除数|被除数|除零)/.test(goal)
    || /(?:делен|делит|раздел)[\p{L}]*/u.test(goal);
  const hasZero = /\b(?:zero|0)\b/.test(goal)
    || /零/.test(goal)
    || /(?:нол|нул)[\p{L}]*/u.test(goal);
  const hasTest = /\b(?:test|tests|testing|assert|assertion|verify|verification)\b/.test(goal)
    || /(?:测试|验证|断言|用例)/.test(goal)
    || /(?:тест|провер)[\p{L}]*/u.test(goal);
  return hasDivide && hasZero && hasTest;
}

function findDivideByZeroTestContext(contextFiles) {
  const testFiles = contextFiles.filter((file) => isTestContextPath(file?.path));
  return testFiles.find((file) => /calculator/i.test(String(file.path || "")))
    || testFiles.find((file) => hasDivideContextEvidence(file));
}

function isTestContextPath(filePath) {
  const normalizedPath = String(filePath || "").replace(/\\/g, "/").toLowerCase();
  return /(?:^|\/)(?:test|tests|spec|specs|__tests__)(?:\/|$)/.test(normalizedPath)
    || /\.(?:test|spec)\.[^/]+$/.test(normalizedPath);
}

function hasDivideContextEvidence(file) {
  const evidence = [file?.path, file?.summary, file?.content].filter(Boolean).join("\n").toLocaleLowerCase();
  return /\b(?:divide|division)\b/.test(evidence)
    || /(?:除以|除法)/.test(evidence)
    || /(?:делен|делит|раздел)[\p{L}]*/u.test(evidence);
}

function extractJsonObject(content) {
  const text = String(content || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return "";
  return text.slice(start, end + 1);
}

function findContextFile(task, filePath) {
  const match = (task?.contextFiles || []).find((file) => file.path === filePath);
  return match || null;
}

function hasReadableContext(task) {
  return (task?.contextFiles || []).some((file) => typeof file.content === "string" && file.content.length > 0);
}

class PatchValidationError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

function invalidPatchParse(reason, summary, note = "") {
  return { ok: false, reason, summary, note: String(note || "").slice(0, 4000) };
}

function invalidPatchProposal({ provider, model, reason, summary, note = "" }) {
  return {
    provider,
    model,
    path: null,
    content: "",
    diff: "",
    files: [],
    applicable: false,
    reason,
    summary,
    note,
    createdAt: new Date().toISOString()
  };
}

function isUnsafePatchPath(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  return normalized.startsWith("/") || normalized.includes("../") || normalized === ".." || /^[a-z]:\//i.test(normalized);
}

function looksLikeUnifiedDiff(content) {
  const text = String(content || "").trimStart();
  return /^diff --git /m.test(text) || (/^---\s+/m.test(text) && /^\+\+\+\s+/m.test(text) && /^@@/m.test(text));
}

function normalizeTrailingNewline(value) {
  const text = String(value || "");
  return text.endsWith("\n") ? text : `${text}\n`;
}

function createSimpleDiff(filePath, before, after) {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const maxLines = Math.max(beforeLines.length, afterLines.length);
  const lines = [`--- a/${filePath}`, `+++ b/${filePath}`, "@@"];
  for (let index = 0; index < maxLines; index += 1) {
    const oldLine = beforeLines[index];
    const newLine = afterLines[index];
    if (oldLine === newLine) {
      if (oldLine !== undefined) lines.push(` ${oldLine}`);
      continue;
    }
    if (oldLine !== undefined) lines.push(`-${oldLine}`);
    if (newLine !== undefined) lines.push(`+${newLine}`);
  }
  return lines.join("\n");
}

function splitLines(value) {
  const normalized = String(value || "").replace(/\r\n/g, "\n");
  if (!normalized) return [];
  return normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
}

export function selectContextFiles({ goal = "", repoProfile = {}, task = null, limit = 8 } = {}) {
  const alreadyRead = new Set((task?.contextFiles || []).map((item) => item.path));
  const goalTokens = tokenize(goal);
  const files = repoProfile.files || [];
  const keyFiles = new Set(repoProfile.keyFiles || []);
  const scored = [];

  for (const file of files) {
    if (!file?.path || alreadyRead.has(file.path)) continue;
    let score = 0;
    const reasons = [];
    const lowerPath = file.path.toLowerCase();
    const lowerName = file.name?.toLowerCase() || lowerPath.split("/").at(-1);
    const lowerSummary = String(file.summary || "").toLowerCase();
    const symbolNames = (file.symbols || []).map((symbol) => String(symbol.name || "").toLowerCase());
    const metadataFile = /readme|package\.json|pyproject|requirements|config/.test(lowerName);
    const metadataGoal = hasAnyToken(goalTokens, ["readme", "package", "dependency", "dependencies", "install", "script", "start", "build", "config", "project"]);
    if (keyFiles.has(file.path)) {
      score += metadataFile && !metadataGoal ? 2 : 5;
      reasons.push("key project file");
    }
    if (file.textLike) score += 2;
    if (metadataFile) {
      score += metadataGoal ? 2 : 1;
      reasons.push("project metadata");
    }
    if (/test|spec|__tests__/.test(lowerPath)) {
      const testScore = goalTokens.has("test") || goalTokens.has("tests") ? 5 : 2;
      score += testScore;
      reasons.push("test-related");
    }
    if (/src|app|lib|packages/.test(lowerPath)) {
      score += 2;
      reasons.push("source-related");
    }
    for (const token of goalTokens) {
      if (token.length < 3) continue;
      if (lowerPath.includes(token)) {
        score += 4;
        reasons.push(`path match: ${token}`);
      }
      if (lowerSummary.includes(token)) {
        score += 3;
        reasons.push(`summary match: ${token}`);
      }
      if (symbolNames.some((name) => name.includes(token))) {
        score += 6;
        reasons.push(`symbol match: ${token}`);
      }
    }
    if (score <= 0) continue;
    scored.push({ path: file.path, score, reason: reasonForFile(reasons, score) });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
}

function reasonForFile(reasons, score) {
  const deduped = [...new Set(reasons)];
  if (deduped.length) return deduped.slice(0, 5).join(", ");
  if (!reasons.length) reasons.push(`ranked score ${score}`);
  return reasons.slice(0, 5).join(", ");
}

function tokenize(value) {
  return new Set((String(value || "").toLowerCase().match(/[a-z0-9_]+/g) || []).filter((token) => !STOP_TOKENS.has(token)));
}

function hasAnyToken(tokens, values) {
  return values.some((value) => tokens.has(value));
}

const STOP_TOKENS = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "codeclaw", "for", "from", "how", "in", "is", "it", "of", "on", "or", "the", "this", "to", "with"]);

async function mockChat(provider, messages) {
  const prompt = messages.at(-1)?.content || "";
  return {
    provider: provider.name,
    model: provider.model,
    content: [
      "Mock suggestion:",
      "- Read the most relevant source and test files before changing code.",
      "- Prepare the smallest patch that satisfies the task goal.",
      "- Run the detected test command and review the result.",
      "",
      prompt.slice(0, 400)
    ].join("\n"),
    messages
  };
}

async function chatOpenAICompatible(provider, messages) {
  if (!provider.baseUrl || !provider.apiKey || !provider.model) throw new Error("Model provider is not fully configured.");
  const url = `${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature: 0.2
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `Model request failed with ${response.status}`);
  return {
    provider: provider.name,
    model: provider.model,
    content: payload.choices?.[0]?.message?.content || "",
    raw: payload
  };
}

function simpleEmbedding(input) {
  const text = String(input || "");
  const buckets = new Array(16).fill(0);
  for (let index = 0; index < text.length; index += 1) {
    buckets[index % buckets.length] += text.charCodeAt(index) / 255;
  }
  return buckets;
}
