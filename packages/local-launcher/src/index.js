import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { processSpawnOptions, terminateProcessTree } from "../../shared/src/process-tree.js";

export const LAUNCHER_PROTOCOL = 1;
export const DEFAULT_PORT = 4173;
export const FALLBACK_PORT_END = 4199;
export const INSTANCE_FILE_MAX_BYTES = 16 * 1024;

const CONTROL_FILE = "instance.json";
const START_LOCK_FILE = "start.lock";
const LOOPBACK_HOST = "127.0.0.1";
const HEALTH_MAX_BYTES = 16 * 1024;
const DEMO_TEMPLATE_PREFIX = "examples/demo-js";
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_CANDIDATE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const SAFE_INSTANCE_ID = /^[A-Za-z0-9_-]{16,128}$/;
const SAFE_PACKAGE_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
const SAFE_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const COMMIT = /^[a-f0-9]{40}$/i;
const INSTANCE_KEYS = [
  "candidateId",
  "instanceId",
  "launchNonce",
  "launcherPid",
  "launcherUptimeMs",
  "launcherProtocol",
  "packageVersion",
  "phase",
  "port",
  "schemaVersion",
  "serverPid",
  "shutdownToken",
  "sourceCommit",
  "startedAt"
].sort();
const STARTED_CONTEXTS = new WeakMap();

