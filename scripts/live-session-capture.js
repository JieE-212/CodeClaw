import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const distPath = path.join(rootPath, "dist");
const args = parseArgs(process.argv.slice(2));
const testerId = sanitizeTesterId(args.tester || "");
const preLivePath = path.resolve(rootPath, args.preLive || path.join("dist", "TRIAL_PRE_LIVE_REPORT.json"));
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_LIVE_CAPTURE_REPORT.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_LIVE_CAPTURE_REPORT.md"));

const report = await buildReport();

await fs.mkdir(path.dirname(jsonPath), { recursive: true });
await fs.mkdir(path.dirname(markdownPath), { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  testerId: report.testerId,
  sessionFolder: report.sessionRelativePath,
  captureFile: report.captureRelativePath,
  summaryFile: report.summaryRelativePath,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  jsonPath,
  markdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function buildReport() {
  const preLive = await readJson(preLivePath);
  const blockers = [];
  const warnings = [];

  if (!preLive) blockers.push("Pre-live report is missing. Run npm.cmd run trial:pre-live first.");
  if (preLive && preLive.ok === false) blockers.push("Pre-live report is not ok.");
  if (preLive && !["PRE_LIVE_READY_TO_HOST", "PRE_LIVE_READY_WITH_HOST_REVIEW"].includes(preLive.decision)) {
    blockers.push(`Pre-live decision is ${preLive.decision || "UNKNOWN"}.`);
  }
  if (preLive?.decision === "PRE_LIVE_READY_WITH_HOST_REVIEW") {
    warnings.push("Pre-live has warnings; host must accept them before starting.");
  }

  const selectedTesterId = sanitizeTesterId(testerId || preLive?.testerId || "tester-1");
  if (isDryRunTesterId(selectedTesterId)) blockers.push(`${selectedTesterId}: dry-run tester ids cannot be used for a real live session.`);

  const sessionFolder = resolveSessionFolder(preLive, selectedTesterId);
  const capturePath = sessionFolder ? path.join(sessionFolder, "LIVE_SESSION_CAPTURE.md") : "";
  const summaryPath = sessionFolder ? path.join(sessionFolder, "LIVE_SESSION_HOST_SUMMARY.md") : "";
  const hygiene = await inspectSessionFolder(sessionFolder);
  blockers.push(...hygiene.blockers);
  warnings.push(...hygiene.warnings);

  if (!blockers.length && sessionFolder) {
    await fs.writeFile(capturePath, renderCaptureFile({ testerId: selectedTesterId, sessionFolder, preLive }), "utf8");
    await fs.writeFile(summaryPath, renderSummaryFile({ testerId: selectedTesterId, preLive }), "utf8");
  }

  const decision = blockers.length
    ? "LIVE_CAPTURE_HOLD"
    : warnings.length
      ? "LIVE_CAPTURE_READY_WITH_REVIEW"
      : "LIVE_CAPTURE_READY";

  return {
    ok: blockers.length === 0,
    mode: "trial-live-capture",
    createdAt: new Date().toISOString(),
    decision,
    testerId: selectedTesterId,
    preLivePath,
    preLiveRelativePath: relative(preLivePath),
    preLiveDecision: preLive?.decision || "MISSING",
    sessionFolder,
    sessionRelativePath: sessionFolder ? relative(sessionFolder) : "",
    capturePath,
    captureRelativePath: capturePath ? relative(capturePath) : "",
    summaryPath,
    summaryRelativePath: summaryPath ? relative(summaryPath) : "",
    hygiene,
    blockers: unique(blockers),
    warnings: unique(warnings),
    afterCallCommands: afterCallCommands(sessionFolder, selectedTesterId),
    nextSteps: nextSteps(decision)
  };
}

async function inspectSessionFolder(sessionFolder) {
  const blockers = [];
  const warnings = [];
  const scannedFiles = [];
  if (!sessionFolder) {
    blockers.push("Session folder could not be resolved.");
    return { blockers, warnings, scannedFiles };
  }
  if (!(await exists(sessionFolder))) {
    blockers.push(`Session folder does not exist: ${relative(sessionFolder)}.`);
    return { blockers, warnings, scannedFiles };
  }
  if (isInside(sessionFolder, path.join(distPath, "trial-dry-runs"))) blockers.push("Session folder is inside dry-run output.");
  const requiredFiles = [
    "BEGINNER_FIRST_LIVE_GUIDE.md",
    "SESSION_BRIEF.md",
    "HOST_RUNBOOK.md",
    "HUMAN_TRIAL_OBSERVATION.md",
    "TRIAL_FEEDBACK_TEMPLATE.md",
    "TRIAL_RESULT_RECORD.md",
    "SESSION_PACK_MANIFEST.json"
  ];
  for (const file of requiredFiles) {
    if (!(await exists(path.join(sessionFolder, file)))) blockers.push(`Session folder is missing ${file}.`);
  }

  const entries = await collectFiles(sessionFolder);
  for (const filePath of entries) {
    const relativePath = relative(filePath);
    scannedFiles.push(relativePath);
    const base = path.basename(filePath);
    if (isDisallowedLiveFile(base)) blockers.push(`Remove non-Markdown/raw capture file before live session: ${relativePath}.`);
    if (isSourceLikeFile(base)) blockers.push(`Remove source-like file before live session: ${relativePath}.`);
    if (base.toLowerCase().endsWith(".md")) {
      const findings = await scanMarkdown(filePath);
      blockers.push(...findings.blockers);
      warnings.push(...findings.warnings);
    }
  }
  return { blockers: unique(blockers), warnings: unique(warnings), scannedFiles };
}

async function collectFiles(folder) {
  const files = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(filePath);
        continue;
      }
      if (entry.isFile()) files.push(filePath);
    }
  }
  await walk(folder);
  return files.sort((a, b) => a.localeCompare(b));
}

