import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { REQUIRED_REMEDIATION_HOST_CHECKS } from "./trial-remediation-contract.js";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const args = parseArgs(process.argv.slice(2));
const rootPath = path.resolve(projectRoot, args.root || ".");
const reportsPath = resolveInsideRoot(args.reports || "dist");

const inputPaths = {
  afterLive: resolveInsideRoot(args.afterLive || path.join(relative(reportsPath), "TRIAL_AFTER_LIVE_REPORT.json")),
  review: resolveInsideRoot(args.review || path.join(relative(reportsPath), "TRIAL_REVIEW_REPORT.json")),
  privacy: resolveInsideRoot(args.privacy || path.join(relative(reportsPath), "TRIAL_PRIVACY_REPORT.json")),
  feedback: resolveInsideRoot(args.feedback || path.join(relative(reportsPath), "TRIAL_FEEDBACK_SUMMARY.json")),
  backlog: resolveInsideRoot(args.backlog || path.join(relative(reportsPath), "TRIAL_FIX_BACKLOG.json")),
  completion: resolveInsideRoot(args.completion || path.join(relative(reportsPath), "TRIAL_SESSION_COMPLETION_REPORT.json")),
  readiness: resolveInsideRoot(args.readiness || path.join(relative(reportsPath), "TRIAL_READINESS_REPORT.json")),
  fixChecklist: resolveInsideRoot(args.fixChecklist || path.join(relative(reportsPath), "TRIAL_REMEDIATION_CHECKLIST.json")),
  acceptance: resolveInsideRoot(args.acceptance || path.join(relative(reportsPath), "TRIAL_REMEDIATION_ACCEPTANCE.json"))
};

const loaded = {};
for (const [key, filePath] of Object.entries(inputPaths)) loaded[key] = await readJsonReport(key, filePath);

const testerId = sanitizeTesterId(args.tester || loaded.afterLive.data?.testerId || loaded.fixChecklist.data?.testerId || "unknown-tester");
const sessionManifestPath = resolveInsideRoot(args.manifest || inferManifestPath(loaded.afterLive.data));
loaded.manifest = await readJsonReport("manifest", sessionManifestPath);

const jsonPath = resolveInsideReports(args.json || path.join(relative(reportsPath), "TRIAL_REMEDIATION_REPORT.json"));
const markdownPath = resolveInsideReports(args.markdown || path.join(relative(reportsPath), "TRIAL_REMEDIATION_REPORT.md"));
const runStamp = timestamp();
const evidencePath = resolveInsideReports(args.evidenceOut || path.join(relative(reportsPath), "trial-remediation", `${testerId}-${runStamp}`));

const report = await buildReport();
await writeReportPair(jsonPath, markdownPath, report);

