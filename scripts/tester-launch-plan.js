import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const args = parseArgs(process.argv.slice(2));
const reportsPath = path.resolve(rootPath, args.reports || "dist");
const testerIdOverride = sanitizeTesterId(args.tester || "");
const firstLive = Boolean(args.firstLive);
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_TESTER_LAUNCH_PLAN.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_TESTER_LAUNCH_PLAN.md"));

const report = await buildReport();

await fs.mkdir(path.dirname(jsonPath), { recursive: true });
await fs.mkdir(path.dirname(markdownPath), { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  testerId: report.testerId,
  currentStep: report.currentStep,
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
    afterLive: await readReport("TRIAL_AFTER_LIVE_REPORT.json"),
    nextLive: await readReport("TRIAL_NEXT_LIVE_REPORT.json"),
    status: await readReport("TRIAL_STATUS_REPORT.json")
  };
  const previousTester = firstLive ? "" : sanitizeTesterId(reports.afterLive.data?.testerId || "");
  const testerId = inferTesterId(reports, previousTester);
  const blockers = [];
  const warnings = [];

  if (!testerId) warnings.push("No target tester id is selected yet; fill the local roster or pass --tester tester-2.");
  if (testerId && isDryRunTesterId(testerId)) blockers.push(`${testerId}: dry-run tester ids cannot be used for a real tester launch.`);
  if (testerId && previousTester && testerId === previousTester) blockers.push(`${testerId}: target tester matches the previous tester.`);

  const intakeTester = inspectIntake(reports.intake, testerId, blockers, warnings);
  const intakeReady = ["READY_FOR_SESSION", "READY_FOR_SESSION_WITH_REVIEW"].includes(reports.intake.data?.decision);
  if (intakeReady) {
    inspectAlignedReport({ label: "intake-session", report: reports.intakeSession, testerId, readyDecisions: ["INTAKE_SESSION_READY", "INTAKE_SESSION_READY_WITH_REVIEW"], blockers, warnings });
  }
  const intakeSessionReady = intakeReady && ["INTAKE_SESSION_READY", "INTAKE_SESSION_READY_WITH_REVIEW"].includes(reports.intakeSession.data?.decision);
  if (intakeSessionReady) {
    inspectAlignedReport({ label: "host-ready", report: reports.hostReady, testerId, readyDecisions: ["READY_TO_HOST"], blockers, warnings });
  }
  const hostReadyReady = intakeSessionReady && reports.hostReady.data?.decision === "READY_TO_HOST";
  if (hostReadyReady) {
    inspectAlignedReport({ label: "host-run", report: reports.hostRun, testerId, readyDecisions: ["HOST_RUN_READY", "HOST_RUN_READY_WITH_REVIEW"], blockers, warnings });
  }
  const hostRunReady = hostReadyReady && ["HOST_RUN_READY", "HOST_RUN_READY_WITH_REVIEW"].includes(reports.hostRun.data?.decision);
  if (hostRunReady) {
    inspectAlignedReport({ label: "pre-live", report: reports.preLive, testerId, readyDecisions: ["PRE_LIVE_READY_TO_HOST", "PRE_LIVE_READY_WITH_HOST_REVIEW"], blockers, warnings });
  }
  const preLiveReady = hostRunReady && ["PRE_LIVE_READY_TO_HOST", "PRE_LIVE_READY_WITH_HOST_REVIEW"].includes(reports.preLive.data?.decision);
  if (preLiveReady) {
    inspectAlignedReport({ label: "live-capture", report: reports.liveCapture, testerId, readyDecisions: ["LIVE_CAPTURE_READY", "LIVE_CAPTURE_READY_WITH_REVIEW"], blockers, warnings });
  }
  const liveCaptureReady = preLiveReady && ["LIVE_CAPTURE_READY", "LIVE_CAPTURE_READY_WITH_REVIEW"].includes(reports.liveCapture.data?.decision);
  if (liveCaptureReady && !firstLive) {
    inspectAlignedReport({ label: "next-live", report: reports.nextLive, testerId, readyDecisions: ["NEXT_LIVE_READY", "NEXT_LIVE_READY_WITH_REVIEW"], blockers, warnings, optional: true });
  }

  const state = decideState(reports, testerId, blockers);
  return {
    ok: blockers.length === 0 && state.ok,
    mode: "trial-tester-launch-plan",
    createdAt: new Date().toISOString(),
    decision: state.decision,
    currentStep: state.currentStep,
    testerId,
    previousTester,
    firstLive,
    tester: intakeTester,
    reportsPath,
    reportsRelativePath: relative(reportsPath),
    reports: reportRefs(reports),
    blockers: unique([...blockers, ...state.blockers]),
    warnings: unique(warnings),
    rosterChecklist: rosterChecklist(testerId || "tester-2"),
    commandSequence: commandSequence(testerId || "<tester-id>", firstLive),
    nextCommand: state.nextCommand,
    nextSteps: nextSteps(state.decision, testerId, firstLive)
  };
}

