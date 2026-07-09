import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const distPath = path.join(rootPath, "dist");
const args = parseArgs(process.argv.slice(2));
const intakePath = path.resolve(rootPath, args.intake || path.join("dist", "TRIAL_TESTER_INTAKE_REPORT.json"));
const testerIdOverride = args.tester ? sanitizeTesterId(args.tester) : "";
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_INTAKE_SESSION_REPORT.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_INTAKE_SESSION_REPORT.md"));

const report = await buildReport();

await fs.mkdir(distPath, { recursive: true });
await fs.mkdir(path.dirname(jsonPath), { recursive: true });
await fs.mkdir(path.dirname(markdownPath), { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  testerId: report.testerId,
  sessionFolder: report.sessionRelativePath,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  jsonPath,
  markdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function buildReport() {
  const intake = await readJson(intakePath);
  const blockers = [];
  const warnings = [];

  if (!intake) blockers.push("Tester intake report is missing. Run npm.cmd run trial:intake first.");
  if (intake && intake.ok === false) blockers.push("Tester intake report is not ok.");
  if (intake && !["READY_FOR_SESSION", "READY_FOR_SESSION_WITH_REVIEW"].includes(intake.decision)) {
    blockers.push(`Tester intake decision is ${intake.decision || "UNKNOWN"}.`);
  }

  const tester = intake ? selectTester(intake, testerIdOverride) : null;
  if (intake && testerIdOverride && !tester) blockers.push(`Tester ${testerIdOverride} was not found in the intake report.`);
  if (intake && !testerIdOverride && !tester) blockers.push("No ready tester was found in the intake report.");
  if (tester && tester.blocked) blockers.push(`${tester.id}: tester intake is blocked.`);
  if (tester && !tester.ready) blockers.push(`${tester.id}: tester is not marked ready.`);
  if (tester?.needsReview || intake?.decision === "READY_FOR_SESSION_WITH_REVIEW") {
    warnings.push("Tester intake requires host review before the session.");
  }

  if (blockers.length) {
    return payload({
      ok: false,
      decision: "INTAKE_SESSION_HOLD",
      tester,
      blockers,
      warnings,
      sessionFolder: "",
      sessionManifest: null,
      sessionStep: null
    });
  }

  const testerId = tester.id;
  const sessionFolder = path.resolve(rootPath, args.out || path.join("dist", "trial-session-packs", testerId));
  const sessionArgs = ["scripts/generate-trial-session-pack.js", "--tester", testerId];
  if (args.out) sessionArgs.push("--out", args.out);
  if (args.backlog) sessionArgs.push("--backlog", args.backlog);
  if (args.force) sessionArgs.push("--force");

  const sessionStep = await runNodeStep(sessionArgs);
  if (sessionStep.exitCode !== 0) {
    return payload({
      ok: false,
      decision: "INTAKE_SESSION_FAILED",
      tester,
      blockers: [`trial:session-pack failed with exit code ${sessionStep.exitCode}.`],
      warnings,
      sessionFolder,
      sessionManifest: null,
      sessionStep
    });
  }

  await enrichSessionPack({ sessionFolder, tester, intake });
  const sessionManifest = await readJson(path.join(sessionFolder, "SESSION_PACK_MANIFEST.json"));
  return payload({
    ok: true,
    decision: warnings.length ? "INTAKE_SESSION_READY_WITH_REVIEW" : "INTAKE_SESSION_READY",
    tester,
    blockers,
    warnings,
    sessionFolder,
    sessionManifest,
    sessionStep
  });
}

function selectTester(intake, testerId) {
  const testers = Array.isArray(intake.testers) ? intake.testers : [];
  if (testerId) return testers.find((tester) => tester.id === testerId) || null;
  return intake.nextTester || testers.find((tester) => tester.ready) || null;
}

async function enrichSessionPack({ sessionFolder, tester, intake }) {
  const briefPath = path.join(sessionFolder, "SESSION_BRIEF.md");
  const manifestPath = path.join(sessionFolder, "SESSION_PACK_MANIFEST.json");
  const brief = await fs.readFile(briefPath, "utf8");
  await fs.writeFile(briefPath, `${renderIntakeBrief(tester, intake)}\n---\n\n${brief}`, "utf8");

  const manifest = await readJson(manifestPath);
  const nextManifest = {
    ...manifest,
    intakeDecision: intake.decision || "UNKNOWN",
    intakeReportPath: intakePath,
    intakeReportRelativePath: relative(intakePath),
    testerIntake: {
      id: tester.id,
      language: tester.language,
      hostLanguage: tester.hostLanguage,
      allowedScope: tester.allowedScope,
      consent: tester.consent,
      privacyAccepted: tester.privacyAccepted,
      projectPermission: tester.projectPermission,
      needsReview: tester.needsReview
    }
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");
}

function renderIntakeBrief(tester, intake) {
  return [
    "# Tester Intake",
    "",
    `Intake decision: ${intake.decision || "UNKNOWN"}`,
    `Tester id: ${tester.id}`,
    `Tester language: ${tester.language || "UNKNOWN"}`,
    `Host language: ${tester.hostLanguage || tester.language || "UNKNOWN"}`,
    `Allowed scope: ${(tester.allowedScope || []).join(", ") || "UNKNOWN"}`,
    `Consent recorded: ${tester.consent ? "Yes" : "No"}`,
    `Privacy accepted: ${tester.privacyAccepted ? "Yes" : "No"}`,
    `Project permission: ${tester.projectPermission ? "Recorded" : "Not recorded"}`,
    `Host review required: ${tester.needsReview ? "Yes" : "No"}`,
    "",
    "- Keep the roster local-only.",
    "- Do not ask for API keys.",
    "- Start with Demo.",
    "- Run real project mode only as read-only preflight unless the host explicitly stops earlier.",
    ""
  ].join("\n");
}

function payload({ ok, decision, tester, blockers, warnings, sessionFolder, sessionManifest, sessionStep }) {
  return {
    ok,
    mode: "trial-intake-session",
    createdAt: new Date().toISOString(),
    decision,
    intakePath,
    intakeRelativePath: relative(intakePath),
    testerId: tester?.id || testerIdOverride || "",
    tester: tester ? {
      id: tester.id,
      language: tester.language,
      hostLanguage: tester.hostLanguage,
      allowedScope: tester.allowedScope || [],
      needsReview: Boolean(tester.needsReview)
    } : null,
    sessionFolder,
    sessionRelativePath: sessionFolder ? relative(sessionFolder) : "",
    sessionManifest: sessionManifest ? {
      ok: sessionManifest.ok,
      testerId: sessionManifest.testerId,
      outputRelativePath: sessionManifest.outputRelativePath,
      backlogDecision: sessionManifest.backlogDecision,
      intakeDecision: sessionManifest.intakeDecision || ""
    } : null,
    blockers,
    warnings,
    sessionStep: sessionStep ? {
      exitCode: sessionStep.exitCode,
      command: sessionStep.command,
      durationMs: sessionStep.durationMs
    } : null,
    nextCommands: sessionFolder ? [
      `npm.cmd run trial:host-ready -- --tester ${tester?.id || testerIdOverride}`,
      "npm.cmd run trial:status"
    ] : [
      "npm.cmd run trial:intake",
      "npm.cmd run trial:intake-session -- --force"
    ],
    nextSteps: nextSteps(decision)
  };
}

function nextSteps(decision) {
  if (decision === "INTAKE_SESSION_HOLD") {
    return [
      "Fix tester intake blockers.",
      "Rerun npm.cmd run trial:intake.",
      "Rerun npm.cmd run trial:intake-session -- --force."
    ];
  }
  if (decision === "INTAKE_SESSION_FAILED") {
    return [
      "Fix the session-pack failure.",
      "Rerun npm.cmd run trial:intake-session -- --force."
    ];
  }
  if (decision === "INTAKE_SESSION_READY_WITH_REVIEW") {
    return [
      "Host must accept intake warnings before the call.",
      "Run trial:host-ready for this tester.",
      "Rerun trial:status before hosting."
    ];
  }
  return [
    "Run trial:host-ready for this tester.",
    "Rerun trial:status before hosting.",
    "Use the generated SESSION_BRIEF.md during the session."
  ];
}

function runNodeStep(commandArgs) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const command = [process.execPath, ...commandArgs].map(quoteShellArg).join(" ");
    const child = spawn(command, {
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
        command,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt
      });
    });
  });
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial Intake Session Report",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Tester: ${report.testerId || "None"}`,
    `Intake: ${report.intakeRelativePath}`,
    `Session folder: ${report.sessionRelativePath || "None"}`,
    "",
    "## Blockers",
    "",
    ...(report.blockers.length ? report.blockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Tester",
    "",
    ...(report.tester ? [
      `- Language: ${report.tester.language}`,
      `- Host language: ${report.tester.hostLanguage}`,
      `- Scope: ${report.tester.allowedScope.join(", ")}`,
      `- Needs review: ${report.tester.needsReview ? "Yes" : "No"}`
    ] : ["- None"]),
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

function parseArgs(rawArgs) {
  const parsed = { intake: "", tester: "", out: "", backlog: "", json: "", markdown: "", force: false };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    let handled = false;
    for (const key of ["intake", "tester", "out", "backlog", "json", "markdown"]) {
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
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function quoteShellArg(value) {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value;
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function sanitizeTesterId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function relative(targetPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}
