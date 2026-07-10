import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const distPath = path.join(rootPath, "dist");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const args = parseArgs(process.argv.slice(2));
const testerId = sanitizeTesterId(args.tester || "tester-dry-run-1");
const nextTester = nextTesterId(testerId);
const runId = args.runId || `intake-review-${dateStamp()}`;
const runPath = path.resolve(rootPath, args.out || path.join("dist", "trial-dry-runs", runId));
const packagePath = path.join(runPath, "package");
const sessionPath = path.join(runPath, "session");
const rosterPath = path.join(runPath, "TESTER_ROSTER.json");
const dryRunReportsPath = path.join(runPath, "reports");
const finalJsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_INTAKE_REVIEW_DRY_RUN_REPORT.json"));
const finalMarkdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_INTAKE_REVIEW_DRY_RUN_REPORT.md"));

await assertSafeOutputPath(runPath);

if (await exists(runPath)) {
  if (!args.force) throw new Error(`Dry-run output already exists: ${runPath}\nUse --force to replace it.`);
  await fs.rm(runPath, { recursive: true, force: true });
}

const steps = [];
let report;

try {
  await fs.mkdir(runPath, { recursive: true });
  await writeAnonymousRoster(rosterPath);

  steps.push(await runNpmStep({
    name: "package:local-trial",
    script: "package:local-trial",
    args: ["--", "--out", relative(packagePath), "--force"]
  }));
  await writeDispatchFixture(packagePath);
  steps.push(await runNpmStep({
    name: "backlog:initial",
    script: "trial:fix-backlog",
    args: [
      "--",
      "--input", relative(path.join(runPath, "MISSING_FEEDBACK_SUMMARY.json")),
      "--json", relative(path.join(dryRunReportsPath, "TRIAL_FIX_BACKLOG.json")),
      "--markdown", relative(path.join(dryRunReportsPath, "TRIAL_FIX_BACKLOG.md"))
    ]
  }));
  steps.push(await runNpmStep({
    name: "trial:intake",
    script: "trial:intake",
    args: [
      "--",
      "--roster", relative(rosterPath),
      "--json", relative(path.join(dryRunReportsPath, "TRIAL_TESTER_INTAKE_REPORT.json")),
      "--markdown", relative(path.join(dryRunReportsPath, "TRIAL_TESTER_INTAKE_REPORT.md"))
    ]
  }));
  steps.push(await runNpmStep({
    name: "trial:intake-session",
    script: "trial:intake-session",
    args: [
      "--",
      "--intake", relative(path.join(dryRunReportsPath, "TRIAL_TESTER_INTAKE_REPORT.json")),
      "--tester", testerId,
      "--out", relative(sessionPath),
      "--backlog", relative(path.join(dryRunReportsPath, "TRIAL_FIX_BACKLOG.json")),
      "--json", relative(path.join(dryRunReportsPath, "TRIAL_INTAKE_SESSION_REPORT.json")),
      "--markdown", relative(path.join(dryRunReportsPath, "TRIAL_INTAKE_SESSION_REPORT.md")),
      "--force"
    ]
  }));
  steps.push(await runNpmStep({
    name: "trial:host-ready",
    script: "trial:host-ready",
    args: [
      "--",
      "--tester", testerId,
      "--dispatch", relative(path.join(dryRunReportsPath, "TRIAL_DISPATCH_NOTE.json")),
      "--backlog", relative(path.join(dryRunReportsPath, "TRIAL_FIX_BACKLOG.json")),
      "--session", relative(path.join(sessionPath, "SESSION_PACK_MANIFEST.json")),
      "--json", relative(path.join(dryRunReportsPath, "TRIAL_HOST_READY_REPORT.json")),
      "--markdown", relative(path.join(dryRunReportsPath, "TRIAL_HOST_READY_REPORT.md"))
    ]
  }));
  steps.push(await runNpmStep({
    name: "trial:host-run",
    script: "trial:host-run",
    args: [
      "--",
      "--tester", testerId,
      "--session", relative(sessionPath),
      "--host-ready", relative(path.join(dryRunReportsPath, "TRIAL_HOST_READY_REPORT.json")),
      "--intake-session", relative(path.join(dryRunReportsPath, "TRIAL_INTAKE_SESSION_REPORT.json")),
      "--json", relative(path.join(dryRunReportsPath, "TRIAL_HOST_RUN_REPORT.json")),
      "--markdown", relative(path.join(dryRunReportsPath, "TRIAL_HOST_RUN_REPORT.md"))
    ]
  }));

  await writeCompletedSessionRecords(sessionPath, testerId);

  steps.push(await runNpmStep({
    name: "trial:complete-session",
    script: "trial:complete-session",
    args: [
      "--",
      "--session", relative(sessionPath),
      "--json", relative(path.join(dryRunReportsPath, "TRIAL_SESSION_COMPLETION_REPORT.json")),
      "--markdown", relative(path.join(dryRunReportsPath, "TRIAL_SESSION_COMPLETION_REPORT.md")),
      "--checklist", relative(path.join(sessionPath, "HOST_COMPLETION_CHECKLIST.md"))
    ]
  }));
  steps.push(await runNpmStep({
    name: "trial:post-session",
    script: "trial:post-session",
    args: ["--", "--session", relative(sessionPath), "--next-tester", nextTester, "--reports", relative(dryRunReportsPath)]
  }));
  steps.push(await runNpmStep({
    name: "trial:review-session",
    script: "trial:review-session",
    args: [
      "--",
      "--session", relative(sessionPath),
      "--reports", relative(dryRunReportsPath),
      "--tester", testerId,
      "--json", relative(path.join(dryRunReportsPath, "TRIAL_REVIEW_REPORT.json")),
      "--markdown", relative(path.join(dryRunReportsPath, "TRIAL_REVIEW_REPORT.md"))
    ]
  }));
  steps.push(await runNpmStep({
    name: "trial:status",
    script: "trial:status",
    args: [
      "--",
      "--dist", relative(dryRunReportsPath),
      "--json", relative(path.join(dryRunReportsPath, "TRIAL_STATUS_REPORT.json")),
      "--markdown", relative(path.join(dryRunReportsPath, "TRIAL_STATUS_REPORT.md"))
    ]
  }));

  report = await buildReport({ error: "" });
} catch (error) {
  report = await buildReport({ error: error.message });
}

