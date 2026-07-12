import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectSourceVersion } from "./source-version.js";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");
const args = parseArgs(process.argv.slice(2));
const appRoot = path.resolve(args.appRoot || process.env.CODECLAW_SIM_APP_ROOT || defaultRoot);
const realRepo = path.resolve(args.realRepo || process.env.CODECLAW_SIM_REAL_REPO || appRoot);
const reportDir = path.resolve(args.outDir || process.env.CODECLAW_SIM_OUT_DIR || path.join(appRoot, "dist"));
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-first-trial-"));
const port = await findFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const demoPath = path.join(appRoot, "examples", "demo-js");
const demoTestPath = path.join(demoPath, "test", "calculator.test.js");
const originalDemoTest = await fs.readFile(demoTestPath, "utf8");

const server = spawn(process.execPath, ["apps/web/server.js"], {
  cwd: appRoot,
  env: {
    ...process.env,
    CODECLAW_PORT: String(port),
    CODECLAW_STATE_DIR: stateDir,
    CODECLAW_PROJECT_LOCK_DIR: path.join(stateDir, "project-locks")
  },
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
  await request("/api/model/config", {
    type: "mock",
    name: "mock",
    baseUrl: "",
    apiKey: "",
    model: "mock-codeclaw"
  });

  const ui = await inspectUi();
  const demo = await runDemoTrial();
  const real = await runRealReadOnlyTrial();
  const failurePaths = await runFailurePathTrial(demo);
  const session = await request("/api/session/last");
  const audit = await request(`/api/audit/events?rootPath=${encodeURIComponent(real.rootPath)}`);
  const sourceVersion = await inspectSourceVersion(appRoot);

  const report = {
    ok: true,
    mode: "simulated-first-trial",
    createdAt: new Date().toISOString(),
    appRoot,
    sourceVersion,
    realRepo,
    port,
    ui,
    demo,
    realReadOnlyPreflight: real,
    failurePaths,
    session: {
      restored: Boolean(session.session?.restored),
      needsPreflight: Boolean(session.session?.needsPreflight)
    },
    audit: {
      events: audit.events?.length || 0,
      latestTypes: (audit.events || []).slice(0, 5).map((event) => event.type)
    },
    simulatedTesterFindings: findingsFor({ ui, demo, real, failurePaths }),
    frictionAudit: frictionAuditFor({ ui, demo, real, failurePaths }),
    humanObservationTemplate: {
      path: path.join("docs", "HUMAN_TRIAL_OBSERVATION.md"),
      requiredForHostedTrial: true,
      stopBeforeRealApply: true
    },
    nextRecommendation: "Run one hosted human trial only if the tester starts with Demo and stops before real-project Apply."
  };

  await fs.mkdir(reportDir, { recursive: true });
  const jsonPath = path.join(reportDir, "SIMULATED_FIRST_TRIAL_REPORT.json");
  const markdownPath = path.join(reportDir, "SIMULATED_FIRST_TRIAL_REPORT.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

  console.log(JSON.stringify({
    ok: true,
    jsonPath,
    markdownPath,
    appRoot,
    realRepo,
    demo: {
      blockers: demo.blockers,
      warnings: demo.warnings,
      contextFiles: demo.contextFiles,
      patchProposalFiles: demo.patchProposalFiles,
      writeAttempted: demo.writeAttempted,
      demoRestored: demo.demoRestored
    },
    realReadOnlyPreflight: {
      repo: real.repo,
      blockers: real.blockers,
      warnings: real.warnings,
      contextFiles: real.contextFiles,
      writeAttempted: real.writeAttempted
    },
    failurePaths: {
      emptyPathCode: failurePaths.emptyPath.code,
      filePathCode: failurePaths.filePath.code,
      noCommandCommands: failurePaths.noCommandProject.commands,
      unconfirmedApplyBlocked: failurePaths.unconfirmedApply.blocked,
      unconfirmedVerifyBlocked: failurePaths.unconfirmedVerify.blocked
    },
    frictionAudit: report.frictionAudit.map((item) => ({ area: item.area, status: item.status })),
    findings: report.simulatedTesterFindings
  }, null, 2));
} finally {
  server.kill();
  await fs.rm(stateDir, { recursive: true, force: true });
}

async function inspectUi() {
  const [html, appJs, i18nJs] = await Promise.all([text("/"), text("/app.js"), text("/i18n.js")]);
  return {
    i18nPresent: html.includes("languageSelect") && appJs.includes("initI18n") && i18nJs.includes("SUPPORTED_LANGUAGES") && i18nJs.includes("zh-CN") && i18nJs.includes("ru"),
    quickStartVisible: html.includes("panel.quickStart") && html.includes("quickStartPrimary"),
    trustStripVisible: html.includes("trust.local.title") && html.includes("trust.preflight.title") && html.includes("trust.confirm.title"),
    demoVisible: html.includes("Demo"),
    pathInputTipsVisible: html.includes("real-project-path-helper") && html.includes("examplePathButton") && appJs.includes("PATH_IS_FILE"),
    pathModeVisible: html.includes("trial-friction-path-mode") && i18nJs.includes("path.mode.demo.title") && i18nJs.includes("path.mode.real.title"),
    readOnlyPreflightCopy: html.includes("preflight.default") && i18nJs.includes("preflight.default"),
    patchGatePresent: html.includes("patchGate") && appJs.includes("preflightPatchGateStatus"),
    applyReviewPresent: html.includes("dry-run-apply-review") && appJs.includes("function renderApplyReview") && i18nJs.includes("applyReview.writeWarning.title"),
    modelCostCopyPresent: i18nJs.includes("model.cost.flash.detail") && i18nJs.includes("model.cost.pro.detail"),
    humanObservationTemplatePresent: await fileExists(path.join(appRoot, "docs", "HUMAN_TRIAL_OBSERVATION.md"))
  };
}

async function runDemoTrial() {
  const goal = "add divide by zero test and verify the project";
  const preflight = await request("/api/preflight/run", { path: demoPath, goal });
  const task = preflight.task;
  const plan = await request("/api/agent/plan", { goal, repoProfile: preflight.profile, taskId: task.id });
  const patch = await request("/api/model/patch-proposal", {
    goal,
    repoProfile: preflight.profile,
    rootPath: preflight.profile.rootPath,
    taskId: task.id
  });
  const latest = await request(`/api/tasks/latest?rootPath=${encodeURIComponent(preflight.profile.rootPath)}`);
  const finalDemoTest = await fs.readFile(demoTestPath, "utf8");
  const tools = new Set((latest.task?.toolCalls || []).map((call) => call.tool));
  const patchFiles = proposalFiles(patch.proposal);
  return {
    repo: preflight.profile.name,
    rootPath: preflight.profile.rootPath,
    taskId: task.id,
    verifyCommand: preflight.profile.commands[0]?.command || "",
    planTitle: plan.plan.title,
    planSteps: plan.plan.steps.length,
    contextFiles: preflight.report.contextFiles.length,
    warnings: preflight.report.nextGate.warnings.length,
    blockers: preflight.report.nextGate.blockers.length,
    writeAttempted: [...tools].some((tool) => ["write_patch", "run_command"].includes(tool)),
    tools: [...tools],
    patchProposalFiles: patchFiles.map((file) => file.path),
    appliedPatches: latest.task?.appliedPatches?.filter((item) => !item.revertedAt).length || 0,
    demoRestored: finalDemoTest === originalDemoTest
  };
}

async function runRealReadOnlyTrial() {
  await ensureDirectory(realRepo);
  const goal = "understand this project and identify the safest first files for a small UI bug fix";
  const preflight = await request("/api/preflight/run", { path: realRepo, goal });
  const latest = await request(`/api/tasks/latest?rootPath=${encodeURIComponent(preflight.profile.rootPath)}`);
  const tools = new Set((latest.task?.toolCalls || []).map((call) => call.tool));
  return {
    repo: preflight.profile.name,
    rootPath: preflight.profile.rootPath,
    files: preflight.profile.fileCount,
    skipped: preflight.profile.skippedCount,
    languages: preflight.profile.languages,
    commands: preflight.profile.commands.map((command) => command.command),
    contextFiles: preflight.report.contextFiles.length,
    contextFilePaths: preflight.report.contextFiles.map((file) => file.path),
    warnings: preflight.report.nextGate.warnings.length,
    blockers: preflight.report.nextGate.blockers.length,
    warningDetails: preflight.report.nextGate.warnings,
    blockerDetails: preflight.report.nextGate.blockers,
    writeAttempted: [...tools].some((tool) => ["write_patch", "run_command"].includes(tool)),
    tools: [...tools]
  };
}

async function runFailurePathTrial(demo) {
  const emptyPath = await expectApiFailure("/api/preflight/run", { path: "", goal: "empty path simulation" }, "PATH_EMPTY");
  const filePath = await expectApiFailure("/api/preflight/run", { path: path.join(demoPath, "package.json"), goal: "file path simulation" }, "PATH_IS_FILE");

  const noCommandRepo = path.join(stateDir, "no-command-repo");
  await fs.mkdir(noCommandRepo, { recursive: true });
  await fs.writeFile(path.join(noCommandRepo, "README.md"), "# No command fixture\n\nThis fixture intentionally has no runnable scripts.\n", "utf8");
  const noCommandPreflight = await request("/api/preflight/run", {
    path: noCommandRepo,
    goal: "inspect a project with no runnable verification commands"
  });

  const unconfirmedApply = await request("/api/tasks/apply-patch", { taskId: demo.taskId });
  const unconfirmedVerify = demo.verifyCommand
    ? await request("/api/tools/call", {
      tool: "run_command",
      args: { command: demo.verifyCommand },
      rootPath: demo.rootPath,
      taskId: demo.taskId
    })
    : { blocked: false, message: "No demo verification command detected." };
  const latest = await request(`/api/tasks/latest?rootPath=${encodeURIComponent(demo.rootPath)}`);

  return {
    emptyPath,
    filePath,
    noCommandProject: {
      repo: noCommandPreflight.profile.name,
      commands: noCommandPreflight.profile.commands.length,
      blockers: noCommandPreflight.report.nextGate.blockers.length,
      warnings: noCommandPreflight.report.nextGate.warnings.length,
      contextFiles: noCommandPreflight.report.contextFiles.length
    },
    unconfirmedApply: {
      blocked: Boolean(unconfirmedApply.blocked),
      message: unconfirmedApply.message || "",
      appliedPatchesAfter: latest.task?.appliedPatches?.filter((item) => !item.revertedAt).length || 0
    },
    unconfirmedVerify: {
      blocked: Boolean(unconfirmedVerify.blocked),
      message: unconfirmedVerify.message || "",
      approved: false
    }
  };
}

function findingsFor({ ui, demo, real, failurePaths }) {
  const findings = [];
  if (!ui.i18nPresent) findings.push("Language switching and base i18n dictionaries are missing.");
  if (!ui.quickStartVisible) findings.push("Quick Start is not obvious enough for a first-time user.");
  if (!ui.trustStripVisible) findings.push("The first screen does not clearly summarize local-only, read-only-first, and confirmation-before-write safety promises.");
  if (!ui.pathInputTipsVisible) findings.push("Real-project path input tips or example controls are missing from the first screen.");
  if (!ui.pathModeVisible) findings.push("Demo vs real-project path mode is not explicitly visible.");
  if (!ui.readOnlyPreflightCopy) findings.push("Read-only safety copy is not visible enough before project selection.");
  if (!ui.applyReviewPresent) findings.push("Apply review panel is missing before the patch write confirmation.");
  if (!ui.humanObservationTemplatePresent) findings.push("Human trial observation checklist is missing from docs.");
  if (demo.blockers > 0) findings.push("Demo preflight reports blockers, so the first-run path is not ready.");
  if (!demo.patchProposalFiles.length) findings.push("Demo does not reach a visible patch proposal.");
  if (demo.writeAttempted) findings.push("Demo simulation attempted a write before approval.");
  if (!demo.demoRestored) findings.push("Demo files changed during the no-apply simulation.");
  if (real.blockers > 0) findings.push("Real-project read-only preflight reports blockers.");
  if (real.writeAttempted) findings.push("Real-project read-only preflight attempted a write or command.");
  if (failurePaths.emptyPath.code !== "PATH_EMPTY") findings.push("Empty path did not return the expected friendly path error.");
  if (failurePaths.filePath.code !== "PATH_IS_FILE") findings.push("File path did not return the expected folder-required error.");
  if (failurePaths.noCommandProject.commands !== 0) findings.push("No-command fixture unexpectedly exposes runnable verification commands.");
  if (!failurePaths.unconfirmedApply.blocked || failurePaths.unconfirmedApply.appliedPatchesAfter > 0) findings.push("Unconfirmed Apply was not safely blocked.");
  if (!failurePaths.unconfirmedVerify.blocked) findings.push("Unconfirmed Verify command was not safely blocked.");
  if (!findings.length) {
    findings.push("No launch, Demo, or read-only preflight blocker found in the simulated first trial.");
    findings.push("Main residual risk: without a live human, path-entry confusion and button-label hesitation still need observation.");
  }
  return findings;
}

function frictionAuditFor({ ui, demo, real, failurePaths }) {
  return [
    {
      area: "startup",
      status: ui.trustStripVisible && ui.quickStartVisible ? "pass" : "watch",
      observe: "Can a tester launch, see service status, and identify the first action without host help?"
    },
    {
      area: "language",
      status: ui.i18nPresent ? "pass" : "fail",
      observe: "Can non-Chinese testers switch language before the workflow begins?"
    },
    {
      area: "demo-vs-real",
      status: ui.pathModeVisible && ui.demoVisible ? "pass" : "watch",
      observe: "Can the tester tell whether they are using Demo, an example path, or a real project?"
    },
    {
      area: "path-recovery",
      status: failurePaths.emptyPath.ok && failurePaths.filePath.ok ? "pass" : "fail",
      observe: "Can the tester recover after empty path or file path mistakes?"
    },
    {
      area: "read-only-preflight",
      status: real.writeAttempted || real.blockers > 0 ? "watch" : "pass",
      observe: "Does the tester understand preflight read files but does not write or run project commands?"
    },
    {
      area: "apply-boundary",
      status: ui.applyReviewPresent && failurePaths.unconfirmedApply.blocked ? "pass" : "fail",
      observe: "Does Apply clearly feel like the write boundary?"
    },
    {
      area: "verify-boundary",
      status: failurePaths.unconfirmedVerify.blocked ? "pass" : "fail",
      observe: "Does Verify clearly communicate that a project command may run?"
    },
    {
      area: "host-observation",
      status: ui.humanObservationTemplatePresent ? "pass" : "watch",
      observe: "Use docs/HUMAN_TRIAL_OBSERVATION.md during the first hosted trial."
    }
  ];
}

function renderMarkdown(report) {
  return [
    "# Simulated First Trial Report",
    "",
    `Created at: ${report.createdAt}`,
    `App root: ${report.appRoot}`,
    `Real repo: ${report.realRepo}`,
    "",
    "## Result",
    "",
    `- Overall: ${report.ok ? "Pass" : "Fail"}`,
    `- UI i18n present: ${yes(report.ui.i18nPresent)}`,
    `- UI Quick Start visible: ${yes(report.ui.quickStartVisible)}`,
    `- UI safety strip visible: ${yes(report.ui.trustStripVisible)}`,
    `- UI path tips visible: ${yes(report.ui.pathInputTipsVisible)}`,
    `- UI path mode visible: ${yes(report.ui.pathModeVisible)}`,
    `- UI read-only copy visible: ${yes(report.ui.readOnlyPreflightCopy)}`,
    `- UI apply review visible: ${yes(report.ui.applyReviewPresent)}`,
    `- Human observation checklist present: ${yes(report.ui.humanObservationTemplatePresent)}`,
    `- Demo blockers: ${report.demo.blockers}`,
    `- Demo warnings: ${report.demo.warnings}`,
    `- Demo context files: ${report.demo.contextFiles}`,
    `- Demo patch proposal files: ${report.demo.patchProposalFiles.join(", ") || "None"}`,
    `- Demo write attempted: ${yes(report.demo.writeAttempted)}`,
    `- Real preflight blockers: ${report.realReadOnlyPreflight.blockers}`,
    `- Real preflight warnings: ${report.realReadOnlyPreflight.warnings}`,
    `- Real preflight write attempted: ${yes(report.realReadOnlyPreflight.writeAttempted)}`,
    `- Empty path error code: ${report.failurePaths.emptyPath.code || "None"}`,
    `- File path error code: ${report.failurePaths.filePath.code || "None"}`,
    `- No-command fixture commands: ${report.failurePaths.noCommandProject.commands}`,
    `- Unconfirmed Apply blocked: ${yes(report.failurePaths.unconfirmedApply.blocked)}`,
    `- Unconfirmed Verify blocked: ${yes(report.failurePaths.unconfirmedVerify.blocked)}`,
    "",
    "## Real Preflight Context",
    "",
    ...report.realReadOnlyPreflight.contextFilePaths.map((file) => `- ${file}`),
    "",
    "## Simulated Tester Findings",
    "",
    ...report.simulatedTesterFindings.map((finding) => `- ${finding}`),
    "",
    "## Friction Audit",
    "",
    "| Area | Status | Observe in hosted trial |",
    "| --- | --- | --- |",
    ...report.frictionAudit.map((item) => `| ${item.area} | ${item.status} | ${item.observe} |`),
    "",
    "## Human Trial Template",
    "",
    `Use \`${report.humanObservationTemplate.path}\` during the next hosted trial.`,
    "",
    "## Next Recommendation",
    "",
    report.nextRecommendation,
    ""
  ].join("\n");
}

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

async function expectApiFailure(url, body, expectedCode) {
  try {
    await request(url, body);
  } catch (error) {
    return {
      ok: error.code === expectedCode,
      code: error.code || "",
      expectedCode,
      message: error.message,
      status: error.status || null
    };
  }
  return {
    ok: false,
    code: "",
    expectedCode,
    message: "Request unexpectedly succeeded.",
    status: null
  };
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

async function ensureDirectory(directoryPath) {
  const stat = await fs.stat(directoryPath);
  if (!stat.isDirectory()) throw new Error(`Trial repo is not a directory: ${directoryPath}`);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function proposalFiles(proposal) {
  if (Array.isArray(proposal?.files)) return proposal.files;
  if (proposal?.path) return [proposal];
  return [];
}

function parseArgs(rawArgs) {
  const parsed = { appRoot: "", realRepo: "", outDir: "" };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--app-root") {
      parsed.appRoot = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "--real-repo") {
      parsed.realRepo = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "--out-dir") {
      parsed.outDir = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
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

function yes(value) {
  return value ? "Yes" : "No";
}
