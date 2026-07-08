import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const distPath = path.join(rootPath, "dist");
const args = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(rootPath, args.input || path.join("dist", "trial-session-packs"));
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_COHORT_SUMMARY.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_COHORT_SUMMARY.md"));

const report = await buildReport(inputPath);

await fs.mkdir(path.dirname(jsonPath), { recursive: true });
await fs.mkdir(path.dirname(markdownPath), { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  inputPath,
  testers: report.counts.testers,
  completed: report.counts.completed,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  jsonPath,
  markdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function buildReport(sourcePath) {
  const testerFolders = await discoverTesterFolders(sourcePath);
  const testers = [];
  for (const folder of testerFolders) {
    testers.push(await readTester(folder));
  }
  const repeatedThemes = collectRepeatedThemes(testers);
  const safetyRepeats = repeatedThemes.filter((theme) => isSafetyTheme(theme.theme) || /safe|trust|write|apply|verify|preflight/i.test(theme.theme));
  const blockers = collectBlockers(testers, repeatedThemes);
  const warnings = collectWarnings(testers, repeatedThemes, blockers);
  const decision = decide(testers, repeatedThemes, blockers);

  return {
    ok: blockers.length === 0,
    mode: "trial-cohort-summary",
    createdAt: new Date().toISOString(),
    inputPath: sourcePath,
    inputRelativePath: relative(sourcePath),
    decision,
    counts: {
      testers: testers.length,
      completed: testers.filter((tester) => tester.completed).length,
      privacyHold: testers.filter((tester) => tester.privacyDecision === "PRIVACY_HOLD").length,
      postSessionReady: testers.filter((tester) => tester.postSessionDecision === "READY_FOR_NEXT_TESTER").length,
      mustFix: testers.reduce((total, tester) => total + tester.mustFixCount, 0),
      watch: testers.reduce((total, tester) => total + tester.watchCount, 0),
      repeatedThemes: repeatedThemes.length,
      safetyRepeats: safetyRepeats.length
    },
    testers,
    repeatedThemes,
    safetyRepeats,
    blockers,
    warnings,
    expansionGate: expansionGate(decision, testers, blockers, warnings),
    nextSteps: nextSteps(decision)
  };
}

async function discoverTesterFolders(sourcePath) {
  if (!(await exists(sourcePath))) return [];
  const stat = await fs.stat(sourcePath);
  if (stat.isFile()) return [path.dirname(sourcePath)];
  const direct = await fs.readdir(sourcePath, { withFileTypes: true });
  const folders = direct
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(sourcePath, entry.name))
    .sort((a, b) => a.localeCompare(b));
  if (folders.length) return folders;
  return [sourcePath];
}

async function readTester(folderPath) {
  const reports = await readReports(folderPath);
  const testerId = inferTesterId(folderPath, reports);
  const feedback = reports.feedback;
  const backlog = reports.backlog;
  const post = reports.postSession;
  const privacy = reports.privacy;
  const hostReady = reports.hostReady;
  const session = reports.session;
  const frictionThemes = normalizeThemes(feedback?.frictionThemes || []);
  const watchItems = normalizeItems(backlog?.watchDuringTester2 || post?.watchDuringNextTester || []);
  const mustFixItems = normalizeItems(backlog?.mustFixBeforeTester2 || post?.mustFixBeforeNextTester || []);
  const safetyConcerns = normalizeSignals(feedback?.safetyConcerns || []);
  const warnings = [
    ...normalizeSignals(feedback?.warnings || []),
    ...watchItems.map((item) => signalFromItem(item))
  ];
  const blockers = [
    ...normalizeSignals(feedback?.blockers || []),
    ...mustFixItems.map((item) => signalFromItem(item))
  ];
  const missing = missingReports(reports);
  const completed = Boolean(feedback || post || privacy);

  return {
    testerId,
    folder: folderPath,
    folderRelativePath: relative(folderPath),
    completed,
    missingReports: missing,
    privacyDecision: privacy?.decision || "MISSING",
    feedbackDecision: feedback?.decision || "MISSING",
    backlogDecision: backlog?.decision || post?.backlogDecision || "MISSING",
    hostReadyDecision: hostReady?.decision || post?.hostReadyDecision || "MISSING",
    postSessionDecision: post?.decision || "MISSING",
    sessionBacklogDecision: session?.backlogDecision || "MISSING",
    coverage: feedback?.coverage || {},
    frictionThemes,
    safetyConcerns,
    blockers,
    warnings,
    mustFixCount: mustFixItems.length,
    watchCount: watchItems.length,
    mustFixItems,
    watchItems,
    riskLevel: testerRiskLevel({ privacy, feedback, backlog, post, hostReady, blockers, mustFixItems, missing }),
    summary: testerSummary({ feedback, backlog, post, privacy, frictionThemes, safetyConcerns, mustFixItems, watchItems, missing })
  };
}

async function readReports(folderPath) {
  const jsonFiles = await collectJsonFiles(folderPath);
  const reports = {};
  for (const file of jsonFiles) {
    const base = path.basename(file).toUpperCase();
    const data = await readJson(file);
    if (!data) continue;
    if (base === "TRIAL_POST_SESSION_REPORT.JSON") reports.postSession = data;
    if (base === "TRIAL_FEEDBACK_SUMMARY.JSON") reports.feedback = data;
    if (base === "TRIAL_FIX_BACKLOG.JSON") reports.backlog = data;
    if (base === "TRIAL_PRIVACY_REPORT.JSON") reports.privacy = data;
    if (base === "TRIAL_HOST_READY_REPORT.JSON") reports.hostReady = data;
    if (base === "SESSION_PACK_MANIFEST.JSON") reports.session = data;
  }
  return reports;
}

async function collectJsonFiles(folderPath) {
  const files = [];
  await walk(folderPath, async (entryPath, dirent) => {
    if (dirent.isFile() && entryPath.toLowerCase().endsWith(".json")) files.push(entryPath);
  });
  return files.sort((a, b) => a.localeCompare(b));
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

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function collectRepeatedThemes(testers) {
  const byTheme = new Map();
  for (const tester of testers) {
    const testerThemes = new Map();
    for (const theme of tester.frictionThemes) {
      const current = testerThemes.get(theme.theme) || { warnings: 0, blockers: 0, count: 0, examples: [] };
      current.warnings += theme.warnings || 0;
      current.blockers += theme.blockers || 0;
      current.count += theme.count || 0;
      current.examples.push(...(theme.examples || []));
      testerThemes.set(theme.theme, current);
    }
    for (const item of [...tester.watchItems, ...tester.mustFixItems]) {
      const themeName = item.theme || categorize(item.title || item.action || "");
      const current = testerThemes.get(themeName) || { warnings: 0, blockers: 0, count: 0, examples: [] };
      current.count += 1;
      if (item.priority === "P0") current.blockers += 1;
      else current.warnings += 1;
      current.examples.push(item.title || item.action || themeName);
      testerThemes.set(themeName, current);
    }
    for (const [themeName, theme] of testerThemes) {
      const current = byTheme.get(themeName) || { theme: themeName, testers: [], testerCount: 0, count: 0, warnings: 0, blockers: 0, examples: [] };
      current.testers.push(tester.testerId);
      current.testerCount += 1;
      current.count += theme.count;
      current.warnings += theme.warnings;
      current.blockers += theme.blockers;
      current.examples.push(...theme.examples);
      byTheme.set(themeName, current);
    }
  }
  return [...byTheme.values()]
    .filter((theme) => theme.testerCount > 1 || theme.blockers > 0 || theme.warnings > 1)
    .map((theme) => ({
      ...theme,
      testers: unique(theme.testers),
      examples: unique(theme.examples).slice(0, 5)
    }))
    .sort((a, b) => b.blockers - a.blockers || b.testerCount - a.testerCount || b.warnings - a.warnings || b.count - a.count);
}

function collectBlockers(testers, repeatedThemes) {
  const blockers = [];
  if (testers.length === 0) blockers.push("No tester folders or reports were found.");
  for (const tester of testers) {
    if (tester.privacyDecision === "PRIVACY_HOLD") blockers.push(`${tester.testerId}: privacy report is PRIVACY_HOLD.`);
    if (tester.postSessionDecision === "POST_SESSION_PIPELINE_FAILED") blockers.push(`${tester.testerId}: post-session pipeline failed.`);
    if (tester.postSessionDecision === "FIX_BEFORE_NEXT_TESTER") blockers.push(`${tester.testerId}: post-session requires fixes before the next tester.`);
    if (tester.backlogDecision === "FIX_BLOCKERS_BEFORE_TESTER_2") blockers.push(`${tester.testerId}: fix backlog has blockers.`);
    if (tester.mustFixCount > 0) blockers.push(`${tester.testerId}: ${tester.mustFixCount} must-fix item(s) remain.`);
  }
  for (const theme of repeatedThemes) {
    if (theme.blockers > 0 && isSafetyTheme(theme.theme)) blockers.push(`Repeated safety blocker theme: ${theme.theme}.`);
  }
  return unique(blockers);
}

function collectWarnings(testers, repeatedThemes, blockers) {
  const warnings = [];
  if (testers.length === 1) warnings.push("Only one tester is present; collect at least two completed testers before expanding.");
  for (const tester of testers) {
    if (!tester.completed) warnings.push(`${tester.testerId}: no completed session reports were found.`);
    if (tester.privacyDecision === "PRIVACY_REVIEW") warnings.push(`${tester.testerId}: privacy report needs host review.`);
    if (tester.hostReadyDecision === "HOLD") warnings.push(`${tester.testerId}: host-ready report is HOLD.`);
    if (tester.missingReports.length) warnings.push(`${tester.testerId}: missing ${tester.missingReports.join(", ")}.`);
  }
  for (const theme of repeatedThemes) {
    if (theme.testerCount > 1) warnings.push(`Repeated friction theme across ${theme.testerCount} testers: ${theme.theme}.`);
  }
  const blockerText = new Set(blockers);
  return unique(warnings.filter((item) => !blockerText.has(item)));
}

function decide(testers, repeatedThemes, blockers) {
  const completed = testers.filter((tester) => tester.completed).length;
  if (blockers.length) return "HOLD_EXPANSION_FIX_FIRST";
  if (completed < 2) return "WAITING_FOR_MORE_SESSIONS";
  if (repeatedThemes.some((theme) => isSafetyTheme(theme.theme) && theme.testerCount > 1)) return "REVIEW_REPEATED_SAFETY";
  if (repeatedThemes.length) return "EXPAND_WITH_WATCH";
  return "READY_TO_EXPAND_3_5";
}

function expansionGate(decision, testers, blockers, warnings) {
  return {
    proceedToThreeToFive: decision === "READY_TO_EXPAND_3_5" || decision === "EXPAND_WITH_WATCH",
    requiresHostAcceptance: decision === "EXPAND_WITH_WATCH" || decision === "REVIEW_REPEATED_SAFETY",
    completedTesterCount: testers.filter((tester) => tester.completed).length,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    instruction: gateInstruction(decision)
  };
}

function gateInstruction(decision) {
  if (decision === "HOLD_EXPANSION_FIX_FIRST") return "Do not expand the cohort. Fix blockers, rerun post-session, then rerun trial:cohort-summary.";
  if (decision === "WAITING_FOR_MORE_SESSIONS") return "Complete at least two hosted tester sessions before deciding on 3-5 testers.";
  if (decision === "REVIEW_REPEATED_SAFETY") return "Host must review repeated safety friction before inviting more testers.";
  if (decision === "EXPAND_WITH_WATCH") return "Expansion is allowed only with the repeated friction themes in the host watch list.";
  return "Expansion to 3-5 testers is allowed.";
}

function nextSteps(decision) {
  if (decision === "HOLD_EXPANSION_FIX_FIRST") {
    return [
      "Fix every blocker listed in this report.",
      "Rerun trial:post-session for the affected completed session folder.",
      "Rerun npm.cmd run trial:cohort-summary -- <cohort-folder>."
    ];
  }
  if (decision === "WAITING_FOR_MORE_SESSIONS") {
    return [
      "Host the next tester using the current session pack.",
      "Put each tester's completed report JSON files in a separate folder.",
      "Rerun trial:cohort-summary after two completed testers."
    ];
  }
  if (decision === "REVIEW_REPEATED_SAFETY" || decision === "EXPAND_WITH_WATCH") {
    return [
      "Copy repeated themes into the next SESSION_BRIEF watch list.",
      "Host must explicitly accept the expansion gate warning.",
      "Continue to 3-5 testers only with the same observation checklist."
    ];
  }
  return [
    "Invite 3-5 testers in small batches.",
    "Keep one folder per tester so cohort summaries stay comparable.",
    "Rerun trial:cohort-summary after each new completed tester."
  ];
}

function missingReports(reports) {
  const missing = [];
  if (!reports.privacy) missing.push("TRIAL_PRIVACY_REPORT.json");
  if (!reports.feedback) missing.push("TRIAL_FEEDBACK_SUMMARY.json");
  if (!reports.backlog && !reports.postSession) missing.push("TRIAL_FIX_BACKLOG.json or TRIAL_POST_SESSION_REPORT.json");
  return missing;
}

function testerRiskLevel({ privacy, feedback, backlog, post, hostReady, blockers, mustFixItems, missing }) {
  if (privacy?.decision === "PRIVACY_HOLD" || mustFixItems.length || blockers.length) return "blocker";
  if (post?.decision === "POST_SESSION_PIPELINE_FAILED" || post?.decision === "FIX_BEFORE_NEXT_TESTER") return "blocker";
  if (backlog?.decision === "FIX_BLOCKERS_BEFORE_TESTER_2" || hostReady?.decision === "HOLD") return "blocker";
  if (privacy?.decision === "PRIVACY_REVIEW" || missing.length || (feedback?.warnings || []).length) return "watch";
  return "clear";
}

function testerSummary({ feedback, backlog, post, privacy, frictionThemes, safetyConcerns, mustFixItems, watchItems, missing }) {
  if (privacy?.decision === "PRIVACY_HOLD") return "Privacy hold; do not ingest or share records.";
  if (mustFixItems.length) return `${mustFixItems.length} must-fix item(s) remain before expansion.`;
  if (post?.decision === "READY_FOR_NEXT_TESTER") return "Post-session pipeline is ready for the next tester.";
  if (frictionThemes.length) return `${frictionThemes.length} friction theme(s), ${watchItems.length} watch item(s), ${safetyConcerns.length} safety concern(s).`;
  if (feedback?.decision) return `Feedback decision: ${feedback.decision}.`;
  if (backlog?.decision) return `Backlog decision: ${backlog.decision}.`;
  if (missing.length) return "Incomplete reports; keep this tester out of expansion decisions until records are added.";
  return "No issues found.";
}

function normalizeThemes(themes) {
  return themes.map((theme) => ({
    theme: theme.theme || categorize(theme.title || theme.action || ""),
    count: Number(theme.count || 0),
    blockers: Number(theme.blockers || 0),
    warnings: Number(theme.warnings || 0),
    examples: Array.isArray(theme.examples) ? theme.examples : []
  }));
}

function normalizeItems(items) {
  return items.map((item) => ({
    id: item.id || "",
    priority: item.priority || "",
    theme: item.theme || categorize(`${item.title || ""} ${item.action || ""}`),
    title: item.title || item.action || item.reason || "Trial item",
    action: item.action || "",
    reason: item.reason || "",
    evidence: item.evidence || "",
    sources: item.sources || []
  }));
}

function normalizeSignals(signals) {
  return signals.map((signal) => ({
    theme: signal.category || categorize(`${signal.label || ""} ${signal.text || ""} ${signal.notes || ""}`),
    label: signal.label || signal.text || "trial signal",
    result: signal.result || "",
    reason: signal.reason || "",
    file: signal.file || "",
    line: signal.line || 1
  }));
}

function signalFromItem(item) {
  return {
    theme: item.theme,
    label: item.title,
    result: item.priority,
    reason: item.reason,
    file: "",
    line: 1
  };
}

function inferTesterId(folderPath, reports) {
  const values = [
    reports.postSession?.nextTester ? previousTesterId(reports.postSession.nextTester) : "",
    reports.hostReady?.testerId || "",
    reports.session?.testerId || "",
    path.basename(folderPath)
  ];
  return sanitizeTesterId(values.find(Boolean) || "tester");
}

function previousTesterId(nextTester) {
  const match = String(nextTester || "").match(/^(.*?)(\d+)$/);
  if (!match) return "";
  const number = Number(match[2]);
  if (!Number.isFinite(number) || number <= 1) return "";
  return `${match[1]}${number - 1}`;
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial Cohort Summary",
    "",
    `Created at: ${report.createdAt}`,
    `Input: ${report.inputRelativePath}`,
    `Decision: ${report.decision}`,
    "",
    "## Expansion Gate",
    "",
    `- Proceed to 3-5 testers: ${report.expansionGate.proceedToThreeToFive ? "Yes" : "No"}`,
    `- Requires host acceptance: ${report.expansionGate.requiresHostAcceptance ? "Yes" : "No"}`,
    `- Completed testers: ${report.expansionGate.completedTesterCount}`,
    `- Blockers: ${report.expansionGate.blockerCount}`,
    `- Warnings: ${report.expansionGate.warningCount}`,
    `- Instruction: ${report.expansionGate.instruction}`,
    "",
    "## Tester Matrix",
    "",
    "| Tester | Risk | Privacy | Feedback | Backlog | Post-session | Must-fix | Watch | Summary |",
    "| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |",
    ...report.testers.map(renderTesterRow),
    "",
    "## Repeated Themes",
    "",
    ...renderThemes(report.repeatedThemes),
    "",
    "## Safety Repeats",
    "",
    ...renderThemes(report.safetyRepeats),
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

function renderTesterRow(tester) {
  return [
    tester.testerId,
    tester.riskLevel,
    tester.privacyDecision,
    tester.feedbackDecision,
    tester.backlogDecision,
    tester.postSessionDecision,
    String(tester.mustFixCount),
    String(tester.watchCount),
    tester.summary
  ].map(escapeTableCell).join(" | ").replace(/^/, "| ").replace(/$/, " |");
}

function renderThemes(themes) {
  if (!themes.length) return ["- None"];
  return themes.map((theme) => `- ${theme.theme}: ${theme.testerCount} tester(s), ${theme.warnings} warning(s), ${theme.blockers} blocker(s). Testers: ${theme.testers.join(", ")}.`);
}

function escapeTableCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function isSafetyTheme(theme) {
  return ["safety", "preflight", "verification", "model"].includes(theme);
}

function categorize(value) {
  const text = String(value || "").toLowerCase();
  if (/\b(start|launch|browser|port|launcher)\b/.test(text)) return "startup";
  if (/\b(language|translation|translated|chinese|english|russian)\b/.test(text)) return "language";
  if (/\b(demo|real project|mode)\b/.test(text)) return "demo-real-mode";
  if (/\b(path|folder|file)\b/.test(text)) return "path";
  if (/\b(preflight|context|warning|blocker|read-only)\b/.test(text)) return "preflight";
  if (/\b(apply|write|safe|trust|permission|api key|risky)\b/.test(text)) return "safety";
  if (/\b(model|flash|pro|cost)\b/.test(text)) return "model";
  if (/\b(patch|changed files|review|revert)\b/.test(text)) return "patch";
  if (/\b(verify|verification|command|test)\b/.test(text)) return "verification";
  if (/\b(audit|trail|log)\b/.test(text)) return "audit";
  if (/\b(guide|template|runbook|copy)\b/.test(text)) return "docs";
  if (/\b(feedback|observation|result record)\b/.test(text)) return "feedback";
  return "other";
}

function sanitizeTesterId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "tester";
}

function parseArgs(rawArgs) {
  const parsed = { input: "", json: "", markdown: "" };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--input") {
      parsed.input = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--input=")) {
      parsed.input = arg.slice("--input=".length);
      continue;
    }
    let handled = false;
    for (const key of ["json", "markdown"]) {
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
    if (!parsed.input && !arg.startsWith("--")) {
      parsed.input = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function relative(targetPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
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
