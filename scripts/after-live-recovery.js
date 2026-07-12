import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const distPath = path.join(rootPath, "dist");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const args = parseArgs(process.argv.slice(2));
const sessionPath = path.resolve(rootPath, args.session || path.join("dist", "trial-session-packs", "tester-1"));
const reportsPath = path.resolve(rootPath, args.reports || "dist");
const testerId = sanitizeTesterId(args.tester || inferTesterId(sessionPath));
const nextTester = sanitizeTesterId(args.nextTester || nextTesterId(testerId));
const runStamp = dateStamp();
const packetPath = path.resolve(rootPath, args.out || path.join("dist", "trial-after-live", `${testerId}-${runStamp}`));
const archivePath = path.resolve(rootPath, args.archiveOut || path.join("dist", "trial-archives", `${testerId}-after-live-${runStamp}`));
const archiveReportPath = path.join(reportsPath, "TRIAL_ARCHIVE_REPORT.json");
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_AFTER_LIVE_REPORT.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_AFTER_LIVE_REPORT.md"));

await assertSafeOutputPath(packetPath);

const steps = [];
const preRunArchiveSnapshot = await readJsonSnapshot(archiveReportPath);
let report;

try {
  await runGuardedStep({
    name: "session:complete",
    script: "trial:complete-session",
    args: [
      "--",
      "--session", relative(sessionPath),
      "--json", relative(path.join(reportsPath, "TRIAL_SESSION_COMPLETION_REPORT.json")),
      "--markdown", relative(path.join(reportsPath, "TRIAL_SESSION_COMPLETION_REPORT.md"))
    ],
    failMessage: "Session completion is not ready. Fill or redact the completed records before after-live recovery."
  });
  await runGuardedStep({
    name: "privacy:check",
    script: "trial:privacy-check",
    args: [
      "--",
      relative(sessionPath),
      "--json", relative(path.join(reportsPath, "TRIAL_PRIVACY_REPORT.json")),
      "--markdown", relative(path.join(reportsPath, "TRIAL_PRIVACY_REPORT.md"))
    ],
    failMessage: "Privacy check failed. Redact session records before ingest, review, archive, or sharing."
  });
  await runGuardedStep({
    name: "post:session",
    script: "trial:post-session",
    args: ["--", "--session", relative(sessionPath), "--next-tester", nextTester, "--reports", relative(reportsPath)],
    failMessage: "Post-session pipeline failed. Fix feedback ingest, backlog, or next-session blockers."
  });
  await runGuardedStep({
    name: "review:session",
    script: "trial:review-session",
    args: [
      "--",
      "--session", relative(sessionPath),
      "--reports", relative(reportsPath),
      "--tester", testerId,
      "--json", relative(path.join(reportsPath, "TRIAL_REVIEW_REPORT.json")),
      "--markdown", relative(path.join(reportsPath, "TRIAL_REVIEW_REPORT.md"))
    ],
    failMessage: "Review failed. Resolve review blockers or fix-now items before archiving."
  });
  await assertReviewReady();
  await runGuardedStep({
    name: "archive:session",
    script: "trial:archive-session",
    args: [
      "--",
      "--session", relative(sessionPath),
      "--reports", relative(reportsPath),
      "--tester", testerId,
      "--out", relative(archivePath),
      "--json", relative(archiveReportPath),
      "--markdown", relative(path.join(reportsPath, "TRIAL_ARCHIVE_REPORT.md")),
      "--force"
    ],
    failMessage: "Archive failed. Do not close the session until privacy-passed evidence can be archived locally."
  });
  await assertArchiveReady();
  const statusStep = await runNpmStep({
    name: "status:update",
    script: "trial:status",
    args: [
      "--",
      "--dist", relative(reportsPath),
      "--json", relative(path.join(reportsPath, "TRIAL_STATUS_REPORT.json")),
      "--markdown", relative(path.join(reportsPath, "TRIAL_STATUS_REPORT.md"))
    ],
    allowFailure: true
  });
  steps.push(statusStep);

  report = await buildReport({ error: "" });
} catch (error) {
  report = await buildReport({ error: error.message });
}

