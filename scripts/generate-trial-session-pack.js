import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const args = parseArgs(process.argv.slice(2));
const testerId = sanitizeTesterId(args.tester || "tester-1");
const outputPath = path.resolve(rootPath, args.out || path.join("dist", "trial-session-packs", testerId));
const backlogPath = path.resolve(rootPath, args.backlog || path.join("dist", "TRIAL_FIX_BACKLOG.json"));
const templateFiles = [
  "docs/TRIAL_FEEDBACK_TEMPLATE.md",
  "docs/HUMAN_TRIAL_OBSERVATION.md",
  "docs/TRIAL_RESULT_RECORD.md"
];

await assertSafeOutputPath(outputPath);
if (await exists(outputPath)) {
  if (!args.force) throw new Error(`Output already exists: ${outputPath}\nUse --force to replace it.`);
  await fs.rm(outputPath, { recursive: true, force: true });
}

const backlog = await readBacklog(backlogPath);
const watchItems = [...(backlog.mustFixBeforeTester2 || []), ...(backlog.watchDuringTester2 || [])];

await fs.mkdir(outputPath, { recursive: true });
for (const file of templateFiles) {
  const source = path.join(rootPath, file);
  const target = path.join(outputPath, path.basename(file));
  const text = await fs.readFile(source, "utf8");
  await fs.writeFile(target, injectTemplateHeader(file, text, { backlog, watchItems }), "utf8");
}

const sessionBrief = renderSessionBrief({ testerId, outputPath, backlog, watchItems });
const manifest = renderManifest({ testerId, outputPath, backlog, watchItems });
await fs.writeFile(path.join(outputPath, "SESSION_BRIEF.md"), sessionBrief, "utf8");
await fs.writeFile(path.join(outputPath, "SESSION_PACK_MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  mode: "trial-session-pack",
  testerId,
  outputPath,
  backlogDecision: backlog.decision || "UNKNOWN",
  mustFix: (backlog.mustFixBeforeTester2 || []).length,
  watch: (backlog.watchDuringTester2 || []).length,
  files: [
    "SESSION_BRIEF.md",
    "TRIAL_FEEDBACK_TEMPLATE.md",
    "HUMAN_TRIAL_OBSERVATION.md",
    "TRIAL_RESULT_RECORD.md",
    "SESSION_PACK_MANIFEST.json"
  ]
}, null, 2));

async function readBacklog(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    return {
      ok: true,
      mode: "trial-fix-backlog",
      decision: "WAITING_FOR_FEEDBACK",
      feedbackDecision: "WAITING_FOR_FEEDBACK",
      mustFixBeforeTester2: [],
      watchDuringTester2: [],
      optionalPolish: [],
      tester2Gate: {
        proceed: false,
        requiresHostAcceptance: false,
        instructions: "Run trial:ingest-feedback and trial:fix-backlog before using backlog-aware watch items."
      },
      readError: error.message
    };
  }
}

function injectTemplateHeader(file, text, { backlog, watchItems }) {
  if (file.endsWith("HUMAN_TRIAL_OBSERVATION.md")) {
    return [
      "# Session-Specific Watch Items",
      "",
      `Backlog decision: ${backlog.decision || "UNKNOWN"}`,
      `Tester 2 gate: ${backlog.tester2Gate?.instructions || "No gate instruction available."}`,
      "",
      ...renderWatchItems(watchItems),
      "",
      "---",
      "",
      text
    ].join("\n");
  }
  if (file.endsWith("TRIAL_RESULT_RECORD.md")) {
    return [
      "# Session-Specific Decision Inputs",
      "",
      `Backlog decision before this session: ${backlog.decision || "UNKNOWN"}`,
      `Must-fix items before this session: ${(backlog.mustFixBeforeTester2 || []).length}`,
      `Watch items for this session: ${(backlog.watchDuringTester2 || []).length}`,
      "",
      "After the session, fill the go/no-go fields and rerun:",
      "",
      "```bash",
      "npm.cmd run trial:ingest-feedback -- <this-session-folder>",
      "npm.cmd run trial:fix-backlog",
      "```",
      "",
      "---",
      "",
      text
    ].join("\n");
  }
  return [
    "# Session-Specific Feedback Notes",
    "",
    `Tester folder: ${path.basename(outputPath)}`,
    "Fill this file after the hosted trial, then run feedback ingest against this session folder.",
    "",
    "---",
    "",
    text
  ].join("\n");
}