if (!args.noEvidenceCopy && report.ok) {
  const evidenceReportsPath = path.join(evidencePath, "reports");
  await fs.mkdir(evidenceReportsPath, { recursive: true });
  const evidenceJsonPath = path.join(evidenceReportsPath, "TRIAL_REMEDIATION_REPORT.json");
  const evidenceMarkdownPath = path.join(evidenceReportsPath, "TRIAL_REMEDIATION_REPORT.md");
  const reportWithEvidence = {
    ...report,
    evidenceCopy: {
      localOnly: true,
      relativePath: relative(evidencePath),
      containsRawTesterRecords: false
    }
  };
  await writeReportPair(jsonPath, markdownPath, reportWithEvidence);
  await writeReportPair(evidenceJsonPath, evidenceMarkdownPath, reportWithEvidence);
  Object.assign(report, reportWithEvidence);
}

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  testerId: report.testerId,
  originalAfterLiveDecision: report.originalAfterLiveDecision,
  fixCommit: report.fixCommit,
  currentCommit: report.currentCommit,
  resolvedItems: report.resolvedItems.length,
  unresolvedItems: report.unresolvedItems.length,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  jsonPath,
  markdownPath,
  evidenceCopy: report.evidenceCopy?.relativePath || ""
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function buildReport() {
  const blockers = [];
  const warnings = [];
  const blockerCodes = new Set();
  const warningCodes = new Set();
  const addBlocker = (code, message) => addFinding(blockers, blockerCodes, code, message);
  const addWarning = (code, message) => addFinding(warnings, warningCodes, code, message);

  for (const key of ["afterLive", "review", "privacy", "feedback", "backlog", "completion", "readiness", "fixChecklist", "acceptance", "manifest"]) {
    if (!loaded[key].exists) addBlocker(`MISSING_${constantName(key)}`, `${displayName(key)} is missing.`);
    else if (loaded[key].error) addBlocker(`INVALID_${constantName(key)}`, `${displayName(key)} is not valid JSON.`);
  }

  const afterLive = loaded.afterLive.data || {};
  const review = loaded.review.data || {};
  const privacy = loaded.privacy.data || {};
  const feedback = loaded.feedback.data || {};
  const backlog = loaded.backlog.data || {};
  const completion = loaded.completion.data || {};
  const readiness = loaded.readiness.data || {};
  const fixChecklist = loaded.fixChecklist.data || {};
  const acceptance = loaded.acceptance.data || {};
  const manifest = loaded.manifest.data || {};
  const originalAfterLiveDecision = stringValue(afterLive.decision) || "UNKNOWN";

  validateModes({ afterLive, review, privacy, feedback, backlog, completion, readiness, fixChecklist, acceptance, manifest }, addBlocker);

  if (originalAfterLiveDecision !== "AFTER_LIVE_BLOCKED") {
    addBlocker("ORIGINAL_AFTER_LIVE_NOT_BLOCKED", "Remediation is only valid for a preserved AFTER_LIVE_BLOCKED result.");
  }
  if (!testerMatches(testerId, [afterLive.testerId, review.testerId, fixChecklist.testerId, acceptance.testerId, manifest.testerId])) {
    addBlocker("TESTER_MISMATCH", "Tester ids are missing or do not align across remediation inputs.");
  }
  if (!isCompletionReady(completion)) addBlocker("COMPLETION_NOT_READY", "The preserved session completion report is not ready.");

  if (privacy.decision === "PRIVACY_HOLD" || arrayLength(privacy.blockers) > 0 || privacy.ok === false) {
    addBlocker("PRIVACY_HOLD", "Privacy remains on hold; remediation cannot override it.");
  } else if (privacy.decision === "PRIVACY_REVIEW" || arrayLength(privacy.warnings) > 0) {
    addWarning("PRIVACY_REVIEW", "The preserved privacy report requires explicit host review.");
  } else if (privacy.decision !== "PRIVACY_OK") {
    addBlocker("PRIVACY_UNKNOWN", "The preserved privacy decision is not PRIVACY_OK or PRIVACY_REVIEW.");
  }

  if (manifest.testerIntake?.consent !== true) addBlocker("INTAKE_CONSENT_MISSING", "The session manifest does not record consent.");
  if (manifest.testerIntake?.privacyAccepted !== true) addBlocker("INTAKE_PRIVACY_MISSING", "The session manifest does not record privacy acceptance.");
  if (hasStructuredStop(feedback)) addBlocker("ORIGINAL_STOP_RECORDED", "The preserved structured feedback records a Stop decision.");

  const gitState = await readGitState(addBlocker);
  const fixCommit = stringValue(fixChecklist.fixCommit);
  validateFixCommit({ fixCommit, gitState, fixChecklist, originalAfterLiveDecision, addBlocker });
  await validateReadiness({ readiness, gitState, addBlocker });

  const sourceItems = collectSourceItems({ afterLive, review, feedback, backlog });
  const mapping = validateFixMappings({ sourceItems, fixChecklist, fixCommit, addBlocker });
  const hostAcceptance = validateHostAcceptance({
    acceptance,
    testerId,
    fixCommit,
    gitState,
    readiness,
    resolvedFixIds: mapping.resolvedFixIds,
    warningsPresent: warnings.length > 0 || countWatchItems(backlog) > 0 || arrayLength(review.warnings) > 0,
    addBlocker,
    addWarning
  });

  const originalWatchCount = countWatchItems(backlog) + arrayLength(review.warnings);
  if (originalWatchCount > 0) {
    addWarning("ORIGINAL_WATCH_ITEMS_RETAINED", `${originalWatchCount} original watch entries remain visible for retest review.`);
  }

  const decision = blockers.length
    ? "REMEDIATION_HOLD"
    : warnings.length
      ? "REMEDIATION_READY_WITH_REVIEW"
      : "REMEDIATION_READY_FOR_RETEST";

  return {
    ok: decision !== "REMEDIATION_HOLD",
    mode: "trial-remediation-gate",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    decision,
    testerId,
    originalAfterLiveDecision,
    originalReviewDecision: stringValue(review.decision) || "UNKNOWN",
    originalPrivacyDecision: stringValue(privacy.decision) || "UNKNOWN",
    originalFeedbackDecision: stringValue(feedback.decision) || "UNKNOWN",
    originalBacklogDecision: stringValue(backlog.decision) || "UNKNOWN",
    originalAfterLiveRelativePath: loaded.afterLive.relativePath,
    fixCommit,
    currentCommit: gitState.commit,
    worktreeClean: gitState.clean,
    readinessCreatedAt: stringValue(readiness.createdAt),
    packagePath: publicPackagePath(readiness.packagePath),
    readinessSourceVersion: {
      available: readiness.sourceVersion?.available === true,
      commit: stringValue(readiness.sourceVersion?.commit),
      dirty: readiness.sourceVersion?.dirty ?? null
    },
    resolvedItems: mapping.resolvedItems,
    unresolvedItems: mapping.unresolvedItems,
    hostAcceptance,
    sourceItemCounts: {
      required: sourceItems.length,
      resolved: mapping.resolvedItems.length,
      unresolved: mapping.unresolvedItems.length
    },
    observedReports: publicObservedReports(),
    blockers,
    warnings,
    privacy: {
      localOnly: true,
      containsRawTesterRecords: false,
      containsTesterQuotesOrNotes: false,
      sourceReportsModified: false
    },
    nextSteps: nextSteps(decision)
  };
}

