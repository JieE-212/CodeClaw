import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const args = parseArgs(process.argv.slice(2));
const reportsPath = path.resolve(rootPath, args.reports || "dist");
const sessionPath = path.resolve(rootPath, args.session || path.join("dist", "trial-session-packs", args.tester || "tester-1"));
const testerId = sanitizeTesterId(args.tester || path.basename(sessionPath));
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_REVIEW_REPORT.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_REVIEW_REPORT.md"));

const report = await buildReport();

await fs.mkdir(path.dirname(jsonPath), { recursive: true });
await fs.mkdir(path.dirname(markdownPath), { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  testerId,
  actionItems: report.actionItems.length,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  jsonPath,
  markdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function buildReport() {
  const reports = {
    completion: await readReport("TRIAL_SESSION_COMPLETION_REPORT.json"),
    privacy: await readReport("TRIAL_PRIVACY_REPORT.json"),
    feedback: await readReport("TRIAL_FEEDBACK_SUMMARY.json"),
    backlog: await readReport("TRIAL_FIX_BACKLOG.json"),
    postSession: await readReport("TRIAL_POST_SESSION_REPORT.json"),
    archive: await readReport("TRIAL_ARCHIVE_REPORT.json")
  };
  const blockers = collectBlockers(reports);
  const warnings = collectWarnings(reports);
  const actionItems = buildActionItems(reports);
  const decision = decideReview({ reports, blockers, actionItems });
  const ok = !["REVIEW_BLOCKED", "REVIEW_FIX_NOW", "REVIEW_WAITING_FOR_REPORTS"].includes(decision);

  return {
    ok,
    mode: "trial-review-session",
    createdAt: new Date().toISOString(),
    testerId,
    sessionPath,
    sessionRelativePath: relative(sessionPath),
    reportsPath,
    reportsRelativePath: relative(reportsPath),
    decision,
    summary: summary(reports, actionItems),
    reports: publicReports(reports),
    actionItems,
    blockers,
    warnings,
    decisionBrief: decisionBrief(decision, actionItems, warnings),
    nextCommands: nextCommands(decision),
    nextSteps: nextSteps(decision)
  };
}

async function readReport(name) {
  const filePath = path.join(reportsPath, name);
  const data = await readJson(filePath);
  return {
    name,
    key: name.replace(/\.json$/i, ""),
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

function collectBlockers(reports) {
  const blockers = [];
  for (const key of ["completion", "privacy", "feedback", "backlog", "postSession"]) {
    const report = reports[key];
    if (!report.exists) blockers.push(`${report.key} is missing.`);
    if (report.exists && report.ok === false) blockers.push(`${report.key} is not ok.`);
    for (const item of report.blockers) blockers.push(`${report.key}: ${item}`);
  }
  if (reports.completion.decision === "SESSION_COMPLETION_HOLD") blockers.push("Session completion is on hold.");
  if (reports.privacy.decision === "PRIVACY_HOLD") blockers.push("Privacy is on hold.");
  if (reports.postSession.decision === "POST_SESSION_PIPELINE_FAILED") blockers.push("Post-session pipeline failed.");
  return unique(blockers);
}

function collectWarnings(reports) {
  const warnings = [];
  for (const report of Object.values(reports)) {
    if (!report.exists && report.key === "TRIAL_ARCHIVE_REPORT") warnings.push("Archive report is missing; archive after review if privacy passed.");
    for (const item of report.warnings) warnings.push(`${report.key}: ${item}`);
  }
  if (reports.archive.exists && reports.archive.decision === "ARCHIVE_HOLD") warnings.push("Archive is on hold.");
  if (!reports.archive.exists) warnings.push("Archive report is missing; create a local archive after review.");
  return unique(warnings);
}

function buildActionItems(reports) {
  const backlog = reports.backlog.data || {};
  const p0 = (backlog.mustFixBeforeTester2 || []).map((item) => actionItem(item, "P0"));
  const watch = (backlog.watchDuringTester2 || []).map((item) => actionItem(item, item.priority || "P2"));
  const optional = (backlog.optionalPolish || []).slice(0, 5).map((item) => actionItem(item, item.priority || "P3"));
  return [...p0, ...watch, ...optional].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.id.localeCompare(b.id));
}

function actionItem(item, fallbackPriority) {
  const priority = item.priority || fallbackPriority;
  const theme = item.theme || "other";
  return {
    id: item.id || `${priority}-UNNUMBERED`,
    priority,
    lane: item.lane || laneForPriority(priority),
    theme,
    title: item.title || "Untitled trial follow-up",
    owner: item.owner || ownerFor(theme, priority),
    action: item.action || actionFor(theme, priority),
    verificationCommand: item.verificationCommand || verificationFor(theme, priority),
    evidence: item.evidence || [],
    sources: item.sources || []
  };
}

function decideReview({ reports, blockers, actionItems }) {
  if (["completion", "privacy", "feedback", "backlog", "postSession"].some((key) => !reports[key].exists)) {
    return "REVIEW_WAITING_FOR_REPORTS";
  }
  if (blockers.length) return "REVIEW_BLOCKED";
  if (actionItems.some((item) => item.priority === "P0")) return "REVIEW_FIX_NOW";
  if (reports.postSession.decision !== "READY_FOR_NEXT_TESTER") return "REVIEW_FIX_NOW";
  if (actionItems.some((item) => item.priority === "P1" || item.priority === "P2")) return "REVIEW_WATCH_NEXT_TESTER";
  return "REVIEW_PROCEED";
}

function summary(reports, actionItems) {
  return {
    completionDecision: reports.completion.decision,
    privacyDecision: reports.privacy.decision,
    feedbackDecision: reports.feedback.decision,
    backlogDecision: reports.backlog.decision,
    postSessionDecision: reports.postSession.decision,
    archiveDecision: reports.archive.decision,
    p0: actionItems.filter((item) => item.priority === "P0").length,
    p1: actionItems.filter((item) => item.priority === "P1").length,
    p2: actionItems.filter((item) => item.priority === "P2").length,
    p3: actionItems.filter((item) => item.priority === "P3").length
  };
}

function decisionBrief(decision, actionItems, warnings) {
  if (decision === "REVIEW_WAITING_FOR_REPORTS") return "Evidence is incomplete. Generate missing completion, privacy, feedback, backlog, and post-session reports first.";
  if (decision === "REVIEW_BLOCKED") return "Do not proceed. Resolve blockers before inviting another tester or archiving evidence.";
  if (decision === "REVIEW_FIX_NOW") return "Fix P0 or failed post-session items now, then rerun readiness and review.";
  if (decision === "REVIEW_WATCH_NEXT_TESTER") {
    const p1 = actionItems.filter((item) => item.priority === "P1").length;
    return p1
      ? `Proceed only with host acceptance of ${p1} P1 watch item(s).`
      : "Proceed to the next tester with watch items copied into the live observation checklist.";
  }
  return warnings.length ? "Proceed after accepting minor archive or report warnings." : "Proceed. No must-fix or watch item remains from this review.";
}

function nextCommands(decision) {
  if (decision === "REVIEW_WAITING_FOR_REPORTS") {
    return [
      `npm.cmd run trial:complete-session -- --session ${relative(sessionPath)}`,
      `npm.cmd run trial:post-session -- --session ${relative(sessionPath)} --next-tester ${nextTesterId(testerId)}`,
      "npm.cmd run trial:review-session"
    ];
  }
  if (decision === "REVIEW_BLOCKED" || decision === "REVIEW_FIX_NOW") {
    return [
      "npm.cmd run trial:simulate",
      "npm.cmd run trial:ready",
      "npm.cmd run trial:freeze",
      "npm.cmd run trial:dispatch",
      "npm.cmd run trial:review-session"
    ];
  }
  if (decision === "REVIEW_WATCH_NEXT_TESTER") {
    return [
      "npm.cmd run trial:intake-session -- --force",
      "npm.cmd run trial:host-ready",
      "npm.cmd run trial:host-run"
    ];
  }
  return [
    "npm.cmd run trial:intake-session -- --force",
    "npm.cmd run trial:status"
  ];
}

function nextSteps(decision) {
  if (decision === "REVIEW_WAITING_FOR_REPORTS") {
    return [
      "Generate the missing reports for the completed tester session.",
      "Rerun trial:review-session when evidence is complete."
    ];
  }
  if (decision === "REVIEW_BLOCKED" || decision === "REVIEW_FIX_NOW") {
    return [
      "Assign every P0 item before inviting another tester.",
      "Run each verification command after fixing.",
      "Refreeze and redispatch the package if product or docs changed."
    ];
  }
  if (decision === "REVIEW_WATCH_NEXT_TESTER") {
    return [
      "Host accepts P1/P2 watch items.",
      "Keep watch items in the next HOST_RUNBOOK and observation checklist.",
      "Review again after the next tester."
    ];
  }
  return [
    "Proceed with the next tester intake/session flow.",
    "Archive the completed session locally if not done yet."
  ];
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial Review Report",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Tester: ${report.testerId}`,
    `Session: ${report.sessionRelativePath}`,
    "",
    "## Decision Brief",
    "",
    `- ${report.decisionBrief}`,
    "",
    "## Summary",
    "",
    ...Object.entries(report.summary).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Action Items",
    "",
    ...renderActionItems(report.actionItems),
    "",
    "## Reports",
    "",
    "| Report | Exists | Decision | Blockers | Warnings |",
    "| --- | --- | --- | ---: | ---: |",
    ...Object.values(report.reports).map((item) => `| ${item.name} | ${item.exists ? "Yes" : "No"} | ${item.decision} | ${item.blockers} | ${item.warnings} |`),
    "",
    "## Blockers",
    "",
    ...(report.blockers.length ? report.blockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ["- None"]),
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

function renderActionItems(items) {
  if (!items.length) return ["- None"];
  return items.flatMap((item) => [
    `- ${item.id} ${item.title}`,
    `  - Priority: ${item.priority}`,
    `  - Owner: ${item.owner}`,
    `  - Action: ${item.action}`,
    `  - Verify: ${item.verificationCommand}`,
    `  - Evidence: ${Array.isArray(item.evidence) ? item.evidence.join("; ") : item.evidence || "n/a"}`
  ]);
}

function publicReports(reports) {
  const output = {};
  for (const [key, report] of Object.entries(reports)) {
    output[key] = {
      name: report.name,
      exists: report.exists,
      ok: report.ok,
      decision: report.decision,
      relativePath: report.relativePath,
      blockers: report.blockers.length,
      warnings: report.warnings.length
    };
  }
  return output;
}

function ownerFor(theme, priority) {
  if (priority === "P0") return "Product owner";
  if (["safety", "preflight", "verification"].includes(theme)) return "Host";
  if (["docs", "feedback"].includes(theme)) return "Trial host";
  return "Product";
}

function actionFor(theme, priority) {
  const prefix = priority === "P0" ? "Fix before the next tester:" : "Review during the next tester:";
  return `${prefix} ${theme.replace(/-/g, " ")}.`;
}

function verificationFor(theme, priority) {
  if (priority === "P0") return "npm.cmd run trial:simulate && npm.cmd run trial:ready";
  if (["safety", "preflight", "verification"].includes(theme)) return "npm.cmd run trial:host-ready && npm.cmd run trial:host-run";
  if (["docs", "feedback"].includes(theme)) return "npm.cmd run trial:complete-session -- --session <session-folder>";
  return "npm.cmd run trial:status";
}

function laneForPriority(priority) {
  if (priority === "P0") return "must-fix";
  if (priority === "P1" || priority === "P2") return "watch";
  return "optional";
}

function priorityRank(priority) {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[priority] ?? 9;
}

function nextTesterId(value) {
  const match = String(value || "").match(/^(.*?)(\d+)$/);
  if (!match) return `${sanitizeTesterId(value)}-next`;
  return `${match[1]}${Number(match[2]) + 1}`;
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return item;
    return item.message || item.reason || item.title || JSON.stringify(item);
  }).filter(Boolean);
}

function sanitizeTesterId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "tester-1";
}

function parseArgs(rawArgs) {
  const parsed = { reports: "", session: "", tester: "", json: "", markdown: "" };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    let handled = false;
    for (const key of ["reports", "session", "tester", "json", "markdown"]) {
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
