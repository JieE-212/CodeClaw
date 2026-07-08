import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const distPath = path.join(rootPath, "dist");
const args = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(rootPath, args.input || path.join("dist", "TRIAL_FEEDBACK_SUMMARY.json"));
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_FIX_BACKLOG.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_FIX_BACKLOG.md"));

const feedback = await readFeedbackSummary(inputPath);
const report = buildBacklog(feedback);

await fs.mkdir(distPath, { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  inputPath,
  mustFix: report.mustFixBeforeTester2.length,
  watch: report.watchDuringTester2.length,
  optional: report.optionalPolish.length,
  jsonPath,
  markdownPath
}, null, 2));

function buildBacklog(feedback) {
  const mustFixBeforeTester2 = buildMustFixItems(feedback);
  const watchDuringTester2 = buildWatchItems(feedback, mustFixBeforeTester2);
  const optionalPolish = buildOptionalPolish(feedback, [...mustFixBeforeTester2, ...watchDuringTester2]);
  const decision = decideBacklog(feedback, mustFixBeforeTester2, watchDuringTester2);

  return {
    ok: true,
    mode: "trial-fix-backlog",
    createdAt: new Date().toISOString(),
    sourceRoot: rootPath,
    feedbackSummaryPath: inputPath,
    feedbackDecision: feedback.decision || "UNKNOWN",
    decision,
    coverage: feedback.coverage || {},
    counts: {
      feedbackFiles: feedback.files?.length || 0,
      blockers: feedback.blockers?.length || 0,
      warnings: feedback.warnings?.length || 0,
      safetyConcerns: feedback.safetyConcerns?.length || 0,
      frictionThemes: feedback.frictionThemes?.length || 0,
      recommendedFixes: feedback.recommendedFixes?.length || 0
    },
    mustFixBeforeTester2: publicItems(mustFixBeforeTester2),
    watchDuringTester2: publicItems(watchDuringTester2),
    optionalPolish: publicItems(optionalPolish),
    tester2Gate: tester2Gate(decision, mustFixBeforeTester2, watchDuringTester2),
    nextSteps: nextSteps(decision)
  };
}

function buildMustFixItems(feedback) {
  const items = [];
  for (const signal of feedback.blockers || []) {
    items.push(itemFromSignal({
      prefix: "P0",
      lane: "must-fix",
      signal,
      title: titleForSignal(signal),
      action: actionForTheme(signal.category, "blocker"),
      reason: signal.reason || "Feedback summary marked this as a blocker."
    }));
  }
  if (feedback.decision === "NO_GO_FIX_FIRST" && items.length === 0) {
    items.push({
      id: "P0-001",
      priority: "P0",
      lane: "must-fix",
      theme: "feedback",
      title: "Resolve feedback summary no-go before tester 2",
      action: "Review TRIAL_FEEDBACK_SUMMARY.md and convert the no-go reason into a concrete product fix.",
      reason: "Feedback decision is NO_GO_FIX_FIRST.",
      evidence: "No explicit blocker signal was available.",
      source: ""
    });
  }
  return renumber(items, "P0");
}

