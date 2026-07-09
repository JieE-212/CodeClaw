import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const distPath = path.join(rootPath, "dist");
const args = parseArgs(process.argv.slice(2));
const testerIdOverride = args.tester ? sanitizeTesterId(args.tester) : "";
const rosterPath = path.resolve(rootPath, args.roster || path.join(".codeclaw", "trial-intake", "TESTER_ROSTER.json"));
const dryRunPath = path.resolve(rootPath, args.dryRun || path.join("dist", "TRIAL_INTAKE_REVIEW_DRY_RUN_REPORT.json"));
const intakePath = path.resolve(rootPath, args.intake || path.join("dist", "TRIAL_TESTER_INTAKE_REPORT.json"));
const intakeSessionPath = path.resolve(rootPath, args.intakeSession || path.join("dist", "TRIAL_INTAKE_SESSION_REPORT.json"));
const hostReadyPath = path.resolve(rootPath, args.hostReady || path.join("dist", "TRIAL_HOST_READY_REPORT.json"));
const hostRunPath = path.resolve(rootPath, args.hostRun || path.join("dist", "TRIAL_HOST_RUN_REPORT.json"));
const statusPath = path.resolve(rootPath, args.status || path.join("dist", "TRIAL_STATUS_REPORT.json"));
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_PRE_LIVE_REPORT.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_PRE_LIVE_REPORT.md"));

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
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  jsonPath,
  markdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function buildReport() {
  const dryRun = await readJson(dryRunPath);
  const intake = await readJson(intakePath);
  const intakeSession = await readJson(intakeSessionPath);
  const hostReady = await readJson(hostReadyPath);
  const hostRun = await readJson(hostRunPath);
  const status = await readJson(statusPath);
  const roster = await readJson(rosterPath);
  const blockers = [];
  const warnings = [];

  if (!dryRun) blockers.push("Intake-to-review dry-run report is missing. Run npm.cmd run trial:intake-review-dry-run -- --force first.");
  if (dryRun && dryRun.ok === false) blockers.push("Intake-to-review dry run is not ok.");
  if (dryRun && dryRun.decision !== "DRY_RUN_READY_FOR_REAL_INTAKE") {
    blockers.push(`Intake-to-review dry-run decision is ${dryRun.decision || "UNKNOWN"}.`);
  }

  if (!intake) blockers.push("Tester intake report is missing. Run npm.cmd run trial:intake first.");
  if (intake && intake.ok === false) blockers.push("Tester intake report is not ok.");
  if (intake && !["READY_FOR_SESSION", "READY_FOR_SESSION_WITH_REVIEW"].includes(intake.decision)) {
    blockers.push(`Tester intake decision is ${intake.decision || "UNKNOWN"}.`);
  }

  const tester = intake ? selectTester(intake, testerIdOverride) : null;
  const testerId = tester?.id || testerIdOverride || "";
  if (intake && testerIdOverride && !tester) blockers.push(`Tester ${testerIdOverride} was not found in the intake report.`);
  if (intake && !testerIdOverride && !tester) blockers.push("No ready tester was found in the intake report.");
  if (tester?.blocked) blockers.push(`${tester.id}: tester intake is blocked.`);
  if (tester && !tester.ready) blockers.push(`${tester.id}: tester is not ready.`);
  if (tester && isDryRunTesterId(tester.id)) blockers.push(`${tester.id}: dry-run tester ids cannot be used for a real live session.`);
  if (tester?.needsReview || intake?.decision === "READY_FOR_SESSION_WITH_REVIEW") {
    warnings.push("Tester intake has host-review warnings; host must explicitly accept them before the call.");
  }

  const intakeRosterPath = intake?.rosterRelativePath || "";
  if (!args.allowCustomRoster && intakeRosterPath && !intakeRosterPath.startsWith(".codeclaw/trial-intake/")) {
    blockers.push(`Real tester intake must use .codeclaw/trial-intake/, not ${intakeRosterPath}.`);
  }
  if (intakeRosterPath.startsWith("dist/trial-dry-runs/")) blockers.push("Dry-run roster cannot be used for a real live session.");
  if (!roster) blockers.push(`Roster file is missing or invalid: ${relative(rosterPath)}.`);
  if (roster) {
    const rosterIssues = inspectRoster(roster, testerId);
    blockers.push(...rosterIssues.blockers);
    warnings.push(...rosterIssues.warnings);
  }

  if (!intakeSession) blockers.push("Intake-session report is missing. Run npm.cmd run trial:intake-session -- --force.");
  if (intakeSession && intakeSession.ok === false) blockers.push("Intake-session report is not ok.");
  if (intakeSession && !["INTAKE_SESSION_READY", "INTAKE_SESSION_READY_WITH_REVIEW"].includes(intakeSession.decision)) {
    blockers.push(`Intake-session decision is ${intakeSession.decision || "UNKNOWN"}.`);
  }
  if (testerId && intakeSession?.testerId && intakeSession.testerId !== testerId) {
    blockers.push(`Intake-session tester ${intakeSession.testerId} does not match selected tester ${testerId}.`);
  }
  if (intakeSession?.decision === "INTAKE_SESSION_READY_WITH_REVIEW") {
    warnings.push("Intake session is ready with review; host must accept warnings before live session.");
  }

  const sessionFolder = resolveSessionFolder({ intakeSession, hostReady, hostRun, testerId });
  const manifest = sessionFolder ? await readJson(path.join(sessionFolder, "SESSION_PACK_MANIFEST.json")) : null;
  const sessionIssues = await inspectSessionFolder({ sessionFolder, manifest, testerId });
  blockers.push(...sessionIssues.blockers);
  warnings.push(...sessionIssues.warnings);

  if (!hostReady) blockers.push("Host-ready report is missing. Run npm.cmd run trial:host-ready.");
  if (hostReady && hostReady.ok === false) blockers.push("Host-ready report is not ok.");
  if (hostReady && hostReady.decision !== "READY_TO_HOST") blockers.push(`Host-ready decision is ${hostReady.decision || "UNKNOWN"}.`);
  if (testerId && hostReady?.testerId && hostReady.testerId !== testerId) {
    blockers.push(`Host-ready tester ${hostReady.testerId} does not match selected tester ${testerId}.`);
  }
  if (hostReady?.warnings?.length) warnings.push(...hostReady.warnings.map((item) => `Host-ready: ${item}`));

  if (!hostRun) blockers.push("Host-run report is missing. Run npm.cmd run trial:host-run.");
  if (hostRun && hostRun.ok === false) blockers.push("Host-run report is not ok.");
  if (hostRun && !["HOST_RUN_READY", "HOST_RUN_READY_WITH_REVIEW"].includes(hostRun.decision)) {
    blockers.push(`Host-run decision is ${hostRun.decision || "UNKNOWN"}.`);
  }
  if (testerId && hostRun?.testerId && hostRun.testerId !== testerId) {
    blockers.push(`Host-run tester ${hostRun.testerId} does not match selected tester ${testerId}.`);
  }
  if (hostRun?.decision === "HOST_RUN_READY_WITH_REVIEW") warnings.push("Host-run is ready with review; host must accept warnings before live session.");
  if (hostRun?.warnings?.length) warnings.push(...hostRun.warnings.map((item) => `Host-run: ${item}`));

  if (!status) warnings.push("Trial status report is missing. Run npm.cmd run trial:status after pre-live.");
  if (status?.ok === false) warnings.push(`Trial status currently reports blockers: ${status.decision || "UNKNOWN"}.`);

  const decision = blockers.length
    ? "PRE_LIVE_HOLD"
    : warnings.length
      ? "PRE_LIVE_READY_WITH_HOST_REVIEW"
      : "PRE_LIVE_READY_TO_HOST";

  return {
    ok: blockers.length === 0,
    mode: "trial-pre-live",
    createdAt: new Date().toISOString(),
    decision,
    testerId,
    tester: tester ? {
      id: tester.id,
      language: tester.language,
      hostLanguage: tester.hostLanguage,
      allowedScope: tester.allowedScope || [],
      needsReview: Boolean(tester.needsReview)
    } : null,
    rosterPath,
    rosterRelativePath: relative(rosterPath),
    sessionFolder,
    sessionRelativePath: sessionFolder ? relative(sessionFolder) : "",
    reports: {
      dryRun: reportRef(dryRunPath, dryRun),
      intake: reportRef(intakePath, intake),
      intakeSession: reportRef(intakeSessionPath, intakeSession),
      hostReady: reportRef(hostReadyPath, hostReady),
      hostRun: reportRef(hostRunPath, hostRun),
      status: reportRef(statusPath, status)
    },
    blockers: unique(blockers),
    warnings: unique(warnings),
    launchChecklist: launchChecklist(decision, testerId),
    launchCommands: launchCommands(testerId),
    nextSteps: nextSteps(decision, testerId)
  };
}

