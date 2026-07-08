import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const args = parseArgs(process.argv.slice(2));
const runId = timestampForPath(new Date());
const reportDir = path.resolve(args.outDir || path.join(rootPath, "dist", "nightly-trial", runId));
const startedAt = Date.now();
const durationMs = Math.max(1, args.minutes * 60_000);
const deadline = startedAt + durationMs;
const commandPlan = args.commands.map(commandFromName);
const results = [];

await fs.mkdir(reportDir, { recursive: true });

console.log(JSON.stringify({
  ok: true,
  mode: "nightly-trial",
  runId,
  reportDir,
  durationMinutes: args.minutes,
  intervalMinutes: args.intervalMinutes,
  readyEvery: args.readyEvery,
  commands: args.commands,
  realRepo: args.realRepo || rootPath,
  finalReady: !args.skipFinalReady
}, null, 2));

let cycle = 0;
let interrupted = false;
process.on("SIGINT", () => {
  interrupted = true;
});

while (!interrupted && Date.now() < deadline) {
  cycle += 1;
  console.log(`\n=== Nightly trial cycle ${cycle} ===`);
  for (const command of commandPlan) {
    results.push(await runStep({ ...command, cycle }));
    if (!results.at(-1).ok) break;
  }

  if (args.readyEvery > 0 && cycle % args.readyEvery === 0 && Date.now() < deadline) {
    results.push(await runStep({ ...commandFromName("trial:ready"), cycle }));
  }

  if (results.some((result) => !result.ok)) break;

  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) break;
  const waitMs = Math.min(args.intervalMinutes * 60_000, remainingMs);
  if (waitMs > 0) {
    console.log(`Waiting ${Math.round(waitMs / 1000)}s before next cycle...`);
    await sleep(waitMs);
  }
}

if (!args.skipFinalReady && !results.some((result) => !result.ok)) {
  results.push(await runStep({ ...commandFromName("trial:ready"), cycle: cycle + 1, final: true }));
}

const finishedAt = Date.now();
const summary = {
  ok: results.length > 0 && results.every((result) => result.ok),
  mode: "nightly-trial",
  runId,
  startedAt: new Date(startedAt).toISOString(),
  finishedAt: new Date(finishedAt).toISOString(),
  durationMs: finishedAt - startedAt,
  requestedDurationMinutes: args.minutes,
  reportDir,
  interrupted,
  cycles: cycle,
  results,
  counts: {
    total: results.length,
    passed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length
  },
  nextSteps: nextSteps(results)
};

