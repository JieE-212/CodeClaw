import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const rootPath = process.cwd();
const packageJsonPath = path.join(rootPath, "package.json");
const serverJsPath = path.join(rootPath, "apps", "web", "server.js");
const packageBefore = await fs.readFile(packageJsonPath, "utf8");
const serverBefore = await fs.readFile(serverJsPath, "utf8");
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-pilot-"));
const port = await findFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["apps/web/server.js"], {
  cwd: rootPath,
  env: { ...process.env, CODECLAW_PORT: String(port), CODECLAW_STATE_DIR: stateDir },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});
let serverOutput = "";

server.stdout.on("data", (chunk) => {
  serverOutput += String(chunk);
});
server.stderr.on("data", (chunk) => {
  serverOutput += String(chunk);
});

try {
  await waitForHealth();
  const scan = await request("/api/repo/scan", { path: rootPath });
  const task = await request("/api/tasks/create", { goal: "explain CodeClaw memory and context selection flow", rootPath: scan.profile.rootPath });
  const plan = await request("/api/agent/plan", { goal: task.task.goal, repoProfile: scan.profile, taskId: task.task.id });
  const context = await request("/api/model/context-files", { goal: task.task.goal, repoProfile: scan.profile, rootPath: scan.profile.rootPath, taskId: task.task.id });
  const selected = context.suggestion.files.slice(0, 3);
  if (!selected.length) throw new Error("Pilot did not produce context candidates.");
  for (const file of selected) {
    await request("/api/tools/call", { tool: "read_file", args: { path: file.path }, rootPath: scan.profile.rootPath, taskId: task.task.id });
  }
  const search = await request("/api/tools/call", { tool: "search_code", args: { query: "MemoryStore" }, rootPath: scan.profile.rootPath, taskId: task.task.id });
  if (!search.result.some((item) => item.path.includes("memory-store"))) throw new Error("Pilot search did not find MemoryStore.");
  const notes = await request("/api/memory/notes", { rootPath: scan.profile.rootPath, notes: "Pilot self-run verified scan, context selection, search, and memory notes." });
  const completed = await request("/api/tasks/complete", { taskId: task.task.id, summary: "Pilot self-run completed without source changes." });

  const packageAfter = await fs.readFile(packageJsonPath, "utf8");
  const serverAfter = await fs.readFile(serverJsPath, "utf8");
  if (packageAfter !== packageBefore || serverAfter !== serverBefore) throw new Error("Pilot self-run changed source files.");

  console.log(JSON.stringify({
    ok: true,
    port,
    project: scan.profile.name,
    files: scan.profile.fileCount,
    commands: scan.profile.commands.map((item) => item.command),
    planSteps: plan.plan.steps.length,
    contextCandidates: selected.map((item) => ({ path: item.path, reason: item.reason })),
    searchHits: search.result.map((item) => item.path).slice(0, 5),
    memoryNotesSaved: notes.memory.notes.length > 0,
    reviewDraft: completed.task.reviewDraft.split("\n")[0],
    sourceFilesUnchanged: true
  }, null, 2));
} finally {
  server.kill();
  await fs.rm(stateDir, { recursive: true, force: true });
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

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const selected = address.port;
      probe.close(() => resolve(selected));
    });
  });
}