function validateModes(reports, addBlocker) {
  const expected = {
    afterLive: "trial-after-live",
    review: "trial-review-session",
    privacy: "trial-privacy-check",
    feedback: "trial-feedback-ingest",
    backlog: "trial-fix-backlog",
    completion: "trial-session-completion",
    readiness: "trial-readiness",
    fixChecklist: "trial-remediation-checklist",
    acceptance: "trial-remediation-acceptance",
    manifest: "trial-session-pack"
  };
  for (const [key, expectedMode] of Object.entries(expected)) {
    if (loaded[key].exists && !loaded[key].error && reports[key].mode !== expectedMode) {
      addBlocker(`MODE_MISMATCH_${constantName(key)}`, `${displayName(key)} has an unexpected mode.`);
    }
  }
}

function validateFixCommit({ fixCommit, gitState, fixChecklist, originalAfterLiveDecision, addBlocker }) {
  if (fixChecklist.originalAfterLiveDecision !== originalAfterLiveDecision) {
    addBlocker("FIX_CHECKLIST_DECISION_MISMATCH", "The fix checklist does not preserve the original after-live decision.");
  }
  if (!/^[0-9a-f]{40}$/i.test(fixCommit)) {
    addBlocker("FIX_COMMIT_MISSING", "The fix checklist must name a full 40-character fix commit.");
    return;
  }
  if (!gitState.commit) return;
  if (!gitState.ancestors.has(fixCommit.toLowerCase())) {
    addBlocker("FIX_COMMIT_NOT_ANCESTOR", "The fix commit is not an ancestor of the current commit.");
  }
  if (!validDate(fixChecklist.createdAt)) addBlocker("FIX_CHECKLIST_TIMESTAMP_INVALID", "The fix checklist needs a valid createdAt timestamp.");
}

async function validateReadiness({ readiness, gitState, addBlocker }) {
  if (readiness.ok !== true) addBlocker("READINESS_NOT_OK", "Readiness has not passed.");
  if (!validDate(readiness.createdAt)) addBlocker("READINESS_TIMESTAMP_INVALID", "Readiness createdAt is missing or invalid.");
  if (readiness.sourceVersion?.available !== true) {
    addBlocker("READINESS_VERSION_UNAVAILABLE", "Readiness does not have an available Git source version.");
  }
  if (readiness.sourceVersion?.commit !== gitState.commit) {
    addBlocker("READINESS_COMMIT_STALE", "Readiness was not generated from the current commit.");
  }
  if (readiness.sourceVersion?.dirty !== false) {
    addBlocker("READINESS_DIRTY", "Readiness sourceVersion must explicitly record dirty=false.");
  }
  if (!gitState.clean) addBlocker("WORKTREE_DIRTY", "The current worktree has product changes not covered by readiness.");
  if (Array.isArray(readiness.checks) && readiness.checks.some((check) => check?.exitCode !== 0)) {
    addBlocker("READINESS_CHECK_FAILED", "At least one readiness check did not pass.");
  }
  if (arrayLength(readiness.hygiene?.missingRequired) > 0 || arrayLength(readiness.hygiene?.disallowed) > 0) {
    addBlocker("READINESS_HYGIENE_FAILED", "Readiness package hygiene is not clean.");
  }
  const packagePath = resolvePackagePath(readiness.packagePath);
  if (!packagePath || !isInsideRoot(packagePath)) {
    addBlocker("READINESS_PACKAGE_OUTSIDE_ROOT", "The readiness package path is missing or outside the project root.");
  } else {
    try {
      const stat = await fs.stat(packagePath);
      if (!stat.isDirectory()) addBlocker("READINESS_PACKAGE_MISSING", "The readiness package path is not a directory.");
    } catch {
      addBlocker("READINESS_PACKAGE_MISSING", "The readiness package directory does not exist.");
    }
  }
}

