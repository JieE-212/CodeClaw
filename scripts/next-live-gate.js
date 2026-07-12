import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  REQUIRED_REMEDIATION_HOST_CHECKS,
  passedRemediationHostCheckIds
} from "./trial-remediation-contract.js";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const distPath = path.join(rootPath, "dist");
const args = parseArgs(process.argv.slice(2));
const reportsPath = path.resolve(rootPath, args.reports || "dist");
const afterLivePath = path.resolve(rootPath, args.afterLive || path.join(reportsPath, "TRIAL_AFTER_LIVE_REPORT.json"));
const intakePath = path.resolve(rootPath, args.intake || path.join(reportsPath, "TRIAL_TESTER_INTAKE_REPORT.json"));
const intakeSessionPath = path.resolve(rootPath, args.intakeSession || path.join(reportsPath, "TRIAL_INTAKE_SESSION_REPORT.json"));
const hostReadyPath = path.resolve(rootPath, args.hostReady || path.join(reportsPath, "TRIAL_HOST_READY_REPORT.json"));
const hostRunPath = path.resolve(rootPath, args.hostRun || path.join(reportsPath, "TRIAL_HOST_RUN_REPORT.json"));
const preLivePath = path.resolve(rootPath, args.preLive || path.join(reportsPath, "TRIAL_PRE_LIVE_REPORT.json"));
const liveCapturePath = path.resolve(rootPath, args.liveCapture || path.join(reportsPath, "TRIAL_LIVE_CAPTURE_REPORT.json"));
const reviewPath = path.resolve(rootPath, args.review || path.join(reportsPath, "TRIAL_REVIEW_REPORT.json"));
const backlogPath = path.resolve(rootPath, args.backlog || path.join(reportsPath, "TRIAL_FIX_BACKLOG.json"));
const remediationPath = path.resolve(rootPath, args.remediation || path.join(reportsPath, "TRIAL_REMEDIATION_REPORT.json"));
const sourceRoot = path.resolve(rootPath, args.sourceRoot || ".");
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_NEXT_LIVE_REPORT.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_NEXT_LIVE_REPORT.md"));

const report = await buildReport();