function selectTester(intake, testerId) {
  const testers = Array.isArray(intake.testers) ? intake.testers : [];
  if (testerId) return testers.find((item) => item.id === testerId) || null;
  return intake.nextTester || testers.find((item) => item.ready) || null;
}

function inspectRoster(roster, testerId) {
  const blockers = [];
  const warnings = [];
  if (roster.localOnly !== true) warnings.push("Roster localOnly is not true; keep real tester data local.");
  if (!Array.isArray(roster.testers)) {
    blockers.push("Roster must contain a testers array.");
    return { blockers, warnings };
  }
  const tester = roster.testers.find((item) => sanitizeTesterId(item.id || item.testerId || "") === testerId);
  if (!tester) {
    blockers.push(`Roster does not contain selected tester ${testerId}.`);
    return { blockers, warnings };
  }
  for (const field of personalFieldNames()) {
    if (Object.hasOwn(tester, field)) blockers.push(`${testerId}: remove personal field "${field}" from roster before live session.`);
  }
  if (tester.consent !== true) blockers.push(`${testerId}: consent must be true in the roster.`);
  if (tester.privacyAccepted !== true) blockers.push(`${testerId}: privacyAccepted must be true in the roster.`);
  if (!Array.isArray(tester.allowedScope) || !tester.allowedScope.includes("demo")) blockers.push(`${testerId}: allowedScope must include demo.`);
  if (Array.isArray(tester.allowedScope) && tester.allowedScope.includes("real-apply")) warnings.push(`${testerId}: real-apply is not recommended for the first live session.`);
  if (isDryRunTesterId(testerId)) blockers.push(`${testerId}: selected tester looks like a dry-run tester.`);
  return { blockers, warnings };
}