function collectSourceItems({ afterLive, review, feedback, backlog }) {
  const items = [];
  const seen = new Set();
  const backlogItems = Array.isArray(backlog.mustFixBeforeTester2) ? backlog.mustFixBeforeTester2 : [];
  for (const [index, item] of backlogItems.entries()) {
    const id = safeToken(item?.id) || `item-${index + 1}`;
    addSourceItem(items, seen, {
      sourceRef: `backlog:${id}`,
      origin: "backlog",
      sourceId: id,
      priority: safePriority(item?.priority || "P0"),
      fingerprint: stableHash(publicBlockerIdentity(item))
    });
  }

  const reviewActions = Array.isArray(review.actionItems) ? review.actionItems.filter((item) => item?.priority === "P0") : [];
  for (const [index, item] of reviewActions.entries()) {
    const id = safeToken(item?.id) || `item-${index + 1}`;
    if (seen.has(`backlog:${id}`)) continue;
    addSourceItem(items, seen, {
      sourceRef: `review:${id}`,
      origin: "review",
      sourceId: id,
      priority: "P0",
      fingerprint: stableHash(publicBlockerIdentity(item))
    });
  }

  const feedbackBlockers = Array.isArray(feedback.blockers) ? feedback.blockers : [];
  for (const [index, item] of feedbackBlockers.entries()) {
    if (matchesBacklogItem(item, backlogItems)) continue;
    const fingerprint = stableHash(publicBlockerIdentity(item));
    addSourceItem(items, seen, {
      sourceRef: `feedback:${fingerprint.slice(0, 16)}`,
      origin: "feedback",
      sourceId: `blocker-${index + 1}`,
      priority: "P0",
      fingerprint
    });
  }

  const productItemsExist = items.length > 0;
  let technicalStepCount = 0;
  for (const [index, step] of listValues(afterLive.steps).entries()) {
    if (step?.exitCode === 0 || step?.exitCode === undefined || step?.exitCode === null) continue;
    if (productItemsExist && normalizeText(step?.name) === "review:session") continue;
    technicalStepCount += 1;
    const stepId = safeToken(step?.name) || `step-${index + 1}`;
    addSourceItem(items, seen, {
      sourceRef: `after-live-step:${stepId}`,
      origin: "after-live",
      sourceId: stepId,
      priority: "P0",
      fingerprint: stableHash({ name: stepId, exitCode: step.exitCode })
    });
  }

  if (afterLive.decision === "AFTER_LIVE_BLOCKED") {
    for (const [index, item] of listValues(afterLive.blockers).entries()) {
      if (productItemsExist && isDerivedAfterLiveBlocker(item)) continue;
      if (technicalStepCount > 0) continue;
      const fingerprint = stableHash({ value: normalizeText(item), index });
      addSourceItem(items, seen, {
        sourceRef: `after-live:${fingerprint.slice(0, 16)}`,
        origin: "after-live",
        sourceId: `blocker-${index + 1}`,
        priority: "P0",
        fingerprint
      });
    }
  }
  return items;
}

function isDerivedAfterLiveBlocker(value) {
  return /(review:session|trial_feedback_summary|trial_review_report|session review)/i.test(stringValue(value));
}

function validateFixMappings({ sourceItems, fixChecklist, fixCommit, addBlocker }) {
  const required = new Map(sourceItems.map((item) => [item.sourceRef, item]));
  const mapped = new Map();
  const resolvedFixIds = new Set();
  const checklistItems = Array.isArray(fixChecklist.items) ? fixChecklist.items : [];

  if (sourceItems.length === 0) addBlocker("NO_SOURCE_BLOCKERS", "No stable source blocker could be derived from the preserved reports.");
  if (checklistItems.length === 0) addBlocker("FIX_CHECKLIST_EMPTY", "The fix checklist contains no remediation items.");

  for (const [index, item] of checklistItems.entries()) {
    const fixId = safeToken(item?.id) || `fix-${index + 1}`;
    const refs = uniqueStrings(item?.sourceRefs);
    if (refs.length === 0) addBlocker("FIX_WITHOUT_SOURCE", `Fix item ${fixId} does not map a source blocker.`);
    if (item?.status !== "fixed") addBlocker("FIX_NOT_COMPLETE", `Fix item ${fixId} is not marked fixed.`);
    const verificationOk = validVerification(item?.verification, fixCommit);
    if (!verificationOk) addBlocker("FIX_NOT_VERIFIED", `Fix item ${fixId} lacks current passing verification evidence.`);
    for (const sourceRef of refs) {
      if (!required.has(sourceRef)) {
        addBlocker("UNKNOWN_SOURCE_REF", `Fix item ${fixId} references an unknown sourceRef.`);
        continue;
      }
      if (mapped.has(sourceRef)) {
        addBlocker("DUPLICATE_SOURCE_REF", `Source ${sourceRef} is mapped by more than one fix item.`);
        continue;
      }
      mapped.set(sourceRef, { fixId, verificationOk, status: item?.status });
      if (verificationOk && item?.status === "fixed") resolvedFixIds.add(fixId);
    }
  }

  const resolvedItems = [];
  const unresolvedItems = [];
  for (const source of sourceItems) {
    const match = mapped.get(source.sourceRef);
    if (match?.verificationOk && match.status === "fixed") {
      resolvedItems.push(publicResolution(source, match.fixId, fixCommit));
    } else {
      const reasonCode = !match ? "UNMAPPED_BLOCKER" : match.status !== "fixed" ? "FIX_NOT_COMPLETE" : "FIX_NOT_VERIFIED";
      unresolvedItems.push(publicUnresolved(source, reasonCode));
      addBlocker(reasonCode, `Source blocker ${source.sourceRef} is unresolved.`);
    }
  }
  return { resolvedItems, unresolvedItems, resolvedFixIds: [...resolvedFixIds].sort() };
}