export function createLocalLauncher(options = {}) {
  if (typeof options.verifyCandidateIntegrity !== "function") {
    throw new TypeError("A candidate integrity verifier is required.");
  }
  const candidateRoot = path.resolve(options.candidateRoot || ".");
  const deps = launcherDependencies(options.dependencies || {});
  const readyTimeoutMs = positiveInteger(options.readyTimeoutMs, 20_000);
  const healthTimeoutMs = positiveInteger(options.healthTimeoutMs, 750);
  const pollIntervalMs = positiveInteger(options.pollIntervalMs, 150);
  const stopTimeoutMs = positiveInteger(options.stopTimeoutMs, 16_000);
  const serverEntry = String(options.serverEntry || "apps/web/server.js");

  return Object.freeze({
    verify: verifyCandidate,
    start,
    stop,
    stopStarted,
    status,
    waitForExit
  });

  async function verifyCandidate() {
    assertSupportedNodeVersion(deps.nodeVersion);
    const value = await options.verifyCandidateIntegrity(candidateRoot);
    return normalizeCandidate(value);
  }

  async function start({ port = null, noBrowser = false, signal = null } = {}) {
    throwIfStartCancelled(signal);
    const candidate = await verifyCandidate();
    throwIfStartCancelled(signal);
    const explicitPort = port !== null && port !== undefined;
    const requestedPort = explicitPort ? validPort(port) : DEFAULT_PORT;
    const runtime = runtimePaths(candidate, deps);
    await prepareRuntimeDirectory(runtime, deps);
    throwIfStartCancelled(signal);
    const releaseLock = await acquireStartLock(runtime, deps, signal);
    let result;
    try {
      result = await startUnderLock(candidate, runtime, {
        explicitPort,
        requestedPort,
        noBrowser,
        signal
      });
    } finally {
      await releaseLock();
    }

    try {
      throwIfStartCancelled(signal);
    } catch (cancelError) {
      if (result?.state === "started") {
        try {
          await stopStarted(result);
        } catch (cleanupError) {
          throw launcherError(
            "LAUNCHER_START_CLEANUP_UNVERIFIED",
            "Startup was cancelled after service handoff, but the process tree could not be proven stopped; its control authority was retained for diagnosis and safe recovery.",
            new AggregateError([cancelError, cleanupError], "Cancelled startup cleanup was not verified.")
          );
        }
      }
      throw cancelError;
    }
    return result;
  }

  async function startUnderLock(candidate, runtime, { explicitPort, requestedPort, noBrowser, signal }) {
      const existing = await readInstance(runtime, deps);
      if (existing) {
        assertInstanceCandidate(existing, candidate);
        const existingHealth = await verifyInstanceHealth(existing, candidate, deps, healthTimeoutMs);
        if (existingHealth.verified) {
          throwIfStartCancelled(signal);
          const healthyInstance = existingHealth.instance;
          if (existing.serverPid === 0) await writeInstance(runtime, healthyInstance, deps);
          if (!existingHealth.ready) {
            throw launcherError(
              "LAUNCHER_INSTANCE_IDENTITY_UNVERIFIED",
              "A reserved CodeClaw instance proved its identity but is not ready; its recovery authority was retained. Try again after startup settles."
            );
          }
          const browser = await openReadyBrowser(healthyInstance, candidate, noBrowser, deps);
          throwIfStartCancelled(signal);
          return publicStartResult("reused", candidate, healthyInstance, browser);
        }
        if (existing.phase === "reserved") {
          if (reservationOwnerMayResume(existing, deps)) {
            throw launcherError(
              "LAUNCHER_INSTANCE_IDENTITY_UNVERIFIED",
              "A reserved startup still has a live launcher owner. Its recovery authority was retained and no second instance was started."
            );
          }
          await removeInstanceIfOwned(runtime, existing.instanceId, deps);
        } else {
          if (existing.serverPid > 0 && deps.processAlive(existing.serverPid)) {
            throw launcherError(
              "LAUNCHER_INSTANCE_IDENTITY_UNVERIFIED",
              "A recorded CodeClaw process is active but its launcher identity could not be verified. It was not terminated."
            );
          }
          await removeInstanceIfOwned(runtime, existing.instanceId, deps);
        }
      }

      const ports = explicitPort
        ? [requestedPort]
        : Array.from({ length: FALLBACK_PORT_END - DEFAULT_PORT + 1 }, (_, index) => DEFAULT_PORT + index);
      const classifications = explicitPort
        ? [await classifyPort(requestedPort, candidate, null, deps, healthTimeoutMs)]
        : await Promise.all(ports.map((candidatePort) => classifyPort(candidatePort, candidate, null, deps, healthTimeoutMs)));
      throwIfStartCancelled(signal);
      if (classifications.some((classification) => classification.kind === "unverified-same-candidate")) {
        throw launcherError(
          "LAUNCHER_INSTANCE_IDENTITY_UNVERIFIED",
          "A service claims this candidate identity but no matching local HMAC authority is available. No second instance was started."
        );
      }
      if (explicitPort && classifications[0].kind !== "free") {
        throw launcherError(
          "LAUNCHER_EXPLICIT_PORT_IN_USE",
          `The explicitly requested loopback port ${requestedPort} is already in use. No process was opened or terminated.`
        );
      }

      let sawBusyPort = classifications.some((classification) => classification.kind !== "free");
      for (let index = 0; index < ports.length; index += 1) {
        const candidatePort = ports[index];
        if (classifications[index].kind !== "free") continue;
        throwIfStartCancelled(signal);
        try {
          return await startNewInstance(candidate, runtime, candidatePort, noBrowser, signal);
        } catch (error) {
          if (!explicitPort
            && error?.code === "LAUNCHER_SERVER_EXITED_BEFORE_READY"
            && await deps.probeTcp(candidatePort, healthTimeoutMs)) {
            sawBusyPort = true;
            continue;
          }
          throw error;
        }
      }
      throw launcherError(
        sawBusyPort ? "LAUNCHER_NO_AVAILABLE_PORT" : "LAUNCHER_START_FAILED",
        `CodeClaw could not acquire a loopback port in the bounded ${DEFAULT_PORT}-${FALLBACK_PORT_END} range.`
      );
  }

  async function startNewInstance(candidate, runtime, port, noBrowser, signal) {
    throwIfStartCancelled(signal);
    await prepareRuntimeDemo(candidateRoot, runtime, candidate, deps);
    throwIfStartCancelled(signal);
    const finalCandidate = await verifyCandidate();
    assertSameCandidateIdentity(candidate, finalCandidate);
    candidate = finalCandidate;
    throwIfStartCancelled(signal);
    const instance = {
      schemaVersion: 1,
      launcherProtocol: LAUNCHER_PROTOCOL,
      candidateId: candidate.candidateId,
      packageVersion: candidate.packageVersion,
      sourceCommit: candidate.sourceCommit,
      instanceId: deps.randomUUID(),
      launchNonce: deps.randomToken(24),
      shutdownToken: deps.randomToken(32),
      port,
      launcherPid: deps.pid,
      launcherUptimeMs: Math.floor(deps.uptimeMs()),
      serverPid: 0,
      phase: "reserved",
      startedAt: deps.now().toISOString()
    };
    await writeInstance(runtime, instance, deps);
    let child = null;
    let spawnFailed = false;
    let childExited = false;
    let preserveControl = false;
    try {
      child = deps.spawnServer({
        command: deps.execPath,
        args: [serverEntry],
        cwd: candidateRoot,
        env: buildServerEnvironment(deps.env, candidate, instance, runtime)
      });
      child?.once?.("error", () => { spawnFailed = true; });
      if (!Number.isSafeInteger(child?.pid) || child.pid <= 0) {
        throw launcherError("LAUNCHER_SERVER_SPAWN_FAILED", "The local CodeClaw service did not return a valid process identity.");
      }
      instance.serverPid = child.pid;
      instance.phase = "starting";
      child.once?.("exit", () => {
        childExited = true;
        removeInstanceAfterChildExit(runtime, instance.instanceId, () => preserveControl, deps).catch(() => {});
      });
      await writeInstance(runtime, instance, deps);
      await deps.releaseServerStart(child, instance);
      const ready = await waitForReady(child, instance, candidate, deps, {
        readyTimeoutMs,
        healthTimeoutMs,
        pollIntervalMs,
        signal,
        spawnFailed: () => spawnFailed
      });
      throwIfStartCancelled(signal);
      instance.phase = "ready";
      await writeInstance(runtime, instance, deps);
      if (childExited || child.exitCode !== null || child.signalCode) {
        throw launcherError("LAUNCHER_SERVER_EXITED_BEFORE_READY", "The local service exited before browser handoff.");
      }
      throwIfStartCancelled(signal);
      const browser = await openReadyBrowser(instance, candidate, noBrowser, deps);
      throwIfStartCancelled(signal);
      const result = publicStartResult("started", candidate, instance, browser);
      Object.defineProperty(result, "child", { value: child, enumerable: false });
      Object.defineProperty(result, "ready", { value: ready, enumerable: false });
      STARTED_CONTEXTS.set(result, { candidate, runtime, instance });
      return result;
    } catch (error) {
      const termination = child
        ? await deps.terminateChildTree(child).catch(() => null)
        : { treeTerminationVerified: true };
      const stopped = child
        ? termination?.treeTerminationVerified === true
          && await waitForStopped(instance, deps, Math.min(3_000, stopTimeoutMs), pollIntervalMs)
        : true;
      if (!stopped) {
        preserveControl = true;
        throw launcherError(
          "LAUNCHER_START_CLEANUP_UNVERIFIED",
          "The failed startup process tree could not be proven stopped; its control authority was retained for diagnosis and safe recovery.",
          error
        );
      }
      await removeInstanceIfOwned(runtime, instance.instanceId, deps);
      throw error;
    }
  }

  async function stop() {
    const candidate = await verifyCandidate();
    const runtime = runtimePaths(candidate, deps);
    await prepareRuntimeDirectory(runtime, deps);
    const releaseLock = await acquireStartLock(runtime, deps);
    try {
      const instance = await readInstance(runtime, deps);
      if (!instance) return publicStoppedResult("not-running", candidate, null, true);
      assertInstanceCandidate(instance, candidate);
      return await stopKnownInstance(candidate, runtime, instance);
    } finally {
      await releaseLock();
    }
  }

  async function stopStarted(startResult) {
    const context = STARTED_CONTEXTS.get(startResult);
    if (!context) throw launcherError("LAUNCHER_STARTED_INSTANCE_INVALID", "The started launcher instance is unavailable.");
    const releaseLock = await acquireStartLock(context.runtime, deps);
    try {
      return await stopKnownInstance(context.candidate, context.runtime, context.instance);
    } finally {
      await releaseLock();
    }
  }

  async function stopKnownInstance(candidate, runtime, instance) {
    const identity = await verifyInstanceHealth(instance, candidate, deps, healthTimeoutMs);
    if (identity.verified) instance = identity.instance;
    if (!identity.verified) {
      if (instance.phase === "reserved") {
        if (reservationOwnerMayResume(instance, deps)) {
          throw launcherError(
            "LAUNCHER_STOP_IDENTITY_MISMATCH",
            "The reserved startup still has a live launcher owner. Its recovery authority was retained and no PID was terminated."
          );
        }
        await removeInstanceIfOwned(runtime, instance.instanceId, deps);
        const portReleased = !(await deps.probeTcp(instance.port, healthTimeoutMs));
        return publicStoppedResult("stale-control-removed", candidate, instance, portReleased);
      }
      const processRunning = instance.serverPid > 0 && deps.processAlive(instance.serverPid);
      const portBusy = await deps.probeTcp(instance.port, healthTimeoutMs);
      if (!processRunning && !portBusy) {
        await removeInstanceIfOwned(runtime, instance.instanceId, deps);
        return publicStoppedResult("stale-control-removed", candidate, instance, true);
      }
      throw launcherError(
        "LAUNCHER_STOP_IDENTITY_MISMATCH",
        "The recorded service identity could not be verified. The launcher refused to terminate a possibly unrelated process."
      );
    }

    await requestShutdown(instance, deps, healthTimeoutMs);
    let stopped = await waitForStopped(instance, deps, stopTimeoutMs, pollIntervalMs);
    let forced = false;
    if (!stopped) {
      const finalIdentity = await verifyInstanceHealth(instance, candidate, deps, healthTimeoutMs);
      if (!finalIdentity.verified) {
        throw launcherError(
          "LAUNCHER_STOP_IDENTITY_LOST",
          "The service did not stop within its deadline and its identity can no longer be proven. No PID-based termination was attempted."
        );
      }
      const termination = await deps.terminatePidTree(instance.serverPid);
      forced = true;
      if (!termination?.terminated || termination.treeTerminationVerified !== true) {
        throw launcherError("LAUNCHER_STOP_TREE_UNVERIFIED", "The process tree termination result could not be verified.");
      }
      stopped = await waitForStopped(instance, deps, Math.min(3_000, stopTimeoutMs), pollIntervalMs);
    }
    if (!stopped) throw launcherError("LAUNCHER_STOP_TIMEOUT", "The verified local service did not release its process and port before the stop deadline.");
    await removeInstanceIfOwned(runtime, instance.instanceId, deps);
    return publicStoppedResult("stopped", candidate, instance, true, forced);
  }

  async function status() {
    const candidate = await verifyCandidate();
    const runtime = runtimePaths(candidate, deps);
    const instance = await readInstance(runtime, deps);
    if (!instance) return publicStatusResult("not-running", candidate, null, false);
    assertInstanceCandidate(instance, candidate);
    const identity = await verifyInstanceHealth(instance, candidate, deps, healthTimeoutMs);
    if (identity.ready) return publicStatusResult("running", candidate, identity.instance, true);
    if (instance.phase === "reserved") {
      return publicStatusResult(
        reservationOwnerMayResume(instance, deps) ? "identity-unverified" : "stale-control",
        candidate,
        instance,
        false
      );
    }
    const processRunning = instance.serverPid > 0 && deps.processAlive(instance.serverPid);
    const portBusy = await deps.probeTcp(instance.port, healthTimeoutMs);
    return publicStatusResult(
      !processRunning && !portBusy ? "stale-control" : "identity-unverified",
      candidate,
      instance,
      false
    );
  }

  async function waitForExit(startResult) {
    const child = startResult?.child;
    if (!child || typeof child.once !== "function") return null;
    if (child.exitCode !== null || child.signalCode) {
      return { exitCode: child.exitCode, signal: child.signalCode };
    }
    return new Promise((resolve) => child.once("exit", (exitCode, signal) => resolve({ exitCode, signal })));
  }
}

