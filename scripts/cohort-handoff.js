import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const args = parseArgs(process.argv.slice(2));
const cohortPath = path.resolve(rootPath, args.cohort || path.join("dist", "TRIAL_COHORT_SUMMARY.json"));
const afterLiveDir = path.resolve(rootPath, args.afterLiveDir || path.join("dist", "trial-after-live"));
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_COHORT_HANDOFF.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_COHORT_HANDOFF.md"));
const handoffPath = path.resolve(rootPath, args.out || path.join("dist", "COHORT_EXPANSION_HANDOFF.md"));

const report = await buildReport();

await fs.mkdir(path.dirname(jsonPath), { recursive: true });
await fs.mkdir(path.dirname(markdownPath), { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

if (report.handoffCreated) {
  await fs.mkdir(path.dirname(handoffPath), { recursive: true });
  await fs.writeFile(handoffPath, renderHandoff(report), "utf8");
}

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  testers: report.counts.testers,
  completed: report.counts.completed,
  expansionAllowed: report.expansion.allowed,
  handoff: report.handoffRelativePath,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  jsonPath,
  markdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function buildReport() {
  const cohort = await readJson(cohortPath);
  const blockers = [];
  const warnings = [];

  if (!cohort) {
    blockers.push("Cohort summary is missing. Run npm.cmd run trial:cohort-summary first.");
  }
  if (cohort?.ok === false) blockers.push("Cohort summary is not ok.");

  const testers = normalizeTesters(cohort?.testers || []);
  if (testers.length < 2) blockers.push("At least two completed tester summaries are required before cohort handoff.");

  const afterLiveEvidence = await collectAfterLiveEvidence(afterLiveDir);
  const evidenceIssues = inspectAfterLiveEvidence(testers, afterLiveEvidence);
  blockers.push(...evidenceIssues.blockers);
  warnings.push(...evidenceIssues.warnings);

  const decision = decide({ cohort, blockers, warnings });
  const expansion = expansionFor(decision, cohort, blockers);
  const watchItems = watchItemsFrom(cohort);
  const safetyReviews = safetyReviewsFrom(cohort);
  const privacyWarnings = privacyWarningsFrom(cohort, testers);

  if (watchItems.length && !args.acceptReview) {
    blockers.push("Host acceptance is required for repeated watch items. Rerun with --accept-review after review.");
  }
  if (privacyWarnings.length && !args.acceptPrivacy) {
    blockers.push("Host privacy acceptance is required for privacy warnings. Rerun with --accept-privacy after review.");
  }

  const finalDecision = decide({ cohort, blockers, warnings });
  const finalExpansion = expansionFor(finalDecision, cohort, blockers);
  const handoffCreated = finalExpansion.handoffAllowed;

  return {
    ok: blockers.length === 0,
    mode: "trial-cohort-handoff",
    createdAt: new Date().toISOString(),
    decision: finalDecision,
    cohortPath,
    cohortRelativePath: relative(cohortPath),
    afterLiveDir,
    afterLiveRelativeDir: relative(afterLiveDir),
    handoffPath,
    handoffRelativePath: handoffCreated ? relative(handoffPath) : "",
    handoffCreated,
    counts: {
      testers: testers.length,
      completed: testers.filter((tester) => tester.completed).length,
      afterLiveReady: afterLiveEvidence.filter((item) => item.ok).length,
      watchItems: watchItems.length,
      safetyReviews: safetyReviews.length,
      privacyWarnings: privacyWarnings.length
    },
    cohortDecision: cohort?.decision || "MISSING",
    expansion: finalExpansion,
    acceptance: {
      reviewAccepted: Boolean(args.acceptReview),
      privacyAccepted: Boolean(args.acceptPrivacy),
      acceptedBy: args.acceptedBy || "",
      acceptedAt: (args.acceptReview || args.acceptPrivacy) ? new Date().toISOString() : ""
    },
    testers,
    afterLiveEvidence,
    watchItems,
    safetyReviews,
    privacyWarnings,
    blockers: unique(blockers),
    warnings: unique(warnings),
    nextCommands: nextCommands(finalDecision),
    nextSteps: nextSteps(finalDecision)
  };
}

function decide({ cohort, blockers }) {
  if (blockers.length) return "COHORT_HANDOFF_HOLD";
  if (!cohort) return "COHORT_HANDOFF_HOLD";
  if (cohort.decision === "HOLD_EXPANSION_FIX_FIRST" || cohort.decision === "WAITING_FOR_MORE_SESSIONS") {
    return "COHORT_HANDOFF_HOLD";
  }
  if (cohort.decision === "REVIEW_REPEATED_SAFETY") return "COHORT_HANDOFF_REVIEW_REQUIRED";
  if (cohort.decision === "EXPAND_WITH_WATCH") return "COHORT_HANDOFF_EXPAND_WITH_WATCH";
  if (cohort.decision === "READY_TO_EXPAND_3_5") return "COHORT_HANDOFF_READY_TO_EXPAND";
  return "COHORT_HANDOFF_HOLD";
}

function expansionFor(decision, cohort, blockers) {
  const allowed = decision === "COHORT_HANDOFF_READY_TO_EXPAND" || decision === "COHORT_HANDOFF_EXPAND_WITH_WATCH";
  return {
    allowed,
    handoffAllowed: blockers.length === 0 && decision !== "COHORT_HANDOFF_HOLD",
    requiresHostAcceptance: decision === "COHORT_HANDOFF_EXPAND_WITH_WATCH" || decision === "COHORT_HANDOFF_REVIEW_REQUIRED",
    nextBatchSize: allowed ? "3-5 testers" : "do not expand yet",
    instruction: expansionInstruction(decision, cohort)
  };
}

function expansionInstruction(decision, cohort) {
  if (decision === "COHORT_HANDOFF_HOLD") return "Do not invite more testers. Fix blockers and rerun trial:cohort-summary, then trial:cohort-handoff.";
  if (decision === "COHORT_HANDOFF_REVIEW_REQUIRED") return "Do not expand until the host reviews repeated safety themes and decides whether to fix first.";
  if (decision === "COHORT_HANDOFF_EXPAND_WITH_WATCH") return "Expansion is allowed only with the listed watch items copied into every next tester session.";
  if (decision === "COHORT_HANDOFF_READY_TO_EXPAND") return "Expansion to 3-5 testers is allowed.";
  return cohort?.expansionGate?.instruction || "Review cohort summary before expanding.";
}

function normalizeTesters(testers) {
  return testers.map((tester) => ({
    testerId: sanitizeTesterId(tester.testerId),
    completed: Boolean(tester.completed),
    riskLevel: tester.riskLevel || "unknown",
    privacyDecision: tester.privacyDecision || "MISSING",
    feedbackDecision: tester.feedbackDecision || "MISSING",
    postSessionDecision: tester.postSessionDecision || "MISSING",
    mustFixCount: Number(tester.mustFixCount || 0),
    watchCount: Number(tester.watchCount || 0),
    folderRelativePath: tester.folderRelativePath || "",
    summary: tester.summary || ""
  })).filter((tester) => tester.testerId);
}

async function collectAfterLiveEvidence(folder) {
  if (!(await exists(folder))) return [];
  const files = [];
  await walk(folder, async (entryPath, dirent) => {
    if (dirent.isFile() && dirent.name === "TRIAL_AFTER_LIVE_REPORT.json") files.push(entryPath);
  });
  const evidence = [];
  for (const filePath of files.sort((a, b) => a.localeCompare(b))) {
    const data = await readJson(filePath);
    if (!data) continue;
    evidence.push({
      testerId: sanitizeTesterId(data.testerId),
      ok: data.ok === true && ["AFTER_LIVE_READY", "AFTER_LIVE_READY_WITH_REVIEW"].includes(data.decision),
      decision: data.decision || "MISSING",
      relativePath: relative(filePath),
      packetRelativePath: data.evidencePacket?.packetRelativePath || data.packetRelativePath || "",
      blockers: normalizeList(data.blockers),
      warnings: normalizeList(data.warnings)
    });
  }
  return evidence;
}

function inspectAfterLiveEvidence(testers, evidence) {
  const blockers = [];
  const warnings = [];
  const byTester = new Map(evidence.map((item) => [item.testerId, item]));
  for (const tester of testers.filter((item) => item.completed)) {
    const item = byTester.get(tester.testerId);
    if (!item) {
      blockers.push(`${tester.testerId}: after-live evidence is missing from ${relative(afterLiveDir)}.`);
      continue;
    }
    if (!item.ok) blockers.push(`${tester.testerId}: after-live decision is ${item.decision}.`);
    for (const warning of item.warnings) warnings.push(`${tester.testerId} after-live: ${warning}`);
  }
  for (const item of evidence) {
    for (const blocker of item.blockers) blockers.push(`${item.testerId} after-live: ${blocker}`);
  }
  return { blockers, warnings };
}

function watchItemsFrom(cohort) {
  const themes = normalizeThemes(cohort?.repeatedThemes || []);
  return themes
    .filter((theme) => !isSafetyTheme(theme.theme))
    .map((theme) => ({
      id: `WATCH-${theme.theme.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`,
      theme: theme.theme,
      testerCount: theme.testerCount,
      warnings: theme.warnings,
      blockers: theme.blockers,
      testers: theme.testers,
      action: `Watch ${theme.theme} in every next tester session.`,
      evidence: theme.examples
    }));
}

function safetyReviewsFrom(cohort) {
  return normalizeThemes(cohort?.safetyRepeats || []).map((theme) => ({
    id: `SAFETY-${theme.theme.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`,
    theme: theme.theme,
    testerCount: theme.testerCount,
    warnings: theme.warnings,
    blockers: theme.blockers,
    testers: theme.testers,
    action: `Host reviews repeated ${theme.theme} safety risk before expansion.`,
    evidence: theme.examples
  }));
}

function privacyWarningsFrom(cohort, testers) {
  const output = [];
  for (const tester of testers) {
    if (tester.privacyDecision === "PRIVACY_REVIEW") {
      output.push({
        testerId: tester.testerId,
        decision: tester.privacyDecision,
        action: "Host reviews privacy warning before sharing or expanding."
      });
    }
  }
  for (const warning of normalizeList(cohort?.warnings)) {
    if (/privacy/i.test(warning)) output.push({ testerId: "", decision: "WARNING", action: warning });
  }
  return output;
}

function normalizeThemes(themes) {
  if (!Array.isArray(themes)) return [];
  return themes.map((theme) => ({
    theme: theme.theme || "other",
    testerCount: Number(theme.testerCount || 0),
    warnings: Number(theme.warnings || 0),
    blockers: Number(theme.blockers || 0),
    testers: Array.isArray(theme.testers) ? theme.testers.map(sanitizeTesterId).filter(Boolean) : [],
    examples: Array.isArray(theme.examples) ? theme.examples : []
  }));
}

function nextCommands(decision) {
  if (decision === "COHORT_HANDOFF_HOLD") {
    return [
      "npm.cmd run trial:after-live -- --session <session-folder> --tester <tester-id>",
      "npm.cmd run trial:cohort-summary -- <completed-trials-folder>",
      "npm.cmd run trial:cohort-handoff -- --accept-review --accept-privacy --accepted-by <host-id>"
    ];
  }
  if (decision === "COHORT_HANDOFF_REVIEW_REQUIRED") {
    return [
      "Review TRIAL_COHORT_HANDOFF.md safety items.",
      "Fix repeated safety issues or rerun with explicit host acceptance after review."
    ];
  }
  return [
    "Open COHORT_EXPANSION_HANDOFF.md.",
    "Copy watch items into every next tester session.",
    "Rerun npm.cmd run trial:status."
  ];
}

function nextSteps(decision) {
  if (decision === "COHORT_HANDOFF_HOLD") {
    return [
      "Do not expand the tester cohort yet.",
      "Close missing after-live evidence or fix cohort blockers.",
      "Rerun cohort summary and handoff."
    ];
  }
  if (decision === "COHORT_HANDOFF_REVIEW_REQUIRED") {
    return [
      "Review repeated safety themes with the host.",
      "Fix first if the theme affects trust, writes, verification, or privacy.",
      "Proceed only after a human host decision."
    ];
  }
  if (decision === "COHORT_HANDOFF_EXPAND_WITH_WATCH") {
    return [
      "Invite the next small batch only with watch items in every runbook.",
      "Keep raw records local-only.",
      "Rerun cohort summary after each new completed tester."
    ];
  }
  return [
    "Invite 3-5 testers in a small batch.",
    "Keep one completed evidence folder per tester.",
    "Rerun cohort summary and handoff after each batch."
  ];
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial Cohort Handoff",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Cohort decision: ${report.cohortDecision}`,
    `Cohort summary: ${report.cohortRelativePath}`,
    `After-live evidence: ${report.afterLiveRelativeDir}`,
    `Expansion handoff: ${report.handoffRelativePath || "Not created"}`,
    "",
    "## Expansion",
    "",
    `- Allowed: ${report.expansion.allowed ? "Yes" : "No"}`,
    `- Next batch: ${report.expansion.nextBatchSize}`,
    `- Requires host acceptance: ${report.expansion.requiresHostAcceptance ? "Yes" : "No"}`,
    `- Instruction: ${report.expansion.instruction}`,
    "",
    "## Acceptance",
    "",
    `- Review accepted: ${report.acceptance.reviewAccepted ? "Yes" : "No"}`,
    `- Privacy accepted: ${report.acceptance.privacyAccepted ? "Yes" : "No"}`,
    `- Accepted by: ${report.acceptance.acceptedBy || "n/a"}`,
    "",
    "## Watch Items",
    "",
    ...renderItems(report.watchItems),
    "",
    "## Safety Reviews",
    "",
    ...renderItems(report.safetyReviews),
    "",
    "## Privacy Warnings",
    "",
    ...(report.privacyWarnings.length ? report.privacyWarnings.map((item) => `- ${item.testerId || "cohort"}: ${item.action}`) : ["- None"]),
    "",
    "## Tester Evidence",
    "",
    "| Tester | Completed | Privacy | After-live | Summary |",
    "| --- | --- | --- | --- | --- |",
    ...report.testers.map((tester) => renderTesterRow(tester, report.afterLiveEvidence)),
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
    "# CodeClaw Cohort Expansion Handoff",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Next batch: ${report.expansion.nextBatchSize}`,
    "",
    "## Expansion Instruction",
    "",
    `- ${report.expansion.instruction}`,
    "",
    "## Watch Items For Every Next Tester",
    "",
    ...renderItems(report.watchItems),
    "",
    "## Safety Review Items",
    "",
    ...renderItems(report.safetyReviews),
    "",
    "## Stop Conditions",
    "",
    "- Stop if a tester hits a repeated safety theme as a blocker.",
    "- Stop if privacy review becomes PRIVACY_HOLD.",
    "- Stop before Apply on any non-disposable real project.",
    "- Stop if watch items are missing from the generated runbook or observation checklist.",
    "",
    "## Evidence Sources",
    "",
    `- Cohort summary: ${report.cohortRelativePath}`,
    `- After-live evidence folder: ${report.afterLiveRelativeDir}`,
    "",
    "## After Each New Tester",
    "",
    "- Run trial:after-live for that tester.",
    "- Add the completed report folder to the cohort input.",
    "- Rerun trial:cohort-summary and trial:cohort-handoff.",
    ""
  ].join("\n");
}

function renderItems(items) {
  if (!items.length) return ["- None"];
  return items.map((item) => `- ${item.id}: ${item.action} Testers: ${(item.testers || []).join(", ") || "n/a"}. Evidence: ${(item.evidence || []).join("; ") || "n/a"}`);
}

function renderTesterRow(tester, evidence) {
  const afterLive = evidence.find((item) => item.testerId === tester.testerId);
  return [
    tester.testerId,
    tester.completed ? "Yes" : "No",
    tester.privacyDecision,
    afterLive ? afterLive.decision : "MISSING",
    tester.summary
  ].map(escapeTableCell).join(" | ").replace(/^/, "| ").replace(/$/, " |");
}

function parseArgs(rawArgs) {
  const parsed = {
    cohort: "",
    afterLiveDir: "",
    json: "",
    markdown: "",
    out: "",
    acceptReview: false,
    acceptPrivacy: false,
    acceptedBy: ""
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--accept-review") {
      parsed.acceptReview = true;
      continue;
    }
    if (arg === "--accept-privacy") {
      parsed.acceptPrivacy = true;
      continue;
    }
    let handled = false;
    for (const key of ["cohort", "afterLiveDir", "json", "markdown", "out", "acceptedBy"]) {
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
    if (!parsed.cohort && !arg.startsWith("--")) {
      parsed.cohort = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

async function walk(directory, visitor) {
  if (!(await exists(directory))) return;
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(entryPath, visitor);
      continue;
    }
    await visitor(entryPath, entry);
  }
}

function isSafetyTheme(theme) {
  return ["safety", "preflight", "verification", "model"].includes(theme) || /safe|trust|write|apply|verify|preflight/i.test(theme);
}

function sanitizeTesterId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return item;
    return item.message || item.reason || item.title || item.rule || JSON.stringify(item);
  }).filter(Boolean);
}

function escapeTableCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
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

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