function inspectIntake(report, testerId, blockers, warnings) {
  if (!report.exists) {
    warnings.push("Tester intake report is missing. Run npm.cmd run trial:intake.");
    return null;
  }
  const intake = report.data;
  if (intake.ok === false) blockers.push("Tester intake report is not ok.");
  if (intake.decision === "WAITING_FOR_TESTER_INTAKE") warnings.push("Tester intake is waiting for a local anonymous roster entry.");
  if (intake.decision === "INTAKE_HOLD") blockers.push("Tester intake is on hold.");
  if (!["READY_FOR_SESSION", "READY_FOR_SESSION_WITH_REVIEW", "WAITING_FOR_TESTER_INTAKE"].includes(intake.decision)) {
    blockers.push(`Tester intake decision is ${intake.decision || "UNKNOWN"}.`);
  }
  const testers = Array.isArray(intake.testers) ? intake.testers : [];
  const tester = testerId ? testers.find((item) => sanitizeTesterId(item.id) === testerId) : intake.nextTester || null;
  if (testerId && intake.decision !== "WAITING_FOR_TESTER_INTAKE" && !tester) blockers.push(`${testerId}: tester is not present in the intake report.`);
  if (tester?.blocked) blockers.push(`${tester.id}: tester intake is blocked.`);
  if (tester && !tester.ready) blockers.push(`${tester.id}: tester is not ready.`);
  if (tester?.needsReview || intake.decision === "READY_FOR_SESSION_WITH_REVIEW") warnings.push("Tester intake requires host review.");
  return tester ? {
    id: tester.id,
    language: tester.language,
    hostLanguage: tester.hostLanguage,
    allowedScope: tester.allowedScope || [],
    needsReview: Boolean(tester.needsReview)
  } : null;
}

function inspectAlignedReport({ label, report, testerId, readyDecisions, blockers, warnings, optional = false }) {
  if (!report.exists) {
    if (!optional) warnings.push(`${label} report is missing.`);
    return;
  }
  if (report.data?.ok === false) warnings.push(`${label} report is not ok yet; rerun the ${label} command when this step is current.`);
  const decision = report.data?.decision || "MISSING";
  if (!readyDecisions.includes(decision)) {
    if (optional && decision === "MISSING") return;
    warnings.push(`${label} decision is ${decision}; rerun this step when it becomes current.`);
  }
  if (testerId && report.data?.testerId && sanitizeTesterId(report.data.testerId) !== testerId) {
    blockers.push(`${label} tester ${report.data.testerId} does not match target tester ${testerId}.`);
  }
  if (/WITH_REVIEW$/.test(decision) || decision === "INTAKE_SESSION_READY_WITH_REVIEW") {
    warnings.push(`${label} is ready with review; host acceptance will be required.`);
  }
}