await fs.mkdir(path.dirname(jsonPath), { recursive: true });
await fs.mkdir(path.dirname(markdownPath), { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

if (report.ok && report.archiveStep?.succeeded) {
  const packet = await createEvidencePacket(report);
  report = { ...report, evidencePacket: packet };
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");
  await copyIfExists(jsonPath, path.join(packetPath, "reports", "TRIAL_AFTER_LIVE_REPORT.json"));
  await copyIfExists(markdownPath, path.join(packetPath, "reports", "TRIAL_AFTER_LIVE_REPORT.md"));
  await fs.writeFile(path.join(packetPath, "EVIDENCE_PACKET_MANIFEST.json"), `${JSON.stringify(report.evidencePacket, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(packetPath, "EVIDENCE_PACKET_MANIFEST.md"), renderPacketMarkdown(report, report.evidencePacket), "utf8");
  await fs.writeFile(path.join(packetPath, "SHARING_CHECKLIST.md"), renderSharingChecklist(report), "utf8");
}

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  testerId,
  nextTester,
  sessionPath,
  evidencePacket: report.evidencePacket?.packetRelativePath || "",
  steps: report.steps.map((step) => ({ name: step.name, exitCode: step.exitCode })),
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  jsonPath,
  markdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function runGuardedStep({ name, script, args, failMessage }) {
  const step = await runNpmStep({ name, script, args, allowFailure: true });
  steps.push(step);
  if (step.exitCode !== 0) {
    throw new Error(`${failMessage} ${name} exited with code ${step.exitCode}.`);
  }
  return step;
}

function runNpmStep({ name, script, args, allowFailure = false }) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const commandArgs = ["run", script, ...args];
    const commandLine = [npmCommand, ...commandArgs].map(quoteShellArg).join(" ");
    console.log(`\n==> ${name}: ${commandLine}`);
    const child = spawn(commandLine, {
      cwd: rootPath,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      const result = {
        name,
        script,
        commandLine,
        exitCode,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        summary: parseJsonOutput(stdout)
      };
      if (exitCode !== 0 && !allowFailure) {
        reject(new Error(`${name} failed with exit code ${exitCode}.`));
        return;
      }
      resolve(result);
    });
  });
}

async function assertReviewReady() {
  const review = await readJson(path.join(reportsPath, "TRIAL_REVIEW_REPORT.json"));
  const blocked = ["REVIEW_BLOCKED", "REVIEW_FIX_NOW", "REVIEW_WAITING_FOR_REPORTS"];
  if (!review) throw new Error("Review report is missing after trial:review-session.");
  if (review.ok === false || blocked.includes(review.decision)) {
    throw new Error(`Review decision is ${review.decision || "UNKNOWN"}; fix before archiving or inviting the next tester.`);
  }
}

async function assertArchiveReady() {
  const snapshot = await readJsonSnapshot(archiveReportPath);
  const archive = snapshot.data;
  if (!archive) throw new Error("Archive report is missing after trial:archive-session.");
  if (preRunArchiveSnapshot.exists && snapshot.content === preRunArchiveSnapshot.content) {
    throw new Error("Archive report was not refreshed by this after-live run; the existing report is stale.");
  }
  if (!archiveReportMatchesCurrentRun(archive)) {
    throw new Error("Archive report does not match this after-live tester, session, and archive output.");
  }
  if (archive.ok === false || archive.decision === "ARCHIVE_HOLD") {
    throw new Error(`Archive decision is ${archive.decision || "UNKNOWN"}; keep records local and fix archive blockers.`);
  }
}

async function buildReport({ error }) {
  const observedArchive = await readReport("TRIAL_ARCHIVE_REPORT.json");
  const reports = {
    completion: await readReport("TRIAL_SESSION_COMPLETION_REPORT.json"),
    privacy: await readReport("TRIAL_PRIVACY_REPORT.json"),
    feedback: await readReport("TRIAL_FEEDBACK_SUMMARY.json"),
    backlog: await readReport("TRIAL_FIX_BACKLOG.json"),
    postSession: await readReport("TRIAL_POST_SESSION_REPORT.json"),
    review: await readReport("TRIAL_REVIEW_REPORT.json"),
    archive: archiveReportForCurrentRun(observedArchive),
    status: await readReport("TRIAL_STATUS_REPORT.json"),
    liveCapture: await readReport("TRIAL_LIVE_CAPTURE_REPORT.json")
  };
  const blockers = collectBlockers(reports, error);
  const warnings = collectWarnings(reports);
  const decision = decideAfterLive(blockers, warnings, reports);
  return {
    ok: blockers.length === 0,
    mode: "trial-after-live",
    createdAt: new Date().toISOString(),
    decision,
    testerId,
    nextTester,
    sessionPath,
    sessionRelativePath: relative(sessionPath),
    reportsPath,
    reportsRelativePath: relative(reportsPath),
    packetPath,
    packetRelativePath: relative(packetPath),
    archivePath,
    archiveRelativePath: relative(archivePath),
    archiveStep: reports.archive.currentRun,
    reports: publicReports(reports),
    steps: steps.map(publicStep),
    blockers,
    warnings,
    rawRecordsExcluded: rawRecordNames(),
    evidencePacket: null,
    nextCommands: nextCommands(decision),
    nextSteps: nextSteps(decision)
  };
}

async function readReport(fileName) {
  const filePath = path.join(reportsPath, fileName);
  const data = await readJson(filePath);
  return {
    name: fileName,
    key: fileName.replace(/\.json$/i, ""),
    path: filePath,
    relativePath: relative(filePath),
    exists: Boolean(data),
    ok: data?.ok ?? null,
    decision: data?.decision || "MISSING",
    blockers: normalizeList(data?.blockers),
    warnings: normalizeList(data?.warnings),
    data
  };
}

function collectBlockers(reports, error) {
  const blockers = [];
  if (error) blockers.push(error);
  for (const step of steps) {
    if (step.name === "status:update") continue;
    if (step.exitCode !== 0) blockers.push(`${step.name} failed with exit code ${step.exitCode}.`);
  }
  for (const key of ["completion", "privacy", "feedback", "backlog", "postSession", "review", "archive"]) {
    const report = reports[key];
    if (!report.exists) blockers.push(`${report.key} is missing.`);
    if (report.exists && report.ok === false) blockers.push(`${report.key} is not ok.`);
    for (const item of report.blockers) blockers.push(`${report.key}: ${item}`);
  }
  if (reports.completion.decision === "SESSION_COMPLETION_HOLD") blockers.push("Session completion is on hold.");
  if (reports.privacy.decision === "PRIVACY_HOLD") blockers.push("Privacy is on hold.");
  if (reports.postSession.decision === "POST_SESSION_PIPELINE_FAILED") blockers.push("Post-session pipeline failed.");
  if (["REVIEW_BLOCKED", "REVIEW_FIX_NOW", "REVIEW_WAITING_FOR_REPORTS"].includes(reports.review.decision)) {
    blockers.push(`Session review is ${reports.review.decision}.`);
  }
  if (!reports.archive.currentRun.succeeded) {
    blockers.push(`Archive did not complete in this after-live run (${reports.archive.currentRun.status}).`);
  }
  if (reports.archive.currentRun.succeeded && reports.archive.decision === "ARCHIVE_HOLD") blockers.push("Archive is on hold.");
  return unique(blockers);
}

function collectWarnings(reports) {
  const warnings = [];
  for (const [key, report] of Object.entries(reports)) {
    if (key === "archive" && !report.currentRun.succeeded) continue;
    for (const item of report.warnings) warnings.push(`${report.key}: ${item}`);
  }
  if (reports.review.decision === "REVIEW_WATCH_NEXT_TESTER") warnings.push("Review has watch items; host acceptance is required before the next tester.");
  if (reports.archive.currentRun.succeeded && reports.archive.decision === "ARCHIVE_READY_LOCAL_REVIEW") warnings.push("Archive has privacy warnings; keep the packet local until reviewed.");
  if (!reports.liveCapture.exists) warnings.push("Live-capture report is missing; confirm the session was hosted with the capture checklist.");
  const statusStep = steps.find((step) => step.name === "status:update");
  if (statusStep && statusStep.exitCode !== 0) warnings.push("trial:status exited non-zero after after-live; review TRIAL_STATUS_REPORT.md manually.");
  return unique(warnings);
}

function decideAfterLive(blockers, warnings, reports) {
  if (blockers.length) return "AFTER_LIVE_BLOCKED";
  if (reports.review.decision === "REVIEW_WATCH_NEXT_TESTER") return "AFTER_LIVE_READY_WITH_REVIEW";
  if (warnings.length) return "AFTER_LIVE_READY_WITH_REVIEW";
  return "AFTER_LIVE_READY";
}

async function createEvidencePacket(report) {
  if (!report.archiveStep?.succeeded) {
    throw new Error("Evidence packet requires a successful archive step from this after-live run.");
  }
  if (await exists(packetPath)) {
    if (!args.force) throw new Error(`Evidence packet already exists: ${relative(packetPath)}. Use --force to replace it.`);
    await fs.rm(packetPath, { recursive: true, force: true });
  }
  await fs.mkdir(path.join(packetPath, "reports"), { recursive: true });
  await fs.mkdir(path.join(packetPath, "session-context"), { recursive: true });

  const reportsCopied = [];
  for (const fileName of reportFileNames()) {
    const copied = await copyIfExists(path.join(reportsPath, fileName), path.join(packetPath, "reports", fileName));
    if (copied) reportsCopied.push(copied);
  }

  const sessionContextCopied = [];
  for (const fileName of sessionContextFileNames()) {
    const copied = await copyIfExists(path.join(sessionPath, fileName), path.join(packetPath, "session-context", fileName));
    if (copied) sessionContextCopied.push(copied);
  }

  return {
    ok: true,
    mode: "trial-after-live-evidence-packet",
    createdAt: new Date().toISOString(),
    decision: report.decision,
    testerId,
    packetPath,
    packetRelativePath: relative(packetPath),
    reportsCopied,
    sessionContextCopied,
    rawRecordsExcluded: rawRecordNames(),
    sharing: {
      packetIsLocalOnly: true,
      publicShareAllowed: false,
      reason: "This packet contains trial evidence and anonymous host context only. Keep it local unless a human privacy review approves a summary."
    }
  };
}

async function copyIfExists(source, target) {
  if (!(await exists(source))) return null;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
  return {
    source,
    sourceRelativePath: relative(source),
    target,
    targetRelativePath: relative(target)
  };
}

function reportFileNames() {
  return [
    "TRIAL_SESSION_COMPLETION_REPORT.json",
    "TRIAL_SESSION_COMPLETION_REPORT.md",
    "TRIAL_PRIVACY_REPORT.json",
    "TRIAL_PRIVACY_REPORT.md",
    "TRIAL_FEEDBACK_SUMMARY.json",
    "TRIAL_FEEDBACK_SUMMARY.md",
    "TRIAL_FIX_BACKLOG.json",
    "TRIAL_FIX_BACKLOG.md",
    "TRIAL_POST_SESSION_REPORT.json",
    "TRIAL_POST_SESSION_REPORT.md",
    "TRIAL_REVIEW_REPORT.json",
    "TRIAL_REVIEW_REPORT.md",
    "TRIAL_ARCHIVE_REPORT.json",
    "TRIAL_ARCHIVE_REPORT.md",
    "TRIAL_STATUS_REPORT.json",
    "TRIAL_STATUS_REPORT.md",
    "TRIAL_LIVE_CAPTURE_REPORT.json",
    "TRIAL_LIVE_CAPTURE_REPORT.md",
    "TRIAL_AFTER_LIVE_REPORT.json",
    "TRIAL_AFTER_LIVE_REPORT.md"
  ];
}

function sessionContextFileNames() {
  return [
    "LIVE_SESSION_HOST_SUMMARY.md",
    "SESSION_PACK_MANIFEST.json",
    "SESSION_BRIEF.md",
    "HOST_RUNBOOK.md",
    "HOST_COMPLETION_CHECKLIST.md"
  ];
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial After-Live Report",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Tester: ${report.testerId}`,
    `Session: ${report.sessionRelativePath}`,
    `Evidence packet: ${report.evidencePacket?.packetRelativePath || "Not created"}`,
    "",
    "## Steps",
    "",
    ...report.steps.map((step) => `- ${step.name}: exit ${step.exitCode}`),
    "",
    "## Report Decisions",
    "",
    ...Object.entries(report.reports).map(([key, item]) => `- ${key}: ${item.exists ? item.decision : "missing"}`),
    "",
    "## Archive Step",
    "",
    `- Current run status: ${report.archiveStep.status}`,
    `- Current run succeeded: ${report.archiveStep.succeeded ? "Yes" : "No"}`,
    `- Step exit code: ${report.archiveStep.stepExitCode ?? "not run"}`,
    `- Stale pre-existing report: ${report.archiveStep.stalePreExisting ? "Yes" : "No"}`,
    `- Observed report decision: ${report.archiveStep.observedDecision}`,
    `- Report refreshed in this run: ${report.archiveStep.reportRefreshed ? "Yes" : "No"}`,
    "",
    "## Blockers",
    "",
    ...(report.blockers.length ? report.blockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Evidence Packet",
    "",
    ...(report.evidencePacket
      ? [
          `- Path: ${report.evidencePacket.packetRelativePath}`,
          `- Reports copied: ${report.evidencePacket.reportsCopied.length}`,
          `- Session context files copied: ${report.evidencePacket.sessionContextCopied.length}`,
          "- Public share allowed: No"
        ]
      : ["- Not created because after-live did not pass."]),
    "",
    "## Raw Records Excluded",
    "",
    ...report.rawRecordsExcluded.map((item) => `- ${item}`),
    "",
    "## Next Commands",
    "",
    ...report.nextCommands.map((item) => `- ${item}`),
    "",
    "## Next Steps",
    "",
    ...report.nextSteps.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function renderPacketMarkdown(report, packet) {
  return [
    "# CodeClaw Trial After-Live Evidence Packet",
    "",
    `Created at: ${packet.createdAt}`,
    `Decision: ${packet.decision}`,
    `Tester: ${packet.testerId}`,
    `Session: ${report.sessionRelativePath}`,
    "",
    "## Reports",
    "",
    ...(packet.reportsCopied.length ? packet.reportsCopied.map((item) => `- ${item.targetRelativePath}`) : ["- None"]),
    "",
    "## Session Context",
    "",
    ...(packet.sessionContextCopied.length ? packet.sessionContextCopied.map((item) => `- ${item.targetRelativePath}`) : ["- None"]),
    "",
    "## Raw Records Excluded",
    "",
    ...packet.rawRecordsExcluded.map((item) => `- ${item}`),
    "",
    "## Sharing",
    "",
    `- Local only: ${packet.sharing.packetIsLocalOnly ? "Yes" : "No"}`,
    `- Public share allowed: ${packet.sharing.publicShareAllowed ? "Yes" : "No"}`,
    `- Reason: ${packet.sharing.reason}`,
    ""
  ].join("\n");
}

function renderSharingChecklist(report) {
  return [
    "# CodeClaw After-Live Sharing Checklist",
    "",
    "Default stance: keep this packet local.",
    "",
    "## Included",
    "",
    "- Generated reports.",
    "- Anonymous host summary if present.",
    "- Session manifest, brief, runbook, and completion checklist if present.",
    "",
    "## Excluded",
    "",
    ...report.rawRecordsExcluded.map((item) => `- ${item}`),
    "",
    "## Before Any Sharing",
    "",
    "- Share only high-level decisions and counts unless a human privacy review approves more.",
    "- Do not share real names, contact details, account URLs, paths, screenshots, logs, source snippets, or secrets.",
    "- Keep raw session records in the original session folder only.",
    ""
  ].join("\n");
}

function publicReports(reports) {
  const output = {};
  for (const [key, report] of Object.entries(reports)) {
    output[key] = {
      exists: report.exists,
      ok: report.ok,
      decision: report.decision,
      relativePath: report.relativePath,
      blockers: report.blockers.length,
      warnings: report.warnings.length
    };
    if (report.currentRun) {
      output[key].currentRunStatus = report.currentRun.status;
      output[key].currentRunSucceeded = report.currentRun.succeeded;
      output[key].stalePreExisting = report.currentRun.stalePreExisting;
      output[key].observedDecision = report.currentRun.observedDecision;
      output[key].observedOk = report.currentRun.observedOk;
      output[key].reportRefreshed = report.currentRun.reportRefreshed;
    }
  }
  return output;
}

function archiveReportForCurrentRun(observed) {
  const step = steps.find((item) => item.name === "archive:session");
  const unchanged = observed.exists
    && preRunArchiveSnapshot.exists
    && JSON.stringify(observed.data) === JSON.stringify(preRunArchiveSnapshot.data);
  const reportRefreshed = observed.exists && (!preRunArchiveSnapshot.exists || !unchanged);
  const matchesCurrentRun = observed.exists && archiveReportMatchesCurrentRun(observed.data);
  const ready = observed.ok === true && ["ARCHIVE_READY_LOCAL", "ARCHIVE_READY_LOCAL_REVIEW"].includes(observed.decision);

  let status = "NOT_RUN";
  if (step && step.exitCode !== 0) status = "FAILED";
  if (step && step.exitCode === 0) status = reportRefreshed && matchesCurrentRun && ready ? "SUCCEEDED" : "INVALID";

  const succeeded = status === "SUCCEEDED";
  return {
    ...observed,
    ok: succeeded ? observed.ok : null,
    decision: succeeded ? observed.decision : archiveDecisionForStatus(status),
    blockers: succeeded ? observed.blockers : [],
    warnings: succeeded ? observed.warnings : [],
    currentRun: {
      status,
      succeeded,
      stepExitCode: step?.exitCode ?? null,
      stalePreExisting: observed.exists && preRunArchiveSnapshot.exists && unchanged,
      observedReportExists: observed.exists,
      observedDecision: observed.decision,
      observedOk: observed.ok,
      reportRefreshed,
      matchesCurrentRun
    }
  };
}

function archiveDecisionForStatus(status) {
  if (status === "NOT_RUN") return "ARCHIVE_NOT_RUN";
  if (status === "FAILED") return "ARCHIVE_STEP_FAILED";
  return "ARCHIVE_REPORT_INVALID";
}

function archiveReportMatchesCurrentRun(archive) {
  return archive?.testerId === testerId
    && archive?.sessionRelativePath === relative(sessionPath)
    && archive?.archiveRelativePath === relative(archivePath);
}

function publicStep(step) {
  return {
    name: step.name,
    script: step.script,
    command: step.commandLine,
    exitCode: step.exitCode,
    durationMs: step.durationMs,
    summary: step.summary
  };
}

function nextCommands(decision) {
  if (decision === "AFTER_LIVE_BLOCKED") {
    return [
      "npm.cmd run trial:status",
      `npm.cmd run trial:remediation -- --tester ${testerId}`
    ];
  }
  return [
    "npm.cmd run trial:intake",
    "npm.cmd run trial:intake-session -- --force",
    "npm.cmd run trial:status"
  ];
}

function nextSteps(decision) {
  if (decision === "AFTER_LIVE_BLOCKED") {
    return [
      "Stop before inviting another tester and preserve this after-live result as history.",
      "Fix the first failed product or safety step without changing confirmed human answers.",
      "Keep raw tester records local.",
      "Use the independent remediation gate after fixes; do not rerun after-live to turn a truthful blocked result green."
    ];
  }
  if (decision === "AFTER_LIVE_READY_WITH_REVIEW") {
    return [
      "Host reviews watch items and privacy/archive warnings.",
      "Keep the evidence packet local.",
      "Proceed to the next tester only after host acceptance."
    ];
  }
  return [
    "Keep the evidence packet local.",
    "Use trial:intake and trial:intake-session for the next tester.",
    "Rerun trial:status before hosting again."
  ];
}

function rawRecordNames() {
  return [
    "HUMAN_TRIAL_OBSERVATION.md",
    "TRIAL_FEEDBACK_TEMPLATE.md",
    "TRIAL_RESULT_RECORD.md",
    "screenshots",
    "logs",
    "source files",
    "contact details",
    "secret tokens"
  ];
}

async function assertSafeOutputPath(candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("After-live evidence packet output must stay inside the CodeClaw project root.");
  }
  if (candidatePath === sessionPath || candidatePath === reportsPath) {
    throw new Error("After-live evidence packet output cannot replace session or reports input.");
  }
}

function parseArgs(rawArgs) {
  const parsed = { session: "", tester: "", nextTester: "", reports: "", out: "", archiveOut: "", json: "", markdown: "", force: false };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    let handled = false;
    for (const key of ["session", "tester", "reports", "out", "archiveOut", "json", "markdown"]) {
      const dashed = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      if (arg === `--${dashed}`) {
        parsed[key] = rawArgs[index + 1] || "";
        index += 1;
        handled = true;
        break;
      }
      if (arg.startsWith(`--${dashed}=`)) {
        parsed[key] = arg.slice(dashed.length + 3);
        handled = true;
        break;
      }
    }
    if (handled) continue;
    if (arg === "--next-tester") {
      parsed.nextTester = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--next-tester=")) {
      parsed.nextTester = arg.slice("--next-tester=".length);
      continue;
    }
    if (!parsed.session && !arg.startsWith("--")) {
      parsed.session = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function parseJsonOutput(output) {
  const start = output.lastIndexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return {};
  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    return {};
  }
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return item;
    return item.message || item.reason || item.title || item.rule || JSON.stringify(item);
  }).filter(Boolean);
}

function inferTesterId(folderPath) {
  return sanitizeTesterId(path.basename(folderPath));
}

function nextTesterId(value) {
  const match = String(value || "").match(/^(.*?)(\d+)$/);
  if (!match) return `${sanitizeTesterId(value)}-next`;
  return `${match[1]}${Number(match[2]) + 1}`;
}

function sanitizeTesterId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "tester-1";
}

function dateStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function quoteShellArg(value) {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value;
  return `"${String(value).replace(/"/g, '\\"')}"`;
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

async function readJsonSnapshot(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return { exists: true, content, data: JSON.parse(content) };
  } catch {
    return { exists: false, content: "", data: null };
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
