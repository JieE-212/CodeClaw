import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCandidateIntegrity } from "../packages/local-launcher/src/candidate-integrity.js";
import { createLocalLauncher } from "../packages/local-launcher/src/index.js";
import { terminateProcessTree } from "../packages/shared/src/process-tree.js";
import { prepareMachineCandidate } from "./prepare-machine-candidate.js";
import { inspectSourceVersion } from "./source-version.js";

const scriptPath = fileURLToPath(import.meta.url);
const sourceRoot = path.resolve(path.dirname(scriptPath), "..");
const SYSTEM_CHECK_MAX_BYTES = 16 * 1024;
const SYSTEM_CHECK_TIMEOUT_MS = 3_000;
const launcherTests = [
  "tests/machine-candidate-integrity.test.js",
  "tests/machine-candidate-package.test.js",
  "tests/local-launcher.test.js",
  "tests/local-launcher-integration.test.js",
  "tests/launcher-server-protocol.test.js",
  "tests/stage4b-machine.test.js",
  "tests/web-ui-workflow.test.js"
];

export async function runStage4BMachineGate({ rootPath = sourceRoot, force = false } = {}) {
  const root = path.resolve(rootPath);
  const source = await inspectSourceVersion(root);
  assertCleanSource(source);
  const outputRoot = path.join(root, "dist");
  const pendingPath = path.join(outputRoot, `.codeclaw-stage4b-pending-${randomUUID()}`);
  let candidate = null;
  let finalPath = "";
  let finalCreated = false;

  try {
    const checks = [];
    await runChecked(npmCommand(), ["run", "check"], root, 180_000);
    checks.push("source-check");
    await runChecked(process.execPath, ["--test", "--test-concurrency=1", ...launcherTests], root, 240_000);
    checks.push("launcher-focused-tests");
    await runChecked(npmCommand(), ["run", "health"], root, 120_000);
    checks.push("source-health");

    candidate = await prepareMachineCandidate({
      rootPath: root,
      outputRoot,
      outputPath: pendingPath,
      force: false
    });
    if (candidate.sourceCommit.toLowerCase() !== source.commit.toLowerCase()) {
      throw stage4bError("STAGE4B_SOURCE_CHANGED", "The packaged candidate no longer matches the source commit that entered the machine gate.");
    }
    checks.push("tracked-commit-package");

    await runChecked(npmCommand(), ["run", "check"], candidate.outputPath, 180_000);
    checks.push("candidate-check");
    await runCandidateLauncherHealth(candidate.outputPath);
    checks.push("candidate-launcher-start-status-stop-restart");
    const verifiedPending = await verifyCandidateIntegrity(candidate.outputPath);
    if (verifiedPending.candidateId !== candidate.candidateId) {
      throw stage4bError("STAGE4B_CANDIDATE_ID_CHANGED", "The candidate identity changed during its machine gate.");
    }
    checks.push("candidate-integrity-after-execution");
    await assertSourceStillClean(root, source);

    const finalName = `CodeClaw-machine-candidate-v${verifiedPending.packageVersion}-${verifiedPending.sourceCommit.slice(0, 12)}-${verifiedPending.candidateId.slice(-12)}`;
    finalPath = path.join(outputRoot, finalName);
    if (await exists(finalPath)) {
      if (!force) throw stage4bError("STAGE4B_CANDIDATE_EXISTS", "The final machine candidate already exists; use the explicit force gate to replace the same output.");
      await removeNormalCandidateDirectory(finalPath, outputRoot);
    }
    await fs.rename(candidate.outputPath, finalPath);
    finalCreated = true;
    const verified = await verifyCandidateIntegrity(finalPath);
    if (verified.candidateId !== candidate.candidateId) {
      throw stage4bError("STAGE4B_CANDIDATE_ID_CHANGED", "The candidate identity changed during final publication.");
    }
    await assertSourceStillClean(root, source);
    checks.push("final-candidate-integrity");

    return {
      ok: true,
      status: "MACHINE_CANDIDATE_READY",
      outputName: finalName,
      candidateId: verified.candidateId,
      packageVersion: verified.packageVersion,
      sourceCommit: verified.sourceCommit,
      fileCount: verified.fileCount,
      totalBytes: verified.totalBytes,
      checks
    };
  } catch (error) {
    const cleanupErrors = [];
    const cleanupTargets = error?.preserveCandidate === true
      ? []
      : [finalCreated ? finalPath : "", candidate?.outputPath || pendingPath];
    for (const target of cleanupTargets) {
      if (!target || !(await exists(target))) continue;
      try {
        await removeNormalCandidateDirectory(target, outputRoot);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "Stage 4B failed and its pending candidate could not be cleaned completely.");
    throw error;
  }
}

async function runCandidateLauncherHealth(candidateRoot) {
  const localAppData = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-stage4b-launcher-"));
  const createLauncher = () => createLocalLauncher({
    candidateRoot,
    verifyCandidateIntegrity,
    dependencies: { localAppData },
    readyTimeoutMs: 30_000,
    stopTimeoutMs: 16_000
  });
  let activeLauncher = null;
  let activeStart = null;
  let cleanupAllowed = true;
  let workError = null;
  try {
    activeLauncher = createLauncher();
    try {
      activeStart = await activeLauncher.start({ noBrowser: true });
    } catch (error) {
      if (error?.code === "LAUNCHER_START_CLEANUP_UNVERIFIED") {
        cleanupAllowed = false;
        error.preserveCandidate = true;
      }
      throw error;
    }
    const runtimeDemo = path.join(localAppData, "CodeClaw", "launcher-v1", activeStart.candidate.candidateId, "demo");
    const system = await fetchBoundedLoopbackJson(`http://127.0.0.1:${activeStart.port}/api/system/check`, {
      headers: {
        "x-codeclaw-candidate-id": activeStart.candidate.candidateId,
        "x-codeclaw-instance-id": activeStart.instanceId
      }
    });
    if (system.ok !== true || canonicalPath(system.demoPath) !== canonicalPath(runtimeDemo)) {
      throw stage4bError("STAGE4B_LAUNCHER_DEMO_INVALID", "The candidate service did not bind its writable Demo to external runtime state.");
    }
    const runtimeProof = path.join(runtimeDemo, ".stage4b-runtime-proof.tmp");
    await fs.writeFile(runtimeProof, "runtime-only\n", { encoding: "utf8", flag: "wx" });
    await verifyCandidateIntegrity(candidateRoot);
    await fs.rm(runtimeProof, { force: true });

    let independent = createLauncher();
    const status = await independent.status();
    if (status.state !== "running" || status.identityVerified !== true) {
      throw stage4bError("STAGE4B_LAUNCHER_STATUS_FAILED", "An independent launcher could not verify the running candidate.");
    }
    const stopped = await independent.stop();
    if (stopped.state !== "stopped" || stopped.portReleased !== true) {
      throw stage4bError("STAGE4B_LAUNCHER_STOP_FAILED", "An independent launcher could not stop and release the candidate port.");
    }
    await waitForLauncherExit(activeLauncher, activeStart, 20_000);
    activeStart = null;

    activeLauncher = createLauncher();
    try {
      activeStart = await activeLauncher.start({ noBrowser: true });
    } catch (error) {
      if (error?.code === "LAUNCHER_START_CLEANUP_UNVERIFIED") {
        cleanupAllowed = false;
        error.preserveCandidate = true;
      }
      throw error;
    }
    independent = createLauncher();
    const restartedStatus = await independent.status();
    if (restartedStatus.state !== "running" || restartedStatus.identityVerified !== true) {
      throw stage4bError("STAGE4B_LAUNCHER_RESTART_FAILED", "The verified candidate did not restart with the same external runtime Demo.");
    }
    const restartedStop = await independent.stop();
    if (restartedStop.state !== "stopped" || restartedStop.portReleased !== true) {
      throw stage4bError("STAGE4B_LAUNCHER_STOP_FAILED", "The restarted candidate did not stop cleanly.");
    }
    await waitForLauncherExit(activeLauncher, activeStart, 20_000);
    activeStart = null;
    await verifyCandidateIntegrity(candidateRoot);
  } catch (error) {
    workError = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    if (activeStart && activeLauncher) {
      try {
        await activeLauncher.stopStarted(activeStart);
        await waitForLauncherExit(activeLauncher, activeStart, 20_000);
      } catch (error) {
        cleanupAllowed = false;
        cleanupErrors.push(error);
      }
    }
    if (cleanupAllowed) {
      try {
        await removeOwnedTemporaryDirectory(localAppData, "codeclaw-stage4b-launcher-");
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length) {
      const aggregate = new AggregateError(
        [...(workError ? [workError] : []), ...cleanupErrors],
        "Stage 4B launcher verification failed and runtime cleanup was incomplete."
      );
      aggregate.code = "STAGE4B_LAUNCHER_CLEANUP_FAILED";
      if (!cleanupAllowed) aggregate.preserveCandidate = true;
      throw aggregate;
    }
  }
}

export async function fetchBoundedLoopbackJson(url, init = {}, {
  fetchImpl = globalThis.fetch,
  timeoutMs = SYSTEM_CHECK_TIMEOUT_MS,
  maxBytes = SYSTEM_CHECK_MAX_BYTES
} = {}) {
  const expected = new URL(url);
  if (expected.protocol !== "http:" || expected.hostname !== "127.0.0.1"
    || expected.username || expected.password || expected.hash) {
    throw stage4bError("STAGE4B_HTTP_TARGET_INVALID", "The Stage 4B machine check accepts only an exact 127.0.0.1 HTTP target.");
  }
  if (typeof fetchImpl !== "function" || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0
    || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw stage4bError("STAGE4B_HTTP_OPTIONS_INVALID", "The Stage 4B bounded HTTP options are invalid.");
  }

  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(stage4bError("STAGE4B_HTTP_TIMEOUT", "The Stage 4B loopback check exceeded its bounded deadline."));
    }, timeoutMs);
  });
  const request = (async () => {
    const response = await fetchImpl(expected.href, { ...init, redirect: "error", signal: controller.signal });
    if (response?.redirected === true || (response?.url && response.url !== expected.href)) {
      throw stage4bError("STAGE4B_HTTP_REDIRECTED", "The Stage 4B loopback check was redirected or returned from an unexpected URL.");
    }
    if (!response?.ok) throw stage4bError("STAGE4B_HTTP_REJECTED", "The Stage 4B loopback check was rejected.");
    const responseType = String(response.headers?.get?.("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    if (responseType !== "application/json") {
      throw stage4bError("STAGE4B_HTTP_TYPE_INVALID", "The Stage 4B loopback check did not return JSON.");
    }
    const declaredHeader = response.headers?.get?.("content-length");
    const declared = declaredHeader === null || declaredHeader === undefined ? null : Number(declaredHeader);
    if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes)) {
      throw stage4bError("STAGE4B_HTTP_TOO_LARGE", "The Stage 4B loopback response exceeded its size limit.");
    }
    const chunks = [];
    let observed = 0;
    for await (const chunk of response.body || []) {
      const buffer = Buffer.from(chunk);
      observed += buffer.byteLength;
      if (observed > maxBytes) {
        throw stage4bError("STAGE4B_HTTP_TOO_LARGE", "The Stage 4B loopback response exceeded its size limit.");
      }
      chunks.push(buffer);
    }
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
      .decode(Buffer.concat(chunks));
    try {
      return JSON.parse(text || "{}");
    } catch (error) {
      throw stage4bError("STAGE4B_HTTP_JSON_INVALID", "The Stage 4B loopback response was not valid JSON.", error);
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForLauncherExit(launcher, startResult, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(stage4bError("STAGE4B_LAUNCHER_EXIT_TIMEOUT", "The candidate launcher child did not exit before its cleanup deadline.")), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([launcher.waitForExit(startResult), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function removeOwnedTemporaryDirectory(target, prefix) {
  const parent = path.resolve(os.tmpdir());
  if (path.dirname(target) !== parent || !path.basename(target).startsWith(prefix)) {
    throw stage4bError("STAGE4B_TEMP_CLEANUP_UNSAFE", "Refusing to clean an unowned Stage 4B launcher directory.");
  }
  const [stat, realPath] = await Promise.all([fs.lstat(target), fs.realpath(target)]);
  if (!stat.isDirectory() || stat.isSymbolicLink() || canonicalPath(realPath) !== canonicalPath(target)) {
    throw stage4bError("STAGE4B_TEMP_CLEANUP_UNSAFE", "The Stage 4B launcher directory changed before cleanup.");
  }
  await fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

function runChecked(command, args, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timingOut = false;
    let settled = false;
    const invocation = checkedCommandInvocation(command, args);
    const child = execFile(invocation.file, invocation.args, {
      cwd,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      env: process.env
    }, (error) => {
      if (timingOut || settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(stage4bError("STAGE4B_COMMAND_FAILED", `A bounded Stage 4B machine check failed: ${path.basename(command)} ${args.slice(0, 2).join(" ")}`));
        return;
      }
      resolve();
    });
    const timer = setTimeout(async () => {
      if (settled) return;
      timingOut = true;
      const termination = await terminateProcessTree(child, { graceMs: 500, forceAfterMs: 3_000, helperTimeoutMs: 3_000 }).catch(() => null);
      settled = true;
      if (!termination?.treeTerminationVerified) {
        reject(stage4bError("STAGE4B_COMMAND_TREE_UNVERIFIED", "A timed-out Stage 4B check could not prove process-tree cleanup."));
        return;
      }
      reject(stage4bError("STAGE4B_COMMAND_TIMEOUT", `A Stage 4B machine check exceeded its ${timeoutMs} ms deadline.`));
    }, timeoutMs);
    timer.unref?.();
  });
}

export function checkedCommandInvocation(command, args, {
  platform = process.platform,
  comspec = process.env.ComSpec || "cmd.exe"
} = {}) {
  if (platform === "win32" && /\.(?:cmd|bat)$/i.test(command)) {
    return {
      file: comspec,
      args: ["/d", "/s", "/c", command, ...args]
    };
  }
  return { file: command, args: [...args] };
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function assertCleanSource(source) {
  if (source.available !== true || source.dirty !== false || !/^[0-9a-f]{40}$/i.test(source.commit)) {
    throw stage4bError("STAGE4B_SOURCE_NOT_CLEAN", "Stage 4B candidates require a clean, committed source identity.");
  }
}

async function assertSourceStillClean(root, expected) {
  const current = await inspectSourceVersion(root);
  if (current.available !== true || current.dirty !== false
    || current.commit.toLowerCase() !== expected.commit.toLowerCase()) {
    throw stage4bError("STAGE4B_SOURCE_CHANGED", "The source worktree or HEAD changed while the Stage 4B gate was running.");
  }
}

async function removeNormalCandidateDirectory(target, outputRoot) {
  if (path.dirname(target) !== outputRoot) throw stage4bError("STAGE4B_CLEANUP_UNSAFE", "Refusing to remove a candidate outside the Stage 4B output root.");
  const [stat, realPath] = await Promise.all([fs.lstat(target), fs.realpath(target)]);
  if (!stat.isDirectory() || stat.isSymbolicLink() || canonicalPath(realPath) !== canonicalPath(target)) {
    throw stage4bError("STAGE4B_CLEANUP_UNSAFE", "Refusing to remove a linked or non-directory Stage 4B candidate.");
  }
  await fs.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

function canonicalPath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}

function stage4bError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArgs(args) {
  const options = { force: false };
  for (const argument of args) {
    if (argument === "--force") options.force = true;
    else throw stage4bError("STAGE4B_ARGUMENT_INVALID", "Unknown Stage 4B machine-gate argument.");
  }
  return options;
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

if (path.resolve(process.argv[1] || "") === scriptPath) {
  try {
    console.log(JSON.stringify(await runStage4BMachineGate(parseArgs(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: String(error?.code || "STAGE4B_MACHINE_FAILED"),
      error: String(error?.message || "Stage 4B machine gate failed.")
    }, null, 2));
    process.exitCode = 1;
  }
}