export function assertSupportedNodeVersion(version = process.versions.node) {
  const major = Number.parseInt(String(version || "").split(".", 1)[0], 10);
  if (!Number.isSafeInteger(major) || major < 20) {
    throw launcherError("LAUNCHER_NODE_UNSUPPORTED", "CodeClaw requires Node.js 20 or newer.");
  }
  return major;
}

export function launcherProof({ shutdownToken, candidateId, instanceId, launchNonce, serverPid, port, challenge }) {
  if (!SAFE_TOKEN.test(String(shutdownToken || "")) || !SAFE_TOKEN.test(String(challenge || ""))
    || !Number.isSafeInteger(serverPid) || serverPid <= 0 || !Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    throw launcherError("LAUNCHER_PROOF_INPUT_INVALID", "The local launcher proof input is invalid.");
  }
  const canonical = `codeclaw-launcher-v1\n${candidateId}\n${instanceId}\n${launchNonce}\n${serverPid}\n${port}\n${challenge}`;
  return createHmac("sha256", shutdownToken).update(canonical, "utf8").digest("base64url");
}

export function publicLauncherError(error) {
  const code = typeof error?.code === "string" && /^LAUNCHER_[A-Z0-9_]+$/.test(error.code)
    ? error.code
    : "LAUNCHER_FAILED";
  return {
    ok: false,
    code,
    message: publicErrorMessage(code)
  };
}

async function waitForReady(child, instance, candidate, deps, options) {
  const deadline = deps.nowMs() + options.readyTimeoutMs;
  while (deps.nowMs() < deadline) {
    throwIfStartCancelled(options.signal);
    if (options.spawnFailed?.()) {
      throw launcherError("LAUNCHER_SERVER_SPAWN_FAILED", "The local CodeClaw service process could not be started.");
    }
    if (child.exitCode !== null || child.signalCode) {
      throw launcherError("LAUNCHER_SERVER_EXITED_BEFORE_READY", "The local service exited before it reported a matching ready identity.");
    }
    const health = await verifyInstanceHealth(instance, candidate, deps, options.healthTimeoutMs);
    if (health.ready) return health.payload;
    await deps.sleep(options.pollIntervalMs);
  }
  throwIfStartCancelled(options.signal);
  throw launcherError("LAUNCHER_READY_TIMEOUT", "The local service did not report a matching ready identity before the bounded startup deadline.");
}

