import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const distPath = path.join(rootPath, "dist");
const args = parseArgs(process.argv.slice(2));
const testerId = sanitizeTesterId(args.tester || "");
const hostReadyPath = path.resolve(rootPath, args.hostReady || path.join("dist", "TRIAL_HOST_READY_REPORT.json"));
const intakeSessionPath = path.resolve(rootPath, args.intakeSession || path.join("dist", "TRIAL_INTAKE_SESSION_REPORT.json"));
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_HOST_RUN_REPORT.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_HOST_RUN_REPORT.md"));

const report = await buildReport();

await fs.mkdir(path.dirname(jsonPath), { recursive: true });
await fs.mkdir(path.dirname(markdownPath), { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  testerId: report.testerId,
  runbookPath: report.runbookRelativePath,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  jsonPath,
  markdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function buildReport() {
  const hostReady = await readJson(hostReadyPath);
  const intakeSession = await readJson(intakeSessionPath);
  const blockers = [];
  const warnings = [];

  if (!hostReady) blockers.push("Host-ready report is missing. Run npm.cmd run trial:host-ready first.");
  if (hostReady && hostReady.ok === false) blockers.push("Host-ready report is not ok.");
  if (hostReady && hostReady.decision !== "READY_TO_HOST") {
    blockers.push(`Host-ready decision is ${hostReady.decision || "UNKNOWN"}.`);
  }

  const selectedTesterId = sanitizeTesterId(testerId || hostReady?.testerId || intakeSession?.testerId || "tester-1");
  const sessionFolder = resolveSessionFolder(hostReady, selectedTesterId);
  const manifest = sessionFolder ? await readJson(path.join(sessionFolder, "SESSION_PACK_MANIFEST.json")) : null;
  const requiredFiles = [
    "SESSION_BRIEF.md",
    "HUMAN_TRIAL_OBSERVATION.md",
    "TRIAL_FEEDBACK_TEMPLATE.md",
    "TRIAL_RESULT_RECORD.md",
    "SESSION_PACK_MANIFEST.json"
  ];

  if (!sessionFolder) blockers.push("Session folder could not be resolved from host-ready report.");
  if (sessionFolder && !(await exists(sessionFolder))) blockers.push(`Session folder does not exist: ${sessionFolder}`);
  for (const file of requiredFiles) {
    if (sessionFolder && !(await exists(path.join(sessionFolder, file)))) blockers.push(`Session folder is missing ${file}.`);
  }
  if (!manifest && sessionFolder) blockers.push("Session manifest is missing or invalid.");
  if (manifest?.testerId && manifest.testerId !== selectedTesterId) {
    blockers.push(`Session manifest tester ${manifest.testerId} does not match selected tester ${selectedTesterId}.`);
  }
  if (hostReady?.testerId && hostReady.testerId !== selectedTesterId) {
    blockers.push(`Host-ready tester ${hostReady.testerId} does not match selected tester ${selectedTesterId}.`);
  }

  if (!intakeSession) {
    warnings.push("Intake-session report is missing; confirm this is not a real external tester run.");
  } else {
    if (intakeSession.ok === false) blockers.push("Intake-session report is not ok.");
    if (!["INTAKE_SESSION_READY", "INTAKE_SESSION_READY_WITH_REVIEW"].includes(intakeSession.decision)) {
      blockers.push(`Intake-session decision is ${intakeSession.decision || "UNKNOWN"}.`);
    }
    if (intakeSession.testerId && intakeSession.testerId !== selectedTesterId) {
      blockers.push(`Intake-session tester ${intakeSession.testerId} does not match selected tester ${selectedTesterId}.`);
    }
    if (intakeSession.decision === "INTAKE_SESSION_READY_WITH_REVIEW") {
      warnings.push("Tester intake requires explicit host review before the call.");
    }
  }

  const runbookPath = sessionFolder ? path.join(sessionFolder, "HOST_RUNBOOK.md") : "";
  const decision = blockers.length ? "HOST_RUN_HOLD" : warnings.length ? "HOST_RUN_READY_WITH_REVIEW" : "HOST_RUN_READY";
  const runbook = blockers.length ? "" : renderRunbook({
    testerId: selectedTesterId,
    sessionFolder,
    hostReady,
    intakeSession,
    manifest,
    warnings
  });
  if (runbookPath && runbook) await fs.writeFile(runbookPath, runbook, "utf8");

  return {
    ok: blockers.length === 0,
    mode: "trial-host-run",
    createdAt: new Date().toISOString(),
    decision,
    testerId: selectedTesterId,
    hostReadyPath,
    hostReadyRelativePath: relative(hostReadyPath),
    intakeSessionPath,
    intakeSessionRelativePath: relative(intakeSessionPath),
    sessionFolder,
    sessionRelativePath: sessionFolder ? relative(sessionFolder) : "",
    runbookPath,
    runbookRelativePath: runbookPath ? relative(runbookPath) : "",
    blockers,
    warnings,
    liveFiles: requiredFiles,
    watchItems: normalizeWatchItems(hostReady?.watchItems || manifest?.watchItems || []),
    hostChecklist: hostChecklist(blockers.length === 0, warnings),
    nextCommands: blockers.length ? [
      "npm.cmd run trial:host-ready",
      "npm.cmd run trial:host-run"
    ] : [
      `npm.cmd run trial:post-session -- --session ${relative(sessionFolder)} --next-tester ${nextTesterId(selectedTesterId)}`,
      "npm.cmd run trial:status"
    ],
    nextSteps: nextSteps(blockers.length === 0)
  };
}

function resolveSessionFolder(hostReady, selectedTesterId) {
  if (args.session) return path.resolve(rootPath, args.session);
  if (hostReady?.sessionFolder) return path.resolve(rootPath, hostReady.sessionFolder);
  if (hostReady?.sessionRelativePath) return path.resolve(rootPath, hostReady.sessionRelativePath);
  return path.join(rootPath, "dist", "trial-session-packs", selectedTesterId);
}

function renderRunbook({ testerId, sessionFolder, hostReady, intakeSession, manifest, warnings }) {
  const watchItems = normalizeWatchItems(hostReady?.watchItems || manifest?.watchItems || []);
  const tester = intakeSession?.tester || manifest?.testerIntake || {};
  return [
    "# CodeClaw Live Host Runbook",
    "",
    `Tester id: ${testerId}`,
    `Created at: ${new Date().toISOString()}`,
    `Session folder: ${relative(sessionFolder)}`,
    `Host-ready decision: ${hostReady?.decision || "UNKNOWN"}`,
    `Intake-session decision: ${intakeSession?.decision || "MISSING"}`,
    "",
    "## Pre-Call Gate",
    "",
    "- Host-ready report says READY_TO_HOST.",
    "- Tester consent and privacy acceptance were recorded in local intake.",
    "- The tester has not shared API keys, secrets, personal contact data, or private project names in the trial files.",
    "- Keep this runbook, SESSION_BRIEF.md, and HUMAN_TRIAL_OBSERVATION.md open.",
    ...(warnings.length ? ["- Host must explicitly accept the warnings below before starting."] : []),
    "",
    "## Warnings To Accept",
    "",
    ...(warnings.length ? warnings.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Tester Context",
    "",
    `- Tester language: ${tester.language || "UNKNOWN"}`,
    `- Host language: ${tester.hostLanguage || tester.language || "UNKNOWN"}`,
    `- Allowed scope: ${(tester.allowedScope || []).join(", ") || "UNKNOWN"}`,
    `- Needs review: ${tester.needsReview ? "Yes" : "No"}`,
    "",
    "## Live Script",
    "",
    "1. Ask the tester to open the package and start with docs/START_GUIDE.md.",
    "2. Confirm Node.js 20 or later and complete docs/TRIAL_5_MIN_PRECHECK.md.",
    "3. Ask the tester to start CodeClaw and switch language if needed.",
    "4. Ask the tester to run Demo first and say what mode they think they are in.",
    "5. Let Demo reach a patch proposal or patch gate without coaching unless blocked for 30 seconds.",
    "6. Ask the tester to run one real-project read-only preflight only.",
    "7. Ask the tester to explain when CodeClaw reads files, writes files, and runs commands.",
    "8. Stop before Apply on a non-disposable real project.",
    "9. Fill HUMAN_TRIAL_OBSERVATION.md during the session.",
    "10. After the call, fill TRIAL_FEEDBACK_TEMPLATE.md and TRIAL_RESULT_RECORD.md.",
    "",
    "## Watch Items",
    "",
    ...(watchItems.length ? watchItems.map(renderWatchItem) : ["- None"]),
    "",
    "## Stop Conditions",
    "",
    "- The app cannot launch after basic path and Node.js checks.",
    "- The tester is about to paste secrets, tokens, or personal data into a shared record.",
    "- The tester wants to apply changes to a non-disposable real project.",
    "- The tester cannot tell Demo from real-project mode after the first correction.",
    "",
    "## After The Session",
    "",
    "```bash",
    `npm.cmd run trial:post-session -- --session ${relative(sessionFolder)} --next-tester ${nextTesterId(testerId)}`,
    "npm.cmd run trial:status",
    "```",
    ""
  ].join("\n");
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial Host Run Report",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Tester: ${report.testerId}`,
    `Session folder: ${report.sessionRelativePath || "None"}`,
    `Runbook: ${report.runbookRelativePath || "None"}`,
    "",
    "## Blockers",
    "",
    ...(report.blockers.length ? report.blockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Host Checklist",
    "",
    ...report.hostChecklist.map((item) => `- ${item}`),
    "",
    "## Watch Items",
    "",
    ...(report.watchItems.length ? report.watchItems.map(renderWatchItem) : ["- None"]),
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

function hostChecklist(ready, warnings) {
  if (!ready) {
    return [
      "Do not start the hosted session.",
      "Fix every blocker in TRIAL_HOST_RUN_REPORT.md.",
      "Rerun trial:host-ready and trial:host-run."
    ];
  }
  const checklist = [
    "Open HOST_RUNBOOK.md before the call.",
    "Open SESSION_BRIEF.md and HUMAN_TRIAL_OBSERVATION.md.",
    "Start with Demo.",
    "Run only read-only preflight on the real project.",
    "Stop before Apply on non-disposable real projects.",
    "Fill feedback and result records immediately after the call."
  ];
  if (warnings.length) checklist.push("Explicitly accept every warning before starting.");
  return checklist;
}

function nextSteps(ready) {
  if (!ready) {
    return [
      "Resolve host-run blockers.",
      "Regenerate the intake session pack if tester identity or scope changed.",
      "Rerun trial:host-ready, then trial:host-run."
    ];
  }
  return [
    "Host the session using HOST_RUNBOOK.md.",
    "Fill the generated observation, feedback, and result files.",
    "Run post-session and status immediately after the session."
  ];
}

function renderWatchItem(item) {
  const evidence = Array.isArray(item.evidence) ? item.evidence.join("; ") : item.evidence || "No evidence recorded.";
  return `- ${item.id || item.priority || "WATCH"} ${item.title || "Watch item"}: ${item.action || "Observe and record."} Evidence: ${evidence}`;
}

function normalizeWatchItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    id: item.id || "",
    priority: item.priority || "",
    title: item.title || "",
    action: item.action || "",
    evidence: item.evidence || []
  }));
}

function parseArgs(rawArgs) {
  const parsed = { tester: "", session: "", hostReady: "", intakeSession: "", json: "", markdown: "" };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    let handled = false;
    for (const key of ["tester", "session", "hostReady", "intakeSession", "json", "markdown"]) {
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
    if (!parsed.tester && !arg.startsWith("--")) {
      parsed.tester = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function sanitizeTesterId(value) {
  const cleaned = String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "";
}

function nextTesterId(value) {
  const match = String(value || "").match(/^(.*?)(\d+)$/);
  if (!match) return `${sanitizeTesterId(value) || "tester"}-next`;
  return `${match[1]}${Number(match[2]) + 1}`;
}

function relative(targetPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
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