function buildWatchItems(feedback, mustFix) {
  const mustFixKeys = new Set(mustFix.map((item) => item.sourceKey).filter(Boolean));
  const byTheme = new Map();
  for (const signal of feedback.warnings || []) {
    const sourceKey = signalKey(signal);
    if (mustFixKeys.has(sourceKey)) continue;
    const theme = signal.category || "other";
    const current = byTheme.get(theme) || {
      priority: isSafetyTheme(theme) ? "P1" : "P2",
      lane: "watch",
      theme,
      title: titleForTheme(theme),
      action: actionForTheme(theme, "watch"),
      reason: "Feedback summary marked this theme as a watch item.",
      evidence: [],
      sources: [],
      sourceKeys: []
    };
    current.evidence.push(displaySignal(signal));
    current.sources.push(sourceRef(signal));
    current.sourceKeys.push(sourceKey);
    byTheme.set(theme, current);
  }
  for (const concern of feedback.safetyConcerns || []) {
    const sourceKey = signalKey(concern);
    if (mustFixKeys.has(sourceKey)) continue;
    const theme = concern.category || "safety";
    const current = byTheme.get(theme) || {
      priority: "P1",
      lane: "watch",
      theme,
      title: titleForTheme(theme),
      action: actionForTheme(theme, "watch"),
      reason: "Safety concern should be watched even when it is not a blocker.",
      evidence: [],
      sources: [],
      sourceKeys: []
    };
    current.priority = "P1";
    current.evidence.push(displaySignal(concern));
    current.sources.push(sourceRef(concern));
    current.sourceKeys.push(sourceKey);
    byTheme.set(theme, current);
  }
  for (const theme of feedback.frictionThemes || []) {
    if ((theme.warnings || 0) === 0 && (theme.blockers || 0) === 0) continue;
    const current = byTheme.get(theme.theme) || {
      priority: theme.blockers ? "P1" : "P2",
      lane: "watch",
      theme: theme.theme,
      title: titleForTheme(theme.theme),
      action: actionForTheme(theme.theme, "watch"),
      reason: "Repeated friction theme in feedback summary.",
      evidence: [],
      sources: [],
      sourceKeys: []
    };
    current.evidence.push(...(theme.examples || []).slice(0, 3));
    byTheme.set(theme.theme, current);
  }
  const items = [...byTheme.values()].map((item) => ({
    ...item,
    evidence: unique(item.evidence).slice(0, 5),
    sources: unique(item.sources).filter(Boolean).slice(0, 5),
    sourceKey: unique(item.sourceKeys).join(";")
  }));
  return renumber(items.sort(compareItems), "P");
}

function buildOptionalPolish(feedback, existingItems) {
  const existingText = new Set(existingItems.flatMap((item) => [item.title, ...evidenceList(item.evidence)]).map(normalizeText));
  const items = [];
  for (const fix of feedback.recommendedFixes || []) {
    if (existingText.has(normalizeText(fix))) continue;
    items.push({
      priority: "P3",
      lane: "optional",
      theme: categorize(fix),
      title: fix,
      action: "Keep as a product polish candidate after tester 2 unless it repeats.",
      reason: "Recommended fix from feedback summary.",
      evidence: fix,
      sources: []
    });
  }
  for (const note of feedback.issueNotes || []) {
    const text = note.text || "";
    if (!text || existingText.has(normalizeText(text))) continue;
    if (items.length >= 8) break;
    items.push({
      priority: "P3",
      lane: "optional",
      theme: note.category || categorize(text),
      title: text,
      action: "Review after required and watch items are handled.",
      reason: "Issue note captured during trial.",
      evidence: text,
      sources: [sourceRef(note)]
    });
  }
  return renumber(items.sort(compareItems), "P3");
}

function decideBacklog(feedback, mustFix, watch) {
  if ((feedback.files || []).length === 0 || feedback.decision === "WAITING_FOR_FEEDBACK") return "WAITING_FOR_FEEDBACK";
  if (mustFix.length > 0 || feedback.decision === "NO_GO_FIX_FIRST") return "FIX_BLOCKERS_BEFORE_TESTER_2";
  if (feedback.decision === "REVIEW_BEFORE_TESTER_2" || feedback.decision === "NEEDS_HOST_DECISION") return "HOST_REVIEW_REQUIRED";
  if (watch.some((item) => item.priority === "P1")) return "READY_FOR_TESTER_2_WITH_SAFETY_WATCH";
  if (watch.length > 0 || feedback.decision === "READY_WITH_WATCH_ITEMS") return "READY_FOR_TESTER_2_WITH_WATCH";
  if (feedback.decision === "READY_FOR_TESTER_2") return "READY_FOR_TESTER_2";
  return "HOST_REVIEW_REQUIRED";
}

function tester2Gate(decision, mustFix, watch) {
  return {
    proceed: ["READY_FOR_TESTER_2", "READY_FOR_TESTER_2_WITH_WATCH", "READY_FOR_TESTER_2_WITH_SAFETY_WATCH"].includes(decision),
    requiresHostAcceptance: decision === "READY_FOR_TESTER_2_WITH_WATCH" || decision === "READY_FOR_TESTER_2_WITH_SAFETY_WATCH",
    mustFixCount: mustFix.length,
    watchCount: watch.length,
    instructions: gateInstructions(decision)
  };
}