async function inspectSessionFolder({ sessionFolder, manifest, testerId }) {
  const blockers = [];
  const warnings = [];
  if (!sessionFolder) {
    blockers.push("Session folder could not be resolved.");
    return { blockers, warnings };
  }
  if (isInside(sessionFolder, path.join(distPath, "trial-dry-runs"))) blockers.push("Session folder is inside dry-run output; generate a real tester session pack.");
  if (!(await exists(sessionFolder))) {
    blockers.push(`Session folder does not exist: ${relative(sessionFolder)}.`);
    return { blockers, warnings };
  }
  for (const file of ["SESSION_BRIEF.md", "HOST_RUNBOOK.md", "HUMAN_TRIAL_OBSERVATION.md", "TRIAL_FEEDBACK_TEMPLATE.md", "TRIAL_RESULT_RECORD.md", "SESSION_PACK_MANIFEST.json"]) {
    if (!(await exists(path.join(sessionFolder, file)))) blockers.push(`Session folder is missing ${file}.`);
  }
  if (!manifest) blockers.push("Session manifest is missing or invalid.");
  if (manifest?.testerId && manifest.testerId !== testerId) blockers.push(`Session manifest tester ${manifest.testerId} does not match selected tester ${testerId}.`);
  if (manifest?.testerIntake) {
    if (manifest.testerIntake.consent !== true) blockers.push("Session manifest does not record tester consent.");
    if (manifest.testerIntake.privacyAccepted !== true) blockers.push("Session manifest does not record privacy acceptance.");
    if (manifest.testerIntake.needsReview) warnings.push("Session manifest tester intake requires host review.");
  }
  return { blockers, warnings };
}

