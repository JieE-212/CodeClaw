import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const args = parseArgs(process.argv.slice(2));
const runId = sanitizeRunId(args.runId || "post-call-latest");
const testerId = sanitizeTesterId(args.tester || "tester-rehearsal-1");
const nextTester = sanitizeTesterId(args.nextTester || "tester-rehearsal-2");
const runRoot = path.resolve(rootPath, args.out || path.join("dist", "trial-post-call-rehearsals", runId));
const sessionPath = path.join(runRoot, "session");
const reportsPath = path.join(runRoot, "reports");
const notesPath = path.join(runRoot, "local-rehearsal-notes.md");
const packetPath = path.join(runRoot, "after-live-packet");
const archivePath = path.join(runRoot, "archive");
const packagePath = path.join(runRoot, "package");
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_POST_CALL_REHEARSAL_REPORT.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_POST_CALL_REHEARSAL_REPORT.md"));

await assertSafeRehearsal();

const steps = [];
let report;

try {
  await prepareRehearsalFixture();
  steps.push(await runNpmStep({
    name: "record:draft",
    script: "trial:record-draft",
    args: [
      "--",
      "--session", relative(sessionPath),
      "--notes", relative(notesPath),
      "--json", relative(path.join(reportsPath, "TRIAL_RECORD_DRAFT.json")),
      "--markdown", relative(path.join(reportsPath, "TRIAL_RECORD_DRAFT.md"))
    ]
  }));
  await assertRecordDraftReady();
  steps.push(await runNpmStep({
    name: "after:live",
    script: "trial:after-live",
    args: [
      "--",
      "--session", relative(sessionPath),
      "--tester", testerId,
      "--next-tester", nextTester,
      "--reports", relative(reportsPath),
      "--out", relative(packetPath),
      "--archive-out", relative(archivePath),
      "--json", relative(path.join(reportsPath, "TRIAL_AFTER_LIVE_REPORT.json")),
      "--markdown", relative(path.join(reportsPath, "TRIAL_AFTER_LIVE_REPORT.md")),
      "--force"
    ]
  }));
  await assertAfterLiveReady();
  if (!args.skipStandby) {
    steps.push(await runNpmStep({
      name: "first-live:standby",
      script: "trial:first-live-standby",
      args: ["--", "--tester", sanitizeTesterId(args.standbyTester || "tester-2")],
      allowFailure: true
    }));
  }
  report = await buildReport("");
} catch (error) {
  report = await buildReport(error.message);
}

