import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const args = parseArgs(process.argv.slice(2));
const testerId = sanitizeTesterId(args.tester || "tester-2");
const reportsPath = path.resolve(rootPath, args.reports || "dist");
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_FIRST_LIVE_STANDBY.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_FIRST_LIVE_STANDBY.md"));

const report = await buildReport();

await fs.mkdir(path.dirname(jsonPath), { recursive: true });
await fs.mkdir(path.dirname(markdownPath), { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  testerId: report.testerId,
  readyToHost: report.readyToHost,
  nextCommand: report.nextCommand,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  jsonPath,
  markdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function buildReport() {
  const reports = {
    intake: await readReport("TRIAL_TESTER_INTAKE_REPORT.json"),
    intakeSession: await readReport("TRIAL_INTAKE_SESSION_REPORT.json"),
    hostReady: await readReport("TRIAL_HOST_READY_REPORT.json"),
    hostRun: await readReport("TRIAL_HOST_RUN_REPORT.json"),
    preLive: await readReport("TRIAL_PRE_LIVE_REPORT.json"),
    liveCapture: await readReport("TRIAL_LIVE_CAPTURE_REPORT.json"),
    testerLaunchPlan: await readReport("TRIAL_TESTER_LAUNCH_PLAN.json"),
    status: await readReport("TRIAL_STATUS_REPORT.json")
  };
  const blockers = [];
  const warnings = [];

  if (!testerId) blockers.push("No tester id was selected.");
  if (isDryRunTesterId(testerId)) blockers.push(`${testerId}: dry-run tester ids cannot be used for a real first-live session.`);
  if (!reports.intake.exists || reports.intake.data?.decision === "WAITING_FOR_TESTER_INTAKE") {
    warnings.push("Tester intake is waiting for a local anonymous roster entry.");
    const state = {
      ok: blockers.length === 0,
      readyToHost: false,
      decision: blockers.length ? "FIRST_LIVE_STANDBY_BLOCKED" : "FIRST_LIVE_STANDBY_WAITING_FOR_TESTER",
      nextCommand: blockers.length ? `npm.cmd run trial:first-live-standby -- --tester ${testerId}` : "npm.cmd run trial:intake"
    };
    return {
      ok: state.ok,
      mode: "trial-first-live-standby",
      createdAt: new Date().toISOString(),
      decision: state.decision,
      readyToHost: state.readyToHost,
      testerId,
      reportsPath,
      reportsRelativePath: relative(reportsPath),
      sessionFolder: "",
      sessionRelativePath: "",
      reports: reportRefs(reports),
      sessionFiles: [],
      blockers: unique(blockers),
      warnings: unique(warnings),
      nextCommand: state.nextCommand,
      hostSummary: hostSummary(state.decision),
      standbyChecklist: standbyChecklist(state.decision),
      refreshCommands: refreshCommands(testerId),
      nextSteps: nextSteps(state.decision)
    };
  }

  inspectReport({ key: "intake", report: reports.intake, readyDecisions: ["READY_FOR_SESSION", "READY_FOR_SESSION_WITH_REVIEW"], blockers, warnings });
  inspectReport({ key: "intake-session", report: reports.intakeSession, readyDecisions: ["INTAKE_SESSION_READY", "INTAKE_SESSION_READY_WITH_REVIEW"], blockers, warnings });
  inspectReport({ key: "host-ready", report: reports.hostReady, readyDecisions: ["READY_TO_HOST"], blockers, warnings });
  inspectReport({ key: "host-run", report: reports.hostRun, readyDecisions: ["HOST_RUN_READY", "HOST_RUN_READY_WITH_REVIEW"], blockers, warnings });
  inspectReport({ key: "pre-live", report: reports.preLive, readyDecisions: ["PRE_LIVE_READY_TO_HOST", "PRE_LIVE_READY_WITH_HOST_REVIEW"], blockers, warnings });
  inspectReport({ key: "live-capture", report: reports.liveCapture, readyDecisions: ["LIVE_CAPTURE_READY", "LIVE_CAPTURE_READY_WITH_REVIEW"], blockers, warnings });

  inspectTesterAlignment(reports, blockers);
  inspectIntakeScope(reports.intake.data, warnings, blockers);
  inspectLaunchPlan(reports.testerLaunchPlan, blockers, warnings);

  const sessionFolder = resolveSessionFolder(reports);
  const sessionFindings = await inspectSessionFolder(sessionFolder);
  blockers.push(...sessionFindings.blockers);
  warnings.push(...sessionFindings.warnings);

  const state = decideState({ reports, blockers, warnings, sessionFolder });
  return {
    ok: state.ok,
    mode: "trial-first-live-standby",
    createdAt: new Date().toISOString(),
    decision: state.decision,
    readyToHost: state.readyToHost,
    testerId,
    reportsPath,
    reportsRelativePath: relative(reportsPath),
    sessionFolder,
    sessionRelativePath: sessionFolder ? relative(sessionFolder) : "",
    reports: reportRefs(reports),
    sessionFiles: sessionFindings.files,
    blockers: unique(blockers),
    warnings: unique(warnings),
    nextCommand: state.nextCommand,
    hostSummary: hostSummary(state.decision),
    standbyChecklist: standbyChecklist(state.decision),
    refreshCommands: refreshCommands(testerId),
    nextSteps: nextSteps(state.decision)
  };
}

function inspectReport({ key, report, readyDecisions, blockers, warnings }) {
  if (!report.exists) {
    warnings.push(`${key} report is missing.`);
    return;
  }
  if (report.data?.ok === false) blockers.push(`${key} report is not ok.`);
  const decision = report.data?.decision || "MISSING";
  if (!readyDecisions.includes(decision)) warnings.push(`${key} decision is ${decision}; refresh the first-live flow before hosting.`);
  if (/WITH_REVIEW$/.test(decision) || decision === "READY_FOR_SESSION_WITH_REVIEW" || decision === "INTAKE_SESSION_READY_WITH_REVIEW") {
    warnings.push(`${key} is ready with review; host must explicitly accept warnings before the call.`);
  }
  for (const item of normalizeList(report.data?.blockers)) blockers.push(`${key}: ${item}`);
  for (const item of normalizeList(report.data?.warnings)) warnings.push(`${key}: ${item}`);
}

function inspectTesterAlignment(reports, blockers) {
  for (const [key, report] of Object.entries(reports)) {
    const reportTesterId = sanitizeTesterId(report.data?.testerId || "");
    if (reportTesterId && reportTesterId !== testerId) blockers.push(`${key} tester ${reportTesterId} does not match ${testerId}.`);
  }
  const manifestTesterId = sanitizeTesterId(reports.intakeSession.data?.sessionManifest?.testerId || "");
  if (manifestTesterId && manifestTesterId !== testerId) blockers.push(`session manifest tester ${manifestTesterId} does not match ${testerId}.`);
}

function inspectIntakeScope(intake, warnings, blockers) {
  const testers = Array.isArray(intake?.testers) ? intake.testers : [];
  const tester = testers.find((item) => sanitizeTesterId(item.id || item.testerId || "") === testerId) || intake?.nextTester || null;
  if (!tester) {
    warnings.push(`${testerId}: tester is not present in the intake report.`);
    return;
  }
  if (tester.blocked) blockers.push(`${testerId}: tester intake is blocked.`);
  if (tester.ready === false) blockers.push(`${testerId}: tester is not marked ready.`);
  if (tester.consent === false) blockers.push(`${testerId}: consent is not recorded.`);
  if (tester.privacyAccepted === false) blockers.push(`${testerId}: privacy acceptance is not recorded.`);
  const scope = Array.isArray(tester.allowedScope) ? tester.allowedScope : [];
  if (!scope.includes("demo")) blockers.push(`${testerId}: allowedScope must include demo.`);
  if (!scope.includes("real-read-only")) warnings.push(`${testerId}: allowedScope should include real-read-only for first-live standby.`);
  if (scope.includes("real-apply")) warnings.push(`${testerId}: real-apply is not part of the first-live scope; stop before Apply on a real project.`);
}

function inspectLaunchPlan(report, blockers, warnings) {
  if (!report.exists) {
    warnings.push("tester-launch-plan report is missing; refresh first-live standby.");
    return;
  }
  if (report.data?.ok === false) blockers.push("tester-launch-plan report is not ok.");
  if (sanitizeTesterId(report.data?.testerId || "") !== testerId) blockers.push(`tester-launch-plan target ${report.data?.testerId || "UNKNOWN"} does not match ${testerId}.`);
  if (report.data?.firstLive !== true) warnings.push("tester-launch-plan was not generated in first-live mode.");
  if (report.data?.decision !== "TESTER_LAUNCH_READY_TO_HOST") {
    warnings.push(`tester-launch-plan decision is ${report.data?.decision || "MISSING"}; rerun first-live launch plan before hosting.`);
  }
}

async function inspectSessionFolder(sessionFolder) {
  const blockers = [];
  const warnings = [];
  const files = [];
  if (!sessionFolder) {
    blockers.push("Session folder could not be resolved.");
    return { blockers, warnings, files };
  }
  if (!(await exists(sessionFolder))) {
    blockers.push(`Session folder does not exist: ${relative(sessionFolder)}.`);
    return { blockers, warnings, files };
  }

  const requiredFiles = [
    "BEGINNER_FIRST_LIVE_GUIDE.md",
    "SESSION_BRIEF.md",
    "HOST_RUNBOOK.md",
    "LIVE_SESSION_CAPTURE.md",
    "LIVE_SESSION_HOST_SUMMARY.md",
    "HUMAN_TRIAL_OBSERVATION.md",
    "TRIAL_FEEDBACK_TEMPLATE.md",
    "TRIAL_RESULT_RECORD.md",
    "SESSION_PACK_MANIFEST.json"
  ];
  for (const file of requiredFiles) {
    const filePath = path.join(sessionFolder, file);
    const present = await exists(filePath);
    files.push({ file, present });
    if (!present) blockers.push(`Session folder is missing ${file}.`);
  }

  const manifest = await readJson(path.join(sessionFolder, "SESSION_PACK_MANIFEST.json"));
  if (manifest?.testerId && sanitizeTesterId(manifest.testerId) !== testerId) blockers.push(`SESSION_PACK_MANIFEST.json tester ${manifest.testerId} does not match ${testerId}.`);
  if (manifest?.testerIntake) {
    if (manifest.testerIntake.consent !== true) blockers.push("Session manifest does not record tester consent.");
    if (manifest.testerIntake.privacyAccepted !== true) blockers.push("Session manifest does not record privacy acceptance.");
    const scope = Array.isArray(manifest.testerIntake.allowedScope) ? manifest.testerIntake.allowedScope : [];
    if (!scope.includes("demo")) blockers.push("Session manifest scope is missing demo.");
    if (!scope.includes("real-read-only")) warnings.push("Session manifest scope is missing real-read-only.");
    if (scope.includes("real-apply")) warnings.push("Session manifest includes real-apply; first-live must stop before Apply on a real project.");
  }

  const runbook = await readText(path.join(sessionFolder, "HOST_RUNBOOK.md"));
  const capture = await readText(path.join(sessionFolder, "LIVE_SESSION_CAPTURE.md"));
  if (runbook && !/stop before apply/i.test(runbook)) warnings.push("HOST_RUNBOOK.md does not clearly say to stop before Apply.");
  if (capture && !/stop before apply/i.test(capture)) warnings.push("LIVE_SESSION_CAPTURE.md does not clearly say to stop before Apply.");

  const hygiene = await inspectSessionHygiene(sessionFolder);
  blockers.push(...hygiene.blockers);
  warnings.push(...hygiene.warnings);
  return { blockers: unique(blockers), warnings: unique(warnings), files };
}

async function inspectSessionHygiene(sessionFolder) {
  const blockers = [];
  const warnings = [];
  const entries = await collectFiles(sessionFolder);
  for (const filePath of entries) {
    const base = path.basename(filePath);
    const location = relative(filePath);
    if (/\.(png|jpg|jpeg|gif|webp|bmp|tiff|log|zip|7z|rar|tar|gz|mp4|mov|avi)$/i.test(base)) blockers.push(`Remove raw capture or archive file before standby: ${location}.`);
    if (base === ".env" || base.startsWith(".env.") || /\.(pem|key|crt)$/i.test(base)) blockers.push(`Remove secret-like file before standby: ${location}.`);
    if (/\.(js|jsx|ts|tsx|py|java|go|rs|cs|cpp|c|h|hpp|php|rb|swift|kt|mjs|cjs)$/i.test(base)) blockers.push(`Remove source-like file before standby: ${location}.`);
    if (base.toLowerCase().endsWith(".md")) {
      const text = await readText(filePath);
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const lineLocation = `${location}:${index + 1}`;
        if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(line)) blockers.push(`Personal email found at ${lineLocation}.`);
        if (/(?:\+?\d[\s().-]*){10,}/.test(line) && /\d{3}/.test(line)) blockers.push(`Possible phone number found at ${lineLocation}.`);
        if (/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b|\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/.test(line)) blockers.push(`Possible secret token found at ${lineLocation}.`);
        if (/(?:[A-Za-z]:\\Users\\[^\\\s]+\\|\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/)/.test(line)) warnings.push(`Personal path found at ${lineLocation}; keep it local and redact before sharing.`);
      }
    }
  }
  return { blockers: unique(blockers), warnings: unique(warnings) };
}