await fs.writeFile(path.join(reportDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(reportDir, "summary.md"), renderMarkdown(summary), "utf8");

console.log(JSON.stringify({
  ok: summary.ok,
  reportDir,
  summaryJson: path.join(reportDir, "summary.json"),
  summaryMarkdown: path.join(reportDir, "summary.md"),
  cycles: summary.cycles,
  counts: summary.counts
}, null, 2));

if (!summary.ok) process.exitCode = 1;

async function runStep(step) {
  const name = `${step.final ? "final:" : ""}cycle-${step.cycle}:${step.name}`;
  const started = Date.now();
  const logBase = safeFileName(name);
  const stdoutPath = path.join(reportDir, `${logBase}.out.log`);
  const stderrPath = path.join(reportDir, `${logBase}.err.log`);
  const commandLine = [step.command, ...step.args].map(quoteShellArg).join(" ");
  console.log(`\n==> ${name}: ${commandLine}`);

  const stdoutChunks = [];
  const stderrChunks = [];
  const child = spawn(commandLine, {
    cwd: rootPath,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    windowsHide: true
  });

  child.stdout.on("data", (chunk) => {
    stdoutChunks.push(chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderrChunks.push(chunk);
    process.stderr.write(chunk);
  });

  const exitCode = await new Promise((resolve) => {
    child.on("error", () => resolve(-1));
    child.on("close", resolve);
  });

  const stdout = Buffer.concat(stdoutChunks).toString("utf8");
  const stderr = Buffer.concat(stderrChunks).toString("utf8");
  await fs.writeFile(stdoutPath, stdout, "utf8");
  await fs.writeFile(stderrPath, stderr, "utf8");

  return {
    ok: exitCode === 0,
    name: step.name,
    cycle: step.cycle,
    final: Boolean(step.final),
    command: commandLine,
    exitCode,
    durationMs: Date.now() - started,
    stdoutPath,
    stderrPath,
    tail: tailLines(stdout || stderr, 20)
  };
}

function commandFromName(name) {
  if (name === "check") return { name, command: npmCommand, args: ["run", "check"] };
  if (name === "test") return { name, command: npmCommand, args: ["test"] };
  if (name === "health") return { name, command: npmCommand, args: ["run", "health"] };
  if (name === "trial:ready") return { name, command: npmCommand, args: ["run", "trial:ready"] };
  if (name === "trial:simulate") {
    const command = { name, command: npmCommand, args: ["run", "trial:simulate"] };
    if (args.realRepo) command.args.push("--", "--real-repo", args.realRepo);
    return command;
  }
  throw new Error(`Unknown nightly command: ${name}`);
}

function parseArgs(rawArgs) {
  const parsed = {
    minutes: 150,
    intervalMinutes: 10,
    readyEvery: 3,
    commands: ["check", "test", "health", "trial:simulate"],
    realRepo: "",
    outDir: "",
    skipFinalReady: false
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--hours") {
      parsed.minutes = Number(rawArgs[index + 1]) * 60;
      index += 1;
      continue;
    }
    if (arg === "--minutes") {
      parsed.minutes = Number(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--interval-minutes") {
      parsed.intervalMinutes = Number(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--ready-every") {
      parsed.readyEvery = Number(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--commands") {
      parsed.commands = String(rawArgs[index + 1] || "").split(",").map((item) => item.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === "--real-repo") {
      parsed.realRepo = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "--out-dir") {
      parsed.outDir = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "--skip-final-ready") {
      parsed.skipFinalReady = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(parsed.minutes) || parsed.minutes <= 0) throw new Error("--minutes/--hours must be positive.");
  if (!Number.isFinite(parsed.intervalMinutes) || parsed.intervalMinutes < 0) throw new Error("--interval-minutes must be zero or positive.");
  if (!Number.isFinite(parsed.readyEvery) || parsed.readyEvery < 0) throw new Error("--ready-every must be zero or positive.");
  if (!parsed.commands.length) throw new Error("--commands cannot be empty.");
  return parsed;
}

function renderMarkdown(summary) {
  return [
    "# Nightly Trial Summary",
    "",
    `Run ID: ${summary.runId}`,
    `Overall: ${summary.ok ? "Pass" : "Fail"}`,
    `Started: ${summary.startedAt}`,
    `Finished: ${summary.finishedAt}`,
    `Cycles: ${summary.cycles}`,
    `Checks: ${summary.counts.passed}/${summary.counts.total} passed`,
    "",
    "## Results",
    "",
    "| Cycle | Step | Result | Duration | Logs |",
    "| --- | --- | --- | --- | --- |",
    ...summary.results.map((result) => `| ${result.final ? "final" : result.cycle} | ${result.name} | ${result.ok ? "Pass" : "Fail"} | ${Math.round(result.durationMs / 1000)}s | ${path.basename(result.stdoutPath)} / ${path.basename(result.stderrPath)} |`),
    "",
    "## Next Steps",
    "",
    ...summary.nextSteps.map((step) => `- ${step}`),
    ""
  ].join("\n");
}

function nextSteps(results) {
  const failed = results.find((result) => !result.ok);
  if (!failed) {
    return [
      "Review summary.md and the latest SIMULATED_FIRST_TRIAL_REPORT.md.",
      "If the run lasted at least two hours, continue with path input UX or dry-run Apply review.",
      "If this was only a short verification run, start the real nightly command with --hours 2.5."
    ];
  }
  return [
    `Start with failed step ${failed.name} in cycle ${failed.cycle}.`,
    `Open ${failed.stdoutPath} and ${failed.stderrPath}.`,
    "Do not share a trial package until the failed step is understood and rerun successfully."
  ];
}

function quoteShellArg(value) {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value;
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function timestampForPath(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "-",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0")
  ].join("");
}

function safeFileName(value) {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "-");
}

function tailLines(text, count) {
  return text.trim().split(/\r?\n/).slice(-count);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