function resolveSessionFolder({ intakeSession, hostReady, hostRun, testerId }) {
  if (args.session) return path.resolve(rootPath, args.session);
  for (const report of [hostRun, hostReady, intakeSession]) {
    if (report?.sessionFolder) return path.resolve(rootPath, report.sessionFolder);
    if (report?.sessionRelativePath) return path.resolve(rootPath, report.sessionRelativePath);
  }
  return testerId ? path.join(rootPath, "dist", "trial-session-packs", testerId) : "";
}

function launchChecklist(decision, testerId) {
  if (decision === "PRE_LIVE_HOLD") {
    return [
      "Do not schedule the live tester session yet.",
      "Fix every blocker in TRIAL_PRE_LIVE_REPORT.md.",
      "Rerun trial:pre-live."
    ];
  }
  return [
    `Confirm the live tester id is ${testerId}.`,
    "Open HOST_RUNBOOK.md, SESSION_BRIEF.md, and HUMAN_TRIAL_OBSERVATION.md.",
    "Start with Demo.",
    "Run only one real-project read-only preflight.",
    "Stop before Apply on a non-disposable real project.",
    "Fill observation, feedback, and result records immediately after the call."
  ];
}

function launchCommands(testerId) {
  const selected = testerId || "<tester-id>";
  return [
    "npm.cmd run trial:intake",
    `npm.cmd run trial:intake-session -- --tester ${selected} --force`,
    `npm.cmd run trial:host-ready -- --tester ${selected}`,
    `npm.cmd run trial:host-run -- --tester ${selected}`,
    `npm.cmd run trial:pre-live -- --tester ${selected}`,
    "npm.cmd run trial:status"
  ];
}

function nextSteps(decision, testerId) {
  if (decision === "PRE_LIVE_HOLD") {
    return [
      "Run or rerun the missing command shown in the blockers.",
      "Keep the real tester roster local-only and anonymous.",
      `Rerun npm.cmd run trial:pre-live -- --tester ${testerId || "<tester-id>"}.`
    ];
  }
  if (decision === "PRE_LIVE_READY_WITH_HOST_REVIEW") {
    return [
      "Host reviews and accepts warnings before the call.",
      "Use HOST_RUNBOOK.md as the live script.",
      "After the call, run trial:complete-session and trial:post-session."
    ];
  }
  return [
    "Schedule or start the first live tester session.",
    "Use HOST_RUNBOOK.md as the live script.",
    "After the call, run trial:complete-session, trial:post-session, and trial:review-session."
  ];
}

function reportRef(filePath, data) {
  return {
    exists: Boolean(data),
    ok: data?.ok ?? null,
    decision: data?.decision || "MISSING",
    relativePath: relative(filePath)
  };
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial Pre-Live Gate",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Tester: ${report.testerId || "None"}`,
    `Roster: ${report.rosterRelativePath}`,
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
    "## Reports",
    "",
    "| Report | Exists | Decision |",
    "| --- | --- | --- |",
    ...Object.entries(report.reports).map(([key, item]) => `| ${key} | ${item.exists ? "Yes" : "No"} | ${item.decision} |`),
    "",
    "## Launch Checklist",
    "",
    ...report.launchChecklist.map((item) => `- ${item}`),
    "",
    "## Command Sequence",
    "",
    "```bash",
    ...report.launchCommands,
    "```",
    "",
    "## Next Steps",
    "",
    ...report.nextSteps.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function parseArgs(rawArgs) {
  const parsed = {
    tester: "",
    roster: "",
    dryRun: "",
    intake: "",
    intakeSession: "",
    hostReady: "",
    hostRun: "",
    status: "",
    session: "",
    json: "",
    markdown: "",
    allowCustomRoster: false
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--allow-custom-roster") {
      parsed.allowCustomRoster = true;
      continue;
    }
    let handled = false;
    for (const key of ["tester", "roster", "dryRun", "intake", "intakeSession", "hostReady", "hostRun", "status", "session", "json", "markdown"]) {
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

function personalFieldNames() {
  return ["name", "realName", "email", "phone", "contact", "company", "github", "gitee", "wechat", "projectName", "repoName"];
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
