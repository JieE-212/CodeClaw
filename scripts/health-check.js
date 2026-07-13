import { spawn } from "node:child_process";
import path from "node:path";
import { findAvailablePort, withAutomationResources } from "./automation-resource-scope.js";
import { previewAndApproveModelOperation } from "./model-operation-client.js";

const rootPath = process.cwd();
const fixturePath = path.join(rootPath, "examples", "support-inbox-js");
let stateDir = "";
let port = 0;
let baseUrl = "";
let server = null;
let serverOutput = "";

await withAutomationResources(async (scope) => {
  stateDir = await scope.temporaryDirectory("codeclaw-health-");
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
  }), "CodeClaw health-check server");
  server.stdout.on("data", (chunk) => {
    serverOutput += String(chunk);
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += String(chunk);
  });

  await waitForHealth();
  const system = await request("/api/system/check");
  assert(system.ok, "System check did not return ok.");

  const [html, appJs, i18nJs, styles] = await Promise.all([
    text("/"),
    text("/app.js"),
    text("/i18n.js"),
    text("/styles.css")
  ]);
  const markers = {
    i18n: html.includes("languageSelect") && appJs.includes("initI18n") && i18nJs.includes("SUPPORTED_LANGUAGES") && i18nJs.includes("zh-CN") && i18nJs.includes("ru"),
    trustStrip: html.includes("trust-strip") && html.includes("trust.local.title") && html.includes("trust.confirm.title") && styles.includes(".trust-strip"),
    workflow: html.includes('id="workflowPanel"')
      && html.includes('id="workflowSteps"')
      && html.includes('data-workflow-step="project"')
      && html.includes('data-workflow-step="complete"')
      && appJs.includes("const workflowModel"),
    experienceMode: html.includes('id="workflowMode"')
      && html.includes('id="modeBeginner"')
      && html.includes('id="modeAdvanced"')
      && appJs.includes("function syncVisibility"),
    modelCostHint: html.includes("modelCostHint") && appJs.includes("MODEL_COST_PROFILES") && styles.includes(".model-cost-hint"),
    preflightPanel: html.includes("preflightButton") && appJs.includes("/api/preflight/run"),
    realProjectPathInput: html.includes('id="repoPath"') && html.includes('id="pathHelper"') && html.includes("examplePathButton") && styles.includes(".path-helper") && appJs.includes("PATH_IS_FILE"),
    patchGate: html.includes("patchGate") && appJs.includes("preflightPatchGateStatus"),
    applyReview: html.includes('id="applyReview"') && appJs.includes("function renderApplyReview") && i18nJs.includes("applyReview.writeWarning.title") && styles.includes(".apply-review"),
    sessionRecovery: html.includes("sessionRecovery") && appJs.includes("function hydrateRestoredSession") && appJs.includes("function startFreshClientWorkflow"),
    modulePurpose: html.includes("data-workflow-section") && html.includes("aria-describedby") && html.includes("data-module-purpose"),
    explicitBoundaries: ["read", "project-write", "network", "command", "local-state"].every((boundary) => html.includes(`data-boundary="${boundary}"`))
      && appJs.includes("function renderVerifyBoundary"),
    accessibility: html.includes('id="workflowStatus"')
      && html.includes('role="status"')
      && html.includes('aria-live="polite"')
      && styles.includes(":focus-visible")
      && styles.includes("prefers-reduced-motion")
      && styles.includes("forced-colors"),
    workspaceCapabilities: html.includes("workspaceCapability")
      && html.includes("previewCopyButton")
      && html.includes("workspaceList")
      && appJs.includes("/api/workspaces/copy/preview")
      && appJs.includes("function workspaceWriteGateStatus")
      && i18nJs.includes("workspace.disclosure.body"),
    friendlyErrors: appJs.includes("function friendlyErrorMessage")
  };
  for (const [name, ok] of Object.entries(markers)) assert(ok, `Missing UI marker: ${name}`);

  await expectApiFailure("/api/preflight/run", { path: "", goal: "empty path check" }, "PATH_EMPTY");
  await expectApiFailure("/api/repo/scan", { path: path.join(fixturePath, "package.json") }, "PATH_IS_FILE");

  const modelConfig = await request("/api/model/config", {
    type: "mock",
    name: "mock",
    baseUrl: "",
    apiKey: "",
    model: "mock-codeclaw"
  });
  assert(modelConfig.ok, "Mock model config did not save.");
  const modelStatus = await request("/api/model/status");
  assert(modelStatus.status?.configured, "Mock model status is not configured.");
  assert(modelStatus.status?.model === "mock-codeclaw", "Unexpected mock model status.");

  const preflight = await request("/api/preflight/run", {
    path: fixturePath,
    goal: "improve ticket status updates with tests"
  });
  assert(preflight.ok, "Preflight did not return ok.");
  assert(preflight.report?.mode === "read-only-preflight", "Preflight mode changed.");
  assert(preflight.report?.writeAttempted === false, "Preflight attempted a write.");
  assert(preflight.workspace?.kind === "original-readonly", "A normal preflight did not receive the original-readonly capability.");
  assert(preflight.workspace?.canWrite === false, "A normal preflight unexpectedly received write capability.");
  assert(preflight.report?.contextFiles?.length > 0, "Preflight selected no context files.");
  const tools = new Set((preflight.task?.toolCalls || []).map((call) => call.tool));
  assert(tools.has("read_file"), "Preflight did not read files.");
  assert(tools.has("search_code"), "Preflight did not search code.");
  assert(!tools.has("write_patch") && !tools.has("run_command"), "Preflight used a write or command tool.");
  await expectApiFailure("/api/tools/call", {
    tool: "run_command",
    args: { command: preflight.profile.commands[0]?.command || "npm run test" },
    rootPath: preflight.profile.rootPath,
    taskId: preflight.task.id,
    approved: true,
    mode: "disposable-copy"
  }, "WORKSPACE_ORIGINAL_READ_ONLY");

  const copyPreview = await request("/api/workspaces/copy/preview", { sourcePath: fixturePath });
  assert(copyPreview.preview?.disclosure?.createsCopy === false, "Copy Preview unexpectedly created a workspace.");
  assert(copyPreview.preview?.disclosure?.safeToShare === false, "Copy Preview incorrectly claimed the source is safe to share.");

  const session = await request("/api/session/last");
  assert(session.session?.restored, "Last session was not restorable after preflight.");
  assert(session.session?.needsPreflight, "Restored session should require rerunning preflight.");

  const demoGoal = "添加除以零测试，并验证项目";
  const demoPreflight = await request("/api/preflight/run", {
    path: system.demoPath,
    goal: demoGoal
  });
  assert(demoPreflight.report?.writeAttempted === false, "Chinese Demo preflight attempted a write.");
  assert(demoPreflight.workspace?.kind === "built-in-demo", "Demo capability was not resolved by the server.");
  const demoPatch = (await previewAndApproveModelOperation(request, {
    operation: "patch-proposal",
    taskId: demoPreflight.task?.id
  })).result;
  assert(demoPatch?.applicable === true, `Chinese Demo patch was not applicable: ${demoPatch?.reason || "unknown"}`);
  assert(demoPatch?.files?.length > 0, "Chinese Demo patch contained no files.");

  console.log(JSON.stringify({
    ok: true,
    mode: "local-health-check",
    port,
    uiMarkers: markers,
    model: modelStatus.status,
    preflight: {
      repo: preflight.profile?.name,
      contextFiles: preflight.report.contextFiles.length,
      warnings: preflight.report.nextGate?.warnings?.length || 0,
      blockers: preflight.report.nextGate?.blockers?.length || 0,
      writeAttempted: preflight.report.writeAttempted,
      tools: [...tools]
    },
    sessionRestored: Boolean(session.session?.restored),
    chineseDemoPatch: {
      applicable: demoPatch.applicable,
      files: demoPatch.files.length
    }
  }, null, 2));
});

async function request(url, body) {
  const response = await fetch(`${baseUrl}${url}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json; charset=utf-8" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (payload.ok === false && !payload.blocked)) {
    const error = new Error(payload.error || payload.message || `Request failed: ${response.status}`);
    error.code = payload.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function expectApiFailure(url, body, code) {
  try {
    await request(url, body);
  } catch (error) {
    assert(error.code === code, `Expected ${code}, got ${error.code || error.message}`);
    return;
  }
  throw new Error(`Expected ${url} to fail with ${code}.`);
}

async function text(url) {
  const response = await fetch(`${baseUrl}${url}`);
  if (!response.ok) throw new Error(`Request failed: ${url} ${response.status}`);
  return response.text();
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


function assert(condition, message) {
  if (!condition) throw new Error(message);
}
