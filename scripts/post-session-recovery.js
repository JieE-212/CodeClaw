import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const distPath = path.join(rootPath, "dist");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const args = parseArgs(process.argv.slice(2));
const sessionPath = path.resolve(rootPath, args.session || path.join("dist", "trial-session-packs", "tester-1"));
const nextTester = sanitizeTesterId(args.nextTester || "tester-2");
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_POST_SESSION_REPORT.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_POST_SESSION_REPORT.md"));

const steps = [];
let report;

try {
  const privacyStep = await runNpmStep({
    name: "privacy:check",
    script: "trial:privacy-check",
    args: [relative(sessionPath)],
    allowFailure: true
  });
  steps.push(privacyStep);
  if (privacyStep.exitCode !== 0) throw new Error("privacy:check failed; redact session records before continuing.");
  steps.push(await runNpmStep({
    name: "feedback:ingest",
    script: "trial:ingest-feedback",
    args: [relative(sessionPath)]
  }));
  steps.push(await runNpmStep({
    name: "feedback:fix-backlog",
    script: "trial:fix-backlog",
    args: []
  }));
  steps.push(await runNpmStep({
    name: "next:session-pack",
    script: "trial:session-pack",
    args: ["--", "--tester", nextTester, "--force"]
  }));
  steps.push(await runNpmStep({
    name: "next:host-ready",
    script: "trial:host-ready",
    args: ["--", "--tester", nextTester],
    allowFailure: true
  }));

  report = await buildReport({ steps, error: "" });
} catch (error) {
  report = await buildReport({ steps, error: error.message });
}

await fs.mkdir(distPath, { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  sessionPath,
  nextTester,
  steps: report.steps.map((step) => ({ name: step.name, exitCode: step.exitCode })),
  jsonPath,
  markdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function buildReport({ steps, error }) {
  const feedback = await readJson(path.join(distPath, "TRIAL_FEEDBACK_SUMMARY.json"));
  const backlog = await readJson(path.join(distPath, "TRIAL_FIX_BACKLOG.json"));
  const hostReady = await readJson(path.join(distPath, "TRIAL_HOST_READY_REPORT.json"));
  const privacy = await readJson(path.join(distPath, "TRIAL_PRIVACY_REPORT.json"));
  const sessionManifest = await readJson(path.join(distPath, "trial-session-packs", nextTester, "SESSION_PACK_MANIFEST.json"));
  const blockers = [];
  const warnings = [];

  if (error) blockers.push(error);
  for (const step of steps) {
    if (step.exitCode !== 0 && step.name !== "next:host-ready") blockers.push(`${step.name} failed with exit code ${step.exitCode}.`);
  }
  if (!privacy.ok) blockers.push("Privacy check did not pass.");
  if (!feedback.ok) blockers.push("Feedback ingest report is not ok.");
  if (!backlog.ok) blockers.push("Fix backlog report is not ok.");
  if (!sessionManifest.ok) blockers.push("Next tester session pack manifest is not ok.");
  if (hostReady.decision === "HOLD") warnings.push("Next tester host-ready gate is HOLD; fix blockers before hosting.");
  if ((backlog.mustFixBeforeTester2 || []).length) warnings.push("Fix backlog has P0 items.");
  if (hostReady.warnings?.length) warnings.push(...hostReady.warnings);

  const decision = decide({ blockers, backlog, hostReady });
  return {
    ok: blockers.length === 0,
    mode: "trial-post-session",
    createdAt: new Date().toISOString(),
    sessionPath,
    sessionRelativePath: relative(sessionPath),
    nextTester,
    decision,
    blockers,
    warnings: unique(warnings),
    privacyDecision: privacy.decision || "UNKNOWN",
    feedbackDecision: feedback.decision || "UNKNOWN",
    backlogDecision: backlog.decision || "UNKNOWN",
    hostReadyDecision: hostReady.decision || "UNKNOWN",
    nextSessionFolder: sessionManifest.outputRelativePath || path.join("dist", "trial-session-packs", nextTester).split(path.sep).join("/"),
    steps: steps.map(publicStep),
    mustFixBeforeNextTester: backlog.mustFixBeforeTester2 || [],
    watchDuringNextTester: backlog.watchDuringTester2 || [],
    nextSteps: nextSteps(decision)
  };
}

function decide({ blockers, backlog, hostReady }) {
  if (blockers.length) return "POST_SESSION_PIPELINE_FAILED";
  if ((backlog.mustFixBeforeTester2 || []).length || backlog.decision === "FIX_BLOCKERS_BEFORE_TESTER_2") return "FIX_BEFORE_NEXT_TESTER";
  if (hostReady.decision === "READY_TO_HOST") return "READY_FOR_NEXT_TESTER";
  if (hostReady.decision === "HOLD") return "HOST_READY_HOLD";
  return "REVIEW_BEFORE_NEXT_TESTER";
}

function nextSteps(decision) {
  if (decision === "READY_FOR_NEXT_TESTER") {
    return [
      "Use the generated next tester session pack.",
      "Open TRIAL_HOST_READY_REPORT.md and accept any watch-item warnings before hosting.",
      "After the next session, rerun trial:post-session with that session folder."
    ];
  }
  if (decision === "FIX_BEFORE_NEXT_TESTER" || decision === "HOST_READY_HOLD") {
    return [
      "Fix P0 or host-ready blockers before inviting the next tester.",
      "Rerun trial:simulate, trial:ready, trial:freeze, and trial:dispatch if product or package files changed.",
      "Rerun trial:session-pack and trial:host-ready for the next tester."
    ];
  }
  if (decision === "POST_SESSION_PIPELINE_FAILED") {
    return [
      "Fix the failed step shown in TRIAL_POST_SESSION_REPORT.md.",
      "Rerun npm.cmd run trial:post-session -- --session <completed-session-folder>."
    ];
  }
  return [
    "Review feedback and backlog reports manually.",
    "Regenerate the next session pack after the host decision is explicit."
  ];
}

function runNpmStep({ name, script, args, allowFailure = false }) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const commandArgs = ["run", script, ...args];
    const commandLine = [npmCommand, ...commandArgs].map(quoteShellArg).join(" ");
    console.log(`\n==> ${name}: ${commandLine}`);
    const child = spawn(commandLine, {
      cwd: rootPath,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      const result = {
        name,
        script,
        commandLine,
        exitCode,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        summary: parseJsonOutput(stdout)
      };
      if (exitCode !== 0 && !allowFailure) {
        reject(new Error(`${name} failed with exit code ${exitCode}.`));
        return;
      }
      resolve(result);
    });
  });
}