function decideState({ reports, blockers, warnings }) {
  if (blockers.length) {
    return {
      ok: false,
      readyToHost: false,
      decision: "FIRST_LIVE_STANDBY_BLOCKED",
      nextCommand: `npm.cmd run trial:first-live-standby -- --tester ${testerId}`
    };
  }
  const intakeDecision = reports.intake.data?.decision || "";
  const launchDecision = reports.testerLaunchPlan.data?.decision || "";
  if (!reports.intake.exists || intakeDecision === "WAITING_FOR_TESTER_INTAKE") {
    return {
      ok: true,
      readyToHost: false,
      decision: "FIRST_LIVE_STANDBY_WAITING_FOR_TESTER",
      nextCommand: "npm.cmd run trial:intake"
    };
  }
  if (!reports.testerLaunchPlan.exists || reports.testerLaunchPlan.data?.firstLive !== true || launchDecision !== "TESTER_LAUNCH_READY_TO_HOST") {
    return {
      ok: true,
      readyToHost: false,
      decision: "FIRST_LIVE_STANDBY_NEEDS_REFRESH",
      nextCommand: `npm.cmd run trial:tester-launch-plan -- --tester ${testerId} --first-live`
    };
  }
  if (warnings.length) {
    return {
      ok: true,
      readyToHost: true,
      decision: "FIRST_LIVE_STANDBY_READY_WITH_REVIEW",
      nextCommand: "Open BEGINNER_FIRST_LIVE_GUIDE.md, LIVE_SESSION_CAPTURE.md, and HOST_RUNBOOK.md"
    };
  }
  return {
    ok: true,
    readyToHost: true,
    decision: "FIRST_LIVE_STANDBY_READY",
    nextCommand: "Open BEGINNER_FIRST_LIVE_GUIDE.md, LIVE_SESSION_CAPTURE.md, and HOST_RUNBOOK.md"
  };
}