function decideState(reports, testerId, blockers) {
  if (blockers.length) return state(false, "TESTER_LAUNCH_BLOCKED", "blocked", "npm.cmd run trial:tester-launch-plan", blockers);
  if (!reports.intake.exists || reports.intake.data?.decision === "WAITING_FOR_TESTER_INTAKE") {
    return state(true, "TESTER_LAUNCH_WAITING_FOR_INTAKE", "intake", "npm.cmd run trial:intake", []);
  }
  if (reports.intake.data?.decision === "INTAKE_HOLD") {
    return state(false, "TESTER_LAUNCH_BLOCKED", "intake", "npm.cmd run trial:intake", ["Tester intake is on hold."]);
  }
  if (!reports.intakeSession.exists || !["INTAKE_SESSION_READY", "INTAKE_SESSION_READY_WITH_REVIEW"].includes(reports.intakeSession.data?.decision)) {
    return state(true, "TESTER_LAUNCH_READY_FOR_INTAKE_SESSION", "intake-session", `npm.cmd run trial:intake-session -- --tester ${testerId || "<tester-id>"} --force`, []);
  }
  if (!reports.hostReady.exists || reports.hostReady.data?.decision !== "READY_TO_HOST") {
    return state(true, "TESTER_LAUNCH_READY_FOR_HOST_READY", "host-ready", `npm.cmd run trial:host-ready -- --tester ${testerId || "<tester-id>"}`, []);
  }
  if (!reports.hostRun.exists || !["HOST_RUN_READY", "HOST_RUN_READY_WITH_REVIEW"].includes(reports.hostRun.data?.decision)) {
    return state(true, "TESTER_LAUNCH_READY_FOR_HOST_RUN", "host-run", `npm.cmd run trial:host-run -- --tester ${testerId || "<tester-id>"}`, []);
  }
  if (!reports.preLive.exists || !["PRE_LIVE_READY_TO_HOST", "PRE_LIVE_READY_WITH_HOST_REVIEW"].includes(reports.preLive.data?.decision)) {
    return state(true, "TESTER_LAUNCH_READY_FOR_PRE_LIVE", "pre-live", `npm.cmd run trial:pre-live -- --tester ${testerId || "<tester-id>"}`, []);
  }
  if (!reports.liveCapture.exists || !["LIVE_CAPTURE_READY", "LIVE_CAPTURE_READY_WITH_REVIEW"].includes(reports.liveCapture.data?.decision)) {
    return state(true, "TESTER_LAUNCH_READY_FOR_LIVE_CAPTURE", "live-capture", `npm.cmd run trial:live-capture -- --tester ${testerId || "<tester-id>"}`, []);
  }
  if (firstLive) {
    return state(true, "TESTER_LAUNCH_READY_TO_HOST", "host", "Open BEGINNER_FIRST_LIVE_GUIDE.md, LIVE_SESSION_CAPTURE.md, and HOST_RUNBOOK.md", []);
  }
  if (!reports.nextLive.exists || !["NEXT_LIVE_READY", "NEXT_LIVE_READY_WITH_REVIEW"].includes(reports.nextLive.data?.decision)) {
    return state(true, "TESTER_LAUNCH_READY_FOR_NEXT_LIVE", "next-live", `npm.cmd run trial:next-live -- --tester ${testerId || "<tester-id>"} --accept-review --accepted-by <host-id>`, []);
  }
  return state(true, "TESTER_LAUNCH_READY_TO_HOST", "host", "Open NEXT_LIVE_HOST_HANDOFF.md", []);
}

function state(ok, decision, currentStep, nextCommand, blockers) {
  return { ok, decision, currentStep, nextCommand, blockers };
}

function inferTesterId(reports, previousTester) {
  const candidates = [
    testerIdOverride,
    reports.afterLive.data?.nextTester,
    reports.intake.data?.nextTester?.id,
    reports.intake.data?.testers?.find?.((tester) => tester.ready)?.id,
    reports.liveCapture.data?.testerId,
    reports.preLive.data?.testerId,
    reports.hostRun.data?.testerId,
    reports.hostReady.data?.testerId,
    reports.intakeSession.data?.testerId
  ].map(sanitizeTesterId).filter(Boolean);
  return candidates.find((candidate) => candidate !== previousTester) || candidates[0] || "";
}

function rosterChecklist(testerId) {
  return [
    `Add an anonymous tester object with id "${testerId}".`,
    "Set language to en, zh-CN, or ru.",
    "Set consent to true only after the tester has consented.",
    "Set privacyAccepted to true only after the tester accepts the privacy rules.",
    "Use allowedScope [\"demo\", \"real-read-only\"] for early sessions.",
    "Record projectPermission without naming the real project.",
    "Do not include real name, email, phone, company, GitHub, Gitee, WeChat, projectName, or repoName."
  ];
}