await fs.mkdir(path.dirname(finalJsonPath), { recursive: true });
await fs.mkdir(path.dirname(finalMarkdownPath), { recursive: true });
await fs.writeFile(finalJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(finalMarkdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  testerId,
  runPath: report.runRelativePath,
  steps: report.steps.map((step) => ({ name: step.name, exitCode: step.exitCode })),
  reviewDecision: report.reviewDecision,
  statusDecision: report.statusDecision,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  jsonPath: finalJsonPath,
  markdownPath: finalMarkdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function buildReport({ error }) {
  const intake = await readJson(path.join(dryRunReportsPath, "TRIAL_TESTER_INTAKE_REPORT.json"));
  const intakeSession = await readJson(path.join(dryRunReportsPath, "TRIAL_INTAKE_SESSION_REPORT.json"));
  const hostReady = await readJson(path.join(dryRunReportsPath, "TRIAL_HOST_READY_REPORT.json"));
  const hostRun = await readJson(path.join(dryRunReportsPath, "TRIAL_HOST_RUN_REPORT.json"));
  const completion = await readJson(path.join(dryRunReportsPath, "TRIAL_SESSION_COMPLETION_REPORT.json"));
  const privacy = await readJson(path.join(dryRunReportsPath, "TRIAL_PRIVACY_REPORT.json"));
  const feedback = await readJson(path.join(dryRunReportsPath, "TRIAL_FEEDBACK_SUMMARY.json"));
  const backlog = await readJson(path.join(dryRunReportsPath, "TRIAL_FIX_BACKLOG.json"));
  const postSession = await readJson(path.join(dryRunReportsPath, "TRIAL_POST_SESSION_REPORT.json"));
  const review = await readJson(path.join(dryRunReportsPath, "TRIAL_REVIEW_REPORT.json"));
  const status = await readJson(path.join(dryRunReportsPath, "TRIAL_STATUS_REPORT.json"));
  const packageInspection = await inspectGeneratedPaths();
  const blockers = [];
  const warnings = [];

  if (error) blockers.push(error);
  for (const step of steps) {
    if (step.exitCode !== 0) blockers.push(`${step.name} failed with exit code ${step.exitCode}.`);
  }
  for (const [name, data] of Object.entries({ intake, intakeSession, hostReady, hostRun, completion, privacy, feedback, backlog, postSession, review, status })) {
    if (!data) blockers.push(`${name} report is missing.`);
    if (data?.ok === false) blockers.push(`${name} report is not ok.`);
  }
  if (intake?.decision !== "READY_FOR_SESSION") blockers.push(`Intake decision is ${intake?.decision || "MISSING"}.`);
  if (!["INTAKE_SESSION_READY", "INTAKE_SESSION_READY_WITH_REVIEW"].includes(intakeSession?.decision)) {
    blockers.push(`Intake-session decision is ${intakeSession?.decision || "MISSING"}.`);
  }
  if (hostReady?.decision !== "READY_TO_HOST") blockers.push(`Host-ready decision is ${hostReady?.decision || "MISSING"}.`);
  if (!["HOST_RUN_READY", "HOST_RUN_READY_WITH_REVIEW"].includes(hostRun?.decision)) {
    blockers.push(`Host-run decision is ${hostRun?.decision || "MISSING"}.`);
  }
  if (!["SESSION_COMPLETION_READY", "SESSION_COMPLETION_READY_WITH_REVIEW"].includes(completion?.decision)) {
    blockers.push(`Completion decision is ${completion?.decision || "MISSING"}.`);
  }
  if (privacy?.decision === "PRIVACY_HOLD") blockers.push("Privacy check is on hold.");
  if (postSession?.decision !== "READY_FOR_NEXT_TESTER") blockers.push(`Post-session decision is ${postSession?.decision || "MISSING"}.`);
  if (!["REVIEW_WATCH_NEXT_TESTER", "REVIEW_PROCEED"].includes(review?.decision)) {
    blockers.push(`Review decision is ${review?.decision || "MISSING"}.`);
  }
  if (status?.ok === false) blockers.push(`Status decision is blocked: ${status.decision || "MISSING"}.`);
  blockers.push(...packageInspection.blockers);
  warnings.push(...packageInspection.warnings);

  const decision = blockers.length ? "DRY_RUN_FAILED" : "DRY_RUN_READY_FOR_REAL_INTAKE";
  return {
    ok: blockers.length === 0,
    mode: "trial-intake-review-dry-run",
    createdAt: new Date().toISOString(),
    decision,
    testerId,
    nextTester,
    runPath,
    runRelativePath: relative(runPath),
    packagePath,
    packageRelativePath: relative(packagePath),
    rosterPath,
    rosterRelativePath: relative(rosterPath),
    sessionPath,
    sessionRelativePath: relative(sessionPath),
    finalJsonPath,
    finalMarkdownPath,
    finalJsonRelativePath: relative(finalJsonPath),
    finalMarkdownRelativePath: relative(finalMarkdownPath),
    intakeDecision: intake?.decision || "MISSING",
    intakeSessionDecision: intakeSession?.decision || "MISSING",
    hostReadyDecision: hostReady?.decision || "MISSING",
    hostRunDecision: hostRun?.decision || "MISSING",
    completionDecision: completion?.decision || "MISSING",
    privacyDecision: privacy?.decision || "MISSING",
    feedbackDecision: feedback?.decision || "MISSING",
    backlogDecision: backlog?.decision || "MISSING",
    postSessionDecision: postSession?.decision || "MISSING",
    reviewDecision: review?.decision || "MISSING",
    statusDecision: status?.decision || "MISSING",
    packageInspection,
    blockers: unique(blockers),
    warnings: unique(warnings),
    steps: steps.map(publicStep),
    artifacts: artifactLinks(),
    nextSteps: nextSteps(decision)
  };
}

async function writeAnonymousRoster(targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const roster = {
    localOnly: true,
    dryRun: true,
    testers: [{
      id: testerId,
      language: "zh-CN",
      hostLanguage: "zh-CN",
      consent: true,
      privacyAccepted: true,
      allowedScope: ["demo", "real-read-only"],
      projectPermission: "Anonymous dry-run fixture confirms only demo and read-only sample project scope.",
      status: "ready",
      notes: "Generated fixture. No real tester identity, contact data, company, account, or private project name."
    }]
  };
  await fs.writeFile(targetPath, `${JSON.stringify(roster, null, 2)}\n`, "utf8");
}

async function writeDispatchFixture(targetPackagePath) {
  const requiredDocs = dispatchRequiredDocs();
  const report = {
    ok: true,
    mode: "trial-dispatch",
    dryRunFixture: true,
    createdAt: new Date().toISOString(),
    decision: "READY_TO_SEND",
    packagePath: targetPackagePath,
    freezeReport: "",
    blockers: [],
    warnings: ["Dry-run dispatch fixture generated for anonymous intake-to-review rehearsal."],
    requiredDocs,
    missingPackageDocs: [],
    sendOrder: [
      "Use the anonymous dry-run package only for local rehearsal.",
      "Do not invite a real tester until trial:intake-review-dry-run passes.",
      "Run trial:intake with the real local-only roster after rehearsal."
    ],
    testerScope: [
      "Start with Demo.",
      "Run one real-project read-only preflight.",
      "Stop before Apply on a non-disposable real project."
    ]
  };
  await fs.mkdir(dryRunReportsPath, { recursive: true });
  await fs.writeFile(path.join(dryRunReportsPath, "TRIAL_DISPATCH_NOTE.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(dryRunReportsPath, "TRIAL_DISPATCH_NOTE.md"), renderDispatchMarkdown(report), "utf8");
}

async function writeCompletedSessionRecords(targetSessionPath, id) {
  await fs.writeFile(path.join(targetSessionPath, "HUMAN_TRIAL_OBSERVATION.md"), renderObservation(id), "utf8");
  await fs.writeFile(path.join(targetSessionPath, "TRIAL_FEEDBACK_TEMPLATE.md"), renderFeedback(id), "utf8");
  await fs.writeFile(path.join(targetSessionPath, "TRIAL_RESULT_RECORD.md"), renderResult(id), "utf8");
}

async function inspectGeneratedPaths() {
  const blockers = [];
  const warnings = [];
  const packageRoster = path.join(packagePath, ".codeclaw", "trial-intake", "TESTER_ROSTER.json");
  const packageDistDryRun = path.join(packagePath, "dist", "trial-dry-runs");
  const packageGit = path.join(packagePath, ".git");
  const packageDist = path.join(packagePath, "dist");

  if (!(await exists(rosterPath))) blockers.push("Dry-run roster was not generated.");
  if (!isInside(rosterPath, runPath)) blockers.push("Dry-run roster is not inside the dry-run output folder.");
  if (!(await exists(packagePath))) blockers.push("Dry-run local trial package was not generated.");
  if (await exists(packageRoster)) blockers.push("Local trial package contains a tester roster.");
  if (await exists(packageDistDryRun)) blockers.push("Local trial package contains dry-run generated artifacts.");
  if (await exists(packageGit)) blockers.push("Local trial package contains .git.");
  if (await exists(packageDist)) warnings.push("Local trial package contains dist; confirm package exclusion rules.");
  if (isInside(runPath, path.join(rootPath, ".codeclaw"))) blockers.push("Dry-run output is inside .codeclaw.");
  return {
    blockers,
    warnings,
    dryRunOutputIgnored: isInside(runPath, distPath),
    packageRosterRelativePath: relative(packageRoster),
    packageContainsRoster: await exists(packageRoster),
    packageContainsDistDryRun: await exists(packageDistDryRun)
  };
}

function runNpmStep({ name, script, args }) {
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
      resolve({
        name,
        script,
        commandLine,
        exitCode,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        summary: parseJsonOutput(stdout)
      });
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

function renderObservation(id) {
  return [
    "# CodeClaw Human Trial Observation Checklist",
    "",
    "## Friction Watchlist",
    "",
    "| Moment | Observe | Result | Notes |",
    "| --- | --- | --- | --- |",
    "| Startup | Can they tell whether CodeClaw is running? | Pass | Dry-run launch path was clear. |",
    "| Language | Do they find the language switcher if needed? | Pass | zh-CN selected for rehearsal. |",
    "| Demo vs real project | Do they understand which mode they are in? | Friction | Tester hesitated before noticing mode label. |",
    "| Path entry | Do they paste a folder, not a file? | Pass | Demo folder used. |",
    "| Path error | Can they recover from empty/file/missing path? | Pass | Recovery copy was understandable. |",
    "| Read-only preflight | Do they understand no writes happened? | Pass | Host confirmed read-only boundary. |",
    "| Patch gate | Do blockers/warnings make sense? | Pass | Patch gate was visible. |",
    "| Apply review | Do changed files and risks feel inspectable? | Pass | Dry-run stopped before real apply. |",
    "| Apply confirm | Do they understand this is the write boundary? | Pass | Tester explained the boundary. |",
    "| Verify confirm | Do they understand commands may run project scripts? | Pass | Tester explained command approval. |",
    "| Audit | Can they find what happened afterward? | Pass | Audit trail was found after the flow. |",
    "",
    "## Host Summary",
    "",
    "- Biggest friction: Demo vs real project mode label was not noticed immediately.",
    "- Biggest trust concern: None.",
    "- First point where host helped: Pointed out the mode label near path controls.",
    "- Recommended product fix: Make the mode cue more prominent near the path controls.",
    "- Safe to continue to the next tester: Yes",
    "",
    `- Tester: ${id}`,
    "- Host: codeclaw-host",
    ""
  ].join("\n");
}

function renderFeedback(id) {
  return [
    "# CodeClaw Trial Feedback Template",
    "",
    "## Tester",
    "",
    `- Name: ${id}`,
    "- Date: 2026-07-09",
    "- OS: Windows 11",
    "- Node version: 22",
    "- CodeClaw package/version: CodeClaw-local-trial-dry-run",
    "- Trial host: codeclaw-host",
    "- Observed live: Yes",
    "",
    "## Trial Scope",
    "",
    "- Trial type: Demo / real read-only preflight",
    "- Project type: JavaScript app",
    "- Project size: Small",
    "- Model used: Mock",
    "- Goal: understand a small UI task safely",
    "- Started from: start-codeclaw.cmd",
    "- First stuck step: finding the difference between Demo mode and real project mode",
    "",
    "## Startup",
    "",
    "| Check | Result | Notes |",
    "| --- | --- | --- |",
    "| `start-codeclaw.cmd` worked | Yes | Launcher path was visible. |",
    "| Browser opened automatically | Yes | Browser tab opened. |",
    "| Error messages were understandable | N/A | No startup error occurred. |",
    "| Port issue occurred | No | No port conflict. |",
    "",
    "## First-run UX",
    "",
    "| Check | Result | Notes |",
    "| --- | --- | --- |",
    "| Quick Start made the next step clear | Yes | Guide was enough. |",
    "| Task Guide was understandable | Yes | Task language was clear. |",
    "| Demo path was easy to find | Yes | Demo button helped. |",
    "| Demo vs real project mode was clear | No | Tester hesitated before reading the mode label. |",
    "| UI language was clear | Yes | zh-CN was understandable. |",
    "",
    "## Preflight",
    "",
    "| Check | Result | Notes |",
    "| --- | --- | --- |",
    "| Preflight completed | Yes | Completed in dry-run. |",
    "| No writes occurred | Yes | Read-only flow confirmed. |",
    "| Context files looked relevant | Yes | Context was plausible. |",
    "| Warnings/blockers were understandable | Yes | Gate copy was understandable. |",
    "| Patch gate felt trustworthy | Yes | Review boundary was visible. |",
    "",
    "## Trust And Safety",
    "",
    "- Did you understand when CodeClaw would read files? Yes.",
    "- Did you understand when CodeClaw would write files? Yes, after Apply confirmation.",
    "- Did any action feel surprising or risky? No.",
    "- Did the audit trail help? Yes.",
    "",
    "## Issues",
    "",
    "1. Mode label was useful, but the tester noticed it only after host prompted them to look near the path field.",
    "",
    "## Overall",
    "",
    "- Would you use CodeClaw again on a real project? Maybe",
    "- Would you try one disposable patch next? Yes",
    "- What would need to improve first? Make Demo vs real mode more visually obvious.",
    "- Most useful part: Read-only preflight.",
    "- Most confusing part: Path mode.",
    "- Suggested next feature: Stronger first-run mode cue.",
    "",
    "## Host Notes",
    "",
    "- Main observed friction: Demo vs real project mode.",
    "- Main trust concern: None.",
    "- Did the tester need help? Yes",
    "- Should this build continue to the next tester? Yes",
    ""
  ].join("\n");
}

function renderResult(id) {
  return [
    "# CodeClaw Hosted Trial Result Record",
    "",
    "## Session",
    "",
    `- Tester: ${id}`,
    "- Date: 2026-07-09",
    "- Package: CodeClaw-local-trial-dry-run",
    "- Host: codeclaw-host",
    "- Trial length: 25 minutes",
    "- Trial scope: Demo / real read-only preflight",
    "- Decision after trial: Continue",
    "",
    "## Outcomes",
    "",
    "| Outcome | Result | Evidence |",
    "| --- | --- | --- |",
    "| App launched | Pass | Started from launcher. |",
    "| Demo reached patch proposal or patch gate | Pass | Patch gate visible. |",
    "| Tester understood Demo vs real project mode | Friction | Needed one hint. |",
    "| Real-project read-only preflight completed | Pass | No write tools used. |",
    "| No unexpected writes occurred | Pass | Audit showed read-only flow. |",
    "| Tester understood Apply writes files | Pass | Tester explained before continuing. |",
    "| Tester understood Verify may run commands | Pass | Tester explained before continuing. |",
    "| Feedback template completed | Pass | Template completed after session. |",
    "",
    "## Friction",
    "",
    "- First stuck moment: Demo vs real project mode.",
    "- Exact tester quote: I am not sure if this is still the demo folder.",
    "- Host intervention needed: Yes",
    "- Time lost: 20 seconds",
    "- Severity: Medium",
    "",
    "## Trust",
    "",
    "- Strongest trust-building moment: Read-only preflight and Apply confirmation.",
    "- Strongest trust concern: None.",
    "- Did the tester feel safe trying read-only preflight on a real project? Yes",
    "- Did the tester feel safe trying a disposable patch next? Maybe",
    "",
    "## Bugs Or Product Fixes",
    "",
    "1. Make Demo vs real project mode more visually obvious near the path controls.",
    "",
    "## Go/No-Go For The Next Tester",
    "",
    "- Proceed to the next tester: Yes",
    "- Required fix before the next tester: None.",
    "- Owner: Product",
    "- Notes: Watch for repeated mode confusion.",
    ""
  ].join("\n");
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial Intake-To-Review Dry Run",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Tester: ${report.testerId}`,
    `Run folder: ${report.runRelativePath}`,
    `Session folder: ${report.sessionRelativePath}`,
    "",
    "## Decisions",
    "",
    `- Intake: ${report.intakeDecision}`,
    `- Intake session: ${report.intakeSessionDecision}`,
    `- Host ready: ${report.hostReadyDecision}`,
    `- Host run: ${report.hostRunDecision}`,
    `- Completion: ${report.completionDecision}`,
    `- Privacy: ${report.privacyDecision}`,
    `- Feedback: ${report.feedbackDecision}`,
    `- Backlog: ${report.backlogDecision}`,
    `- Post-session: ${report.postSessionDecision}`,
    `- Review: ${report.reviewDecision}`,
    `- Status: ${report.statusDecision}`,
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
    "## Artifact Hygiene",
    "",
    `- Dry-run output ignored: ${report.packageInspection.dryRunOutputIgnored ? "Yes" : "No"}`,
    `- Package contains tester roster: ${report.packageInspection.packageContainsRoster ? "Yes" : "No"}`,
    `- Package contains dry-run artifacts: ${report.packageInspection.packageContainsDistDryRun ? "Yes" : "No"}`,
    "",
    "## Artifacts",
    "",
    ...Object.entries(report.artifacts).map(([key, value]) => `- ${key}: ${value || "n/a"}`),
    "",
    "## Next Steps",
    "",
    ...report.nextSteps.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function renderDispatchMarkdown(report) {
  return [
    "# CodeClaw Trial Dispatch Note",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Package: ${report.packagePath}`,
    "",
    "## Dry Run",
    "",
    "- This dispatch note was generated for anonymous intake-to-review rehearsal.",
    "- It must not be sent to a real tester as-is.",
    "",
    "## Required Package Docs",
    "",
    ...report.requiredDocs.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function artifactLinks() {
  return {
    dryRunReport: relative(finalMarkdownPath),
    roster: relative(rosterPath),
    intakeReport: relative(path.join(dryRunReportsPath, "TRIAL_TESTER_INTAKE_REPORT.md")),
    intakeSessionReport: relative(path.join(dryRunReportsPath, "TRIAL_INTAKE_SESSION_REPORT.md")),
    hostRunReport: relative(path.join(dryRunReportsPath, "TRIAL_HOST_RUN_REPORT.md")),
    completionReport: relative(path.join(dryRunReportsPath, "TRIAL_SESSION_COMPLETION_REPORT.md")),
    postSessionReport: relative(path.join(dryRunReportsPath, "TRIAL_POST_SESSION_REPORT.md")),
    reviewReport: relative(path.join(dryRunReportsPath, "TRIAL_REVIEW_REPORT.md")),
    statusReport: relative(path.join(dryRunReportsPath, "TRIAL_STATUS_REPORT.md"))
  };
}

function nextSteps(decision) {
  if (decision !== "DRY_RUN_READY_FOR_REAL_INTAKE") {
    return [
      "Open dist/TRIAL_INTAKE_REVIEW_DRY_RUN_REPORT.md.",
      "Fix the first failed step or blocker.",
      "Rerun npm.cmd run trial:intake-review-dry-run -- --force."
    ];
  }
  return [
    "Fill the real local-only roster in .codeclaw/trial-intake/TESTER_ROSTER.json.",
    "Run npm.cmd run trial:intake.",
    "Run npm.cmd run trial:intake-session -- --force for the first real tester."
  ];
}

function dispatchRequiredDocs() {
  return [
    "docs/START_GUIDE.md",
    "docs/TRIAL_INVITE_MESSAGE.md",
    "docs/TRIAL_HOST_BRIEF.md",
    "docs/TRIAL_GO_NO_GO.md",
    "docs/TRIAL_5_MIN_PRECHECK.md",
    "docs/HUMAN_TRIAL_OBSERVATION.md",
    "docs/TRIAL_FEEDBACK_TEMPLATE.md",
    "docs/TRIAL_FEEDBACK_INGEST.md",
    "docs/TRIAL_FIX_BACKLOG.md",
    "docs/TRIAL_SESSION_PACK.md",
    "docs/TRIAL_HOST_READY.md",
    "docs/TRIAL_POST_SESSION.md",
    "docs/TRIAL_PRIVACY_CHECK.md",
    "docs/TRIAL_COHORT_SUMMARY.md",
    "docs/TRIAL_ARCHIVE_SESSION.md",
    "docs/TRIAL_STATUS.md",
    "docs/TRIAL_TESTER_INTAKE.md",
    "docs/TRIAL_INTAKE_SESSION.md",
    "docs/TRIAL_HOST_RUN.md",
    "docs/TRIAL_SESSION_COMPLETION.md",
    "docs/TRIAL_SESSION_REVIEW.md",
    "docs/TRIAL_INTAKE_REVIEW_DRY_RUN.md",
    "docs/TRIAL_PRE_LIVE.md",
    "docs/TRIAL_LIVE_CAPTURE.md",
    "docs/TRIAL_AFTER_LIVE.md",
    "docs/TRIAL_RESULT_RECORD.md"
  ];
}

function parseArgs(rawArgs) {
  const parsed = { out: "", json: "", markdown: "", tester: "", runId: "", force: false };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    let handled = false;
    for (const key of ["out", "json", "markdown", "tester", "runId"]) {
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

async function assertSafeOutputPath(candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Dry-run output must stay inside the CodeClaw project root.");
  }
  if (!isInside(candidatePath, distPath)) {
    throw new Error("Dry-run output must stay inside ignored dist/.");
  }
  if (isInside(candidatePath, path.join(rootPath, ".codeclaw"))) {
    throw new Error("Dry-run output cannot be inside .codeclaw.");
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

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function sanitizeTesterId(value) {
  const cleaned = String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "tester-dry-run-1";
}

function nextTesterId(value) {
  const match = String(value || "").match(/^(.*?)(\d+)$/);
  if (!match) return `${sanitizeTesterId(value)}-next`;
  return `${match[1]}${Number(match[2]) + 1}`;
}

function dateStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function quoteShellArg(value) {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value;
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function relative(targetPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
}

function isInside(candidatePath, allowedRoot) {
  const relativePath = path.relative(allowedRoot, candidatePath);
  return !relativePath || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
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
