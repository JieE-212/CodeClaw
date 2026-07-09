import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const reportPath = path.join(rootPath, "dist", "TRIAL_READINESS_REPORT.json");

const sourceChecks = [
  { name: "source:health", command: npmCommand, args: ["run", "health"], cwd: rootPath },
  { name: "source:check", command: npmCommand, args: ["run", "check"], cwd: rootPath },
  { name: "source:test", command: npmCommand, args: ["test"], cwd: rootPath }
];

const packageChecks = [
  { name: "package:check", command: npmCommand, args: ["run", "check"] },
  { name: "package:health", command: npmCommand, args: ["run", "health"] },
  { name: "package:test", command: npmCommand, args: ["test"] }
];

const requiredPackageEntries = [
  "apps",
  "docs",
  "docs/HUMAN_TRIAL_OBSERVATION.md",
  "docs/START_GUIDE.md",
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
  "docs/TRIAL_HOST_BRIEF.md",
  "docs/TRIAL_GO_NO_GO.md",
  "docs/TRIAL_5_MIN_PRECHECK.md",
  "docs/TRIAL_RESULT_RECORD.md",
  "docs/TRIAL_INVITE_MESSAGE.md",
  "examples",
  "packages",
  "scripts",
  "tests",
  ".gitignore",
  "package.json",
  "README.md",
  "PACKAGE_MANIFEST.md",
  "run-nightly-trial.cmd",
  "start-codeclaw.cmd",
  "start-codeclaw.ps1"
];

try {
  const sourceResults = [];
  for (const check of sourceChecks) {
    sourceResults.push(await runStep(check));
  }

  const packageResult = await runStep({
    name: "package:create",
    command: process.execPath,
    args: ["scripts/prepare-local-trial.js", "--force"],
    cwd: rootPath
  });
  const packagePayload = parseJsonOutput(packageResult.stdout);
  const packagePath = packagePayload.outputPath;
  if (!packagePath) throw new Error("Package script did not report outputPath.");

  const hygiene = await inspectPackage(packagePath);
  if (hygiene.missingRequired.length > 0 || hygiene.disallowed.length > 0) {
    throw new Error("Package hygiene check failed.");
  }

  const packageResults = [];
  for (const check of packageChecks) {
    packageResults.push(await runStep({ ...check, cwd: packagePath }));
  }

  const report = {
    ok: true,
    mode: "trial-readiness",
    createdAt: new Date().toISOString(),
    sourceRoot: rootPath,
    packagePath,
    checks: [...sourceResults, packageResult, ...packageResults].map(publicStepResult),
    hygiene,
    nextSteps: [
      "Zip or share the package folder.",
      "Ask testers to start with docs/START_GUIDE.md.",
      "Use docs/TRIAL_HOST_BRIEF.md and docs/TRIAL_GO_NO_GO.md before the hosted session.",
      "Use docs/TRIAL_5_MIN_PRECHECK.md immediately before starting.",
      "Use docs/HUMAN_TRIAL_OBSERVATION.md during hosted first trials.",
      "Ask testers to fill docs/TRIAL_FEEDBACK_TEMPLATE.md.",
      "Fill docs/TRIAL_RESULT_RECORD.md before inviting tester 2.",
      "Stop before writes if preflight reports blockers or context looks wrong."
    ]
  };
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    reportPath,
    packagePath,
    checks: report.checks.map((check) => ({ name: check.name, exitCode: check.exitCode })),
    hygiene: {
      missingRequired: hygiene.missingRequired.length,
      disallowed: hygiene.disallowed.length,
      files: hygiene.files
    }
  }, null, 2));
} catch (error) {
  const report = {
    ok: false,
    mode: "trial-readiness",
    createdAt: new Date().toISOString(),
    sourceRoot: rootPath,
    error: error.message
  };
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(error.message);
  process.exitCode = 1;
}

function runStep({ name, command, args, cwd }) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const commandLine = [command, ...args].map(quoteShellArg).join(" ");
    console.log(`\n==> ${name}: ${commandLine}`);
    const child = spawn(commandLine, {
      cwd,
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
      const durationMs = Date.now() - startedAt;
      const result = { name, command, args, commandLine, cwd, exitCode, durationMs, stdout, stderr };
      if (exitCode !== 0) {
        reject(new Error(`${name} failed with exit code ${exitCode}.`));
        return;
      }
      resolve(result);
    });
  });
}

async function inspectPackage(packagePath) {
  const missingRequired = [];
  for (const entry of requiredPackageEntries) {
    if (!(await exists(path.join(packagePath, entry)))) missingRequired.push(entry);
  }
  const disallowed = [];
  let files = 0;
  await walk(packagePath, async (entryPath, dirent) => {
    const name = dirent.name;
    if (isDisallowedName(name)) disallowed.push(path.relative(packagePath, entryPath).split(path.sep).join("/"));
    if (dirent.isFile()) files += 1;
  });
  return { packagePath, missingRequired, disallowed, files };
}

async function walk(directory, visitor) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    await visitor(entryPath, entry);
    if (entry.isDirectory()) await walk(entryPath, visitor);
  }
}

function isDisallowedName(name) {
  return [
    ".git",
    ".codeclaw",
    "node_modules",
    "coverage",
    "dist",
    "build",
    "trial-feedback",
    "trial-session-packs",
    "trial-privacy-risk",
    "server-bg.log"
  ].includes(name) || name === ".env" || name.startsWith(".env.") || name.endsWith(".local") || name.endsWith(".log");
}

function parseJsonOutput(output) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Could not parse JSON from package output.");
  }
  return JSON.parse(output.slice(start, end + 1));
}

function publicStepResult(result) {
  return {
    name: result.name,
    command: result.commandLine,
    cwd: result.cwd,
    exitCode: result.exitCode,
    durationMs: result.durationMs
  };
}

function quoteShellArg(value) {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