function validateHostAcceptance({ acceptance, testerId, fixCommit, gitState, readiness, resolvedFixIds, warningsPresent, addBlocker, addWarning }) {
  const decision = stringValue(acceptance.decision) || "MISSING";
  const accepted = ["ACCEPTED", "ACCEPTED_WITH_REVIEW"].includes(decision);
  if (!accepted) addBlocker("HOST_ACCEPTANCE_MISSING", "Host acceptance is missing or on hold.");
  if (!/^host-[a-z0-9-]+$/i.test(stringValue(acceptance.acceptedBy))) addBlocker("HOST_ID_INVALID", "Host acceptance must use an anonymous host id.");
  if (acceptance.testerId !== testerId) addBlocker("HOST_TESTER_MISMATCH", "Host acceptance is not aligned to this tester id.");
  if (acceptance.fixCommit !== fixCommit) addBlocker("HOST_FIX_COMMIT_MISMATCH", "Host acceptance does not target the fix commit.");
  if (!gitState.commit || acceptance.acceptedCommit !== gitState.commit) addBlocker("HOST_ACCEPTANCE_STALE", "Host acceptance is not bound to the current commit.");
  if (!validDate(acceptance.acceptedAt)) {
    addBlocker("HOST_ACCEPTANCE_TIMESTAMP_INVALID", "Host acceptance needs a valid acceptedAt timestamp.");
  } else if (validDate(readiness.createdAt) && Date.parse(acceptance.acceptedAt) < Date.parse(readiness.createdAt)) {
    addBlocker("HOST_ACCEPTANCE_BEFORE_READINESS", "Host acceptance predates current readiness.");
  }
  if (acceptance.originalRecordsUnchanged !== true) addBlocker("ORIGINAL_RECORDS_NOT_PRESERVED", "Host acceptance must confirm that the original tester records and after-live result were not changed.");

  const checks = Array.isArray(acceptance.hostChecks) ? acceptance.hostChecks : [];
  const publicChecks = [];
  for (const id of REQUIRED_REMEDIATION_HOST_CHECKS) {
    const check = checks.find((item) => safeToken(item?.id) === id);
    if (!check) {
      addBlocker("HOST_CHECK_MISSING", `Host acceptance is missing required check ${id}.`);
      continue;
    }
    const passed = check.status === "passed";
    const method = safeToken(check.method);
    const checkedAt = validDate(check.checkedAt) ? check.checkedAt : "";
    if (!passed) addBlocker("HOST_CHECK_NOT_PASSED", `Host check ${id} did not pass.`);
    if (!checkedAt) addBlocker("HOST_CHECK_TIMESTAMP_INVALID", `Host check ${id} needs a valid checkedAt timestamp.`);
    if (checkedAt && validDate(readiness.createdAt) && Date.parse(checkedAt) < Date.parse(readiness.createdAt)) {
      addBlocker("HOST_CHECK_BEFORE_READINESS", `Host check ${id} predates current readiness.`);
    }
    if (checkedAt && validDate(acceptance.acceptedAt) && Date.parse(checkedAt) > Date.parse(acceptance.acceptedAt)) {
      addBlocker("HOST_CHECK_AFTER_ACCEPTANCE", `Host check ${id} is later than the host acceptance decision.`);
    }
    if (!['manual', 'host-observed'].includes(method)) addBlocker("HOST_CHECK_METHOD_INVALID", `Host check ${id} must be completed manually by the host.`);
    publicChecks.push({ id, status: passed ? "passed" : "failed", method, checkedAt });
  }

  const reviewedFixIds = new Set(uniqueStrings(acceptance.reviewedFixIds).map(safeToken));
  for (const fixId of resolvedFixIds) {
    if (!reviewedFixIds.has(fixId)) addBlocker("FIX_NOT_HOST_REVIEWED", `Host acceptance does not cover fix item ${fixId}.`);
  }
  if (warningsPresent && acceptance.acceptedWarnings !== true) addBlocker("WARNINGS_NOT_ACCEPTED", "Remaining review warnings have not been explicitly accepted.");
  if (decision === "ACCEPTED_WITH_REVIEW" || warningsPresent) addWarning("HOST_REVIEW_REQUIRED", "Host acceptance retains explicit watch items for the controlled retest.");

  return {
    exists: loaded.acceptance.exists && !loaded.acceptance.error,
    decision,
    accepted,
    acceptedBy: safeHostId(acceptance.acceptedBy),
    acceptedAt: validDate(acceptance.acceptedAt) ? acceptance.acceptedAt : "",
    fixCommit: /^[0-9a-f]{40}$/i.test(stringValue(acceptance.fixCommit)) ? acceptance.fixCommit : "",
    acceptedCommit: /^[0-9a-f]{40}$/i.test(stringValue(acceptance.acceptedCommit)) ? acceptance.acceptedCommit : "",
    originalRecordsUnchanged: acceptance.originalRecordsUnchanged === true,
    hostChecks: publicChecks,
    acceptedWarnings: acceptance.acceptedWarnings === true,
    reviewedFixIds: [...reviewedFixIds].sort()
  };
}