async function verifyInstanceHealth(instance, candidate, deps, timeoutMs) {
  const challenge = deps.randomToken(24);
  let payload;
  try {
    payload = await fetchJson(
      `http://${LOOPBACK_HOST}:${instance.port}/api/health?challenge=${encodeURIComponent(challenge)}`,
      { method: "GET" },
      deps,
      timeoutMs
    );
  } catch {
    return { verified: false, ready: false, payload: null };
  }
  const reportedServerPid = Number(payload?.serverPid);
  const reservedIdentity = instance.phase === "reserved" && instance.serverPid === 0;
  const serverPidMatches = reservedIdentity
    ? Number.isSafeInteger(reportedServerPid) && reportedServerPid > 0
    : reportedServerPid === instance.serverPid;
  const identityMatches = payload?.ok === true
    && payload.app === "CodeClaw"
    && Number(payload.launcherProtocol) === LAUNCHER_PROTOCOL
    && payload.candidateId === candidate.candidateId
    && payload.packageVersion === candidate.packageVersion
    && payload.sourceCommit === candidate.sourceCommit
    && payload.instanceId === instance.instanceId
    && payload.launchNonce === instance.launchNonce
    && serverPidMatches
    && payload.port === instance.port;
  if (!identityMatches) return { verified: false, ready: false, payload };
  const recoveredInstance = reservedIdentity
    ? { ...instance, serverPid: reportedServerPid, phase: payload.accepting === true ? "ready" : "starting" }
    : instance;
  const expected = launcherProof({ ...recoveredInstance, challenge });
  if (!safeTextEqual(payload.proof, expected)) return { verified: false, ready: false, payload };
  return { verified: true, ready: payload.accepting === true, payload, instance: recoveredInstance };
}

async function classifyPort(port, candidate, instance, deps, timeoutMs) {
  if (!(await deps.probeTcp(port, timeoutMs))) return { kind: "free" };
  if (instance?.port === port) {
    const verified = await verifyInstanceHealth(instance, candidate, deps, timeoutMs);
    if (verified.ready) return { kind: "same-candidate", verified };
  }
  try {
    const challenge = deps.randomToken(24);
    const payload = await fetchJson(
      `http://${LOOPBACK_HOST}:${port}/api/health?challenge=${encodeURIComponent(challenge)}`,
      { method: "GET" },
      deps,
      timeoutMs
    );
    if (payload?.app === "CodeClaw" && Number(payload.launcherProtocol) === LAUNCHER_PROTOCOL) {
      return { kind: payload.candidateId === candidate.candidateId ? "unverified-same-candidate" : "other-candidate" };
    }
  } catch {}
  return { kind: "unknown-busy" };
}

async function requestShutdown(instance, deps, timeoutMs) {
  let payload;
  try {
    payload = await fetchJson(
      `http://${LOOPBACK_HOST}:${instance.port}/api/system/shutdown`,
      {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ instanceId: instance.instanceId, token: instance.shutdownToken })
      },
      deps,
      timeoutMs
    );
  } catch (error) {
    throw launcherError("LAUNCHER_SHUTDOWN_REQUEST_FAILED", "The verified service did not accept the bounded local shutdown request.", error);
  }
  if (payload?.ok !== true) {
    throw launcherError("LAUNCHER_SHUTDOWN_REJECTED", "The verified service rejected its local shutdown capability.");
  }
}

async function waitForStopped(instance, deps, timeoutMs, pollIntervalMs) {
  const deadline = deps.nowMs() + timeoutMs;
  while (deps.nowMs() < deadline) {
    const processRunning = instance.serverPid > 0 && deps.processAlive(instance.serverPid);
    const portBusy = await deps.probeTcp(instance.port, Math.min(300, timeoutMs));
    if (!processRunning && !portBusy) return true;
    await deps.sleep(pollIntervalMs);
  }
  return !(instance.serverPid > 0 && deps.processAlive(instance.serverPid))
    && !(await deps.probeTcp(instance.port, Math.min(300, timeoutMs)));
}

async function openReadyBrowser(instance, candidate, noBrowser, deps) {
  const url = new URL(`http://${LOOPBACK_HOST}:${instance.port}/`);
  url.searchParams.set("candidate", candidate.candidateId);
  url.searchParams.set("instance", instance.instanceId);
  if (noBrowser) return { opened: false, skipped: true, url: url.href };
  try {
    await deps.openBrowser(url.href);
    return { opened: true, skipped: false, url: url.href };
  } catch {
    return { opened: false, skipped: false, url: url.href, warning: "LAUNCHER_BROWSER_OPEN_FAILED" };
  }
}

function buildServerEnvironment(source, candidate, instance, runtime) {
  const env = {};
  for (const name of [
    "APPDATA", "ComSpec", "HOME", "LANG", "LC_ALL", "LOCALAPPDATA", "PATH", "PATHEXT",
    "SystemRoot", "TEMP", "TMP", "TZ", "USERPROFILE", "WINDIR"
  ]) {
    if (typeof source[name] === "string") env[name] = source[name];
  }
  return {
    ...env,
    LOCALAPPDATA: runtime.localAppData,
    CODECLAW_PORT: String(instance.port),
    CODECLAW_STATE_DIR: runtime.stateDir,
    CODECLAW_DEMO_ROOT: runtime.demoRoot,
    CODECLAW_LAUNCHER_PROTOCOL: String(LAUNCHER_PROTOCOL),
    CODECLAW_CANDIDATE_ID: candidate.candidateId,
    CODECLAW_PACKAGE_VERSION: candidate.packageVersion,
    CODECLAW_SOURCE_COMMIT: candidate.sourceCommit,
    CODECLAW_INSTANCE_ID: instance.instanceId,
    CODECLAW_LAUNCH_NONCE: instance.launchNonce,
    CODECLAW_SHUTDOWN_TOKEN: instance.shutdownToken
  };
}

function runtimePaths(candidate, deps) {
  const localAppData = path.resolve(String(deps.localAppData || ""));
  if (!deps.localAppData) throw launcherError("LAUNCHER_LOCALAPPDATA_MISSING", "The Windows local application-data directory is unavailable.");
  const runtimeDir = path.join(localAppData, "CodeClaw", "launcher-v1", candidate.candidateId);
  return {
    localAppData,
    runtimeDir,
    stateDir: path.join(runtimeDir, "state"),
    demoRoot: path.join(runtimeDir, "demo"),
    instancePath: path.join(runtimeDir, CONTROL_FILE),
    lockPath: path.join(runtimeDir, START_LOCK_FILE)
  };
}

async function prepareRuntimeDirectory(runtime, deps) {
  await deps.fs.mkdir(runtime.runtimeDir, { recursive: true, mode: 0o700 });
  await deps.fs.mkdir(runtime.stateDir, { recursive: true, mode: 0o700 });
  await assertNormalRuntimeDirectory(runtime.runtimeDir, deps);
  await assertNormalRuntimeDirectory(runtime.stateDir, deps);
}