function publicStep(step) {
  return {
    name: step.name,
    script: step.script,
    command: step.commandLine,
    exitCode: step.exitCode,
    durationMs: step.durationMs,
    summary: step.summary
  };
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      decision: "MISSING",
      readError: error.message,
      filePath
    };
  }
}

function parseJsonOutput(output) {
  const start = output.lastIndexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return {};
  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    return {};
  }
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial Post-Session Report",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Completed session: ${report.sessionRelativePath}`,
    `Next tester: ${report.nextTester}`,
    `Next session folder: ${report.nextSessionFolder}`,
    "",
    "## Decisions",
    "",
    `- Privacy: ${report.privacyDecision}`,
    `- Feedback: ${report.feedbackDecision}`,
    `- Backlog: ${report.backlogDecision}`,
    `- Host-ready: ${report.hostReadyDecision}`,
    "",
    "## Blockers",
    "",
    ...(report.blockers.length ? report.blockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Steps",
    "",
    ...report.steps.map((step) => `- ${step.name}: exit ${step.exitCode}`),
    "",
    "## Must Fix Before Next Tester",
    "",
    ...renderItems(report.mustFixBeforeNextTester),
    "",
    "## Watch During Next Tester",
    "",
    ...renderItems(report.watchDuringNextTester),
    "",
    "## Next Steps",
    "",
    ...report.nextSteps.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function renderItems(items) {
  if (!items.length) return ["- None"];
  return items.map((item) => `- ${item.id || item.priority || "ITEM"} ${item.title || "Untitled"}: ${item.action || item.reason || ""}`);
}

function parseArgs(rawArgs) {
  const parsed = { session: "", nextTester: "", json: "", markdown: "" };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--session") {
      parsed.session = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--session=")) {
      parsed.session = arg.slice("--session=".length);
      continue;
    }
    if (arg === "--next-tester") {
      parsed.nextTester = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--next-tester=")) {
      parsed.nextTester = arg.slice("--next-tester=".length);
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
    if (!parsed.session && !arg.startsWith("--")) {
      parsed.session = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function sanitizeTesterId(value) {
  const cleaned = String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "tester-2";
}

function quoteShellArg(value) {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value;
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function relative(targetPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