function commandSequence(testerId, isFirstLive) {
  const sequence = [
    "npm.cmd run trial:intake",
    `npm.cmd run trial:intake-session -- --tester ${testerId} --force`,
    `npm.cmd run trial:host-ready -- --tester ${testerId}`,
    `npm.cmd run trial:host-run -- --tester ${testerId}`,
    `npm.cmd run trial:pre-live -- --tester ${testerId}`,
    `npm.cmd run trial:live-capture -- --tester ${testerId}`
  ];
  if (!isFirstLive) {
    sequence.push(`npm.cmd run trial:next-live -- --tester ${testerId} --accept-review --accepted-by <host-id>`);
  }
  return [
    ...sequence,
    "npm.cmd run trial:status"
  ];
}

function nextSteps(decision, testerId, firstLive) {
  if (decision === "TESTER_LAUNCH_BLOCKED") return ["Fix blockers, then rerun trial:tester-launch-plan."];
  if (decision === "TESTER_LAUNCH_WAITING_FOR_INTAKE") {
    return [
      "Fill .codeclaw/trial-intake/TESTER_ROSTER.json locally with anonymous tester data.",
      "Rerun npm.cmd run trial:intake.",
      `Rerun npm.cmd run trial:tester-launch-plan -- --tester ${testerId || "tester-2"}.`
    ];
  }
  if (decision === "TESTER_LAUNCH_READY_TO_HOST") {
    if (firstLive) {
      return [
        "Open BEGINNER_FIRST_LIVE_GUIDE.md, LIVE_SESSION_CAPTURE.md, and HOST_RUNBOOK.md.",
        "Host only the selected anonymous tester within Demo plus real-read-only scope.",
        "After the call, use record-draft, human confirmation, then after-live."
      ];
    }
    return [
      "Open NEXT_LIVE_HOST_HANDOFF.md.",
      "Host only the selected anonymous tester.",
      "After the call, use record-draft, human confirmation, then after-live."
    ];
  }
  return [
    "Run the next command shown in this report.",
    "Rerun trial:tester-launch-plan.",
    "Do not host until the decision is TESTER_LAUNCH_READY_TO_HOST."
  ];
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

function reportRefs(reports) {
  const output = {};
  for (const [key, report] of Object.entries(reports)) {
    output[key] = {
      exists: report.exists,
      decision: report.data?.decision || "MISSING",
      testerId: report.data?.testerId || "",
      relativePath: report.relativePath
    };
  }
  return output;
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Tester Launch Plan",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Current step: ${report.currentStep}`,
    `Tester: ${report.testerId || "Not selected"}`,
    `Previous tester: ${report.previousTester || "Unknown"}`,
    `First live tester mode: ${report.firstLive ? "Yes" : "No"}`,
    `Next command: ${report.nextCommand}`,
    "",
    "## Roster Checklist",
    "",
    ...report.rosterChecklist.map((item) => `- ${item}`),
    "",
    "## Command Sequence",
    "",
    "```bash",
    ...report.commandSequence,
    "```",
    "",
    "## Reports",
    "",
    "| Report | Exists | Decision | Tester |",
    "| --- | --- | --- | --- |",
    ...Object.entries(report.reports).map(([key, item]) => `| ${key} | ${item.exists ? "Yes" : "No"} | ${item.decision} | ${item.testerId || "n/a"} |`),
    "",
    "## Blockers",
    "",
    ...(report.blockers.length ? report.blockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Next Steps",
    "",
    ...report.nextSteps.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function parseArgs(rawArgs) {
  const parsed = { tester: "", reports: "", json: "", markdown: "", firstLive: false };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--first-live" || arg === "--first-real-tester") {
      parsed.firstLive = true;
      continue;
    }
    let handled = false;
    for (const key of ["tester", "reports", "json", "markdown"]) {
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

function isDryRunTesterId(value) {
  return /dry[-_.]?run/i.test(String(value || ""));
}

function sanitizeTesterId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
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