async function prepareRuntimeDemo(candidateRoot, runtime, candidate, deps) {
  try {
    await assertNormalRuntimeDirectory(runtime.demoRoot, deps);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const manifest = runtimeDemoManifest(candidate);
  const stagingPath = path.join(runtime.runtimeDir, `.demo-${deps.randomUUID()}.tmp`);
  let stagingCreated = false;
  let installed = false;
  try {
    await deps.fs.mkdir(stagingPath, { recursive: false, mode: 0o700 });
    stagingCreated = true;
    for (const relative of manifest.directories) {
      await deps.fs.mkdir(path.join(stagingPath, ...relative.split("/")), { recursive: true, mode: 0o700 });
    }
    for (const file of manifest.files) {
      await copyVerifiedDemoFile(candidateRoot, stagingPath, file, deps);
    }
    await assertNormalRuntimeDirectory(stagingPath, deps);
    await deps.fs.rename(stagingPath, runtime.demoRoot);
    installed = true;
    await assertNormalRuntimeDirectory(runtime.demoRoot, deps);
  } finally {
    if (stagingCreated && !installed) await removeNormalLauncherDirectory(stagingPath, runtime.runtimeDir, deps);
  }
}

function runtimeDemoManifest(candidate) {
  const authority = candidate.authority;
  if (!authority || !Array.isArray(authority.directories) || !Array.isArray(authority.files)) {
    throw launcherError("LAUNCHER_DEMO_AUTHORITY_INVALID", "The verified candidate did not provide a complete Demo template manifest.");
  }
  const prefix = `${DEMO_TEMPLATE_PREFIX}/`;
  const directories = authority.directories
    .filter((relative) => relative.startsWith(prefix))
    .map((relative) => relative.slice(prefix.length));
  const files = authority.files
    .filter((file) => typeof file?.path === "string" && file.path.startsWith(prefix))
    .map((file) => ({ ...file, relative: file.path.slice(prefix.length) }));
  for (const relative of directories) assertSafeDemoRelativePath(relative);
  for (const file of files) {
    assertSafeDemoRelativePath(file.relative);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || !SHA256.test(String(file.sha256 || ""))) {
      throw launcherError("LAUNCHER_DEMO_AUTHORITY_INVALID", "The verified Demo template contains an invalid file record.");
    }
  }
  if (!files.some((file) => file.relative === "package.json")) {
    throw launcherError("LAUNCHER_DEMO_AUTHORITY_INVALID", "The verified candidate Demo template is incomplete.");
  }
  directories.sort((left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right));
  files.sort((left, right) => left.relative.localeCompare(right.relative));
  return { directories, files };
}

async function copyVerifiedDemoFile(candidateRoot, stagingRoot, file, deps) {
  const sourcePath = path.join(candidateRoot, ...file.path.split("/"));
  const targetPath = path.join(stagingRoot, ...file.relative.split("/"));
  const [before, realPath] = await Promise.all([
    deps.fs.lstat(sourcePath, { bigint: true }),
    deps.fs.realpath(sourcePath)
  ]);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n
    || before.size !== BigInt(file.size)
    || canonicalLocalPath(realPath) !== canonicalLocalPath(sourcePath)) {
    throw launcherError("LAUNCHER_DEMO_SOURCE_CHANGED", "The verified Demo template changed before it could be materialized safely.");
  }
  await deps.fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  let sourceHandle;
  let targetHandle;
  try {
    sourceHandle = await deps.fs.open(sourcePath, "r");
    const opened = await sourceHandle.stat({ bigint: true });
    if (!sameFileStat(before, opened)) {
      throw launcherError("LAUNCHER_DEMO_SOURCE_CHANGED", "The verified Demo template changed before it could be read.");
    }
    targetHandle = await deps.fs.open(targetPath, "wx", 0o600);
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(256 * 1024);
    let total = 0;
    for (;;) {
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > file.size) {
        throw launcherError("LAUNCHER_DEMO_SOURCE_CHANGED", "The verified Demo template grew while it was copied.");
      }
      digest.update(buffer.subarray(0, bytesRead));
      await writeAll(targetHandle, buffer, bytesRead);
    }
    const [after, pathAfter, finalRealPath] = await Promise.all([
      sourceHandle.stat({ bigint: true }),
      deps.fs.lstat(sourcePath, { bigint: true }),
      deps.fs.realpath(sourcePath)
    ]);
    if (total !== file.size || digest.digest("hex") !== file.sha256
      || !sameFileStat(opened, after) || !sameFileStat(after, pathAfter)
      || canonicalLocalPath(finalRealPath) !== canonicalLocalPath(sourcePath)) {
      throw launcherError("LAUNCHER_DEMO_SOURCE_CHANGED", "The verified Demo template changed while it was copied.");
    }
    await targetHandle.sync();
  } finally {
    await sourceHandle?.close().catch(() => {});
    await targetHandle?.close().catch(() => {});
  }
}

async function writeAll(handle, buffer, length) {
  let offset = 0;
  while (offset < length) {
    const { bytesWritten } = await handle.write(buffer, offset, length - offset, null);
    if (!bytesWritten) throw launcherError("LAUNCHER_DEMO_WRITE_FAILED", "The runtime Demo copy could not be written completely.");
    offset += bytesWritten;
  }
}

async function removeNormalLauncherDirectory(directory, expectedParent, deps) {
  if (path.dirname(directory) !== expectedParent) {
    throw launcherError("LAUNCHER_RUNTIME_CLEANUP_UNSAFE", "The launcher refused an unsafe runtime cleanup path.");
  }
  let stat;
  let realPath;
  try {
    [stat, realPath] = await Promise.all([deps.fs.lstat(directory), deps.fs.realpath(directory)]);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || canonicalLocalPath(realPath) !== canonicalLocalPath(directory)) {
    throw launcherError("LAUNCHER_RUNTIME_CLEANUP_UNSAFE", "The launcher refused to remove an unsafe runtime directory.");
  }
  await deps.fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

function assertSafeDemoRelativePath(relative) {
  if (typeof relative !== "string" || !relative || relative.includes("\\") || path.posix.isAbsolute(relative)
    || relative.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw launcherError("LAUNCHER_DEMO_AUTHORITY_INVALID", "The verified Demo template contains an unsafe path.");
  }
}

function canonicalLocalPath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}

