import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { inspectSourceVersion, sourceVersionBindingIssues } from "./source-version.js";
import { hasAllRequiredRemediationHostChecks } from "./trial-remediation-contract.js";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const args = parseArgs(process.argv.slice(2));
const distPath = path.resolve(rootPath, args.dist || "dist");
const sourceRoot = path.resolve(rootPath, args.sourceRoot || ".");
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_STATUS_REPORT.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_STATUS_REPORT.md"));

const report = await buildReport();

await fs.mkdir(path.dirname(jsonPath), { recursive: true });
await fs.mkdir(path.dirname(markdownPath), { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  currentStage: report.currentStage,
  nextCommand: report.nextCommand,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  jsonPath,
  markdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function buildReport() {
  const reports = {
    readiness: await readReport("TRIAL_READINESS_REPORT.json"),
    freeze: await readReport("TRIAL_FREEZE_REPORT.json"),
    dispatch: await readReport("TRIAL_DISPATCH_NOTE.json"),
    hostReady: await readReport("TRIAL_HOST_READY_REPORT.json"),
    hostRun: await readReport("TRIAL_HOST_RUN_REPORT.json"),
    completion: await readReport("TRIAL_SESSION_COMPLETION_REPORT.json"),
    privacy: await readReport("TRIAL_PRIVACY_REPORT.json"),
    feedback: await readReport("TRIAL_FEEDBACK_SUMMARY.json"),
    backlog: await readReport("TRIAL_FIX_BACKLOG.json"),
    postSession: await readReport("TRIAL_POST_SESSION_REPORT.json"),
    review: await readReport("TRIAL_REVIEW_REPORT.json"),
    intakeReviewDryRun: await readReport("TRIAL_INTAKE_REVIEW_DRY_RUN_REPORT.json"),
    preLive: await readReport("TRIAL_PRE_LIVE_REPORT.json"),
    liveCapture: await readReport("TRIAL_LIVE_CAPTURE_REPORT.json"),
    afterLive: await readReport("TRIAL_AFTER_LIVE_REPORT.json"),
    remediation: await readReport("TRIAL_REMEDIATION_REPORT.json"),
    nextLive: await readReport("TRIAL_NEXT_LIVE_REPORT.json"),
    cohort: await readReport("TRIAL_COHORT_SUMMARY.json"),
    cohortHandoff: await readReport("TRIAL_COHORT_HANDOFF.json"),
    archive: await readReport("TRIAL_ARCHIVE_REPORT.json"),
    intake: await readReport("TRIAL_TESTER_INTAKE_REPORT.json"),
    testerLaunchPlan: await readReport("TRIAL_TESTER_LAUNCH_PLAN.json")
  };
  const artifacts = await collectArtifacts();
  const sourceVersion = await inspectSourceVersion(sourceRoot);
  const remediationReady = remediationClosesAfterLive(reports, sourceVersion);
  const blockers = collectBlockers(reports, { remediationReady });
  const warnings = collectWarnings(reports, artifacts, { remediationReady });
  const state = decideState(reports, blockers, { remediationReady });

  return {
    ok: blockers.length === 0,
    mode: "trial-status",
    createdAt: new Date().toISOString(),
    distPath,
    distRelativePath: relative(distPath),
    sourceVersion,
    decision: state.decision,
    currentStage: state.currentStage,
    nextCommand: state.nextCommand,
    nextAction: state.nextAction,
    blockers,
    warnings,
    reports: publicReports(reports),
    artifacts,
    quickLinks: quickLinks(reports, artifacts),
    commandGuide: commandGuide(state, reports),
    nextSteps: nextSteps(state)
  };
}

async function readReport(fileName) {
  const filePath = path.join(distPath, fileName);
  const observed = await readJsonWithHash(filePath);
  const data = observed.data;
  return {
    key: fileName.replace(/\.json$/i, ""),
    fileName,
    path: filePath,
    relativePath: relative(filePath),
    exists: Boolean(data),
    ok: data?.ok ?? null,
    mode: data?.mode || "",
    decision: data?.decision || "MISSING",
    createdAt: data?.createdAt || "",
    blockers: normalizeList(data?.blockers),
    warnings: normalizeList(data?.warnings),
    sha256: observed.sha256,
    data
  };
}

async function collectArtifacts() {
  return {
    latestPackage: await latestDirectory(/^CodeClaw-local-trial-\d{8}$/),
    latestSessionPack: await latestNestedDirectory(path.join(distPath, "trial-session-packs")),
    latestAfterLivePacket: await latestNestedDirectory(path.join(distPath, "trial-after-live")),
    latestArchive: await latestNestedDirectory(path.join(distPath, "trial-archives"))
  };
}

function decideState(reports, blockers, { remediationReady = false } = {}) {
  if (!reports.readiness.exists) {
    return state("NEEDS_READINESS", "preflight", "npm.cmd run trial:ready", "Run source and package readiness checks.");
  }
  if (reports.readiness.ok === false) {
    return state("READINESS_BLOCKED", "preflight", "npm.cmd run trial:ready", "Fix readiness failures before packaging.");
  }
  if (!reports.freeze.exists) {
    return state("NEEDS_FREEZE", "package", "npm.cmd run trial:simulate && npm.cmd run trial:freeze", "Freeze a hosted-trial candidate.");
  }
  if (reports.freeze.decision !== "GO_HOSTED_TRIAL") {
    return state("FREEZE_BLOCKED", "package", "npm.cmd run trial:simulate && npm.cmd run trial:freeze", "Fix freeze blockers before sharing.");
  }
  if (!reports.dispatch.exists) {
    return state("NEEDS_DISPATCH", "package", "npm.cmd run trial:dispatch", "Generate the tester dispatch note.");
  }
  if (reports.dispatch.decision !== "READY_TO_SEND") {
    return state("DISPATCH_BLOCKED", "package", "npm.cmd run trial:dispatch", "Fix dispatch blockers before sending.");
  }
  if (!reports.hostReady.exists) {
    return state("NEEDS_HOST_READY", "hosting", "npm.cmd run trial:session-pack -- --force; npm.cmd run trial:host-ready", "Generate and verify the session pack.");
  }
  if (reports.hostReady.decision === "HOLD") {
    return state("HOST_READY_BLOCKED", "hosting", "npm.cmd run trial:host-ready", "Fix host-ready blockers before hosting.");
  }
  if (reports.privacy.decision === "PRIVACY_HOLD") {
    return state("PRIVACY_HOLD", "post-session", "npm.cmd run trial:privacy-check -- <session-folder>", "Redact completed records before ingesting or archiving.");
  }
  if (!reports.postSession.exists && !reports.hostRun.exists) {
    return state("NEEDS_HOST_RUN", "hosting", "npm.cmd run trial:host-run", "Generate the live host runbook before the session.");
  }
  if (!reports.postSession.exists && reports.hostRun.decision === "HOST_RUN_HOLD") {
    return state("HOST_RUN_BLOCKED", "hosting", "npm.cmd run trial:host-run", "Fix host-run blockers before hosting.");
  }
  if (!reports.postSession.exists && reports.hostRun.exists && !reports.preLive.exists) {
    return state("NEEDS_PRE_LIVE", "hosting", "npm.cmd run trial:pre-live", "Run the pre-live gate before scheduling the first real tester session.");
  }
  if (!reports.postSession.exists && reports.preLive.exists && reports.preLive.decision === "PRE_LIVE_HOLD") {
    return state("PRE_LIVE_BLOCKED", "hosting", "npm.cmd run trial:pre-live", "Fix pre-live blockers before hosting.");
  }
  if (!reports.postSession.exists && reports.preLive.exists && !reports.liveCapture.exists) {
    return state("NEEDS_LIVE_CAPTURE", "hosting", "npm.cmd run trial:live-capture", "Generate the live-session capture checklist before hosting.");
  }
  if (!reports.postSession.exists && reports.liveCapture.exists && reports.liveCapture.decision === "LIVE_CAPTURE_HOLD") {
    return state("LIVE_CAPTURE_BLOCKED", "hosting", "npm.cmd run trial:live-capture", "Fix live-capture blockers before hosting.");
  }
  if (!reports.postSession.exists && reports.completion.exists && reports.completion.decision === "SESSION_COMPLETION_HOLD") {
    return state("SESSION_COMPLETION_BLOCKED", "post-session", "npm.cmd run trial:complete-session -- --session <session-folder>", "Finish or redact completed session records before post-session.");
  }
  if (!reports.postSession.exists && reports.completion.exists && reports.completion.decision.startsWith("SESSION_COMPLETION_READY")) {
    return state("READY_FOR_AFTER_LIVE", "post-session", "npm.cmd run trial:after-live -- --session <session-folder> --tester <tester-id>", "Run the guarded after-live recovery, review, archive, and evidence packet workflow.");
  }
  if (!reports.postSession.exists) {
    return state("READY_TO_HOST", "hosting", "npm.cmd run trial:complete-session -- --session <session-folder>", "Host the session, fill records, then run completion check.");
  }
  if (reports.afterLive.exists && reports.afterLive.decision === "AFTER_LIVE_BLOCKED") {
    if (!remediationReady) {
      return reports.remediation.exists
        ? state("REMEDIATION_BLOCKED", "remediation", "npm.cmd run trial:remediation -- --tester <previous-tester-id>", "Complete the independent remediation gate without changing the original tester result.")
        : state("NEEDS_REMEDIATION", "remediation", "npm.cmd run trial:remediation -- --tester <previous-tester-id>", "Create a fix-closure report for the preserved AFTER_LIVE_BLOCKED result.");
    }
  }
  if (reports.postSession.decision === "READY_FOR_NEXT_TESTER" && !reports.afterLive.exists && (!reports.review.exists || !reports.archive.exists)) {
    return state("NEEDS_AFTER_LIVE", "after-live", "npm.cmd run trial:after-live -- --session <session-folder> --tester <tester-id>", "Run after-live to complete review, archive, status, and local evidence packaging.");
  }
  if (!remediationReady && reports.postSession.decision !== "READY_FOR_NEXT_TESTER") {
    return state("POST_SESSION_REVIEW", "post-session", "npm.cmd run trial:post-session -- --session <session-folder> --next-tester <tester-id>", "Resolve post-session blockers or review items.");
  }
  if (!remediationReady && !reports.review.exists) {
    return state("NEEDS_SESSION_REVIEW", "review", "npm.cmd run trial:review-session", "Review completed tester evidence before archiving or inviting another tester.");
  }
  if (!remediationReady && (reports.review.decision === "REVIEW_BLOCKED" || reports.review.decision === "REVIEW_FIX_NOW" || reports.review.decision === "REVIEW_WAITING_FOR_REPORTS")) {
    return state("SESSION_REVIEW_BLOCKED", "review", "npm.cmd run trial:review-session", "Resolve review blockers or fix-now items before proceeding.");
  }
  if (!remediationReady && !reports.archive.exists) {
    return state("NEEDS_ARCHIVE", "archive", "npm.cmd run trial:archive-session -- --session <session-folder> --tester <tester-id>", "Archive the privacy-passed session evidence locally.");
  }
  if (!remediationReady && reports.archive.decision === "ARCHIVE_HOLD") {
    return state("ARCHIVE_BLOCKED", "archive", "npm.cmd run trial:archive-session -- --session <session-folder> --tester <tester-id>", "Fix archive blockers before closing the session.");
  }
  if (reports.nextLive.exists && reports.nextLive.decision === "NEXT_LIVE_HOLD") {
    return state("NEXT_LIVE_BLOCKED", "next-live", "npm.cmd run trial:next-live -- --tester <tester-id> --accept-review", "Fix next-live launch loop blockers before hosting another tester.");
  }
  if (!reports.intake.exists) {
    return state("NEEDS_TESTER_INTAKE", "intake", "npm.cmd run trial:intake -- --init", "Create and fill the local tester intake roster before generating the next session pack.");
  }
  if (reports.intake.decision === "INTAKE_HOLD") {
    return state("TESTER_INTAKE_BLOCKED", "intake", "npm.cmd run trial:intake", "Fix tester consent, privacy, language, or scope blockers.");
  }
  if (reports.intake.decision === "WAITING_FOR_TESTER_INTAKE") {
    return state("NEEDS_TESTER_INTAKE", "intake", "npm.cmd run trial:intake", "Complete at least one tester intake entry before generating a session pack.");
  }
  const nextTester = nextTesterFromReports(reports);
  if (!reports.cohort.exists && reports.nextLive.exists && ["NEXT_LIVE_READY", "NEXT_LIVE_READY_WITH_REVIEW"].includes(reports.nextLive.decision)) {
    return state("READY_TO_HOST_NEXT_LIVE", "next-live", "Open NEXT_LIVE_HOST_HANDOFF.md", "Use the next-live handoff and host only the selected anonymous tester.");
  }
  if (!reports.cohort.exists && reports.liveCapture.exists && ["LIVE_CAPTURE_READY", "LIVE_CAPTURE_READY_WITH_REVIEW"].includes(reports.liveCapture.decision) && reportTesterMatches(reports.liveCapture, nextTester)) {
    return state("NEEDS_NEXT_LIVE", "next-live", "npm.cmd run trial:next-live -- --tester <tester-id> --accept-review", "Run the guarded next-live loop check before hosting the next tester.");
  }
  if (!reports.cohort.exists || reports.cohort.decision === "WAITING_FOR_MORE_SESSIONS") {
    return state("READY_FOR_NEXT_TESTER", "next-session", "npm.cmd run trial:intake-session -- --force", "Generate the next tester session pack from intake.");
  }
  if (reports.cohortHandoff.exists && reports.cohortHandoff.decision === "COHORT_HANDOFF_HOLD") {
    return state("COHORT_HANDOFF_BLOCKED", "cohort", "npm.cmd run trial:cohort-handoff -- --accept-review --accept-privacy --accepted-by <host-id>", "Fix cohort handoff blockers before expanding.");
  }
  if (reports.cohortHandoff.exists && reports.cohortHandoff.decision === "COHORT_HANDOFF_REVIEW_REQUIRED") {
    return state("COHORT_HANDOFF_REVIEW", "cohort", "npm.cmd run trial:cohort-handoff -- --accept-review --accepted-by <host-id>", "Review repeated safety themes before deciding whether to expand.");
  }
  if (reports.cohortHandoff.exists && ["COHORT_HANDOFF_READY_TO_EXPAND", "COHORT_HANDOFF_EXPAND_WITH_WATCH"].includes(reports.cohortHandoff.decision)) {
    return state("READY_TO_EXPAND", "cohort", "Open COHORT_EXPANSION_HANDOFF.md", "Proceed with the next hosted tester batch under cohort handoff instructions.");
  }
  if (reports.cohort.decision === "HOLD_EXPANSION_FIX_FIRST") {
    return state("COHORT_REVIEW", "cohort", "npm.cmd run trial:cohort-summary -- <completed-trials-folder>", "Review and fix cohort expansion blockers.");
  }
  if (reports.cohort.decision === "REVIEW_REPEATED_SAFETY") {
    return state("NEEDS_COHORT_HANDOFF", "cohort", "npm.cmd run trial:cohort-handoff -- --accept-review --accepted-by <host-id>", "Generate a cohort handoff for repeated safety review.");
  }
  if (["READY_TO_EXPAND_3_5", "EXPAND_WITH_WATCH"].includes(reports.cohort.decision)) {
    return state("NEEDS_COHORT_HANDOFF", "cohort", "npm.cmd run trial:cohort-handoff -- --accept-review --accept-privacy --accepted-by <host-id>", "Generate the cohort expansion handoff before inviting 3-5 testers.");
  }
  if (blockers.length) {
    return state("BLOCKED", "review", "npm.cmd run trial:status", "Review blockers in the status report.");
  }
  return state("READY_TO_EXPAND", "cohort", "npm.cmd run trial:intake-session -- --force", "Proceed with the next hosted tester batch from intake under watch items.");
}

function collectBlockers(reports, { remediationReady = false } = {}) {
  const blockers = [];
  const remediatedHistoricalKeys = new Set(["afterLive", "feedback", "backlog", "postSession", "review", "archive"]);
  for (const [key, report] of Object.entries(reports)) {
    if (key === "intakeReviewDryRun") continue;
    if (key === "hostRun" && reports.postSession.exists) continue;
    if (key === "completion" && reports.postSession.exists) continue;
    if (key === "preLive" && reports.postSession.exists) continue;
    if (key === "liveCapture" && reports.postSession.exists) continue;
    if (key === "afterLive" && !report.exists) continue;
    if (key === "nextLive" && !report.exists) continue;
    if (key === "cohortHandoff" && !report.exists) continue;
    if (key === "remediation" && !report.exists) continue;
    if (remediationReady && remediatedHistoricalKeys.has(key)) continue;
    if (!report.exists) continue;
    if (report.ok === false) blockers.push(`${report.key}: report is not ok.`);
    for (const item of report.blockers) blockers.push(`${report.key}: ${item}`);
  }
  if (reports.privacy.decision === "PRIVACY_HOLD") blockers.push("Privacy is PRIVACY_HOLD.");
  return unique(blockers);
}

function collectWarnings(reports, artifacts, { remediationReady = false } = {}) {
  const warnings = [];
  for (const report of Object.values(reports)) {
    if (!report.exists) warnings.push(`${report.fileName} has not been generated yet.`);
    for (const item of report.warnings) warnings.push(`${report.key}: ${item}`);
  }
  if (!artifacts.latestPackage) warnings.push("No local trial package folder was found.");
  if (!artifacts.latestSessionPack) warnings.push("No trial session pack folder was found.");
  if (!artifacts.latestArchive) warnings.push("No trial archive folder was found.");
  if (remediationReady) warnings.push("The previous AFTER_LIVE_BLOCKED result remains historical; current progress comes from an independent remediation closure.");
  return unique(warnings);
}

function remediationClosesAfterLive(reports, currentSourceVersion) {
  const afterLive = reports.afterLive.data || {};
  const remediation = reports.remediation.data || {};
  if (afterLive.decision !== "AFTER_LIVE_BLOCKED") return false;
  if (remediation.mode !== "trial-remediation-gate") return false;
  if (remediation.ok !== true || !["REMEDIATION_READY_FOR_RETEST", "REMEDIATION_READY_WITH_REVIEW"].includes(remediation.decision)) return false;
  if ((remediation.blockers || []).length > 0) return false;
  if (remediation.originalAfterLiveDecision !== "AFTER_LIVE_BLOCKED") return false;
  if (sanitizeTesterId(remediation.testerId) !== sanitizeTesterId(afterLive.testerId)) return false;
  if ((remediation.unresolvedItems || []).length > 0) return false;
  if (remediation.hostAcceptance?.accepted !== true || remediation.hostAcceptance?.originalRecordsUnchanged !== true) return false;
  if (!/^host-[a-z0-9-]+$/i.test(remediation.hostAcceptance?.acceptedBy || "")) return false;
  if (remediation.decision === "REMEDIATION_READY_WITH_REVIEW" && remediation.hostAcceptance?.acceptedWarnings !== true) return false;
  if (!hasAllRequiredRemediationHostChecks(remediation.hostAcceptance?.hostChecks)) return false;
  if (remediation.hostAcceptance?.acceptedCommit !== remediation.currentCommit) return false;
  if (remediation.observedReports?.afterLive?.sha256 !== reports.afterLive.sha256) return false;

  const remediationVersion = {
    available: Boolean(remediation.currentCommit),
    commit: remediation.currentCommit || "",
    dirty: remediation.worktreeClean === true ? false : true
  };
  return sourceVersionBindingIssues(currentSourceVersion, {
    "Current readiness report": reports.readiness.data?.sourceVersion,
    "Remediation readiness": remediation.readinessSourceVersion,
    "Remediation report": remediationVersion
  }).length === 0;
}

function publicReports(reports) {
  const output = {};
  for (const [key, report] of Object.entries(reports)) {
    output[key] = {
      exists: report.exists,
      ok: report.ok,
      decision: report.decision,
      createdAt: report.createdAt,
      relativePath: report.relativePath,
      blockers: report.blockers.length,
      warnings: report.warnings.length
    };
  }
  return output;
}

function quickLinks(reports, artifacts) {
  return {
    readinessReport: reports.readiness.exists ? reports.readiness.relativePath : "",
    dispatchNote: reports.dispatch.exists ? reports.dispatch.relativePath : "",
    hostReadyReport: reports.hostReady.exists ? reports.hostReady.relativePath : "",
    hostRunReport: reports.hostRun.exists ? reports.hostRun.relativePath : "",
    completionReport: reports.completion.exists ? reports.completion.relativePath : "",
    postSessionReport: reports.postSession.exists ? reports.postSession.relativePath : "",
    reviewReport: reports.review.exists ? reports.review.relativePath : "",
    intakeReviewDryRun: reports.intakeReviewDryRun.exists ? reports.intakeReviewDryRun.relativePath : "",
    preLiveReport: reports.preLive.exists ? reports.preLive.relativePath : "",
    liveCaptureReport: reports.liveCapture.exists ? reports.liveCapture.relativePath : "",
    afterLiveReport: reports.afterLive.exists ? reports.afterLive.relativePath : "",
    remediationReport: reports.remediation.exists ? reports.remediation.relativePath : "",
    nextLiveReport: reports.nextLive.exists ? reports.nextLive.relativePath : "",
    cohortSummary: reports.cohort.exists ? reports.cohort.relativePath : "",
    cohortHandoff: reports.cohortHandoff.exists ? reports.cohortHandoff.relativePath : "",
    archiveReport: reports.archive.exists ? reports.archive.relativePath : "",
    intakeReport: reports.intake.exists ? reports.intake.relativePath : "",
    testerLaunchPlan: reports.testerLaunchPlan.exists ? reports.testerLaunchPlan.relativePath : "",
    latestPackage: artifacts.latestPackage?.relativePath || "",
    latestSessionPack: artifacts.latestSessionPack?.relativePath || "",
    latestAfterLivePacket: artifacts.latestAfterLivePacket?.relativePath || "",
    latestArchive: artifacts.latestArchive?.relativePath || ""
  };
}

function commandGuide(current, reports) {
  return [
    { step: "Readiness", command: "npm.cmd run trial:ready", status: reports.readiness.exists ? reports.readiness.decision : "missing" },
    { step: "Freeze", command: "npm.cmd run trial:simulate && npm.cmd run trial:freeze", status: reports.freeze.exists ? reports.freeze.decision : "missing" },
    { step: "Dispatch", command: "npm.cmd run trial:dispatch", status: reports.dispatch.exists ? reports.dispatch.decision : "missing" },
    { step: "Host-ready", command: "npm.cmd run trial:session-pack -- --force; npm.cmd run trial:host-ready", status: reports.hostReady.exists ? reports.hostReady.decision : "missing" },
    { step: "Host runbook", command: "npm.cmd run trial:host-run", status: reports.hostRun.exists ? reports.hostRun.decision : "missing" },
    { step: "Session completion", command: "npm.cmd run trial:complete-session -- --session <session-folder>", status: reports.completion.exists ? reports.completion.decision : "missing" },
    { step: "Post-session", command: "npm.cmd run trial:post-session -- --session <session-folder> --next-tester <tester-id>", status: reports.postSession.exists ? reports.postSession.decision : "missing" },
    { step: "Session review", command: "npm.cmd run trial:review-session", status: reports.review.exists ? reports.review.decision : "missing" },
    { step: "Intake-review dry run", command: "npm.cmd run trial:intake-review-dry-run", status: reports.intakeReviewDryRun.exists ? reports.intakeReviewDryRun.decision : "missing" },
    { step: "Pre-live gate", command: "npm.cmd run trial:pre-live", status: reports.preLive.exists ? reports.preLive.decision : "missing" },
    { step: "Live capture", command: "npm.cmd run trial:live-capture", status: reports.liveCapture.exists ? reports.liveCapture.decision : "missing" },
    { step: "After-live", command: "npm.cmd run trial:after-live -- --session <session-folder> --tester <tester-id>", status: reports.afterLive.exists ? reports.afterLive.decision : "missing" },
    { step: "Remediation", command: "npm.cmd run trial:remediation -- --tester <previous-tester-id>", status: reports.remediation.exists ? reports.remediation.decision : "missing" },
    { step: "Next live gate", command: "npm.cmd run trial:next-live -- --tester <tester-id> --accept-review", status: reports.nextLive.exists ? reports.nextLive.decision : "missing" },
    { step: "Cohort", command: "npm.cmd run trial:cohort-summary -- <completed-trials-folder>", status: reports.cohort.exists ? reports.cohort.decision : "missing" },
    { step: "Cohort handoff", command: "npm.cmd run trial:cohort-handoff -- --accept-review --accept-privacy --accepted-by <host-id>", status: reports.cohortHandoff.exists ? reports.cohortHandoff.decision : "missing" },
    { step: "Archive", command: "npm.cmd run trial:archive-session -- --session <session-folder> --tester <tester-id>", status: reports.archive.exists ? reports.archive.decision : "missing" },
    { step: "Tester intake", command: "npm.cmd run trial:intake", status: reports.intake.exists ? reports.intake.decision : "missing" },
    { step: "Intake session", command: "npm.cmd run trial:intake-session -- --force", status: "uses ready tester intake" },
    { step: "Tester launch plan", command: "npm.cmd run trial:tester-launch-plan -- --tester <tester-id>", status: reports.testerLaunchPlan.exists ? reports.testerLaunchPlan.decision : "missing" },
    { step: "Current recommendation", command: current.nextCommand, status: current.decision }
  ];
}

function nextSteps(current) {
  return [
    current.nextAction,
    `Run: ${current.nextCommand}`,
    "Rerun npm.cmd run trial:status after the command completes."
  ];
}

function state(decision, currentStage, nextCommand, nextAction) {
  return { decision, currentStage, nextCommand, nextAction };
}

function nextTesterFromReports(reports) {
  return sanitizeTesterId(
    reports.afterLive.data?.nextTester
    || reports.intake.data?.nextTester?.id
    || reports.intake.data?.testers?.find?.((tester) => tester.ready)?.id
    || ""
  );
}

function reportTesterMatches(report, testerId) {
  if (!testerId) return false;
  return sanitizeTesterId(report.data?.testerId || "") === testerId;
}

async function latestDirectory(pattern) {
  if (!(await exists(distPath))) return null;
  const entries = await fs.readdir(distPath, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
    .map((entry) => path.join(distPath, entry.name));
  return latestPath(matches);
}

async function latestNestedDirectory(parentPath) {
  if (!(await exists(parentPath))) return null;
  const entries = await fs.readdir(parentPath, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(parentPath, entry.name));
  return latestPath(matches);
}

async function latestPath(paths) {
  let latest = null;
  for (const candidate of paths) {
    const stat = await fs.stat(candidate);
    const item = {
      path: candidate,
      relativePath: relative(candidate),
      updatedAt: stat.mtime.toISOString()
    };
    if (!latest || stat.mtimeMs > latest.mtimeMs) latest = { ...item, mtimeMs: stat.mtimeMs };
  }
  if (!latest) return null;
  const { mtimeMs, ...publicItem } = latest;
  return publicItem;
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial Status",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Current stage: ${report.currentStage}`,
    `Next command: ${report.nextCommand}`,
    "",
    "## Next Action",
    "",
    `- ${report.nextAction}`,
    "",
    "## Quick Links",
    "",
    ...Object.entries(report.quickLinks).map(([key, value]) => `- ${key}: ${value || "n/a"}`),
    "",
    "## Reports",
    "",
    "| Report | Exists | Decision | Blockers | Warnings |",
    "| --- | --- | --- | ---: | ---: |",
    ...Object.entries(report.reports).map(([key, item]) => `| ${key} | ${item.exists ? "Yes" : "No"} | ${item.decision} | ${item.blockers} | ${item.warnings} |`),
    "",
    "## Blockers",
    "",
    ...(report.blockers.length ? report.blockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Command Guide",
    "",
    ...report.commandGuide.map((item) => `- ${item.step}: ${item.command} (${item.status})`),
    "",
    "## Next Steps",
    "",
    ...report.nextSteps.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function parseArgs(rawArgs) {
  const parsed = { dist: "", sourceRoot: "", json: "", markdown: "" };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    let handled = false;
    for (const key of ["dist", "sourceRoot", "json", "markdown"]) {
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
    if (!parsed.dist && !arg.startsWith("--")) {
      parsed.dist = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return item;
    return item.message || item.reason || item.title || JSON.stringify(item);
  }).filter(Boolean);
}

function relative(targetPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sanitizeTesterId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

async function readJsonWithHash(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return {
      data: JSON.parse(content),
      sha256: crypto.createHash("sha256").update(content).digest("hex")
    };
  } catch {
    return { data: null, sha256: "" };
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