async function readGitState(addBlocker) {
  const state = { commit: "", clean: false, ancestors: new Set() };
  try {
    const { stdout: commitOut } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: rootPath, windowsHide: true });
    state.commit = commitOut.trim().toLowerCase();
    const { stdout: statusOut } = await execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: rootPath, windowsHide: true });
    state.clean = statusOut.trim() === "";
    const fixCommit = stringValue(loaded.fixChecklist.data?.fixCommit).toLowerCase();
    if (/^[0-9a-f]{40}$/.test(fixCommit)) {
      try {
        await execFileAsync("git", ["merge-base", "--is-ancestor", fixCommit, state.commit], { cwd: rootPath, windowsHide: true });
        state.ancestors.add(fixCommit);
      } catch {
        // The caller reports the non-ancestor condition without leaking command output.
      }
    }
  } catch {
    addBlocker("GIT_STATE_UNAVAILABLE", "Current Git commit and worktree state could not be read.");
  }
  return state;
}

function validVerification(verification, fixCommit) {
  if (!verification || verification.status !== "passed") return false;
  if (verification.verifiedCommit !== fixCommit) return false;
  if (!validDate(verification.checkedAt)) return false;
  if (!Array.isArray(verification.evidence) || verification.evidence.length === 0) return false;
  return verification.evidence.every((item) => item?.passed === true && stringValue(item.kind) && stringValue(item.reference));
}

function hasStructuredStop(feedback) {
  const values = [feedback.decision, ...(feedback.decisionSignals || [])];
  return values.some((item) => {
    if (typeof item === "string") return normalizeText(item) === "stop";
    return [item?.decision, item?.result, item?.answer].some((value) => normalizeText(value) === "stop");
  });
}

function matchesBacklogItem(blocker, backlogItems) {
  const blockerLabel = normalizeText(blocker?.label || blocker?.title);
  const blockerSource = portableSource(blocker?.file, blocker?.line);
  return backlogItems.some((item) => {
    if (blockerLabel && normalizeText(item?.title) === blockerLabel) return true;
    return blockerSource && listValues(item?.sources).some((source) => normalizePortable(source).endsWith(normalizePortable(blockerSource)));
  });
}

function publicBlockerIdentity(item) {
  return {
    id: safeToken(item?.id),
    priority: safePriority(item?.priority),
    category: safeToken(item?.category || item?.theme),
    label: normalizeText(item?.label || item?.title),
    source: portableSource(item?.file, item?.line) || listValues(item?.sources).map(normalizePortable).sort()
  };
}

function publicResolution(source, fixId, fixCommit) {
  return {
    sourceRef: source.sourceRef,
    origin: source.origin,
    sourceId: source.sourceId,
    priority: source.priority,
    sourceFingerprint: source.fingerprint,
    fixId,
    verificationStatus: "passed",
    fixCommit
  };
}