function gateInstructions(decision) {
  if (decision === "WAITING_FOR_FEEDBACK") return "Collect tester 1 records, run trial:ingest-feedback, then rerun trial:fix-backlog.";
  if (decision === "FIX_BLOCKERS_BEFORE_TESTER_2") return "Do not invite tester 2 until all P0 items are fixed and the trial package is refrozen.";
  if (decision === "HOST_REVIEW_REQUIRED") return "Have the host make or update the tester-2 go/no-go decision before inviting tester 2.";
  if (decision === "READY_FOR_TESTER_2_WITH_SAFETY_WATCH") return "Tester 2 may proceed only with explicit host acceptance of P1 safety watch items.";
  if (decision === "READY_FOR_TESTER_2_WITH_WATCH") return "Tester 2 may proceed; keep the listed watch items in the observation checklist.";
  return "Tester 2 may proceed with the current hosted packet.";
}

function nextSteps(decision) {
  if (decision === "WAITING_FOR_FEEDBACK") {
    return [
      "Collect completed tester 1 Markdown records.",
      "Run npm.cmd run trial:ingest-feedback -- <completed-feedback-folder>.",
      "Run npm.cmd run trial:fix-backlog."
    ];
  }
  if (decision === "FIX_BLOCKERS_BEFORE_TESTER_2") {
    return [
      "Fix P0 items first.",
      "Rerun trial:simulate, trial:ready, trial:freeze, and trial:dispatch.",
      "Rerun trial:ingest-feedback and trial:fix-backlog before inviting tester 2."
    ];
  }
  if (decision === "HOST_REVIEW_REQUIRED") {
    return [
      "Complete the host go/no-go fields in TRIAL_RESULT_RECORD.md.",
      "Rerun trial:ingest-feedback and trial:fix-backlog."
    ];
  }
  return [
    "Invite tester 2 using the current hosted packet.",
    "Add watch items to HUMAN_TRIAL_OBSERVATION.md notes before the session.",
    "After tester 2, rerun trial:ingest-feedback and trial:fix-backlog with the new records."
  ];
}

async function readFeedbackSummary(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    return {
      ok: true,
      mode: "trial-feedback-ingest",
      createdAt: new Date().toISOString(),
      decision: "WAITING_FOR_FEEDBACK",
      files: [],
      coverage: {},
      blockers: [],
      warnings: [],
      safetyConcerns: [],
      frictionThemes: [],
      recommendedFixes: [
        `Feedback summary is missing or invalid: ${path.relative(rootPath, filePath).split(path.sep).join("/")}`
      ],
      issueNotes: [],
      nextSteps: [
        "Run npm.cmd run trial:ingest-feedback -- <completed-feedback-folder> before generating a final backlog."
      ],
      readError: error.message
    };
  }
}

function itemFromSignal({ prefix, lane, signal, title, action, reason }) {
  return {
    id: "",
    priority: prefix,
    lane,
    theme: signal.category || "other",
    title,
    action,
    reason,
    evidence: displaySignal(signal),
    sources: [sourceRef(signal)].filter(Boolean),
    sourceKey: signalKey(signal)
  };
}

function titleForSignal(signal) {
  return signal.label || signal.text || "Resolve trial feedback blocker";
}

function titleForTheme(theme) {
  return {
    startup: "Watch startup and launcher clarity",
    language: "Watch language switcher and translated copy",
    "demo-real-mode": "Watch Demo vs real project mode clarity",
    path: "Watch path entry and recovery",
    preflight: "Watch read-only preflight trust and context relevance",
    safety: "Watch safety and write-boundary confidence",
    model: "Watch model setup and API-key confidence",
    patch: "Watch patch proposal review clarity",
    verification: "Watch verification command clarity",
    audit: "Watch audit trail discoverability",
    docs: "Watch guide and template clarity",
    feedback: "Watch feedback collection completeness",
    other: "Watch uncategorized tester friction"
  }[theme] || `Watch ${theme} friction`;
}

function actionForTheme(theme, lane) {
  const strict = lane === "blocker";
  const actions = {
    startup: "Make launch status, browser open state, and recovery copy unmistakable.",
    language: "Improve language switcher visibility and verify first-run copy in all supported languages.",
    "demo-real-mode": "Make Demo vs real project mode visually prominent near the path controls.",
    path: "Improve folder/file path validation, recovery copy, and example path guidance.",
    preflight: "Clarify read-only guarantees, blockers, warnings, and context quality before patching.",
    safety: "Tighten Apply/Verify confirmation copy and make write or command boundaries impossible to miss.",
    model: "Clarify model setup, cost tiers, and API-key storage before asking testers to configure models.",
    patch: "Improve changed-file review, risk labels, and patch proposal readability.",
    verification: "Clarify what command will run and why before verification approval.",
    audit: "Make audit history easier to find after preflight, apply, and verify.",
    docs: "Tighten Quick Start, runbook, or feedback template wording.",
    feedback: "Make completed feedback records easier to collect and compare.",
    other: "Review the evidence and convert repeated tester hesitation into a concrete product fix."
  };
  return strict ? `${actions[theme] || actions.other} Ship this before tester 2.` : actions[theme] || actions.other;
}