await fs.mkdir(path.dirname(jsonPath), { recursive: true });
await fs.mkdir(path.dirname(markdownPath), { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

if (report.ok && report.handoffPath) {
  await fs.mkdir(path.dirname(report.handoffPath), { recursive: true });
  await fs.writeFile(report.handoffPath, renderHandoff(report), "utf8");
}

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  previousTester: report.previousTester,
  testerId: report.testerId,
  sessionFolder: report.sessionRelativePath,
  handoff: report.handoffRelativePath,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  jsonPath,
  markdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function buildReport() {
  const afterLiveObserved = await readJsonWithHash(afterLivePath);
  const reports = {
    afterLive: afterLiveObserved.data,
    intake: await readJson(intakePath),
    intakeSession: await readJson(intakeSessionPath),
    hostReady: await readJson(hostReadyPath),
    hostRun: await readJson(hostRunPath),
    preLive: await readJson(preLivePath),
    liveCapture: await readJson(liveCapturePath),
    review: await readJson(reviewPath),
    backlog: await readJson(backlogPath),
    remediation: await readJson(remediationPath)
  };
  const blockers = [];
  const warnings = [];

  const previousTester = sanitizeTesterId(args.previousTester || reports.afterLive?.testerId || "");
  const selectedTester = selectTester(reports, previousTester);
  const testerId = selectedTester.id;

  const previousClosure = await inspectPreviousClosure({
    afterLive: reports.afterLive,
    afterLiveSha256: afterLiveObserved.sha256,
    remediation: reports.remediation,
    previousTester,
    blockers,
    warnings
  });
  if (!previousTester) blockers.push("Previous tester could not be inferred from TRIAL_AFTER_LIVE_REPORT.json.");
  if (!testerId) blockers.push("Next tester could not be inferred. Pass --tester <tester-id> or run intake/live gates for the next tester.");
  if (previousTester && testerId && testerId === previousTester) {
    blockers.push(`Next tester ${testerId} matches the previous tester; generate a new tester session pack.`);
  }
  if (testerId && isDryRunTesterId(testerId)) blockers.push(`${testerId}: dry-run tester ids cannot be used for a real next-live launch.`);

  const intakeTester = inspectIntake(reports.intake, testerId, blockers, warnings);
  inspectReportAlignment({ key: "intake-session", report: reports.intakeSession, testerId, allowed: ["INTAKE_SESSION_READY", "INTAKE_SESSION_READY_WITH_REVIEW"], blockers, warnings });
  inspectReportAlignment({ key: "host-ready", report: reports.hostReady, testerId, allowed: ["READY_TO_HOST"], blockers, warnings });
  inspectReportAlignment({ key: "host-run", report: reports.hostRun, testerId, allowed: ["HOST_RUN_READY", "HOST_RUN_READY_WITH_REVIEW"], blockers, warnings });
  inspectReportAlignment({ key: "pre-live", report: reports.preLive, testerId, allowed: ["PRE_LIVE_READY_TO_HOST", "PRE_LIVE_READY_WITH_HOST_REVIEW"], blockers, warnings });
  inspectReportAlignment({ key: "live-capture", report: reports.liveCapture, testerId, allowed: ["LIVE_CAPTURE_READY", "LIVE_CAPTURE_READY_WITH_REVIEW"], blockers, warnings });

  const sessionFolder = resolveSessionFolder(reports, testerId);
  const manifest = sessionFolder ? await readJson(path.join(sessionFolder, "SESSION_PACK_MANIFEST.json")) : null;
  const sessionIssues = await inspectSessionFolder({ sessionFolder, manifest, testerId, previousTester });
  blockers.push(...sessionIssues.blockers);
  warnings.push(...sessionIssues.warnings);

  const reviewWatchItems = reviewWatchItemsFrom(reports.review);
  const backlogWatchItems = backlogWatchItemsFrom(reports.backlog);
  const watchItems = uniqueWatchItems([...reviewWatchItems, ...backlogWatchItems]);
  const watchIssues = await inspectWatchItems({ sessionFolder, manifest, reports, watchItems });
  blockers.push(...watchIssues.blockers);
  warnings.push(...watchIssues.warnings);

  const needsHostAcceptance = needsAcceptance(reports, watchItems);
  if (needsHostAcceptance && !args.acceptReview) {
    blockers.push("Host acceptance is required for watch items or ready-with-review reports. Rerun with --accept-review after the host accepts them.");
  }
  if (args.acceptReview && !args.acceptedBy) warnings.push("Review acceptance was recorded without --accepted-by; add a host id next time.");

  const decision = blockers.length
    ? "NEXT_LIVE_HOLD"
    : warnings.length
      ? "NEXT_LIVE_READY_WITH_REVIEW"
      : "NEXT_LIVE_READY";
  const handoffPath = sessionFolder
    ? path.join(sessionFolder, "NEXT_LIVE_HOST_HANDOFF.md")
    : path.join(distPath, "NEXT_LIVE_HOST_HANDOFF.md");

  return {
    ok: blockers.length === 0,
    mode: "trial-next-live",
    createdAt: new Date().toISOString(),
    decision,
    previousTester,
    testerId,
    tester: intakeTester ? {
      id: intakeTester.id,
      language: intakeTester.language,
      hostLanguage: intakeTester.hostLanguage,
      allowedScope: intakeTester.allowedScope || [],
      needsReview: Boolean(intakeTester.needsReview)
    } : null,
    sessionFolder,
    sessionRelativePath: sessionFolder ? relative(sessionFolder) : "",
    handoffPath: blockers.length ? "" : handoffPath,
    handoffRelativePath: blockers.length ? "" : relative(handoffPath),
    reports: reportRefs({
      afterLive: [afterLivePath, reports.afterLive],
      intake: [intakePath, reports.intake],
      intakeSession: [intakeSessionPath, reports.intakeSession],
      hostReady: [hostReadyPath, reports.hostReady],
      hostRun: [hostRunPath, reports.hostRun],
      preLive: [preLivePath, reports.preLive],
      liveCapture: [liveCapturePath, reports.liveCapture],
      review: [reviewPath, reports.review],
      backlog: [backlogPath, reports.backlog],
      remediation: [remediationPath, reports.remediation]
    }),
    previousClosure,
    acceptance: {
      required: needsHostAcceptance,
      accepted: Boolean(args.acceptReview),
      acceptedBy: args.acceptedBy || "",
      acceptedAt: args.acceptReview ? new Date().toISOString() : ""
    },
    watchItems,
    stopConditions: stopConditions(testerId),
    blockers: unique(blockers),
    warnings: unique(warnings),
    nextCommands: nextCommands(decision, testerId, previousClosure),
    nextSteps: nextSteps(decision)
  };
}

async function inspectPreviousClosure({ afterLive, afterLiveSha256, remediation, previousTester, blockers, warnings }) {
  if (!afterLive) {
    blockers.push("After-live report is missing. Run npm.cmd run trial:after-live for the previous tester first.");
    return { kind: "missing", ready: false, historicalDecision: "MISSING", remediationDecision: "MISSING" };
  }
  if (["AFTER_LIVE_READY", "AFTER_LIVE_READY_WITH_REVIEW"].includes(afterLive.decision)) {
    if (afterLive.ok === false) blockers.push("After-live report is not ok.");
    if (afterLive.decision === "AFTER_LIVE_READY_WITH_REVIEW") {
      warnings.push("Previous after-live passed with review; host must accept watch items before next live launch.");
    }
    return { kind: "after-live", ready: afterLive.ok !== false, historicalDecision: afterLive.decision, remediationDecision: "MISSING" };
  }

  if (afterLive.decision !== "AFTER_LIVE_BLOCKED") {
    blockers.push(`After-live decision is ${afterLive.decision || "UNKNOWN"}.`);
    return { kind: "unsupported", ready: false, historicalDecision: afterLive.decision || "UNKNOWN", remediationDecision: remediation?.decision || "MISSING" };
  }

  if (!remediation) {
    blockers.push("Previous after-live remains blocked and no remediation report exists. Run trial:remediation after verified product fixes; do not rewrite the original tester result.");
    return { kind: "remediation", ready: false, historicalDecision: afterLive.decision, remediationDecision: "MISSING" };
  }

  const before = blockers.length;
  if (remediation.mode !== "trial-remediation-gate") blockers.push("Remediation report has an unexpected mode.");
  if (remediation.originalAfterLiveDecision !== "AFTER_LIVE_BLOCKED") blockers.push("Remediation does not preserve the original AFTER_LIVE_BLOCKED decision.");
  if (sanitizeTesterId(remediation.testerId) !== previousTester) blockers.push("Remediation tester does not match the previous tester.");
  if (remediation.observedReports?.afterLive?.sha256 !== afterLiveSha256) blockers.push("The preserved after-live report changed after remediation was reviewed.");
  if (remediation.ok !== true || !["REMEDIATION_READY_FOR_RETEST", "REMEDIATION_READY_WITH_REVIEW"].includes(remediation.decision)) {
    blockers.push(`Remediation decision is ${remediation.decision || "MISSING"}.`);
  }
  if ((remediation.blockers || []).length) blockers.push("Remediation still contains gate blockers.");
  if (remediation.worktreeClean !== true) blockers.push("Remediation did not record a clean source worktree.");
  if ((remediation.unresolvedItems || []).length) blockers.push("Remediation still contains unresolved source items.");
  if (remediation.hostAcceptance?.accepted !== true || remediation.hostAcceptance?.originalRecordsUnchanged !== true) {
    blockers.push("Remediation does not contain current host acceptance with unchanged original records.");
  }
  if (!/^host-[a-z0-9-]+$/i.test(remediation.hostAcceptance?.acceptedBy || "")) {
    blockers.push("Remediation host acceptance does not identify an anonymous host id.");
  }
  if (remediation.decision === "REMEDIATION_READY_WITH_REVIEW" && remediation.hostAcceptance?.acceptedWarnings !== true) {
    blockers.push("Remediation review warnings were not explicitly accepted.");
  }
  if (remediation.hostAcceptance?.acceptedCommit !== remediation.currentCommit || remediation.readinessSourceVersion?.commit !== remediation.currentCommit) {
    blockers.push("Remediation acceptance, readiness, and current commit are not aligned.");
  }
  const passedHostChecks = passedRemediationHostCheckIds(remediation.hostAcceptance?.hostChecks);
  if (REQUIRED_REMEDIATION_HOST_CHECKS.some((id) => !passedHostChecks.has(id))) {
    blockers.push("Remediation is missing one or more required manual host checks.");
  }

  const gitState = await readGitState(sourceRoot);
  if (!gitState.commit || remediation.currentCommit !== gitState.commit) blockers.push("Remediation is not bound to the current source commit.");
  if (!gitState.clean) blockers.push("The source worktree changed after remediation; commit and regenerate readiness/remediation before next-live.");
  if (remediation.decision === "REMEDIATION_READY_WITH_REVIEW") {
    warnings.push("Previous tester remains a historical No-Go with accepted remediation watch items; keep them visible during the controlled retest.");
  }
  return {
    kind: "remediation",
    ready: blockers.length === before,
    historicalDecision: afterLive.decision,
    remediationDecision: remediation.decision || "MISSING",
    currentCommit: remediation.currentCommit || ""
  };
}

function inspectIntake(intake, testerId, blockers, warnings) {
  if (!intake) {
    blockers.push("Tester intake report is missing. Run npm.cmd run trial:intake.");
    return null;
  }
  if (intake.ok === false) blockers.push("Tester intake report is not ok.");
  if (!["READY_FOR_SESSION", "READY_FOR_SESSION_WITH_REVIEW"].includes(intake.decision)) {
    blockers.push(`Tester intake decision is ${intake.decision || "UNKNOWN"}.`);
  }
  const testers = Array.isArray(intake.testers) ? intake.testers : [];
  const tester = testers.find((item) => sanitizeTesterId(item.id) === testerId) || null;
  if (testerId && !tester) blockers.push(`Tester ${testerId} was not found in the intake report.`);
  if (tester?.blocked) blockers.push(`${testerId}: tester intake is blocked.`);
  if (tester && !tester.ready) blockers.push(`${testerId}: tester is not marked ready.`);
  if (tester?.needsReview || intake.decision === "READY_FOR_SESSION_WITH_REVIEW") {
    warnings.push("Tester intake requires host review before the next live session.");
  }
  for (const field of personalFieldNames()) {
    if (tester && Object.hasOwn(tester, field)) blockers.push(`${testerId}: intake report contains personal field "${field}".`);
  }
  if (tester?.consent === false) blockers.push(`${testerId}: consent is false in intake.`);
  if (tester?.privacyAccepted === false) blockers.push(`${testerId}: privacyAccepted is false in intake.`);
  return tester;
}

function inspectReportAlignment({ key, report, testerId, allowed, blockers, warnings }) {
  if (!report) {
    blockers.push(`${key} report is missing.`);
    return;
  }
  if (report.ok === false) blockers.push(`${key} report is not ok.`);
  if (!allowed.includes(report.decision)) blockers.push(`${key} decision is ${report.decision || "UNKNOWN"}.`);
  if (testerId && report.testerId && sanitizeTesterId(report.testerId) !== testerId) {
    blockers.push(`${key} tester ${report.testerId} does not match next tester ${testerId}.`);
  }
  if (/_WITH_REVIEW$/.test(report.decision || "") || report.decision === "INTAKE_SESSION_READY_WITH_REVIEW") {
    warnings.push(`${key} is ready with review; host acceptance is required before launch.`);
  }
  for (const item of normalizeList(report.warnings)) warnings.push(`${key}: ${item}`);
  for (const item of normalizeList(report.blockers)) blockers.push(`${key}: ${item}`);
}

async function inspectSessionFolder({ sessionFolder, manifest, testerId, previousTester }) {
  const blockers = [];
  const warnings = [];
  if (!sessionFolder) {
    blockers.push("Next-live session folder could not be resolved.");
    return { blockers, warnings };
  }
  if (isInside(sessionFolder, path.join(distPath, "trial-dry-runs"))) blockers.push("Next-live session folder is inside dry-run output.");
  if (isStalePreviousSessionPath(sessionFolder, previousTester)) {
    blockers.push(`Session folder appears to belong to previous tester ${previousTester}.`);
  }
  if (!(await exists(sessionFolder))) {
    blockers.push(`Session folder does not exist: ${relative(sessionFolder)}.`);
    return { blockers, warnings };
  }
  for (const file of ["SESSION_BRIEF.md", "HOST_RUNBOOK.md", "HUMAN_TRIAL_OBSERVATION.md", "TRIAL_FEEDBACK_TEMPLATE.md", "TRIAL_RESULT_RECORD.md", "SESSION_PACK_MANIFEST.json", "LIVE_SESSION_CAPTURE.md", "LIVE_SESSION_HOST_SUMMARY.md"]) {
    if (!(await exists(path.join(sessionFolder, file)))) blockers.push(`Session folder is missing ${file}.`);
  }
  if (!manifest) blockers.push("Session manifest is missing or invalid.");
  if (manifest?.testerId && sanitizeTesterId(manifest.testerId) !== testerId) {
    blockers.push(`Session manifest tester ${manifest.testerId} does not match next tester ${testerId}.`);
  }
  if (manifest?.testerId && previousTester && sanitizeTesterId(manifest.testerId) === previousTester) {
    blockers.push(`Session manifest still points to previous tester ${previousTester}.`);
  }
  return { blockers, warnings };
}

async function inspectWatchItems({ sessionFolder, manifest, reports, watchItems }) {
  const blockers = [];
  const warnings = [];
  if (!watchItems.length) return { blockers, warnings };
  const manifestIds = new Set(normalizeWatchItems(manifest?.watchItems).map((item) => item.id));
  const hostReadyIds = new Set(normalizeWatchItems(reports.hostReady?.watchItems).map((item) => item.id));
  const hostRunIds = new Set(normalizeWatchItems(reports.hostRun?.watchItems).map((item) => item.id));
  const brief = sessionFolder ? await readTextIfExists(path.join(sessionFolder, "SESSION_BRIEF.md")) : "";
  const runbook = sessionFolder ? await readTextIfExists(path.join(sessionFolder, "HOST_RUNBOOK.md")) : "";
  const observation = sessionFolder ? await readTextIfExists(path.join(sessionFolder, "HUMAN_TRIAL_OBSERVATION.md")) : "";
  for (const item of watchItems) {
    if (!item.id) continue;
    if (!manifestIds.has(item.id)) blockers.push(`Session manifest is missing accepted watch item ${item.id}.`);
    if (!hostReadyIds.has(item.id)) blockers.push(`Host-ready report is missing accepted watch item ${item.id}.`);
    if (hostRunIds.size && !hostRunIds.has(item.id)) blockers.push(`Host-run report is missing accepted watch item ${item.id}.`);
    if (!brief.includes(item.id)) blockers.push(`SESSION_BRIEF.md is missing accepted watch item ${item.id}.`);
    if (!runbook.includes(item.id)) blockers.push(`HOST_RUNBOOK.md is missing accepted watch item ${item.id}.`);
    if (!observation.includes(item.id)) blockers.push(`HUMAN_TRIAL_OBSERVATION.md is missing accepted watch item ${item.id}.`);
  }
  return { blockers, warnings };
}

function selectTester(reports, previousTester) {
  const explicit = sanitizeTesterId(args.tester || "");
  if (explicit) return { id: explicit, source: "argument" };
  const candidates = [
    reports.afterLive?.nextTester,
    reports.liveCapture?.testerId,
    reports.preLive?.testerId,
    reports.hostRun?.testerId,
    reports.hostReady?.testerId,
    reports.intakeSession?.testerId,
    reports.intake?.nextTester?.id
  ].map(sanitizeTesterId).filter(Boolean);
  const id = candidates.find((candidate) => candidate !== previousTester) || candidates[0] || "";
  return { id, source: "reports" };
}

function resolveSessionFolder(reports, testerId) {
  if (args.session) return path.resolve(rootPath, args.session);
  for (const report of [reports.liveCapture, reports.preLive, reports.hostRun, reports.hostReady, reports.intakeSession]) {
    if (report?.sessionFolder) return path.resolve(rootPath, report.sessionFolder);
    if (report?.sessionRelativePath) return path.resolve(rootPath, report.sessionRelativePath);
  }
  return testerId ? path.join(rootPath, "dist", "trial-session-packs", testerId) : "";
}

function reviewWatchItemsFrom(review) {
  return normalizeWatchItems((review?.actionItems || []).filter((item) => item.lane === "watch" || item.priority === "P1" || item.priority === "P2"));
}

function backlogWatchItemsFrom(backlog) {
  return normalizeWatchItems(backlog?.watchDuringTester2 || []);
}

function normalizeWatchItems(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    id: String(item.id || "").trim(),
    priority: item.priority || "P2",
    title: item.title || "Watch item",
    owner: item.owner || "Host",
    action: item.action || "Watch during the next tester session.",
    verificationCommand: item.verificationCommand || "npm.cmd run trial:status",
    evidence: Array.isArray(item.evidence) ? item.evidence : normalizeList(item.evidence)
  })).filter((item) => item.id);
}