function publicUnresolved(source, reasonCode) {
  return {
    sourceRef: source.sourceRef,
    origin: source.origin,
    sourceId: source.sourceId,
    priority: source.priority,
    sourceFingerprint: source.fingerprint,
    reasonCode
  };
}

function publicObservedReports() {
  return Object.fromEntries(["afterLive", "review", "privacy", "feedback", "backlog", "completion", "readiness"].map((key) => {
    const item = loaded[key];
    return [key, {
      exists: item.exists,
      mode: stringValue(item.data?.mode),
      decision: stringValue(item.data?.decision),
      ok: item.data?.ok ?? null,
      relativePath: item.relativePath,
      sha256: item.sha256,
      blockers: arrayLength(item.data?.blockers),
      warnings: arrayLength(item.data?.warnings)
    }];
  }));
}

async function readJsonReport(key, filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return { key, exists: true, data: JSON.parse(text), error: "", relativePath: relative(filePath), sha256: sha256(text) };
  } catch (error) {
    if (error.code === "ENOENT") return { key, exists: false, data: null, error: "", relativePath: relative(filePath), sha256: "" };
    return { key, exists: true, data: null, error: error.message, relativePath: relative(filePath), sha256: "" };
  }
}

async function writeReportPair(targetJson, targetMarkdown, report) {
  await fs.mkdir(path.dirname(targetJson), { recursive: true });
  await fs.mkdir(path.dirname(targetMarkdown), { recursive: true });
  await fs.writeFile(targetJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(targetMarkdown, renderMarkdown(report), "utf8");
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial Remediation Report",
    "",
    `Decision: ${report.decision}`,
    `Tester: ${report.testerId}`,
    `Created: ${report.createdAt}`,
    `Original after-live decision: ${report.originalAfterLiveDecision}`,
    `Original after-live report: ${report.originalAfterLiveRelativePath}`,
    `Fix commit: ${report.fixCommit || "missing"}`,
    `Current commit: ${report.currentCommit || "unavailable"}`,
    `Readiness created: ${report.readinessCreatedAt || "missing"}`,
    `Package: ${report.packagePath || "missing"}`,
    "",
    "This is a local-only remediation gate. It does not change the original human records or replace the original after-live decision.",
    "",
    "## Resolution",
    "",
    `- Required source items: ${report.sourceItemCounts.required}`,
    `- Resolved: ${report.sourceItemCounts.resolved}`,
    `- Unresolved: ${report.sourceItemCounts.unresolved}`,
    "",
    "### Resolved source refs",
    "",
    ...markdownRows(report.resolvedItems, (item) => `- ${item.sourceRef} -> ${item.fixId} (${item.verificationStatus})`),
    "",
    "### Unresolved source refs",
    "",
    ...markdownRows(report.unresolvedItems, (item) => `- ${item.sourceRef}: ${item.reasonCode}`),
    "",
    "## Host acceptance",
    "",
    `- Decision: ${report.hostAcceptance.decision}`,
    `- Host: ${report.hostAcceptance.acceptedBy || "missing"}`,
    `- Accepted commit: ${report.hostAcceptance.acceptedCommit || "missing"}`,
    `- Original records unchanged: ${yesNo(report.hostAcceptance.originalRecordsUnchanged)}`,
    `- Warnings accepted: ${yesNo(report.hostAcceptance.acceptedWarnings)}`,
    `- Required host checks passed: ${report.hostAcceptance.hostChecks.filter((item) => item.status === "passed").length}/${REQUIRED_REMEDIATION_HOST_CHECKS.length}`,
    "",
    "## Blockers",
    "",
    ...markdownRows(report.blockers, (item) => `- ${item.code}: ${item.message}`),
    "",
    "## Warnings",
    "",
    ...markdownRows(report.warnings, (item) => `- ${item.code}: ${item.message}`),
    "",
    "## Privacy boundary",
    "",
    "- No raw tester record is copied into this report.",
    "- No tester quote, note, path, or source excerpt is copied.",
    "- Original reports and human records remain unchanged and local-only.",
    "",
    "## Next steps",
    "",
    ...report.nextSteps.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function nextSteps(decision) {
  if (decision === "REMEDIATION_HOLD") {
    return [
      "Resolve every coded blocker without editing the preserved human records or original after-live report.",
      "Rerun trial:ready after the final product commit, then renew host acceptance on that same commit.",
      "Rerun trial:remediation; do not invite another tester while the decision remains HOLD."
    ];
  }
  if (decision === "REMEDIATION_READY_WITH_REVIEW") {
    return [
      "Keep the original AFTER_LIVE_BLOCKED decision in history.",
      "Carry the listed warnings into the controlled retest plan.",
      "Use this report only as remediation evidence for a future next-live gate."
    ];
  }
  return [
    "Keep the original AFTER_LIVE_BLOCKED decision in history.",
    "Use this report only as remediation evidence for a future controlled retest gate.",
    "Do not treat remediation readiness as a successful human retest."
  ];
}

function inferManifestPath(afterLive) {
  const session = stringValue(afterLive?.sessionRelativePath);
  return session ? path.join(session, "SESSION_PACK_MANIFEST.json") : path.join(relative(reportsPath), "SESSION_PACK_MANIFEST.json");
}

function testerMatches(expected, values) {
  const present = values.map(stringValue).filter(Boolean).map(sanitizeTesterId);
  return expected !== "unknown-tester" && present.length >= 4 && present.every((item) => item === expected);
}

function isCompletionReady(report) {
  return report.ok === true && ["SESSION_COMPLETION_READY", "SESSION_COMPLETION_READY_WITH_REVIEW"].includes(report.decision);
}

function countWatchItems(backlog) {
  return arrayLength(backlog.watchDuringTester2);
}

function publicPackagePath(value) {
  const packagePath = resolvePackagePath(value);
  return packagePath && isInsideRoot(packagePath) ? relative(packagePath) : "";
}

function resolvePackagePath(value) {
  if (!stringValue(value)) return "";
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(rootPath, value);
}

function resolveInsideRoot(value) {
  const resolved = path.isAbsolute(value) ? path.normalize(value) : path.resolve(rootPath, value);
  if (!isInsideRoot(resolved)) throw new Error(`Path must stay inside the remediation root: ${value}`);
  return resolved;
}

function resolveInsideReports(value) {
  const resolved = resolveInsideRoot(value);
  const rel = path.relative(reportsPath, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`Remediation output must stay inside the reports folder: ${value}`);
  return resolved;
}

function isInsideRoot(value) {
  const rel = path.relative(rootPath, value);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function relative(value) {
  return toPortable(path.relative(rootPath, value)) || ".";
}

function normalizePortable(value) {
  return toPortable(value).toLowerCase();
}

function toPortable(value) {
  return stringValue(value).split(path.sep).join("/").replaceAll("\\", "/");
}

function portableSource(file, line) {
  if (!stringValue(file)) return "";
  const normalized = normalizePortable(file);
  const parts = normalized.split("/");
  const sessionIndex = parts.lastIndexOf("trial-session-packs");
  const safePath = sessionIndex >= 0 ? parts.slice(sessionIndex).join("/") : parts.slice(-1).join("/");
  return line ? `${safePath}:${line}` : safePath;
}

function addSourceItem(items, seen, item) {
  if (seen.has(item.sourceRef)) return;
  seen.add(item.sourceRef);
  items.push(item);
}

function addFinding(list, seen, code, message) {
  if (seen.has(code)) return;
  seen.add(code);
  list.push({ code, message });
}

function stableHash(value) {
  return sha256(JSON.stringify(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value) {
  return stringValue(value).toLowerCase().replace(/\s+/g, " ");
}

function listValues(value) {
  return Array.isArray(value) ? value : [];
}

function arrayLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

function uniqueStrings(value) {
  return [...new Set(listValues(value).map(stringValue).filter(Boolean))].sort();
}

function validDate(value) {
  return stringValue(value) !== "" && Number.isFinite(Date.parse(value));
}

function safeToken(value) {
  return stringValue(value).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function safePriority(value) {
  const priority = stringValue(value).toUpperCase();
  return /^P[0-3]$/.test(priority) ? priority : "P0";
}

function safeHostId(value) {
  const host = stringValue(value);
  return /^host-[a-z0-9-]+$/i.test(host) ? host : "";
}

function sanitizeTesterId(value) {
  const sanitized = stringValue(value).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "unknown-tester";
}

function displayName(key) {
  return ({
    afterLive: "Original after-live report",
    review: "Original review report",
    privacy: "Original privacy report",
    feedback: "Original feedback summary",
    backlog: "Original fix backlog",
    completion: "Original completion report",
    readiness: "Current readiness report",
    fixChecklist: "Remediation fix checklist",
    acceptance: "Remediation acceptance checklist",
    manifest: "Original session manifest"
  })[key] || key;
}

function constantName(value) {
  return value.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
}

function markdownRows(items, render) {
  return items.length ? items.map(render) : ["- None"];
}

function yesNo(value) {
  return value ? "Yes" : "No";
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (key === "noEvidenceCopy") {
      parsed.noEvidenceCopy = true;
      continue;
    }
    const value = argv[index + 1];
    if (value && !value.startsWith("--")) {
      parsed[key] = value;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}