async function scanMarkdown(filePath) {
  const blockers = [];
  const warnings = [];
  const text = await fs.readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const location = `${relative(filePath)}:${index + 1}`;
    if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(line)) blockers.push(`Personal email found at ${location}.`);
    if (/(?:\+?\d[\s().-]*){10,}/.test(line) && /\d{3}/.test(line)) blockers.push(`Possible phone number found at ${location}.`);
    if (/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b|\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/.test(line)) {
      blockers.push(`Possible secret token found at ${location}.`);
    }
    const identity = line.match(/^\s*-\s*(Name|Tester|Host|Trial host):\s*(.+)$/i);
    if (identity && !isSafeIdentityValue(identity[2])) blockers.push(`Personal ${identity[1]} field should use an anonymous id at ${location}.`);
    if (/(?:[A-Za-z]:\\Users\\[^\\\s]+\\|\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/)/.test(line)) warnings.push(`Personal path found at ${location}; redact before sharing.`);
  }
  return { blockers: unique(blockers), warnings: unique(warnings) };
}

function renderCaptureFile({ testerId, sessionFolder, preLive }) {
  const commands = afterCallCommands(sessionFolder, testerId);
  return [
    "# CodeClaw Live Session Capture",
    "",
    `Tester id: ${testerId}`,
    `Created at: ${new Date().toISOString()}`,
    `Session folder: ${relative(sessionFolder)}`,
    `Pre-live decision: ${preLive?.decision || "MISSING"}`,
    "",
    "## Before Call",
    "",
    "- [ ] Open BEGINNER_FIRST_LIVE_GUIDE.md and reconfirm the real human's consent.",
    "- [ ] Open HOST_RUNBOOK.md.",
    "- [ ] Open HUMAN_TRIAL_OBSERVATION.md.",
    "- [ ] Keep SESSION_BRIEF.md nearby.",
    "- [ ] Confirm tester id is anonymous.",
    "- [ ] Confirm no screenshots, logs, source files, contact data, or secrets are in this folder.",
    "- [ ] Confirm the tester knows the first session starts with Demo.",
    "",
    "## During Call",
    "",
    "- [ ] Record first stuck moment.",
    "- [ ] Record when the tester asks for help.",
    "- [ ] Record whether Demo vs real project mode is understood.",
    "- [ ] Record whether read-only preflight feels safe.",
    "- [ ] Record any Apply or Verify confusion before continuing.",
    "- [ ] Stop before Apply on a non-disposable real project.",
    "",
    "## After Call",
    "",
    "- [ ] Add explicit local notes to HUMAN_TRIAL_OBSERVATION.md.",
    "- [ ] Run trial:record-draft and review its missing fields.",
    "- [ ] Fill TRIAL_FEEDBACK_TEMPLATE.md and TRIAL_RESULT_RECORD.md with confirmed answers only.",
    "- [ ] Fill LIVE_SESSION_HOST_SUMMARY.md with anonymous, high-level notes only.",
    "- [ ] Run trial:after-live only after the three final records are complete.",
    "",
    "```bash",
    ...commands,
    "```",
    "",
    "## Keep Local",
    "",
    "- Raw tester records.",
    "- Screenshots.",
    "- Logs.",
    "- Project paths.",
    "- Any source snippets or stack traces not needed for a product decision.",
    ""
  ].join("\n");
}