function compareItems(a, b) {
  return priorityRank(a.priority) - priorityRank(b.priority) || a.theme.localeCompare(b.theme) || a.title.localeCompare(b.title);
}

function priorityRank(priority) {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[priority] ?? 9;
}

function renumber(items, fallbackPrefix) {
  const counts = new Map();
  return items.map((item, index) => ({
    ...item,
    id: nextId(item.priority || fallbackPrefix, counts)
  }));
}

function nextId(priority, counts) {
  const current = (counts.get(priority) || 0) + 1;
  counts.set(priority, current);
  return `${priority}-${String(current).padStart(3, "0")}`;
}

function publicItems(items) {
  return items.map(({ sourceKey, sourceKeys, ...item }) => item);
}

function evidenceList(evidence) {
  if (Array.isArray(evidence)) return evidence;
  if (!evidence) return [];
  return [evidence];
}

function displaySignal(signal) {
  if (signal.text) return signal.text;
  const label = signal.label || "feedback signal";
  const result = signal.result ? `: ${signal.result}` : "";
  const notes = signal.notes ? ` (${signal.notes})` : "";
  return `${label}${result}${notes}`;
}

function sourceRef(signal) {
  if (!signal.file) return "";
  const relative = path.relative(rootPath, signal.file).split(path.sep).join("/");
  return `${relative}:${signal.line || 1}`;
}

function signalKey(signal) {
  return [signal.file || "", signal.line || "", signal.label || signal.text || "", signal.result || ""].join("|");
}

function isSafetyTheme(theme) {
  return ["safety", "preflight", "verification"].includes(theme);
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

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial Fix Backlog",
    "",
    `Created at: ${report.createdAt}`,
    `Feedback decision: ${report.feedbackDecision}`,
    `Backlog decision: ${report.decision}`,
    "",
    "## Tester 2 Gate",
    "",
    `- Proceed: ${report.tester2Gate.proceed ? "Yes" : "No"}`,
    `- Requires host acceptance: ${report.tester2Gate.requiresHostAcceptance ? "Yes" : "No"}`,
    `- Must-fix items: ${report.tester2Gate.mustFixCount}`,
    `- Watch items: ${report.tester2Gate.watchCount}`,
    `- Instruction: ${report.tester2Gate.instructions}`,
    "",
    "## Must Fix Before Tester 2",
    "",
    ...renderItems(report.mustFixBeforeTester2),
    "",
    "## Watch During Tester 2",
    "",
    ...renderItems(report.watchDuringTester2),
    "",
    "## Optional Polish",
    "",
    ...renderItems(report.optionalPolish),
    "",
    "## Counts",
    "",
    `- Feedback files: ${report.counts.feedbackFiles}`,
    `- Blockers: ${report.counts.blockers}`,
    `- Warnings: ${report.counts.warnings}`,
    `- Safety concerns: ${report.counts.safetyConcerns}`,
    `- Friction themes: ${report.counts.frictionThemes}`,
    "",
    "## Next Steps",
    "",
    ...report.nextSteps.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function renderItems(items) {
  if (!items.length) return ["- None"];
  return items.flatMap((item) => [
    `- ${item.id} ${item.title}`,
    `  - Priority: ${item.priority}`,
    `  - Theme: ${item.theme}`,
    `  - Action: ${item.action}`,
    `  - Evidence: ${Array.isArray(item.evidence) ? item.evidence.join("; ") : item.evidence}`,
    `  - Source: ${(item.sources || []).join(", ") || "n/a"}`
  ]);
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
    if (arg === "--json") {
      parsed.json = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--json=")) {
      parsed.json = arg.slice("--json=".length);
      continue;
    }
    if (arg === "--markdown") {
      parsed.markdown = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--markdown=")) {
      parsed.markdown = arg.slice("--markdown=".length);
      continue;
    }
    if (!parsed.input && !arg.startsWith("--")) {
      parsed.input = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}
