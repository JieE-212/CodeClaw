import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCandidateIntegrity } from "../packages/local-launcher/src/candidate-integrity.js";
import { createLocalLauncher, publicLauncherError } from "../packages/local-launcher/src/index.js";

const scriptPath = fileURLToPath(import.meta.url);
const defaultCandidateRoot = path.resolve(path.dirname(scriptPath), "..");
const rawArgs = process.argv.slice(2);
let args = null;

try {
  args = parseArgs(rawArgs);
  const launcher = createLocalLauncher({
    candidateRoot: args.candidateRoot || defaultCandidateRoot,
    verifyCandidateIntegrity
  });
  if (args.command === "start") {
    const startController = new AbortController();
    const cancelStart = () => startController.abort();
    process.once("SIGINT", cancelStart);
    process.once("SIGTERM", cancelStart);
    process.once("SIGHUP", cancelStart);
    let result;
    try {
      result = await launcher.start({ port: args.port, noBrowser: args.noBrowser, signal: startController.signal });
    } finally {
      process.off("SIGINT", cancelStart);
      process.off("SIGTERM", cancelStart);
      process.off("SIGHUP", cancelStart);
    }
    writeResult(result, args.json);
    if (result.state === "started") await superviseStartedService(launcher, result, args.json);
  } else if (args.command === "stop") {
    writeResult(await launcher.stop(), args.json);
  } else {
    writeResult(await launcher.status(), args.json);
  }
} catch (error) {
  writeError(publicLauncherError(error), args?.json || rawArgs.includes("--json"));
  process.exitCode = 1;
}

async function superviseStartedService(localLauncher, startResult, jsonOutput) {
  if (!jsonOutput) {
    process.stdout.write("[Ready] CodeClaw is running on the loopback address shown above.\n");
    process.stdout.write("[Stop] Press Enter or Ctrl+C, or run stop-codeclaw.cmd.\n");
  }

  let resolveStopRequest;
  const stopRequest = new Promise((resolve) => { resolveStopRequest = resolve; });
  const requestStop = () => resolveStopRequest("requested");
  let fatal = false;
  const requestFatalStop = () => {
    fatal = true;
    resolveStopRequest("fatal");
  };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  process.once("SIGHUP", requestStop);
  process.once("uncaughtException", requestFatalStop);
  process.once("unhandledRejection", requestFatalStop);

  const input = process.stdin.isTTY
    ? readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    : null;
  input?.once("line", requestStop);
  const childExit = localLauncher.waitForExit(startResult).then((value) => ({ type: "exit", value }));
  const action = await Promise.race([
    childExit,
    stopRequest.then(() => ({ type: "stop" }))
  ]);

  input?.close();
  process.off("SIGINT", requestStop);
  process.off("SIGTERM", requestStop);
  process.off("SIGHUP", requestStop);
  process.off("uncaughtException", requestFatalStop);
  process.off("unhandledRejection", requestFatalStop);

  if (action.type === "stop") {
    try {
      writeResult(await localLauncher.stopStarted(startResult), jsonOutput);
    } catch (error) {
      writeError(publicLauncherError(error), jsonOutput);
      process.exitCode = 1;
    }
    if (fatal) process.exitCode = 1;
    return;
  }
  if (!jsonOutput) process.stdout.write("[Stopped] The local CodeClaw service has exited.\n");
  if (action.value?.exitCode && action.value.exitCode !== 0) process.exitCode = 1;
}

function parseArgs(rawArgs) {
  const parsed = {
    command: "start",
    port: null,
    noBrowser: false,
    json: false,
    candidateRoot: ""
  };
  let commandSeen = false;
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (["start", "stop", "status"].includes(arg) && !commandSeen) {
      parsed.command = arg;
      commandSeen = true;
      continue;
    }
    if (arg === "--no-browser") {
      parsed.noBrowser = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--port") {
      parsed.port = requiredValue(rawArgs, ++index, "--port");
      continue;
    }
    if (arg.startsWith("--port=")) {
      parsed.port = arg.slice("--port=".length);
      continue;
    }
    if (arg === "--candidate-root") {
      parsed.candidateRoot = requiredValue(rawArgs, ++index, "--candidate-root");
      continue;
    }
    if (arg.startsWith("--candidate-root=")) {
      parsed.candidateRoot = arg.slice("--candidate-root=".length);
      continue;
    }
    throw Object.assign(new Error("Unknown launcher argument."), { code: "LAUNCHER_ARGUMENT_INVALID" });
  }
  if (parsed.command !== "start" && (parsed.noBrowser || parsed.port !== null)) {
    throw Object.assign(new Error("Start-only launcher option."), { code: "LAUNCHER_ARGUMENT_INVALID" });
  }
  return parsed;
}

function requiredValue(values, index, name) {
  const value = values[index];
  if (!value || value.startsWith("--")) {
    throw Object.assign(new Error(`Missing ${name} value.`), { code: "LAUNCHER_ARGUMENT_INVALID" });
  }
  return value;
}

function writeResult(result, jsonOutput) {
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  process.stdout.write(`[CodeClaw] ${result.command}: ${result.state}\n`);
  process.stdout.write(`[Candidate] ${result.candidate.packageVersion} / ${result.candidate.sourceCommit} / ${result.candidate.candidateId}\n`);
  if (result.port) process.stdout.write(`[Loopback] 127.0.0.1:${result.port}\n`);
  if (result.url) process.stdout.write(`[URL] ${result.url}\n`);
  for (const warning of result.warnings || []) process.stdout.write(`[Warning] ${warning}\n`);
}

function writeError(error, jsonOutput) {
  const output = jsonOutput ? JSON.stringify(error) : `[Error] ${error.code}: ${error.message}`;
  process.stderr.write(`${output}\n`);
}