async function assertNormalRuntimeDirectory(directory, deps) {
  const resolved = path.resolve(directory);
  const [stat, realPath] = await Promise.all([
    deps.fs.lstat(resolved),
    deps.fs.realpath(resolved)
  ]);
  const canonical = process.platform === "win32"
    ? (value) => path.resolve(value).toLocaleLowerCase("en-US")
    : (value) => path.resolve(value);
  if (!stat.isDirectory() || stat.isSymbolicLink() || canonical(realPath) !== canonical(resolved)) {
    throw launcherError("LAUNCHER_RUNTIME_UNSAFE", "The launcher runtime path is not a normal local directory.");
  }
}

async function acquireStartLock(runtime, deps, signal = null) {
  if (process.platform === "win32") return acquireWindowsStartLock(runtime, deps, signal);
  const nonce = deps.randomToken(24);
  const record = JSON.stringify({ schemaVersion: 1, pid: deps.pid, nonce, createdAt: deps.now().toISOString() });
  const deadline = deps.nowMs() + 2_000;
  for (;;) {
    throwIfStartCancelled(signal);
    let handle;
    let createdStat = null;
    try {
      handle = await deps.fs.open(runtime.lockPath, "wx", 0o600);
      await handle.writeFile(record, "utf8");
      await handle.sync();
      createdStat = await handle.stat();
      await handle.close();
      handle = null;
      return async () => {
        const removed = await unlinkFileIfIdentity(runtime.lockPath, createdStat, deps).catch(() => false);
        if (!removed) throw launcherError("LAUNCHER_START_LOCK_CLEANUP_FAILED", "The launcher start lock changed before release and was retained.");
      };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error.code !== "EEXIST") {
        if (createdStat) {
          let cleaned = false;
          try {
            cleaned = await unlinkFileIfIdentity(runtime.lockPath, createdStat, deps);
          } catch {}
          if (!cleaned) {
            throw launcherError("LAUNCHER_START_LOCK_CLEANUP_FAILED", "A failed start lock write could not be cleaned safely.", error);
          }
        }
        throw error;
      }
      if (deps.nowMs() >= deadline) {
        throw launcherError("LAUNCHER_START_LOCKED", "Another launcher is starting this candidate. No second service was created.");
      }
      await deps.sleep(50);
    }
  }
}

async function acquireWindowsStartLock(runtime, deps, signal) {
  const candidateId = path.basename(runtime.runtimeDir);
  const pipeName = `\\\\.\\pipe\\CodeClaw-launcher-v1-${candidateId}`;
  const deadline = deps.nowMs() + 2_000;
  for (;;) {
    throwIfStartCancelled(signal);
    const sockets = new Set();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.destroy();
    });
    const outcome = await new Promise((resolve) => {
      const finish = (value) => {
        server.off("error", onError);
        server.off("listening", onListening);
        resolve(value);
      };
      const onError = (error) => finish({ ok: false, error });
      const onListening = () => finish({ ok: true });
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(pipeName);
    });
    if (outcome.ok) {
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        const close = new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
        for (const socket of sockets) socket.destroy();
        let timer;
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => reject(
            launcherError("LAUNCHER_START_LOCK_CLEANUP_FAILED", "The Windows launcher lock did not close within its bounded deadline.")
          ), 1_000);
          timer.unref?.();
        });
        try {
          await Promise.race([close, timeout]);
        } finally {
          clearTimeout(timer);
        }
      };
    }
    try { server.close(); } catch {}
    if (outcome.error?.code !== "EADDRINUSE") throw outcome.error;
    if (deps.nowMs() >= deadline) {
      throw launcherError("LAUNCHER_START_LOCKED", "Another launcher is starting or stopping this candidate. No second service was created.");
    }
    await deps.sleep(50);
  }
}

async function unlinkFileIfIdentity(filePath, expected, deps) {
  const current = await deps.fs.lstat(filePath);
  if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || !sameFileStat(current, expected)) return false;
  await deps.fs.unlink(filePath);
  return true;
}

async function readInstance(runtime, deps) {
  try {
    await assertNormalRuntimeDirectory(runtime.runtimeDir, deps);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error.code?.startsWith("LAUNCHER_")) throw error;
    throw launcherError("LAUNCHER_RUNTIME_UNSAFE", "The launcher runtime path is not a normal local directory.", error);
  }
  let raw;
  try {
    raw = await readSmallText(runtime.instancePath, INSTANCE_FILE_MAX_BYTES, deps);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw launcherError("LAUNCHER_INSTANCE_FILE_UNSAFE", "The launcher instance control file is unreadable or unsafe.", error);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw launcherError("LAUNCHER_INSTANCE_FILE_INVALID", "The launcher instance control file is invalid.", error);
  }
  const instance = validateInstance(parsed);
  if (raw !== `${JSON.stringify(instance, null, 2)}\n`) {
    throw launcherError("LAUNCHER_INSTANCE_FILE_INVALID", "The launcher instance control file is not canonical.");
  }
  return instance;
}

async function writeInstance(runtime, instance, deps) {
  validateInstance(instance);
  const temporaryPath = `${runtime.instancePath}.${instance.instanceId}.tmp`;
  const content = `${JSON.stringify(instance, null, 2)}\n`;
  let handle;
  try {
    handle = await deps.fs.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await deps.fs.rename(temporaryPath, runtime.instancePath);
  } finally {
    await handle?.close().catch(() => {});
    await deps.fs.unlink(temporaryPath).catch(() => {});
  }
}

