import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const distPath = path.join(rootPath, "dist");
const args = parseArgs(process.argv.slice(2));
const testerId = sanitizeTesterId(args.tester || "tester-1");
const dispatchPath = path.resolve(rootPath, args.dispatch || path.join("dist", "TRIAL_DISPATCH_NOTE.json"));
const backlogPath = path.resolve(rootPath, args.backlog || path.join("dist", "TRIAL_FIX_BACKLOG.json"));
const sessionManifestPath = path.resolve(
  rootPath,
  args.session || path.join("dist", "trial-session-packs", testerId, "SESSION_PACK_MANIFEST.json")
);
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_HOST_READY_REPORT.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_HOST_READY_REPORT.md"));

const inputs = {
  dispatch: await readJson(dispatchPath, "dispatch"),
  backlog: await readJson(backlogPath, "fix backlog"),
  session: await readJson(sessionManifestPath, "session pack manifest")
};
const report = await buildReport(inputs);

await fs.mkdir(distPath, { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  testerId,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  jsonPath,
  markdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function buildReport({ dispatch, backlog, session }) {
  const blockers = [];
  const warnings = [];

  if (!dispatch.ok || dispatch.decision !== "READY_TO_SEND") blockers.push("Dispatch note is not READY_TO_SEND.");
  if ((dispatch.blockers || []).length) blockers.push(`Dispatch has blockers: ${dispatch.blockers.join("; ")}`);
  if ((dispatch.missingPackageDocs || []).length) blockers.push(`Package missing dispatch docs: ${dispatch.missingPackageDocs.join(", ")}`);

  const packagePath = dispatch.packagePath || "";
  if (!packagePath) blockers.push("Dispatch report does not include packagePath.");
  if (packagePath && !(await exists(packagePath))) blockers.push(`Package path does not exist: ${packagePath}`);
  if (packagePath) {
    const packageIssues = await inspectPackage(packagePath, dispatch.requiredDocs || []);
    blockers.push(...packageIssues.blockers);
    warnings.push(...packageIssues.warnings);
  }

  if (!backlog.ok) blockers.push("Fix backlog report is not ok.");
  if (backlog.decision === "FIX_BLOCKERS_BEFORE_TESTER_2") blockers.push("Fix backlog requires blockers to be fixed before hosting.");
  if (backlog.decision === "WAITING_FOR_FEEDBACK") warnings.push("Fix backlog is waiting for feedback; first tester sessions can still proceed with an empty watch list.");
  if ((backlog.mustFixBeforeTester2 || []).length) {
    blockers.push(`Fix backlog has P0 items: ${(backlog.mustFixBeforeTester2 || []).map((item) => item.id || item.title).join(", ")}`);
  }
  if (backlog.tester2Gate?.requiresHostAcceptance) {
    warnings.push("Backlog has watch items that require explicit host acceptance.");
  }

  const sessionFolder = sessionFolderPath(session);
  if (!session.ok) blockers.push("Session pack manifest is not ok.");
  if (!sessionFolder) blockers.push("Session pack manifest does not include an output path.");
  if (sessionFolder && !(await exists(sessionFolder))) blockers.push(`Session pack folder does not exist: ${sessionFolder}`);
  const sessionIssues = sessionFolder ? await inspectSessionPack(sessionFolder, session, backlog) : { blockers: [], warnings: [] };
  blockers.push(...sessionIssues.blockers);
  warnings.push(...sessionIssues.warnings);

  const decision = blockers.length ? "HOLD" : "READY_TO_HOST";
  return {
    ok: blockers.length === 0,
    mode: "trial-host-ready",
    createdAt: new Date().toISOString(),
    decision,
    testerId,
    inputs: {
      dispatchPath,
      backlogPath,
      sessionManifestPath
    },
    packagePath,
    packageRelativePath: packagePath ? relative(packagePath) : "",
    sessionFolder,
    sessionRelativePath: sessionFolder ? relative(sessionFolder) : "",
    dispatchDecision: dispatch.decision || "UNKNOWN",
    backlogDecision: backlog.decision || "UNKNOWN",
    sessionBacklogDecision: session.backlogDecision || "UNKNOWN",
    blockers,
    warnings,
    watchItems: session.watchItems || backlog.watchDuringTester2 || [],
    hostChecklist: hostChecklist(decision, warnings),
    nextSteps: nextSteps(decision)
  };
}

async function inspectPackage(packagePath, requiredDocs) {
  const blockers = [];
  const warnings = [];
  for (const doc of requiredDocs) {
    if (!(await exists(path.join(packagePath, doc)))) blockers.push(`Package is missing required doc: ${doc}`);
  }
  const disallowed = [
    "docs/trial-feedback",
    "trial-session-packs",
    "dist/trial-session-packs",
    ".codeclaw",
    ".git",
    "node_modules",
    ".env"
  ];
  for (const entry of disallowed) {
    if (await exists(path.join(packagePath, ...entry.split("/")))) blockers.push(`Package contains disallowed hosted-trial state: ${entry}`);
  }
  if (await exists(path.join(packagePath, "dist"))) warnings.push("Package contains a dist folder; confirm it was not created after readiness packaging.");
  return { blockers, warnings };
}

async function inspectSessionPack(sessionFolder, session, backlog) {
  const blockers = [];
  const warnings = [];
  const requiredFiles = unique([
    "SESSION_BRIEF.md",
    "SESSION_PACK_MANIFEST.json",
    ...(session.files || [])
  ]);
  for (const file of requiredFiles) {
    if (!(await exists(path.join(sessionFolder, file)))) blockers.push(`Session pack is missing ${file}.`);
  }
  const briefPath = path.join(sessionFolder, "SESSION_BRIEF.md");
  const observationPath = path.join(sessionFolder, "HUMAN_TRIAL_OBSERVATION.md");
  const brief = await readTextIfExists(briefPath);
  const observation = await readTextIfExists(observationPath);
  const watchItems = session.watchItems || backlog.watchDuringTester2 || [];
  for (const item of watchItems) {
    if (!item.id) continue;
    if (!brief.includes(item.id)) blockers.push(`SESSION_BRIEF.md does not include watch item ${item.id}.`);
    if (!observation.includes(item.id)) blockers.push(`HUMAN_TRIAL_OBSERVATION.md does not include watch item ${item.id}.`);
  }
  if (session.backlogDecision !== backlog.decision) warnings.push("Session pack backlog decision differs from current fix backlog decision; regenerate trial:session-pack.");
  if ((session.gate?.mustFixCount || 0) > 0) blockers.push("Session pack manifest reports must-fix items.");
  return { blockers, warnings };
}

function hostChecklist(decision, warnings) {
  if (decision !== "READY_TO_HOST") {
    return [
      "Fix every blocker in TRIAL_HOST_READY_REPORT.md.",
      "Rerun trial:dispatch, trial:fix-backlog, trial:session-pack, and trial:host-ready.",
      "Do not start the hosted session yet."
    ];
  }
  const checklist = [
    "Open BEGINNER_FIRST_LIVE_GUIDE.md and SESSION_BRIEF.md before the call.",
    "Reconfirm the real human's consent before handing over the browser.",
    "Start with Demo, then run one real-project read-only preflight.",
    "Stop before Apply on a non-disposable real project.",
    "Fill the generated HUMAN_TRIAL_OBSERVATION.md during the session.",
    "Afterward, run record-draft, fill only confirmed record values, then run after-live."
  ];
  if (warnings.length) checklist.push("Explicitly accept the warnings before starting.");
  return checklist;
}

function nextSteps(decision) {
  if (decision !== "READY_TO_HOST") {
    return [
      "Resolve blockers.",
      "Run npm.cmd run trial:ready, trial:freeze, trial:dispatch if the package changed.",
      "Run npm.cmd run trial:session-pack -- --force.",
      "Run npm.cmd run trial:host-ready."
    ];
  }
  return [
    "Host the tester session with BEGINNER_FIRST_LIVE_GUIDE.md and SESSION_BRIEF.md open.",
    "After the session, run trial:record-draft and ask the human for missing answers.",
    "Run trial:after-live only after all three final records are complete."
  ];
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      mode: label,
      decision: "MISSING",
      readError: `Missing or invalid ${label}: ${filePath}\n${error.message}`
    };
  }
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function sessionFolderPath(session) {
  if (session.outputRelativePath) return path.resolve(rootPath, session.outputRelativePath);
  if (session.outputPath) return session.outputPath;
  return "";
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial Host Ready Report",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Tester: ${report.testerId}`,
    `Package: ${report.packageRelativePath || "None"}`,
    `Session folder: ${report.sessionRelativePath || "None"}`,
    "",
    "## Blockers",
    "",
    ...(report.blockers.length ? report.blockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Watch Items",
    "",
    ...(report.watchItems.length ? report.watchItems.map(renderWatchItem) : ["- None"]),
    "",
    "## Host Checklist",
    "",
    ...report.hostChecklist.map((item) => `- ${item}`),
    "",
    "## Next Steps",
    "",
    ...report.nextSteps.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function renderWatchItem(item) {
  const evidence = Array.isArray(item.evidence) ? item.evidence.join("; ") : item.evidence || "No evidence recorded.";
  return `- ${item.id || item.priority || "WATCH"} ${item.title || "Watch item"}: ${evidence}`;
}

function relative(targetPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
}

function parseArgs(rawArgs) {
  const parsed = { tester: "", dispatch: "", backlog: "", session: "", json: "", markdown: "" };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--tester") {
      parsed.tester = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--tester=")) {
      parsed.tester = arg.slice("--tester=".length);
      continue;
    }
    let handled = false;
    for (const key of ["dispatch", "backlog", "session", "json", "markdown"]) {
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
    if (arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function sanitizeTesterId(value) {
  const cleaned = String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "tester-1";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