function resolveSessionFolder(reports) {
  if (args.session) return path.resolve(rootPath, args.session);
  for (const report of [reports.liveCapture, reports.preLive, reports.hostRun, reports.hostReady, reports.intakeSession]) {
    if (report.data?.sessionFolder) return path.resolve(rootPath, report.data.sessionFolder);
    if (report.data?.sessionRelativePath) return path.resolve(rootPath, report.data.sessionRelativePath);
  }
  return path.join(rootPath, "dist", "trial-session-packs", testerId);
}

async function collectFiles(folder) {
  const files = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(filePath);
      } else if (entry.isFile()) {
        files.push(filePath);
      }
    }
  }
  await walk(folder);
  return files.sort((a, b) => a.localeCompare(b));
}

function hostSummary(decision) {
  if (decision === "FIRST_LIVE_STANDBY_READY") return "Ready to host the first real tester. Keep scope to Demo plus real read-only preflight.";
  if (decision === "FIRST_LIVE_STANDBY_READY_WITH_REVIEW") return "Ready to host after the host explicitly accepts warnings. Keep scope to Demo plus real read-only preflight.";
  if (decision === "FIRST_LIVE_STANDBY_WAITING_FOR_TESTER") return "Waiting for an anonymous real tester intake entry.";
  if (decision === "FIRST_LIVE_STANDBY_NEEDS_REFRESH") return "Refresh the first-live launch plan before hosting.";
  return "Blocked. Do not host until blockers are fixed.";
}