async function removeInstanceIfOwned(runtime, instanceId, deps) {
  let observed;
  try {
    observed = await readInstance(runtime, deps);
  } catch {
    return false;
  }
  if (!observed || observed.instanceId !== instanceId) return false;
  await deps.fs.unlink(runtime.instancePath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  return true;
}

async function removeInstanceAfterChildExit(runtime, instanceId, shouldPreserve, deps) {
  const releaseLock = await acquireStartLock(runtime, deps);
  try {
    if (shouldPreserve()) return false;
    return await removeInstanceIfOwned(runtime, instanceId, deps);
  } finally {
    await releaseLock();
  }
}

async function readSmallText(filePath, maxBytes, deps) {
  const before = await deps.fs.lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maxBytes) {
    throw launcherError("LAUNCHER_CONTROL_FILE_UNSAFE", "A launcher control file is not a bounded normal file.");
  }
  const handle = await deps.fs.open(filePath, "r");
  try {
    const opened = await handle.stat();
    if (!sameFileStat(before, opened)) throw launcherError("LAUNCHER_CONTROL_FILE_CHANGED", "A launcher control file changed before it was read.");
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const read = await handle.read(buffer, offset, buffer.length - offset, null);
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    if (offset > maxBytes) throw launcherError("LAUNCHER_CONTROL_FILE_TOO_LARGE", "A launcher control file exceeded its size limit.");
    const after = await handle.stat();
    const pathAfter = await deps.fs.lstat(filePath);
    if (!sameFileStat(opened, after) || !sameFileStat(after, pathAfter)) {
      throw launcherError("LAUNCHER_CONTROL_FILE_CHANGED", "A launcher control file changed while it was read.");
    }
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, offset));
  } finally {
    await handle.close();
  }
}

async function fetchJson(url, init, deps, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await deps.fetch(url, { ...init, redirect: "error", signal: controller.signal });
    if (response?.redirected === true || (response?.url && response.url !== String(url))) {
      throw launcherError("LAUNCHER_HTTP_REDIRECTED", "A local launcher request was redirected or returned from an unexpected URL.");
    }
    if (!response?.ok) throw launcherError("LAUNCHER_HTTP_REJECTED", "A local launcher request was rejected.");
    const responseType = String(response.headers?.get?.("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    if (responseType !== "application/json") {
      throw launcherError("LAUNCHER_HTTP_TYPE_INVALID", "A local launcher response was not JSON.");
    }
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > HEALTH_MAX_BYTES) {
      throw launcherError("LAUNCHER_HTTP_TOO_LARGE", "A local launcher response exceeded its size limit.");
    }
    const chunks = [];
    let observed = 0;
    for await (const chunk of response.body || []) {
      const buffer = Buffer.from(chunk);
      observed += buffer.byteLength;
      if (observed > HEALTH_MAX_BYTES) throw launcherError("LAUNCHER_HTTP_TOO_LARGE", "A local launcher response exceeded its size limit.");
      chunks.push(buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } finally {
    clearTimeout(timeout);
  }
}

function launcherDependencies(injected) {
  const env = injected.env || process.env;
  return {
    fs: injected.fs || fs,
    fetch: injected.fetch || globalThis.fetch,
    env,
    execPath: injected.execPath || process.execPath,
    nodeVersion: injected.nodeVersion || process.versions.node,
    localAppData: injected.localAppData || env.LOCALAPPDATA || "",
    pid: injected.pid || process.pid,
    now: injected.now || (() => new Date()),
    nowMs: injected.nowMs || Date.now,
    uptimeMs: injected.uptimeMs || (() => os.uptime() * 1_000),
    sleep: injected.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
    randomUUID: injected.randomUUID || randomUUID,
    randomToken: injected.randomToken || ((bytes) => randomBytes(bytes).toString("base64url")),
    processAlive: injected.processAlive || defaultProcessAlive,
    probeTcp: injected.probeTcp || probeTcp,
    openBrowser: injected.openBrowser || defaultOpenBrowser,
    spawnServer: injected.spawnServer || defaultSpawnServer,
    releaseServerStart: injected.releaseServerStart || defaultReleaseServerStart,
    terminateChildTree: injected.terminateChildTree || ((child) => terminateProcessTree(child, { graceMs: 500, forceAfterMs: 2_000, helperTimeoutMs: 2_000 })),
    terminatePidTree: injected.terminatePidTree || terminatePidTree
  };
}

function defaultSpawnServer({ command, args, cwd, env }) {
  return spawn(command, args, processSpawnOptions({
    cwd,
    env,
    stdio: ["pipe", "ignore", "ignore"]
  }));
}

function defaultReleaseServerStart(child, instance) {
  const input = child?.stdin;
  if (!input || typeof input.end !== "function" || input.destroyed || input.writableEnded) {
    return Promise.reject(launcherError("LAUNCHER_START_GATE_UNAVAILABLE", "The local service start gate was unavailable."));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.off("error", onError);
      if (error) reject(launcherError("LAUNCHER_START_GATE_FAILED", "The local service start gate could not be released.", error));
      else resolve();
    };
    const onError = (error) => finish(error);
    input.once("error", onError);
    const timer = setTimeout(() => {
      input.destroy();
      finish(launcherError("LAUNCHER_START_GATE_TIMEOUT", "The local service start gate exceeded its bounded deadline."));
    }, 2_000);
    input.end(`${instance.launchNonce}\n`, (error) => finish(error || null));
  });
}

function defaultOpenBrowser(url) {
  if (process.platform !== "win32") throw launcherError("LAUNCHER_BROWSER_UNSUPPORTED", "Automatic browser opening is available only in the Windows launcher.");
  return new Promise((resolve, reject) => {
    const child = spawn("explorer.exe", [url], { shell: false, windowsHide: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function probeTcp(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: LOOPBACK_HOST, port });
    let settled = false;
    const finish = (busy) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(busy);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    const timer = setTimeout(() => finish(true), timeoutMs);
    timer.unref?.();
  });
}

async function terminatePidTree(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return { terminated: false };
  if (process.platform === "win32") {
    const exitCode = await runBoundedHelper("taskkill.exe", ["/PID", String(pid), "/T", "/F"], 3_000);
    return { terminated: exitCode === 0, treeTerminationVerified: exitCode === 0 };
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error.code === "ESRCH") return { terminated: true, treeTerminationVerified: true };
    return { terminated: false };
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (!defaultProcessAlive(pid)) return { terminated: true, treeTerminationVerified: true };
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 100));
  return { terminated: !defaultProcessAlive(pid), treeTerminationVerified: !defaultProcessAlive(pid) };
}

function runBoundedHelper(command, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: "ignore" });
    let settled = false;
    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(exitCode);
    };
    child.once("error", () => finish(null));
    child.once("close", finish);
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(null);
    }, timeoutMs);
    timer.unref?.();
  });
}

