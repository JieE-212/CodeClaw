import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const distPath = path.join(rootPath, "dist");
const freezePath = path.join(distPath, "TRIAL_FREEZE_REPORT.json");
const jsonPath = path.join(distPath, "TRIAL_DISPATCH_NOTE.json");
const markdownPath = path.join(distPath, "TRIAL_DISPATCH_NOTE.md");

const freeze = await readJson(freezePath);
const packagePath = freeze.packagePath || "";
const requiredDocs = [
  "docs/START_GUIDE.md",
  "docs/TRIAL_INVITE_MESSAGE.md",
  "docs/TRIAL_HOST_BRIEF.md",
  "docs/TRIAL_GO_NO_GO.md",
  "docs/TRIAL_5_MIN_PRECHECK.md",
  "docs/HUMAN_TRIAL_OBSERVATION.md",
  "docs/TRIAL_FEEDBACK_TEMPLATE.md",
  "docs/TRIAL_FEEDBACK_INGEST.md",
  "docs/TRIAL_FIX_BACKLOG.md",
  "docs/TRIAL_SESSION_PACK.md",
  "docs/TRIAL_HOST_READY.md",
  "docs/TRIAL_POST_SESSION.md",
  "docs/TRIAL_PRIVACY_CHECK.md",
  "docs/TRIAL_COHORT_SUMMARY.md",
  "docs/TRIAL_ARCHIVE_SESSION.md",
  "docs/TRIAL_STATUS.md",
  "docs/TRIAL_TESTER_INTAKE.md",
  "docs/TRIAL_INTAKE_SESSION.md",
  "docs/TRIAL_HOST_RUN.md",
  "docs/TRIAL_SESSION_COMPLETION.md",
  "docs/TRIAL_SESSION_REVIEW.md",
  "docs/TRIAL_INTAKE_REVIEW_DRY_RUN.md",
  "docs/TRIAL_PRE_LIVE.md",
  "docs/TRIAL_LIVE_CAPTURE.md",
  "docs/TRIAL_AFTER_LIVE.md",
  "docs/TRIAL_RESULT_RECORD.md"
];

const missingPackageDocs = [];
if (packagePath) {
  for (const doc of requiredDocs) {
    if (!(await exists(path.join(packagePath, doc)))) missingPackageDocs.push(doc);
  }
}

const blockers = [];
if (!freeze.ok || freeze.decision !== "GO_HOSTED_TRIAL") blockers.push("Freeze report is not GO_HOSTED_TRIAL.");
if (!packagePath) blockers.push("Freeze report does not include a package path.");
if (packagePath && !(await exists(packagePath))) blockers.push("Package path does not exist.");
if (missingPackageDocs.length) blockers.push(`Package is missing dispatch docs: ${missingPackageDocs.join(", ")}`);

const report = {
  ok: blockers.length === 0,
  mode: "trial-dispatch",
  createdAt: new Date().toISOString(),
  decision: blockers.length ? "HOLD" : "READY_TO_SEND",
  packagePath,
  freezeReport: freezePath,
  blockers,
  warnings: freeze.gate?.warnings || [],
  requiredDocs,
  missingPackageDocs,
  sendOrder: [
    "Send docs/TRIAL_INVITE_MESSAGE.md text to the tester.",
    "Share or zip the package folder.",
    "Ask the tester to open docs/START_GUIDE.md first.",
    "Use docs/TRIAL_5_MIN_PRECHECK.md before starting.",
    "Use docs/HUMAN_TRIAL_OBSERVATION.md during the session.",
    "Ask the tester to fill docs/TRIAL_FEEDBACK_TEMPLATE.md afterward.",
    "Fill docs/TRIAL_RESULT_RECORD.md before deciding on tester 2.",
    "Run npm.cmd run trial:ingest-feedback after completed records are collected.",
    "Run npm.cmd run trial:fix-backlog before inviting tester 2.",
    "Run npm.cmd run trial:session-pack before each hosted tester session.",
    "Run npm.cmd run trial:host-ready immediately before hosting.",
    "Run npm.cmd run trial:host-run to generate the live HOST_RUNBOOK.md.",
    "Run npm.cmd run trial:complete-session after the hosted records are filled.",
    "Run npm.cmd run trial:privacy-check before ingesting completed records.",
    "Run npm.cmd run trial:post-session after the hosted records are filled.",
    "Run npm.cmd run trial:review-session after post-session to choose fix-now, watch, or proceed.",
    "Run npm.cmd run trial:intake-review-dry-run before filling the first real tester roster.",
    "Run npm.cmd run trial:pre-live before scheduling or starting the first real tester session.",
    "Run npm.cmd run trial:live-capture before the live call and use the generated capture files.",
    "Run npm.cmd run trial:after-live after the call to complete recovery, review, archive, and evidence packaging.",
    "Run npm.cmd run trial:cohort-summary after at least two completed tester folders exist.",
    "Run npm.cmd run trial:archive-session after privacy and post-session reports are ready.",
    "Run npm.cmd run trial:intake before generating a real tester session pack.",
    "Run npm.cmd run trial:intake-session to generate a session pack from ready intake.",
    "Run npm.cmd run trial:status whenever the next step is unclear."
  ],
  testerScope: [
    "Start with Demo.",
    "Run one real-project read-only preflight.",
    "Stop before Apply on a non-disposable real project.",
    "Do not request API keys in the first hosted trial."
  ]
};

await fs.mkdir(distPath, { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  jsonPath,
  markdownPath,
  packagePath,
  blockers: blockers.length,
  missingPackageDocs: missingPackageDocs.length
}, null, 2));

if (blockers.length) process.exitCode = 1;

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Missing or invalid dispatch input: ${filePath}\n${error.message}`);
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

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial Dispatch Note",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Package: ${report.packagePath || "None"}`,
    "",
    "## Blockers",
    "",
    ...(report.blockers.length ? report.blockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Send Order",
    "",
    ...report.sendOrder.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## Tester Scope",
    "",
    ...report.testerScope.map((item) => `- ${item}`),
    "",
    "## Required Package Docs",
    "",
    ...report.requiredDocs.map((item) => `- ${item}`),
    "",
    "## Missing Package Docs",
    "",
    ...(report.missingPackageDocs.length ? report.missingPackageDocs.map((item) => `- ${item}`) : ["- None"]),
    ""
  ].join("\n");
}