function standbyChecklist(decision) {
  if (decision === "FIRST_LIVE_STANDBY_BLOCKED") {
    return [
      "Do not host the tester yet.",
      "Fix every blocker in this report.",
      "Rerun the refresh commands, then rerun trial:first-live-standby."
    ];
  }
  if (decision === "FIRST_LIVE_STANDBY_WAITING_FOR_TESTER") {
    return [
      "Find a real human tester.",
      "Fill only anonymous tester intake locally.",
      "Rerun trial:intake and this standby check."
    ];
  }
  if (decision === "FIRST_LIVE_STANDBY_NEEDS_REFRESH") {
    return [
      "Rerun the first-live launch plan.",
      "Rerun trial:first-live-standby.",
      "Host only after standby says ready."
    ];
  }
  return [
    `Confirm the tester id is ${testerId}.`,
    "Open BEGINNER_FIRST_LIVE_GUIDE.md, HOST_RUNBOOK.md, and LIVE_SESSION_CAPTURE.md.",
    "Reconfirm the real human's consent before starting.",
    "Start with Demo.",
    "Run only one real-project read-only preflight.",
    "Stop before Apply on every real project.",
    "After the call, run trial:record-draft, fill only confirmed records, then run trial:after-live."
  ];
}

function refreshCommands(selectedTesterId) {
  return [
    "npm.cmd run trial:intake",
    `npm.cmd run trial:intake-session -- --tester ${selectedTesterId} --force`,
    `npm.cmd run trial:host-ready -- --tester ${selectedTesterId}`,
    `npm.cmd run trial:host-run -- --tester ${selectedTesterId}`,
    `npm.cmd run trial:pre-live -- --tester ${selectedTesterId}`,
    `npm.cmd run trial:live-capture -- --tester ${selectedTesterId}`,
    `npm.cmd run trial:tester-launch-plan -- --tester ${selectedTesterId} --first-live`,
    `npm.cmd run trial:first-live-standby -- --tester ${selectedTesterId}`
  ];
}