function normalizeCandidate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw launcherError("LAUNCHER_CANDIDATE_INVALID", "Candidate verification did not return a valid identity.");
  }
  const candidateId = String(value.candidateId || "");
  const packageVersion = String(value.packageVersion || "");
  const sourceCommit = String(value.sourceCommit || "");
  if (!SAFE_CANDIDATE_ID.test(candidateId)
    || !SAFE_PACKAGE_VERSION.test(packageVersion)
    || !COMMIT.test(sourceCommit)
    || value.sourceDirty !== false) {
    throw launcherError("LAUNCHER_CANDIDATE_IDENTITY_INVALID", "The verified candidate identity is incomplete or unsafe.");
  }
  return Object.freeze({ ...value, candidateId, packageVersion, sourceCommit: sourceCommit.toLowerCase() });
}

function validateInstance(value) {
  const keys = Object.keys(value || {}).sort();
  const reserved = value?.phase === "reserved";
  if (JSON.stringify(keys) !== JSON.stringify(INSTANCE_KEYS)
    || value.schemaVersion !== 1
    || value.launcherProtocol !== LAUNCHER_PROTOCOL
    || !SAFE_CANDIDATE_ID.test(value.candidateId || "")
    || !SAFE_PACKAGE_VERSION.test(value.packageVersion || "")
    || !COMMIT.test(value.sourceCommit || "")
    || !SAFE_INSTANCE_ID.test(value.instanceId || "")
    || !SAFE_TOKEN.test(value.launchNonce || "")
    || !SAFE_TOKEN.test(value.shutdownToken || "")
    || !Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65_535
    || !Number.isSafeInteger(value.launcherPid) || value.launcherPid <= 0
    || !Number.isSafeInteger(value.launcherUptimeMs) || value.launcherUptimeMs < 0
    || !Number.isSafeInteger(value.serverPid) || (reserved ? value.serverPid !== 0 : value.serverPid <= 0)
    || !["reserved", "starting", "ready"].includes(value.phase)
    || !validIsoDate(value.startedAt)) {
    throw launcherError("LAUNCHER_INSTANCE_FILE_INVALID", "The launcher instance control file has an invalid schema.");
  }
  return value;
}

function assertInstanceCandidate(instance, candidate) {
  if (instance.candidateId !== candidate.candidateId
    || instance.packageVersion !== candidate.packageVersion
    || instance.sourceCommit.toLowerCase() !== candidate.sourceCommit) {
    throw launcherError("LAUNCHER_INSTANCE_CANDIDATE_MISMATCH", "The runtime control file belongs to a different candidate identity.");
  }
}

function assertSameCandidateIdentity(left, right) {
  if (left.candidateId !== right.candidateId
    || left.packageVersion !== right.packageVersion
    || left.sourceCommit !== right.sourceCommit) {
    throw launcherError("LAUNCHER_CANDIDATE_CHANGED", "The candidate identity changed before the local service could be spawned.");
  }
}

function publicStartResult(state, candidate, instance, browser) {
  return {
    ok: true,
    command: "start",
    state,
    candidate: publicCandidate(candidate),
    instanceId: instance.instanceId,
    host: LOOPBACK_HOST,
    port: instance.port,
    url: browser.url,
    browserOpened: browser.opened,
    browserSkipped: browser.skipped,
    warnings: browser.warning ? [browser.warning] : []
  };
}

function publicStoppedResult(state, candidate, instance, portReleased, forced = false) {
  return {
    ok: true,
    command: "stop",
    state,
    candidate: publicCandidate(candidate),
    instanceId: instance?.instanceId || "",
    host: LOOPBACK_HOST,
    port: instance?.port || null,
    portReleased,
    forced
  };
}

function publicStatusResult(state, candidate, instance, identityVerified) {
  return {
    ok: true,
    command: "status",
    state,
    candidate: publicCandidate(candidate),
    instanceId: instance?.instanceId || "",
    host: LOOPBACK_HOST,
    port: instance?.port || null,
    identityVerified
  };
}

function publicCandidate(candidate) {
  return {
    candidateId: candidate.candidateId,
    packageVersion: candidate.packageVersion,
    sourceCommit: candidate.sourceCommit
  };
}

function publicErrorMessage(code) {
  const messages = {
    LAUNCHER_NODE_UNSUPPORTED: "Install Node.js 20 or newer, then start CodeClaw again.",
    LAUNCHER_EXPLICIT_PORT_IN_USE: "The requested loopback port is occupied. Stop that service or choose another explicit port.",
    LAUNCHER_NO_AVAILABLE_PORT: "No bounded CodeClaw loopback port is currently available.",
    LAUNCHER_INSTANCE_IDENTITY_UNVERIFIED: "A recorded process could not be proven to be this CodeClaw candidate; it was left untouched.",
    LAUNCHER_STOP_IDENTITY_MISMATCH: "Stop was refused because the recorded service identity did not match.",
    LAUNCHER_STOP_IDENTITY_LOST: "Stop could not safely prove the process identity after the graceful deadline.",
    LAUNCHER_STOP_TREE_UNVERIFIED: "Forced process-tree cleanup could not be verified.",
    LAUNCHER_READY_TIMEOUT: "CodeClaw did not become ready before the startup deadline.",
    LAUNCHER_SERVER_EXITED_BEFORE_READY: "CodeClaw exited before it became ready.",
    LAUNCHER_START_CLEANUP_UNVERIFIED: "A failed startup could not prove process-tree cleanup. Its control record was retained; do not start another instance.",
    LAUNCHER_BROWSER_OPEN_FAILED: "CodeClaw is ready, but Windows could not open the default browser automatically."
  };
  return messages[code] || "CodeClaw launcher stopped safely. Use the launcher status command for the current local state.";
}

function launcherError(code, message, cause = undefined) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function validPort(value) {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw launcherError("LAUNCHER_PORT_INVALID", "The launcher port must be an integer between 1 and 65535.");
  }
  return parsed;
}

function validIsoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function reservationOwnerMayResume(instance, deps) {
  const currentUptimeMs = Math.floor(Number(deps.uptimeMs()));
  if (Number.isSafeInteger(currentUptimeMs) && currentUptimeMs >= 0
    && currentUptimeMs < instance.launcherUptimeMs) return false;
  return deps.processAlive(instance.launcherPid);
}

function safeTextEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sameFileStat(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.birthtimeMs === right.birthtimeMs
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.mode === right.mode
    && left.nlink === right.nlink;
}

function defaultProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function throwIfStartCancelled(signal) {
  if (!signal?.aborted) return;
  throw launcherError("LAUNCHER_START_CANCELLED", "The launcher start was cancelled before browser handoff.");
}
