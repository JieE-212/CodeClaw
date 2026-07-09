import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const distPath = path.join(rootPath, "dist");
const args = parseArgs(process.argv.slice(2));
const sessionPath = path.resolve(rootPath, args.session || path.join("dist", "trial-session-packs", "tester-1"));
const reportsPath = path.resolve(rootPath, args.reports || "dist");
const testerId = sanitizeTesterId(args.tester || inferTesterId(sessionPath));
const archivePath = path.resolve(rootPath, args.out || path.join("dist", "trial-archives", `${testerId}-${dateStamp()}`));
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_ARCHIVE_REPORT.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_ARCHIVE_REPORT.md"));

await assertSafeOutputPath(archivePath);

const report = await buildReport();

await fs.mkdir(path.dirname(jsonPath), { recursive: true });
await fs.mkdir(path.dirname(markdownPath), { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderReportMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  testerId,
  sessionPath,
  reportsPath,
  archivePath,
  reportsCopied: report.reportsCopied.length,
  sessionContextCopied: report.sessionContextCopied.length,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  jsonPath,
  markdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function buildReport() {
  const blockers = [];
  const warnings = [];
  const privacy = await readPrivacyReport();

  if (!(await exists(sessionPath))) blockers.push(`Session folder does not exist: ${relative(sessionPath)}`);
  if (!(await exists(reportsPath))) blockers.push(`Reports folder does not exist: ${relative(reportsPath)}`);
  if (!privacy.report) blockers.push("Privacy report is missing; run trial:privacy-check before archiving.");
  if (privacy.report?.decision === "PRIVACY_HOLD" || privacy.report?.ok === false) blockers.push("Privacy report is not safe to archive.");
  if (privacy.report?.decision === "PRIVACY_REVIEW") warnings.push("Privacy report has warnings; archive is local-only until host accepts them.");

  if (blockers.length) {
    return reportPayload({
      ok: false,
      decision: "ARCHIVE_HOLD",
      blockers,
      warnings,
      privacy,
      reportsCopied: [],
      sessionContextCopied: [],
      manifestPath: "",
      checklistPath: ""
    });
  }

  if (await exists(archivePath)) {
    if (!args.force) {
      return reportPayload({
        ok: false,
        decision: "ARCHIVE_HOLD",
        blockers: [`Archive output already exists: ${relative(archivePath)}. Use --force to replace it.`],
        warnings,
        privacy,
        reportsCopied: [],
        sessionContextCopied: [],
        manifestPath: "",
        checklistPath: ""
      });
    }
    await fs.rm(archivePath, { recursive: true, force: true });
  }

  await fs.mkdir(path.join(archivePath, "reports"), { recursive: true });
  await fs.mkdir(path.join(archivePath, "session-context"), { recursive: true });

  const reportsCopied = await copyReports();
  const sessionContextCopied = await copySessionContext();
  if (!reportsCopied.some((item) => item.source.endsWith("TRIAL_PRIVACY_REPORT.json"))) {
    warnings.push("Privacy report JSON was read but not copied from the selected reports/session folder.");
  }
  if (!reportsCopied.length) warnings.push("No report files were copied into the archive.");

  const decision = warnings.length ? "ARCHIVE_READY_LOCAL_REVIEW" : "ARCHIVE_READY_LOCAL";
  const manifest = reportPayload({
    ok: true,
    decision,
    blockers,
    warnings,
    privacy,
    reportsCopied,
    sessionContextCopied,
    manifestPath: path.join(archivePath, "ARCHIVE_MANIFEST.json"),
    checklistPath: path.join(archivePath, "SHARING_CHECKLIST.md")
  });
  await fs.writeFile(manifest.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(archivePath, "ARCHIVE_MANIFEST.md"), renderManifestMarkdown(manifest), "utf8");
  await fs.writeFile(manifest.checklistPath, renderSharingChecklist(manifest), "utf8");
  return manifest;
}

async function readPrivacyReport() {
  const candidates = [
    path.join(reportsPath, "TRIAL_PRIVACY_REPORT.json"),
    path.join(sessionPath, "TRIAL_PRIVACY_REPORT.json")
  ];
  for (const candidate of candidates) {
    const report = await readJson(candidate);
    if (report) {
      return {
        report,
        path: candidate,
        relativePath: relative(candidate),
        decision: report.decision || "UNKNOWN"
      };
    }
  }
  return {
    report: null,
    path: "",
    relativePath: "",
    decision: "MISSING"
  };
}

async function copyReports() {
  const files = [];
  for (const base of reportFileNames()) {
    for (const sourceRoot of unique([reportsPath, sessionPath])) {
      const source = path.join(sourceRoot, base);
      if (!(await exists(source))) continue;
      const target = path.join(archivePath, "reports", base);
      await fs.copyFile(source, target);
      files.push(fileRecord(source, target));
      break;
    }
  }
  return files;
}

async function copySessionContext() {
  const files = [];
  for (const base of ["SESSION_PACK_MANIFEST.json", "SESSION_BRIEF.md"]) {
    const source = path.join(sessionPath, base);
    if (!(await exists(source))) continue;
    const target = path.join(archivePath, "session-context", base);
    await fs.copyFile(source, target);
    files.push(fileRecord(source, target));
  }
  return files;
}

function reportFileNames() {
  return [
    "TRIAL_PRIVACY_REPORT.json",
    "TRIAL_PRIVACY_REPORT.md",
    "TRIAL_FEEDBACK_SUMMARY.json",
    "TRIAL_FEEDBACK_SUMMARY.md",
    "TRIAL_FIX_BACKLOG.json",
    "TRIAL_FIX_BACKLOG.md",
    "TRIAL_HOST_READY_REPORT.json",
    "TRIAL_HOST_READY_REPORT.md",
    "TRIAL_POST_SESSION_REPORT.json",
    "TRIAL_POST_SESSION_REPORT.md",
    "TRIAL_COHORT_SUMMARY.json",
    "TRIAL_COHORT_SUMMARY.md"
  ];
}

function reportPayload({ ok, decision, blockers, warnings, privacy, reportsCopied, sessionContextCopied, manifestPath, checklistPath }) {
  return {
    ok,
    mode: "trial-archive-session",
    createdAt: new Date().toISOString(),
    decision,
    testerId,
    sessionPath,
    sessionRelativePath: relative(sessionPath),
    reportsPath,
    reportsRelativePath: relative(reportsPath),
    archivePath,
    archiveRelativePath: relative(archivePath),
    manifestPath,
    manifestRelativePath: manifestPath ? relative(manifestPath) : "",
    checklistPath,
    checklistRelativePath: checklistPath ? relative(checklistPath) : "",
    privacyDecision: privacy.decision,
    privacyReportPath: privacy.relativePath,
    blockers,
    warnings,
    reportsCopied,
    sessionContextCopied,
    rawRecordsExcluded: rawRecordNames(),
    sharing: sharingPolicy(decision, privacy, warnings),
    nextSteps: nextSteps(decision)
  };
}

function sharingPolicy(decision, privacy, warnings) {
  const ready = decision === "ARCHIVE_READY_LOCAL" || decision === "ARCHIVE_READY_LOCAL_REVIEW";
  return {
    archiveIsLocalOnly: true,
    publicShareAllowed: false,
    shareManifestOnlyAfterReview: ready && privacy.decision === "PRIVACY_OK" && warnings.length === 0,
    reason: ready
      ? "Archive contains trial decision evidence and must stay local unless the host manually reviews it."
      : "Archive was not created because privacy or input blockers exist."
  };
}

function nextSteps(decision) {
  if (decision === "ARCHIVE_HOLD") {
    return [
      "Run npm.cmd run trial:privacy-check -- <session-folder>.",
      "Redact blockers if privacy is PRIVACY_HOLD.",
      "Rerun npm.cmd run trial:archive-session -- --session <session-folder>."
    ];
  }
  if (decision === "ARCHIVE_READY_LOCAL_REVIEW") {
    return [
      "Keep the archive local.",
      "Open SHARING_CHECKLIST.md and explicitly accept privacy warnings before sharing any summary.",
      "Use the archive manifest when updating cohort or release notes."
    ];
  }
  return [
    "Keep the archive local by default.",
    "Use ARCHIVE_MANIFEST.md for lightweight status review.",
    "Do not share raw tester records unless a human privacy review approves them."
  ];
}

function renderReportMarkdown(report) {
  return [
    "# CodeClaw Trial Archive Report",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Tester: ${report.testerId}`,
    `Session: ${report.sessionRelativePath}`,
    `Archive: ${report.archiveRelativePath}`,
    `Privacy: ${report.privacyDecision}`,
    "",
    "## Blockers",
    "",
    ...(report.blockers.length ? report.blockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Copied Reports",
    "",
    ...(report.reportsCopied.length ? report.reportsCopied.map((item) => `- ${item.targetRelativePath}`) : ["- None"]),
    "",
    "## Session Context",
    "",
    ...(report.sessionContextCopied.length ? report.sessionContextCopied.map((item) => `- ${item.targetRelativePath}`) : ["- None"]),
    "",
    "## Raw Records Excluded",
    "",
    ...report.rawRecordsExcluded.map((item) => `- ${item}`),
    "",
    "## Next Steps",
    "",
    ...report.nextSteps.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function renderManifestMarkdown(report) {
  return [
    "# CodeClaw Trial Archive Manifest",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Tester: ${report.testerId}`,
    `Privacy: ${report.privacyDecision}`,
    "",
    "## Source",
    "",
    `- Session: ${report.sessionRelativePath}`,
    `- Reports: ${report.reportsRelativePath}`,
    "",
    "## Evidence",
    "",
    ...(report.reportsCopied.length ? report.reportsCopied.map((item) => `- ${item.targetRelativePath}`) : ["- None"]),
    "",
    "## Sharing Policy",
    "",
    `- Archive is local-only: ${report.sharing.archiveIsLocalOnly ? "Yes" : "No"}`,
    `- Public share allowed: ${report.sharing.publicShareAllowed ? "Yes" : "No"}`,
    `- Manifest share after review: ${report.sharing.shareManifestOnlyAfterReview ? "Yes" : "No"}`,
    `- Reason: ${report.sharing.reason}`,
    ""
  ].join("\n");
}

function renderSharingChecklist(report) {
  return [
    "# CodeClaw Trial Archive Sharing Checklist",
    "",
    "Default stance: keep this archive local.",
    "",
    "## Can Share After Human Review",
    "",
    "- High-level decision names such as READY_FOR_NEXT_TESTER or EXPAND_WITH_WATCH.",
    "- Count summaries without tester names, paths, screenshots, source code, or logs.",
    "- Product themes rewritten in general language.",
    "",
    "## Keep Local",
    "",
    "- Report JSON and Markdown files copied into this archive.",
    "- Tester-specific notes, paths, stack traces, and host observations.",
    "- Any file under the original session folder.",
    "",
    "## Never Share",
    "",
    "- API keys, tokens, private keys, `.env` content, logs, or real project source.",
    "- Screenshots that reveal project names, usernames, paths, or proprietary code.",
    "- Raw tester records unless a separate privacy review explicitly approves them.",
    "",
    "## Archive State",
    "",
    `- Decision: ${report.decision}`,
    `- Privacy: ${report.privacyDecision}`,
    `- Raw records excluded: ${report.rawRecordsExcluded.join(", ")}`,
    ""
  ].join("\n");
}

function fileRecord(source, target) {
  return {
    source,
    sourceRelativePath: relative(source),
    target,
    targetRelativePath: relative(target)
  };
}

function rawRecordNames() {
  return [
    "HUMAN_TRIAL_OBSERVATION.md",
    "TRIAL_FEEDBACK_TEMPLATE.md",
    "TRIAL_RESULT_RECORD.md",
    "tester feedback markdown",
    "screenshots",
    "logs",
    "source files"
  ];
}

async function assertSafeOutputPath(candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Archive output must stay inside the CodeClaw project root.");
  }
  if (candidatePath === sessionPath || candidatePath === reportsPath) {
    throw new Error("Archive output cannot replace session or reports input.");
  }
}

function parseArgs(rawArgs) {
  const parsed = { session: "", reports: "", tester: "", out: "", json: "", markdown: "", force: false };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    let handled = false;
    for (const key of ["session", "reports", "tester", "out", "json", "markdown"]) {
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
    if (!parsed.session && !arg.startsWith("--")) {
      parsed.session = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function inferTesterId(folderPath) {
  return sanitizeTesterId(path.basename(folderPath));
}

function sanitizeTesterId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "tester";
}

function dateStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
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