function nextSteps(decision) {
  if (decision === "FIRST_LIVE_STANDBY_READY" || decision === "FIRST_LIVE_STANDBY_READY_WITH_REVIEW") {
    return [
      "Host the first real tester only when the human tester is available.",
      "Keep the session limited to Demo and real-read-only.",
      "After the call, capture explicit notes, run trial:record-draft, confirm missing answers with the human, then run trial:after-live."
    ];
  }
  if (decision === "FIRST_LIVE_STANDBY_WAITING_FOR_TESTER") {
    return [
      "Wait until a real human tester is available.",
      "Fill the local anonymous roster.",
      "Rerun trial:first-live-standby."
    ];
  }
  if (decision === "FIRST_LIVE_STANDBY_NEEDS_REFRESH") {
    return [
      "Run the next command shown in this report.",
      "Rerun trial:first-live-standby.",
      "Do not host until the decision is ready."
    ];
  }
  return [
    "Fix blockers.",
    "Rerun the relevant host gate command.",
    "Rerun trial:first-live-standby."
  ];
}

function reportRefs(reports) {
  const output = {};
  for (const [key, report] of Object.entries(reports)) {
    output[key] = {
      exists: report.exists,
      ok: report.data?.ok ?? null,
      decision: report.data?.decision || "MISSING",
      testerId: report.data?.testerId || "",
      createdAt: report.data?.createdAt || "",
      relativePath: report.relativePath
    };
  }
  return output;
}

function renderMarkdown(report) {
  return [
    "# CodeClaw First-Live Standby",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Tester: ${report.testerId}`,
    `Ready to host: ${report.readyToHost ? "Yes" : "No"}`,
    `Session folder: ${report.sessionRelativePath || "None"}`,
    `Next command: ${report.nextCommand}`,
    "",
    "## Host Summary",
    "",
    `- ${report.hostSummary}`,
    "",
    "## Standby Checklist",
    "",
    ...report.standbyChecklist.map((item) => `- ${item}`),
    "",
    "## Reports",
    "",
    "| Report | Exists | Decision | Tester |",
    "| --- | --- | --- | --- |",
    ...Object.entries(report.reports).map(([key, item]) => `| ${key} | ${item.exists ? "Yes" : "No"} | ${item.decision} | ${item.testerId || "n/a"} |`),
    "",
    "## Session Files",
    "",
    "| File | Present |",
    "| --- | --- |",
    ...report.sessionFiles.map((item) => `| ${item.file} | ${item.present ? "Yes" : "No"} |`),
    "",
    "## Blockers",
    "",
    ...(report.blockers.length ? report.blockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Refresh Commands",
    "",
    "```bash",
    ...report.refreshCommands,
    "```",
    "",
    "## Next Steps",
    "",
    ...report.nextSteps.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function parseArgs(rawArgs) {
  const parsed = { tester: "", reports: "", session: "", json: "", markdown: "" };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    let handled = false;
    for (const key of ["tester", "reports", "session", "json", "markdown"]) {
      if (arg === `--${key}`) {
        parsed[key] = rawArgs[index + 1] || "";
        index += 1;
        handled = true;
        break;
      }
      if (arg.startsWith(`--${key}=`)) {
        parsed[key] = arg.slice(key.length + 3);
        handled = true;
        break;
      }
    }
    if (handled) continue;
    if (!parsed.tester && !arg.startsWith("--")) {
      parsed.tester = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

async function readReport(fileName) {
  const filePath = path.join(reportsPath, fileName);
  const data = await readJson(filePath);
  return {
    exists: Boolean(data),
    relativePath: relative(filePath),
    data
  };
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return item;
    return item.message || item.reason || item.title || JSON.stringify(item);
  }).filter(Boolean);
}

function isDryRunTesterId(value) {
  return /dry[-_.]?run/i.test(String(value || ""));
}

function sanitizeTesterId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function relative(targetPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
