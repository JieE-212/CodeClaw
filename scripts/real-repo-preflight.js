import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { decidePreflightGate, pickSearchQuery, summarizeContextCoverage } from "../packages/preflight/src/index.js";
import { findAvailablePort, withAutomationResources } from "./automation-resource-scope.js";
import { previewAndApproveModelOperation } from "./model-operation-client.js";

const rootPath = process.cwd();
const targetRepo = path.resolve(process.argv[2] || process.env.CODECLAW_TRIAL_REPO || "");
const goal = (process.argv.slice(3).join(" ") || process.env.CODECLAW_TRIAL_GOAL || "understand the project and identify safe first context files").trim();

if (!process.argv[2] && !process.env.CODECLAW_TRIAL_REPO) {
  console.error("Usage: npm.cmd run pilot:real:preflight -- \"C:\\path\\to\\repo\" \"trial goal\"");
  process.exit(1);
}

await ensureDirectory(targetRepo);

let stateDir = "";
let port = 0;
let baseUrl = "";
let server = null;
let serverOutput = "";

await withAutomationResources(async (scope) => {
  stateDir = await scope.temporaryDirectory("codeclaw-real-preflight-");
  port = await findAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = scope.child(spawn(process.execPath, ["apps/web/server.js"], {
    cwd: rootPath,
    env: {
      ...process.env,
      CODECLAW_PORT: String(port),
      CODECLAW_STATE_DIR: stateDir,
      CODECLAW_PROJECT_LOCK_DIR: path.join(stateDir, "project-locks")
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  }), "CodeClaw real-repo preflight server");
  server.stdout.on("data", (chunk) => {
    serverOutput += String(chunk);
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += String(chunk);
  });

  await waitForHealth();
  await request("/api/model/config", {
    type: "mock",
    name: "mock",
    baseUrl: "",
    apiKey: "",
    model: "mock-codeclaw"
  });

  const scan = await request("/api/repo/scan", { path: targetRepo });
  const task = await request("/api/tasks/create", { goal, rootPath: scan.profile.rootPath });
  const plan = await request("/api/agent/plan", { goal, taskId: task.task.id });
  const context = (await previewAndApproveModelOperation(request, {
    operation: "context-files",
    taskId: task.task.id
  })).result;

  const selected = context.files.slice(0, 5);
  const readFiles = [];
  for (const file of selected) {
    const read = await request("/api/tools/call", {
      tool: "read_file",
      args: { path: file.path },
      rootPath: scan.profile.rootPath,
      taskId: task.task.id
    });
    readFiles.push({ path: file.path, size: typeof read.result === "string" ? read.result.length : 0 });
  }

  const searchQuery = pickSearchQuery(goal, selected, scan.profile);
  const search = await request("/api/tools/call", {
    tool: "search_code",
    args: { query: searchQuery },
    rootPath: scan.profile.rootPath,
    taskId: task.task.id
  });
  const latest = await get(`/api/tasks/latest?rootPath=${encodeURIComponent(scan.profile.rootPath)}`);

  console.log(JSON.stringify({
    ok: true,
    mode: "read-only-preflight",
    port,
    repo: {
      name: scan.profile.name,
      rootPath: scan.profile.rootPath,
      files: scan.profile.fileCount,
      skipped: scan.profile.skippedCount,
      languages: scan.profile.languages
    },
    commands: scan.profile.commands.map((item) => ({ name: item.name, command: item.command })),
    goal,
    plan: {
      title: plan.plan.title,
      steps: plan.plan.steps.length,
      intent: plan.plan.intent,
      confidence: plan.plan.confidence
    },
    contextFiles: selected.map((item) => ({ path: item.path, reason: item.reason })),
    readFiles,
    search: {
      query: searchQuery,
      hits: (search.result || []).slice(0, 8).map((item) => item.path)
    },
    writeAttempted: (latest.task?.toolCalls || []).some((call) => ["write_patch", "run_command"].includes(call.tool)),
    contextCoverage: summarizeContextCoverage(selected),
    nextGate: decidePreflightGate({ goal, scan: scan.profile, selected, searchHits: search.result || [] })
  }, null, 2));
});

async function ensureDirectory(directoryPath) {
  let stat = null;
  try {
    stat = await fs.stat(directoryPath);
  } catch {
    throw new Error(`Trial repo does not exist: ${directoryPath}`);
  }
  if (!stat.isDirectory()) throw new Error(`Trial repo is not a directory: ${directoryPath}`);
}

async function request(url, body) {
  const response = await fetch(`${baseUrl}${url}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json; charset=utf-8" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (payload.ok === false && !payload.blocked)) {
    throw new Error(payload.error || payload.message || `Request failed: ${response.status}`);
  }
  return payload;
}

async function get(url) {
  return request(url);
}

async function waitForHealth() {
  for (let index = 0; index < 50; index += 1) {
    if (server.exitCode !== null) throw new Error(`Server exited early.\n${serverOutput}`);
    try {
      const health = await request("/api/health");
      if (health.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not become ready.\n${serverOutput}`);
}