function uniqueWatchItems(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    if (!item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    output.push(item);
  }
  return output;
}

function needsAcceptance(reports, watchItems) {
  if (watchItems.length > 0) return true;
  return [
    reports.afterLive?.decision,
    reports.remediation?.decision,
    reports.intake?.decision,
    reports.intakeSession?.decision,
    reports.hostRun?.decision,
    reports.preLive?.decision,
    reports.liveCapture?.decision
  ].some((decision) => /WITH_REVIEW$/.test(decision || ""));
}

function reportRefs(entries) {
  const output = {};
  for (const [key, [filePath, data]] of Object.entries(entries)) {
    output[key] = {
      exists: Boolean(data),
      ok: data?.ok ?? null,
      decision: data?.decision || "MISSING",
      testerId: data?.testerId || "",
      relativePath: relative(filePath)
    };
  }
  return output;
}

function stopConditions(testerId) {
  return [
    `Stop if the live tester id is not ${testerId || "<tester-id>"}.`,
    "Stop if the session folder contains screenshots, logs, source files, contact data, or secrets.",
    "Stop if the tester asks to use a private repo without explicit permission.",
    "Stop before Apply on a non-disposable real project.",
    "Stop if any accepted watch item becomes a P0 fix-now issue."
  ];
}

function nextCommands(decision, testerId, previousClosure) {
  if (decision === "NEXT_LIVE_HOLD") {
    return [
      previousClosure?.historicalDecision === "AFTER_LIVE_BLOCKED"
        ? "npm.cmd run trial:remediation -- --tester <previous-tester-id>"
        : "npm.cmd run trial:after-live -- --session <previous-session-folder> --tester <previous-tester-id>",
      `npm.cmd run trial:intake-session -- --tester ${testerId || "<tester-id>"} --force`,
      `npm.cmd run trial:host-ready -- --tester ${testerId || "<tester-id>"}`,
      `npm.cmd run trial:host-run -- --tester ${testerId || "<tester-id>"}`,
      `npm.cmd run trial:pre-live -- --tester ${testerId || "<tester-id>"}`,
      `npm.cmd run trial:live-capture -- --tester ${testerId || "<tester-id>"}`,
      `npm.cmd run trial:next-live -- --tester ${testerId || "<tester-id>"} --accept-review`
    ];
  }
  return [
    `npm.cmd run trial:next-live -- --tester ${testerId || "<tester-id>"} --accept-review`,
    "Open NEXT_LIVE_HOST_HANDOFF.md before the call.",
    "npm.cmd run trial:status"
  ];
}