await fs.mkdir(path.dirname(jsonPath), { recursive: true });
await fs.mkdir(path.dirname(markdownPath), { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  runId,
  testerId,
  rehearsalRoot: report.rehearsalRelativePath,
  recordDraft: report.recordDraftDecision,
  afterLive: report.afterLiveDecision,
  standby: report.standbyDecision,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  jsonPath,
  markdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function prepareRehearsalFixture() {
  if (await exists(runRoot)) {
    if (!args.force) throw new Error(`Rehearsal output already exists: ${relative(runRoot)}. Use --force to replace it.`);
    await fs.rm(runRoot, { recursive: true, force: true });
  }
  await fs.mkdir(sessionPath, { recursive: true });
  await fs.mkdir(reportsPath, { recursive: true });
  await fs.mkdir(packagePath, { recursive: true });
  await fs.writeFile(path.join(packagePath, "PACKAGE_MANIFEST.md"), "# Rehearsal package placeholder\n", "utf8");
  await writeNotes();
  await writeCompletedSession();
  await writeJson(path.join(reportsPath, "TRIAL_DISPATCH_NOTE.json"), {
    ok: true,
    mode: "trial-dispatch",
    decision: "READY_TO_SEND",
    packagePath,
    requiredDocs: [],
    blockers: [],
    missingPackageDocs: []
  });
  await writeJson(path.join(reportsPath, "TRIAL_LIVE_CAPTURE_REPORT.json"), {
    ok: true,
    mode: "trial-live-capture",
    decision: "LIVE_CAPTURE_READY",
    testerId,
    sessionFolder: sessionPath,
    sessionRelativePath: relative(sessionPath),
    blockers: [],
    warnings: []
  });
}

async function writeNotes() {
  await fs.writeFile(notesPath, [
    "# CodeClaw Post-Call Rehearsal Notes",
    "",
    "REHEARSAL ONLY. This is synthetic anonymous data for pipeline verification, not real tester feedback.",
    "",
    "- Goal: Rehearse Demo and real read-only preflight records.",
    "- Observed live: Yes",
    "- Biggest friction: The host wanted clearer post-call command order.",
    "- Biggest trust concern: None in rehearsal.",
    "- First point where host helped: No host help was needed.",
    "- Recommended product fix: Keep the post-call command order visible.",
    "- Safe to continue to tester 2: Yes",
    "- Would you use CodeClaw again on a real project?: Yes",
    "- Would you try one disposable patch next?: Maybe",
    "- Most useful part: Local-only safety gates.",
    "- Most confusing part: After-call command order.",
    "- Should this build go to tester 2?: Yes",
    "- Decision after trial: Continue",
    "- First stuck moment: None",
    "- Host intervention needed: No",
    "- Severity: Low",
    "- Strongest trust-building moment: Read-only preflight stayed visibly safe.",
    "- Strongest trust concern: None",
    "- Proceed to tester 2: Yes",
    "- Required fix before tester 2: None",
    ""
  ].join("\n"), "utf8");
}

async function writeCompletedSession() {
  await fs.writeFile(path.join(sessionPath, "SESSION_BRIEF.md"), [
    "# Session Brief",
    "",
    "REHEARSAL ONLY. Synthetic anonymous post-call fixture.",
    `Tester id: ${testerId}`,
    ""
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(sessionPath, "HOST_RUNBOOK.md"), "# Host Runbook\n\nREHEARSAL ONLY. Use Demo, then read-only preflight. Stop before Apply.\n", "utf8");
  await fs.writeFile(path.join(sessionPath, "LIVE_SESSION_HOST_SUMMARY.md"), [
    "# CodeClaw Live Session Host Summary",
    "",
    "REHEARSAL ONLY. Synthetic anonymous summary.",
    "",
    `- Tester id: ${testerId}`,
    "- Date: 2026-07-10",
    "- Trial scope: Demo / real read-only preflight",
    "- Main friction: Post-call command order.",
    "- Main trust concern: None in rehearsal.",
    "- First host intervention: None.",
    "- Most useful moment: Local-only safety gates.",
    "- Required product fix before next tester: None",
    "- Proceed recommendation: Continue",
    ""
  ].join("\n"), "utf8");
  await writeJson(path.join(sessionPath, "SESSION_PACK_MANIFEST.json"), {
    ok: true,
    mode: "trial-session-pack",
    testerId,
    outputPath: sessionPath,
    outputRelativePath: relative(sessionPath),
    testerIntake: {
      id: testerId,
      consent: true,
      privacyAccepted: true,
      allowedScope: ["demo", "real-read-only"]
    },
    files: ["TRIAL_FEEDBACK_TEMPLATE.md", "HUMAN_TRIAL_OBSERVATION.md", "TRIAL_RESULT_RECORD.md"]
  });
  await fs.writeFile(path.join(sessionPath, "HUMAN_TRIAL_OBSERVATION.md"), recordMarkdown({
    title: "Human Trial Observation",
    fields: {
      Tester: testerId,
      "Biggest friction": "Post-call command order needed to be clearer.",
      "Biggest trust concern": "None in rehearsal.",
      "First point where host helped": "No host help was needed.",
      "Recommended product fix": "Keep post-call commands visible.",
      "Safe to continue to tester 2": "Yes"
    }
  }), "utf8");
  await fs.writeFile(path.join(sessionPath, "TRIAL_FEEDBACK_TEMPLATE.md"), recordMarkdown({
    title: "Trial Feedback Template",
    fields: {
      Name: testerId,
      "Observed live": "Yes",
      Goal: "Rehearse Demo and real read-only preflight records.",
      "Would you use CodeClaw again on a real project?": "Yes",
      "Would you try one disposable patch next?": "Maybe",
      "Most useful part": "Local-only safety gates.",
      "Most confusing part": "After-call command order.",
      "Should this build go to tester 2?": "Yes"
    }
  }), "utf8");
  await fs.writeFile(path.join(sessionPath, "TRIAL_RESULT_RECORD.md"), recordMarkdown({
    title: "Trial Result Record",
    fields: {
      Host: "codeclaw-host",
      "Decision after trial": "Continue",
      "First stuck moment": "None",
      "Host intervention needed": "No",
      Severity: "Low",
      "Strongest trust-building moment": "Read-only preflight stayed visibly safe.",
      "Strongest trust concern": "None",
      "Proceed to tester 2": "Yes",
      "Required fix before tester 2": "None"
    }
  }), "utf8");
}

function recordMarkdown({ title, fields }) {
  return [
    `# ${title}`,
    "",
    "REHEARSAL ONLY. Synthetic anonymous data for pipeline verification, not real tester feedback.",
    "",
    ...Object.entries(fields).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Checklist",
    "",
    "| Check | Result | Notes |",
    "| --- | --- | --- |",
    "| Rehearsal marker present | Pass | Data is synthetic and anonymous. |",
    "| Demo path | Pass | Rehearsal reached the demo flow. |",
    "| Read-only preflight | Pass | No write path was exercised. |",
    "| Apply boundary | Pass | Rehearsal stopped before Apply. |",
    "| Verify boundary | Pass | Rehearsal noted command boundary. |",
    "| Trust copy | Pass | Rehearsal kept safety copy visible. |",
    "| Feedback records | Pass | Required fields are complete. |",
    "| Privacy check | Pass | No contact data, paths, screenshots, logs, source snippets, or secrets. |",
    "",
    "## Issues",
    "",
    "1. None.",
    ""
  ].join("\n");
}

async function assertRecordDraftReady() {
  const recordDraft = await readJson(path.join(reportsPath, "TRIAL_RECORD_DRAFT.json"));
  if (!recordDraft) throw new Error("Record draft report is missing after trial:record-draft.");
  if (recordDraft.ok === false || recordDraft.decision === "RECORD_DRAFT_HOLD") {
    throw new Error(`Record draft decision is ${recordDraft.decision || "UNKNOWN"}.`);
  }
  if (!recordDraft.localOnly) throw new Error("Record draft report must be marked local-only.");
}

async function assertAfterLiveReady() {
  const afterLive = await readJson(path.join(reportsPath, "TRIAL_AFTER_LIVE_REPORT.json"));
  if (!afterLive) throw new Error("After-live report is missing after trial:after-live.");
  if (afterLive.ok === false || afterLive.decision === "AFTER_LIVE_BLOCKED") {
    throw new Error(`After-live decision is ${afterLive.decision || "UNKNOWN"}.`);
  }
}

async function buildReport(error) {
  const recordDraft = await readJson(path.join(reportsPath, "TRIAL_RECORD_DRAFT.json"));
  const afterLive = await readJson(path.join(reportsPath, "TRIAL_AFTER_LIVE_REPORT.json"));
  const standby = args.skipStandby ? null : await readJson(path.join(rootPath, "dist", "TRIAL_FIRST_LIVE_STANDBY.json"));
  const blockers = [];
  const warnings = [];
  if (error) blockers.push(error);
  for (const step of steps) {
    if (step.exitCode !== 0 && step.name !== "first-live:standby") blockers.push(`${step.name} failed with exit code ${step.exitCode}.`);
    if (step.exitCode !== 0 && step.name === "first-live:standby") warnings.push("First-live standby check did not pass after rehearsal; review tester-2 standby separately.");
  }
  if (!recordDraft) blockers.push("TRIAL_RECORD_DRAFT.json is missing.");
  if (recordDraft?.decision === "RECORD_DRAFT_HOLD") blockers.push("Record draft is on hold.");
  if (!afterLive) blockers.push("TRIAL_AFTER_LIVE_REPORT.json is missing.");
  if (afterLive?.decision === "AFTER_LIVE_BLOCKED") blockers.push("After-live rehearsal is blocked.");
  if (standby && standby.decision === "FIRST_LIVE_STANDBY_BLOCKED") warnings.push("Tester-2 first-live standby is blocked after rehearsal.");

  const decision = blockers.length
    ? "POST_CALL_REHEARSAL_BLOCKED"
    : warnings.length || afterLive?.decision === "AFTER_LIVE_READY_WITH_REVIEW"
      ? "POST_CALL_REHEARSAL_READY_WITH_REVIEW"
      : "POST_CALL_REHEARSAL_READY";

  return {
    ok: blockers.length === 0,
    mode: "trial-post-call-rehearsal",
    createdAt: new Date().toISOString(),
    decision,
    runId,
    testerId,
    nextTester,
    rehearsalOnly: true,
    realTesterFeedback: false,
    rehearsalPath: runRoot,
    rehearsalRelativePath: relative(runRoot),
    sessionPath,
    sessionRelativePath: relative(sessionPath),
    reportsPath,
    reportsRelativePath: relative(reportsPath),
    notesPath,
    notesRelativePath: relative(notesPath),
    recordDraftDecision: recordDraft?.decision || "MISSING",
    recordDraftSuggestions: recordDraft?.suggestions?.length || 0,
    recordDraftMissing: recordDraft?.missing?.length || 0,
    afterLiveDecision: afterLive?.decision || "MISSING",
    standbyDecision: args.skipStandby ? "SKIPPED" : standby?.decision || "MISSING",
    steps: steps.map(publicStep),
    blockers: unique(blockers),
    warnings: unique(warnings),
    outputs: {
      recordDraft: relative(path.join(reportsPath, "TRIAL_RECORD_DRAFT.md")),
      afterLive: relative(path.join(reportsPath, "TRIAL_AFTER_LIVE_REPORT.md")),
      packet: relative(packetPath),
      archive: relative(archivePath)
    },
    nextCommands: nextCommands(decision),
    nextSteps: nextSteps(decision)
  };
}

function nextCommands(decision) {
  if (decision === "POST_CALL_REHEARSAL_BLOCKED") {
    return [
      `npm.cmd run trial:post-call-rehearsal -- --run-id ${runId} --force`,
      "npm.cmd run trial:first-live-standby -- --tester tester-2"
    ];
  }
  return [
    "npm.cmd run trial:first-live-standby -- --tester tester-2",
    "When a real tester is available: open HOST_RUNBOOK.md and LIVE_SESSION_CAPTURE.md"
  ];
}

function nextSteps(decision) {
  if (decision === "POST_CALL_REHEARSAL_BLOCKED") {
    return [
      "Fix the rehearsal blocker.",
      "Rerun the rehearsal with --force.",
      "Do not use rehearsal output as real tester feedback."
    ];
  }
  return [
    "Keep rehearsal output local and do not treat it as real tester feedback.",
    "Use trial:first-live-standby to keep tester-2 ready.",
    "When the human tester is available, run the real first-live session."
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

function renderMarkdown(report) {
  return [
    "# CodeClaw Post-Call Rehearsal Report",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Run id: ${report.runId}`,
    `Tester: ${report.testerId}`,
    `Rehearsal only: ${report.rehearsalOnly ? "Yes" : "No"}`,
    `Real tester feedback: ${report.realTesterFeedback ? "Yes" : "No"}`,
    `Rehearsal folder: ${report.rehearsalRelativePath}`,
    "",
    "## Decisions",
    "",
    `- Record draft: ${report.recordDraftDecision}`,
    `- After-live: ${report.afterLiveDecision}`,
    `- First-live standby: ${report.standbyDecision}`,
    "",
    "## Steps",
    "",
    ...report.steps.map((step) => `- ${step.name}: exit ${step.exitCode}`),
    "",
    "## Outputs",
    "",
    ...Object.entries(report.outputs).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Blockers",
    "",
    ...(report.blockers.length ? report.blockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Rules",
    "",
    "- This is rehearsal output only.",
    "- Do not count this as tester feedback.",
    "- Do not use this to justify product decisions that require a real human tester.",
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

async function assertSafeRehearsal() {
  if (!isRehearsalTesterId(testerId)) throw new Error("Post-call rehearsal tester id must include rehearsal.");
  if (!isRehearsalTesterId(nextTester)) throw new Error("Post-call rehearsal next tester id must include rehearsal.");
  const relativePath = path.relative(rootPath, runRoot);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Post-call rehearsal output must stay inside the CodeClaw project root.");
  }
  const allowedRoot = path.join(rootPath, "dist", "trial-post-call-rehearsals");
  const insideAllowedRoot = !path.relative(allowedRoot, runRoot).startsWith("..") && !path.isAbsolute(path.relative(allowedRoot, runRoot));
  if (!insideAllowedRoot) throw new Error("Post-call rehearsal output must stay inside dist/trial-post-call-rehearsals/.");
}

function parseArgs(rawArgs) {
  const parsed = {
    runId: "",
    tester: "",
    nextTester: "",
    standbyTester: "",
    out: "",
    json: "",
    markdown: "",
    force: false,
    skipStandby: false
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    if (arg === "--skip-standby") {
      parsed.skipStandby = true;
      continue;
    }
    let handled = false;
    for (const key of ["runId", "tester", "nextTester", "standbyTester", "out", "json", "markdown"]) {
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
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
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

function quoteShellArg(value) {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value;
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function sanitizeRunId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "post-call-latest";
}

function isRehearsalTesterId(value) {
  return /rehearsal/i.test(String(value || ""));
}

function sanitizeTesterId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "tester-rehearsal-1";
}

function relative(targetPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
