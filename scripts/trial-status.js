import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const args = parseArgs(process.argv.slice(2));
const distPath = path.resolve(rootPath, args.dist || "dist");
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_STATUS_REPORT.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_STATUS_REPORT.md"));

const report = await buildReport();

await fs.mkdir(path.dirname(jsonPath), { recursive: true });
await fs.mkdir(path.dirname(markdownPath), { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  currentStage: report.currentStage,
  nextCommand: report.nextCommand,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  jsonPath,
  markdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function buildReport() {
  const reports = {
    readiness: await readReport("TRIAL_READINESS_REPORT.json"),
    freeze: await readReport("TRIAL_FREEZE_REPORT.json"),
    dispatch: await readReport("TRIAL_DISPATCH_NOTE.json"),
    hostReady: await readReport("TRIAL_HOST_READY_REPORT.json"),
    hostRun: await readReport("TRIAL_HOST_RUN_REPORT.json"),
    completion: await readReport("TRIAL_SESSION_COMPLETION_REPORT.json"),
    privacy: await readReport("TRIAL_PRIVACY_REPORT.json"),
    feedback: await readReport("TRIAL_FEEDBACK_SUMMARY.json"),
    backlog: await readReport("TRIAL_FIX_BACKLOG.json"),
    postSession: await readReport("TRIAL_POST_SESSION_REPORT.json"),
    cohort: await readReport("TRIAL_COHORT_SUMMARY.json"),
    archive: await readReport("TRIAL_ARCHIVE_REPORT.json"),
    intake: await readReport("TRIAL_TESTER_INTAKE_REPORT.json")
  };
  const artifacts = await collectArtifacts();
  const blockers = collectBlockers(reports);
  const warnings = collectWarnings(reports, artifacts);
  const state = decideState(reports, blockers);

  return {
    ok: blockers.length === 0,
    mode: "trial-status",
    createdAt: new Date().toISOString(),
    distPath,
    distRelativePath: relative(distPath),
    decision: state.decision,
    currentStage: state.currentStage,
    nextCommand: state.nextCommand,
    nextAction: state.nextAction,
    blockers,
    warnings,
    reports: publicReports(reports),
    artifacts,
    quickLinks: quickLinks(reports, artifacts),
    commandGuide: commandGuide(state, reports),
    nextSteps: nextSteps(state)
  };
}

async function readReport(fileName) {
  const filePath = path.join(distPath, fileName);
  const data = await readJson(filePath);
  return {
    key: fileName.replace(/\.json$/i, ""),
    fileName,
    path: filePath,
    relativePath: relative(filePath),
    exists: Boolean(data),
    ok: data?.ok ?? null,
    mode: data?.mode || "",
    decision: data?.decision || "MISSING",
    createdAt: data?.createdAt || "",
    blockers: normalizeList(data?.blockers),
    warnings: normalizeList(data?.warnings),
    data
  };
}

async function collectArtifacts() {
  return {
    latestPackage: await latestDirectory(/^CodeClaw-local-trial-\d{8}$/),
    latestSessionPack: await latestNestedDirectory(path.join(distPath, "trial-session-packs")),
    latestArchive: await latestNestedDirectory(path.join(distPath, "trial-archives"))
  };
}

function decideState(reports, blockers) {
  if (!reports.readiness.exists) {
    return state("NEEDS_READINESS", "preflight", "npm.cmd run trial:ready", "Run source and package readiness checks.");
  }
  if (reports.readiness.ok === false) {
    return state("READINESS_BLOCKED", "preflight", "npm.cmd run trial:ready", "Fix readiness failures before packaging.");
  }
  if (!reports.freeze.exists) {
    return state("NEEDS_FREEZE", "package", "npm.cmd run trial:simulate && npm.cmd run trial:freeze", "Freeze a hosted-trial candidate.");
  }
  if (reports.freeze.decision !== "GO_HOSTED_TRIAL") {
    return state("FREEZE_BLOCKED", "package", "npm.cmd run trial:simulate && npm.cmd run trial:freeze", "Fix freeze blockers before sharing.");
  }
  if (!reports.dispatch.exists) {
    return state("NEEDS_DISPATCH", "package", "npm.cmd run trial:dispatch", "Generate the tester dispatch note.");
  }
  if (reports.dispatch.decision !== "READY_TO_SEND") {
    return state("DISPATCH_BLOCKED", "package", "npm.cmd run trial:dispatch", "Fix dispatch blockers before sending.");
  }
  if (!reports.hostReady.exists) {
    return state("NEEDS_HOST_READY", "hosting", "npm.cmd run trial:session-pack -- --force; npm.cmd run trial:host-ready", "Generate and verify the session pack.");
  }
  if (reports.hostReady.decision === "HOLD") {
    return state("HOST_READY_BLOCKED", "hosting", "npm.cmd run trial:host-ready", "Fix host-ready blockers before hosting.");
  }
  if (reports.privacy.decision === "PRIVACY_HOLD") {
    return state("PRIVACY_HOLD", "post-session", "npm.cmd run trial:privacy-check -- <session-folder>", "Redact completed records before ingesting or archiving.");
  }
  if (!reports.postSession.exists && !reports.hostRun.exists) {
    return state("NEEDS_HOST_RUN", "hosting", "npm.cmd run trial:host-run", "Generate the live host runbook before the session.");
  }
  if (!reports.postSession.exists && reports.hostRun.decision === "HOST_RUN_HOLD") {
    return state("HOST_RUN_BLOCKED", "hosting", "npm.cmd run trial:host-run", "Fix host-run blockers before hosting.");
  }
  if (!reports.postSession.exists && reports.completion.exists && reports.completion.decision === "SESSION_COMPLETION_HOLD") {
    return state("SESSION_COMPLETION_BLOCKED", "post-session", "npm.cmd run trial:complete-session -- --session <session-folder>", "Finish or redact completed session records before post-session.");
  }
  if (!reports.postSession.exists && reports.completion.exists && reports.completion.decision.startsWith("SESSION_COMPLETION_READY")) {
    return state("READY_FOR_POST_SESSION", "post-session", "npm.cmd run trial:post-session -- --session <session-folder> --next-tester <tester-id>", "Run the post-session pipeline for the completed records.");
  }
  if (!reports.postSession.exists) {
    return state("READY_TO_HOST", "hosting", "npm.cmd run trial:complete-session -- --session <session-folder>", "Host the session, fill records, then run completion check.");
  }
  if (reports.postSession.decision !== "READY_FOR_NEXT_TESTER") {
    return state("POST_SESSION_REVIEW", "post-session", "npm.cmd run trial:post-session -- --session <session-folder> --next-tester <tester-id>", "Resolve post-session blockers or review items.");
  }
  if (!reports.archive.exists) {
    return state("NEEDS_ARCHIVE", "archive", "npm.cmd run trial:archive-session -- --session <session-folder> --tester <tester-id>", "Archive the privacy-passed session evidence locally.");
  }
  if (reports.archive.decision === "ARCHIVE_HOLD") {
    return state("ARCHIVE_BLOCKED", "archive", "npm.cmd run trial:archive-session -- --session <session-folder> --tester <tester-id>", "Fix archive blockers before closing the session.");
  }
  if (!reports.intake.exists) {
    return state("NEEDS_TESTER_INTAKE", "intake", "npm.cmd run trial:intake -- --init", "Create and fill the local tester intake roster before generating the next session pack.");
  }
  if (reports.intake.decision === "INTAKE_HOLD") {
    return state("TESTER_INTAKE_BLOCKED", "intake", "npm.cmd run trial:intake", "Fix tester consent, privacy, language, or scope blockers.");
  }
  if (reports.intake.decision === "WAITING_FOR_TESTER_INTAKE") {
    return state("NEEDS_TESTER_INTAKE", "intake", "npm.cmd run trial:intake", "Complete at least one tester intake entry before generating a session pack.");
  }
  if (!reports.cohort.exists || reports.cohort.decision === "WAITING_FOR_MORE_SESSIONS") {
    return state("READY_FOR_NEXT_TESTER", "next-session", "npm.cmd run trial:intake-session -- --force", "Generate the next tester session pack from intake.");
  }
  if (reports.cohort.decision === "HOLD_EXPANSION_FIX_FIRST" || reports.cohort.decision === "REVIEW_REPEATED_SAFETY") {
    return state("COHORT_REVIEW", "cohort", "npm.cmd run trial:cohort-summary -- <completed-trials-folder>", "Review repeated safety or expansion blockers.");
  }
  if (blockers.length) {
    return state("BLOCKED", "review", "npm.cmd run trial:status", "Review blockers in the status report.");
  }
  return state("READY_TO_EXPAND", "cohort", "npm.cmd run trial:intake-session -- --force", "Proceed with the next hosted tester batch from intake under watch items.");
}

function collectBlockers(reports) {
  const blockers = [];
  for (const [key, report] of Object.entries(reports)) {
    if (key === "hostRun" && reports.postSession.exists) continue;
    if (key === "completion" && reports.postSession.exists) continue;
    if (!report.exists) continue;
    if (report.ok === false) blockers.push(`${report.key}: report is not ok.`);
    for (const item of report.blockers) blockers.push(`${report.key}: ${item}`);
  }
  if (reports.privacy.decision === "PRIVACY_HOLD") blockers.push("Privacy is PRIVACY_HOLD.");
  return unique(blockers);
}

function collectWarnings(reports, artifacts) {
  const warnings = [];
  for (const report of Object.values(reports)) {
    if (!report.exists) warnings.push(`${report.fileName} has not been generated yet.`);
    for (const item of report.warnings) warnings.push(`${report.key}: ${item}`);
  }
  if (!artifacts.latestPackage) warnings.push("No local trial package folder was found.");
  if (!artifacts.latestSessionPack) warnings.push("No trial session pack folder was found.");
  if (!artifacts.latestArchive) warnings.push("No trial archive folder was found.");
  return unique(warnings);
}

function publicReports(reports) {
  const output = {};
  for (const [key, report] of Object.entries(reports)) {
    output[key] = {
      exists: report.exists,
      ok: report.ok,
      decision: report.decision,
      createdAt: report.createdAt,
      relativePath: report.relativePath,
      blockers: report.blockers.length,
      warnings: report.warnings.length
    };
  }
  return output;
}

function quickLinks(reports, artifacts) {
  return {
    readinessReport: reports.readiness.exists ? reports.readiness.relativePath : "",
    dispatchNote: reports.dispatch.exists ? reports.dispatch.relativePath : "",
    hostReadyReport: reports.hostReady.exists ? reports.hostReady.relativePath : "",
    hostRunReport: reports.hostRun.exists ? reports.hostRun.relativePath : "",
    completionReport: reports.completion.exists ? reports.completion.relativePath : "",
    postSessionReport: reports.postSession.exists ? reports.postSession.relativePath : "",
    cohortSummary: reports.cohort.exists ? reports.cohort.relativePath : "",
    archiveReport: reports.archive.exists ? reports.archive.relativePath : "",
    intakeReport: reports.intake.exists ? reports.intake.relativePath : "",
    latestPackage: artifacts.latestPackage?.relativePath || "",
    latestSessionPack: artifacts.latestSessionPack?.relativePath || "",
    latestArchive: artifacts.latestArchive?.relativePath || ""
  };
}

function commandGuide(current, reports) {
  return [
    { step: "Readiness", command: "npm.cmd run trial:ready", status: reports.readiness.exists ? reports.readiness.decision : "missing" },
    { step: "Freeze", command: "npm.cmd run trial:simulate && npm.cmd run trial:freeze", status: reports.freeze.exists ? reports.freeze.decision : "missing" },
    { step: "Dispatch", command: "npm.cmd run trial:dispatch", status: reports.dispatch.exists ? reports.dispatch.decision : "missing" },
    { step: "Host-ready", command: "npm.cmd run trial:session-pack -- --force; npm.cmd run trial:host-ready", status: reports.hostReady.exists ? reports.hostReady.decision : "missing" },
    { step: "Host runbook", command: "npm.cmd run trial:host-run", status: reports.hostRun.exists ? reports.hostRun.decision : "missing" },
    { step: "Session completion", command: "npm.cmd run trial:complete-session -- --session <session-folder>", status: reports.completion.exists ? reports.completion.decision : "missing" },
    { step: "Post-session", command: "npm.cmd run trial:post-session -- --session <session-folder> --next-tester <tester-id>", status: reports.postSession.exists ? reports.postSession.decision : "missing" },
    { step: "Cohort", command: "npm.cmd run trial:cohort-summary -- <completed-trials-folder>", status: reports.cohort.exists ? reports.cohort.decision : "missing" },
    { step: "Archive", command: "npm.cmd run trial:archive-session -- --session <session-folder> --tester <tester-id>", status: reports.archive.exists ? reports.archive.decision : "missing" },
    { step: "Tester intake", command: "npm.cmd run trial:intake", status: reports.intake.exists ? reports.intake.decision : "missing" },
    { step: "Intake session", command: "npm.cmd run trial:intake-session -- --force", status: "uses ready tester intake" },
    { step: "Current recommendation", command: current.nextCommand, status: current.decision }
  ];
}

function nextSteps(current) {
  return [
    current.nextAction,
    `Run: ${current.nextCommand}`,
    "Rerun npm.cmd run trial:status after the command completes."
  ];
}

function state(decision, currentStage, nextCommand, nextAction) {
  return { decision, currentStage, nextCommand, nextAction };
}

async function latestDirectory(pattern) {
  if (!(await exists(distPath))) return null;
  const entries = await fs.readdir(distPath, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
    .map((entry) => path.join(distPath, entry.name));
  return latestPath(matches);
}

async function latestNestedDirectory(parentPath) {
  if (!(await exists(parentPath))) return null;
  const entries = await fs.readdir(parentPath, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(parentPath, entry.name));
  return latestPath(matches);
}

async function latestPath(paths) {
  let latest = null;
  for (const candidate of paths) {
    const stat = await fs.stat(candidate);
    const item = {
      path: candidate,
      relativePath: relative(candidate),
      updatedAt: stat.mtime.toISOString()
    };
    if (!latest || stat.mtimeMs > latest.mtimeMs) latest = { ...item, mtimeMs: stat.mtimeMs };
  }
  if (!latest) return null;
  const { mtimeMs, ...publicItem } = latest;
  return publicItem;
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial Status",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Current stage: ${report.currentStage}`,
    `Next command: ${report.nextCommand}`,
    "",
    "## Next Action",
    "",
    `- ${report.nextAction}`,
    "",
    "## Quick Links",
    "",
    ...Object.entries(report.quickLinks).map(([key, value]) => `- ${key}: ${value || "n/a"}`),
    "",
    "## Reports",
    "",
    "| Report | Exists | Decision | Blockers | Warnings |",
    "| --- | --- | --- | ---: | ---: |",
    ...Object.entries(report.reports).map(([key, item]) => `| ${key} | ${item.exists ? "Yes" : "No"} | ${item.decision} | ${item.blockers} | ${item.warnings} |`),
    "",
    "## Blockers",
    "",
    ...(report.blockers.length ? report.blockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Command Guide",
    "",
    ...report.commandGuide.map((item) => `- ${item.step}: ${item.command} (${item.status})`),
    "",
    "## Next Steps",
    "",
    ...report.nextSteps.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function parseArgs(rawArgs) {
  const parsed = { dist: "", json: "", markdown: "" };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    let handled = false;
    for (const key of ["dist", "json", "markdown"]) {
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
    if (!parsed.dist && !arg.startsWith("--")) {
      parsed.dist = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return item;
    return item.message || item.reason || item.title || JSON.stringify(item);
  }).filter(Boolean);
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

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