function nextSteps(decision) {
  if (decision === "NEXT_LIVE_HOLD") {
    return [
      "Do not start the next tester session yet.",
      "Fix every blocker in TRIAL_NEXT_LIVE_REPORT.md.",
      "Rerun trial:next-live after the existing gates are aligned."
    ];
  }
  if (decision === "NEXT_LIVE_READY_WITH_REVIEW") {
    return [
      "Use NEXT_LIVE_HOST_HANDOFF.md as the launch handoff.",
      "Keep accepted watch items visible during the call.",
      "Run trial:after-live after the next tester session is complete."
    ];
  }
  return [
    "Use NEXT_LIVE_HOST_HANDOFF.md as the launch handoff.",
    "Start the next live tester session only with the selected anonymous tester id.",
    "Run trial:after-live after the session is complete."
  ];
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Next Live Gate",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Previous tester: ${report.previousTester || "Unknown"}`,
    `Next tester: ${report.testerId || "Unknown"}`,
    `Session folder: ${report.sessionRelativePath || "None"}`,
    `Host handoff: ${report.handoffRelativePath || "Not created"}`,
    `Previous closure: ${report.previousClosure.kind} (${report.previousClosure.remediationDecision || report.previousClosure.historicalDecision})`,
    "",
    "## Acceptance",
    "",
    `- Required: ${report.acceptance.required ? "Yes" : "No"}`,
    `- Accepted: ${report.acceptance.accepted ? "Yes" : "No"}`,
    `- Accepted by: ${report.acceptance.acceptedBy || "n/a"}`,
    "",
    "## Watch Items",
    "",
    ...renderWatchItems(report.watchItems),
    "",
    "## Stop Conditions",
    "",
    ...report.stopConditions.map((item) => `- ${item}`),
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

function renderHandoff(report) {
  return [
    "# CodeClaw Next Live Host Handoff",
    "",
    `Created at: ${report.createdAt}`,
    `Previous tester closed: ${report.previousTester || "Unknown"}`,
    `Next tester: ${report.testerId || "Unknown"}`,
    `Session folder: ${report.sessionRelativePath || "None"}`,
    `Gate decision: ${report.decision}`,
    `Previous closure: ${report.previousClosure.kind} (${report.previousClosure.remediationDecision || report.previousClosure.historicalDecision})`,
    "",
    "## Accepted Watch Items",
    "",
    ...renderWatchItems(report.watchItems),
    "",
    "## Stop Conditions",
    "",
    ...report.stopConditions.map((item) => `- ${item}`),
    "",
    "## Launch Files",
    "",
    "- SESSION_BRIEF.md",
    "- HOST_RUNBOOK.md",
    "- HUMAN_TRIAL_OBSERVATION.md",
    "- LIVE_SESSION_CAPTURE.md",
    "- LIVE_SESSION_HOST_SUMMARY.md",
    "",
    "## After The Call",
    "",
    `- Run: npm.cmd run trial:after-live -- --session ${report.sessionRelativePath || "<session-folder>"} --tester ${report.testerId || "<tester-id>"}`,
    "- Keep raw tester records local-only.",
    "- Rerun npm.cmd run trial:status.",
    ""
  ].join("\n");
}

function renderWatchItems(items) {
  if (!items.length) return ["- None"];
  return items.map((item) => {
    const evidence = Array.isArray(item.evidence) && item.evidence.length ? ` Evidence: ${item.evidence.join("; ")}` : "";
    return `- ${item.id} ${item.title} (${item.priority}). Owner: ${item.owner}. Action: ${item.action}.${evidence}`;
  });
}

function parseArgs(rawArgs) {
  const parsed = {
    tester: "",
    previousTester: "",
    reports: "",
    afterLive: "",
    intake: "",
    intakeSession: "",
    hostReady: "",
    hostRun: "",
    preLive: "",
    liveCapture: "",
    review: "",
    backlog: "",
    remediation: "",
    sourceRoot: "",
    session: "",
    json: "",
    markdown: "",
    acceptReview: false,
    acceptedBy: ""
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--accept-review") {
      parsed.acceptReview = true;
      continue;
    }
    let handled = false;
    for (const key of ["tester", "previousTester", "reports", "afterLive", "intake", "intakeSession", "hostReady", "hostRun", "preLive", "liveCapture", "review", "backlog", "remediation", "sourceRoot", "session", "json", "markdown", "acceptedBy"]) {
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

function isStalePreviousSessionPath(sessionFolder, previousTester) {
  if (!previousTester) return false;
  const relativePath = relative(sessionFolder);
  return path.basename(sessionFolder) === previousTester
    || relativePath.includes(`trial-session-packs/${previousTester}`);
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

function normalizeList(value) {
  if (!Array.isArray(value)) {
    if (!value) return [];
    return [String(value)];
  }
  return value.map((item) => {
    if (typeof item === "string") return item;
    return item.message || item.reason || item.title || item.id || JSON.stringify(item);
  }).filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function relative(targetPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
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

async function readJsonWithHash(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return { data: JSON.parse(content), sha256: crypto.createHash("sha256").update(content).digest("hex") };
  } catch {
    return { data: null, sha256: "" };
  }
}

async function readGitState(cwd) {
  try {
    const [{ stdout: commit }, { stdout: status }] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd, windowsHide: true }),
      execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd, windowsHide: true })
    ]);
    return { commit: commit.trim().toLowerCase(), clean: status.trim() === "" };
  } catch {
    return { commit: "", clean: false };
  }
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
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