function renderSessionBrief({ testerId, outputPath, backlog, watchItems }) {
  const outputRelativePath = toPortablePath(path.relative(rootPath, outputPath));
  return [
    "# CodeClaw Hosted Trial Session Brief",
    "",
    `Tester id: ${testerId}`,
    `Created at: ${new Date().toISOString()}`,
    `Session folder: ${outputRelativePath}`,
    `Backlog decision: ${backlog.decision || "UNKNOWN"}`,
    `Feedback decision: ${backlog.feedbackDecision || "UNKNOWN"}`,
    "",
    "## Gate",
    "",
    `- Proceed according to backlog: ${backlog.tester2Gate?.proceed ? "Yes" : "No"}`,
    `- Requires host acceptance: ${backlog.tester2Gate?.requiresHostAcceptance ? "Yes" : "No"}`,
    `- Instruction: ${backlog.tester2Gate?.instructions || "No gate instruction available."}`,
    "",
    "## Before The Session",
    "",
    "- Keep `docs/START_GUIDE.md`, `docs/TRIAL_5_MIN_PRECHECK.md`, and this session folder open.",
    "- Start with Demo, then run one real-project read-only preflight.",
    "- Stop before Apply on a non-disposable real project.",
    "- Do not ask for API keys in the first hosted trial.",
    "",
    "## Watch Items",
    "",
    ...renderWatchItems(watchItems),
    "",
    "## Files To Fill",
    "",
    "- `HUMAN_TRIAL_OBSERVATION.md` during the live session.",
    "- `TRIAL_FEEDBACK_TEMPLATE.md` after the tester finishes.",
    "- `TRIAL_RESULT_RECORD.md` after the host reviews the outcome.",
    "",
    "## After The Session",
    "",
    "Run these from the project root, replacing the path with this session folder if needed:",
    "",
    "```bash",
    `npm.cmd run trial:post-session -- --session ${toPortablePath(path.relative(rootPath, outputPath))} --next-tester ${nextTesterId(testerId)}`,
    "```",
    ""
  ].join("\n");
}

function renderWatchItems(items) {
  if (!items.length) return ["- None"];
  return items.map((item) => {
    const evidence = Array.isArray(item.evidence) ? item.evidence.join("; ") : item.evidence || "No evidence recorded.";
    return `- ${item.id || item.priority || "WATCH"} ${item.title || "Watch item"}: ${item.action || "Observe and record."} Evidence: ${evidence}`;
  });
}

function renderManifest({ testerId, outputPath, backlog, watchItems }) {
  const outputRelativePath = toPortablePath(path.relative(rootPath, outputPath));
  return {
    ok: true,
    mode: "trial-session-pack",
    createdAt: new Date().toISOString(),
    testerId,
    outputPath,
    outputRelativePath,
    backlogDecision: backlog.decision || "UNKNOWN",
    feedbackDecision: backlog.feedbackDecision || "UNKNOWN",
    gate: backlog.tester2Gate || {},
    watchItems: watchItems.map((item) => ({
      id: item.id || "",
      priority: item.priority || "",
      theme: item.theme || "",
      title: item.title || "",
      action: item.action || "",
      evidence: item.evidence || []
    })),
    files: [
      "SESSION_BRIEF.md",
      "TRIAL_FEEDBACK_TEMPLATE.md",
      "HUMAN_TRIAL_OBSERVATION.md",
      "TRIAL_RESULT_RECORD.md"
    ],
    afterSessionCommands: [
      `npm.cmd run trial:post-session -- --session ${toPortablePath(path.relative(rootPath, outputPath))} --next-tester ${nextTesterId(testerId)}`
    ]
  };
}

async function assertSafeOutputPath(candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Session pack output must stay inside the CodeClaw project root.");
  }
  const distRoot = path.join(rootPath, "dist");
  const feedbackRoot = path.join(rootPath, "docs", "trial-feedback");
  if (isInside(candidatePath, distRoot) || isInside(candidatePath, feedbackRoot)) return;
  throw new Error("Session pack output must be inside dist/ or docs/trial-feedback/.");
}

function isInside(candidatePath, allowedRoot) {
  const relative = path.relative(allowedRoot, candidatePath);
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseArgs(rawArgs) {
  const parsed = { tester: "", out: "", backlog: "", force: false };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    if (arg === "--tester") {
      parsed.tester = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--tester=")) {
      parsed.tester = arg.slice("--tester=".length);
      continue;
    }
    if (arg === "--out") {
      parsed.out = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      parsed.out = arg.slice("--out=".length);
      continue;
    }
    if (arg === "--backlog") {
      parsed.backlog = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--backlog=")) {
      parsed.backlog = arg.slice("--backlog=".length);
      continue;
    }
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
  return cleaned || "tester-1";
}

function nextTesterId(value) {
  const match = String(value || "").match(/^(.*?)(\d+)$/);
  if (!match) return `${sanitizeTesterId(value)}-next`;
  return `${match[1]}${Number(match[2]) + 1}`;
}

function toPortablePath(value) {
  return value.split(path.sep).join("/");
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