function renderSummaryFile({ testerId, preLive }) {
  return [
    "# CodeClaw Live Session Host Summary",
    "",
    "Keep this anonymous. Do not include real names, contact details, company names, account URLs, private project names, screenshots, logs, or source code.",
    "",
    `- Tester id: ${testerId}`,
    `- Pre-live decision: ${preLive?.decision || "MISSING"}`,
    "- Date: YYYY-MM-DD",
    "- Trial scope: Demo / real read-only preflight",
    "- Main friction: ",
    "- Main trust concern: ",
    "- First host intervention: ",
    "- Most useful moment: ",
    "- Required product fix before next tester: None / ",
    "- Proceed recommendation: Continue / Fix first / Stop",
    "- Evidence reports to review: TRIAL_SESSION_COMPLETION_REPORT.md, TRIAL_PRIVACY_REPORT.md, TRIAL_POST_SESSION_REPORT.md, TRIAL_REVIEW_REPORT.md",
    ""
  ].join("\n");
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Live Session Capture Report",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Tester: ${report.testerId}`,
    `Session folder: ${report.sessionRelativePath || "None"}`,
    `Capture file: ${report.captureRelativePath || "None"}`,
    `Summary file: ${report.summaryRelativePath || "None"}`,
    "",
    "## Blockers",
    "",
    ...(report.blockers.length ? report.blockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Scanned Files",
    "",
    ...(report.hygiene.scannedFiles.length ? report.hygiene.scannedFiles.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## After-Call Commands",
    "",
    "```bash",
    ...report.afterCallCommands,
    "```",
    "",
    "## Next Steps",
    "",
    ...report.nextSteps.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function afterCallCommands(sessionFolder, testerId) {
  const session = sessionFolder ? relative(sessionFolder) : "<session-folder>";
  return [
    `npm.cmd run trial:record-draft -- --session ${session}`,
    `npm.cmd run trial:after-live -- --session ${session} --tester ${testerId || "<tester-id>"} --force`
  ];
}

function nextSteps(decision) {
  if (decision === "LIVE_CAPTURE_HOLD") {
    return [
      "Remove blockers from the session folder.",
      "Regenerate missing host/session files if needed.",
      "Rerun npm.cmd run trial:live-capture before hosting."
    ];
  }
  if (decision === "LIVE_CAPTURE_READY_WITH_REVIEW") {
    return [
      "Host accepts warnings before the call.",
      "Use LIVE_SESSION_CAPTURE.md during the call.",
      "Use record-draft, human confirmation, then after-live after the call."
    ];
  }
  return [
    "Use LIVE_SESSION_CAPTURE.md during the call.",
    "Fill LIVE_SESSION_HOST_SUMMARY.md after the call.",
    "Use record-draft, human confirmation, then after-live."
  ];
}

function resolveSessionFolder(preLive, selectedTesterId) {
  if (args.session) return path.resolve(rootPath, args.session);
  if (preLive?.sessionFolder) return path.resolve(rootPath, preLive.sessionFolder);
  if (preLive?.sessionRelativePath) return path.resolve(rootPath, preLive.sessionRelativePath);
  return path.join(rootPath, "dist", "trial-session-packs", selectedTesterId);
}

function parseArgs(rawArgs) {
  const parsed = { tester: "", session: "", preLive: "", json: "", markdown: "" };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    let handled = false;
    for (const key of ["tester", "session", "preLive", "json", "markdown"]) {
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
    if (!parsed.session && !arg.startsWith("--")) {
      parsed.session = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function isDisallowedLiveFile(base) {
  return /\.(png|jpg|jpeg|gif|webp|bmp|tiff|log|zip|7z|rar|tar|gz|mp4|mov|avi)$/i.test(base)
    || base === ".env"
    || base.startsWith(".env.")
    || /\.(pem|key|crt)$/i.test(base);
}

function isSourceLikeFile(base) {
  return /\.(js|jsx|ts|tsx|py|java|go|rs|cs|cpp|c|h|hpp|php|rb|swift|kt|mjs|cjs)$/i.test(base);
}

function isSafeIdentityValue(value) {
  const cleaned = cleanCell(value).toLowerCase();
  if (!cleaned || isPlaceholder(cleaned)) return true;
  return /^(tester|host|anonymous|anon|sample|codeclaw-host|product|none|n\/a)([-_\s.]?[a-z0-9]+)*$/i.test(cleaned);
}

function isPlaceholder(value) {
  const cleaned = cleanCell(value);
  return !cleaned || cleaned === "." || cleaned === "-" || /\s\/\s/.test(cleaned);
}

function cleanCell(value) {
  return String(value || "").replace(/`/g, "").replace(/\s+/g, " ").trim();
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

function isInside(candidatePath, allowedRoot) {
  const relativePath = path.relative(allowedRoot, candidatePath);
  return !relativePath || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
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
