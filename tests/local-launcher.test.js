import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { EventEmitter, once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  createLocalLauncher,
  launcherProof,
  publicLauncherError
} from "../packages/local-launcher/src/index.js";

const DEMO_PACKAGE = '{"name":"codeclaw-runtime-demo"}\n';
const CANDIDATE = Object.freeze({
  candidateId: "codeclaw-candidate-0123456789abcdef",
  packageVersion: "0.1.0",
  sourceCommit: "a".repeat(40),
  sourceDirty: false,
  authority: {
    directories: ["examples", "examples/demo-js"],
    files: [{
      path: "examples/demo-js/package.json",
      size: Buffer.byteLength(DEMO_PACKAGE),
      sha256: createHash("sha256").update(DEMO_PACKAGE).digest("hex")
    }]
  }
});

test("launcher proof uses the fixed canonical UTF-8 HMAC message", () => {
  const input = {
    shutdownToken: "s".repeat(43),
    candidateId: CANDIDATE.candidateId,
    instanceId: "instance-00000001",
    launchNonce: "n".repeat(32),
    serverPid: 424_242,
    port: 4173,
    challenge: "c".repeat(32)
  };
  const expected = createHmac("sha256", input.shutdownToken)
    .update(`codeclaw-launcher-v1\n${input.candidateId}\n${input.instanceId}\n${input.launchNonce}\n${input.serverPid}\n${input.port}\n${input.challenge}`, "utf8")
    .digest("base64url");
  assert.equal(launcherProof(input), expected);
});

test("candidate verification failure causes zero spawn, browser, and runtime writes", async (t) => {
  const localAppData = await temporaryDirectory(t, "codeclaw-launcher-no-spawn-");
  let spawned = 0;
  let browsers = 0;
  const launcher = createLocalLauncher({
    candidateRoot: localAppData,
    verifyCandidateIntegrity: async () => {
      throw Object.assign(new Error("private absolute candidate failure"), { code: "CANDIDATE_TAMPERED" });
    },
    dependencies: {
      localAppData,
      spawnServer: () => { spawned += 1; },
      openBrowser: () => { browsers += 1; }
    }
  });

  await assert.rejects(() => launcher.start(), { code: "CANDIDATE_TAMPERED" });
  assert.equal(spawned, 0);
  assert.equal(browsers, 0);
  await assert.rejects(fs.stat(path.join(localAppData, "CodeClaw")), { code: "ENOENT" });
  const publicError = publicLauncherError(Object.assign(new Error("C:\\Users\\private\\candidate"), { code: "CANDIDATE_TAMPERED" }));
  assert.doesNotMatch(JSON.stringify(publicError), /private|Users|candidate failure/i);
});

test("launcher rejects unsupported Node before candidate verification", async (t) => {
  const localAppData = await temporaryDirectory(t, "codeclaw-launcher-node-");
  let verified = 0;
  const launcher = createLocalLauncher({
    candidateRoot: localAppData,
    verifyCandidateIntegrity: async () => { verified += 1; return CANDIDATE; },
    dependencies: { localAppData, nodeVersion: "18.20.0" }
  });
  await assert.rejects(() => launcher.start(), { code: "LAUNCHER_NODE_UNSUPPORTED" });
  assert.equal(verified, 0);
});

test("launcher starts only after identity verification, waits for matching ready, and emits no secret diagnostics", async (t) => {
  const harness = await mockHarness(t);
  const result = await harness.launcher.start();

  assert.equal(result.state, "started");
  assert.equal(result.host, "127.0.0.1");
  assert.equal(result.port, 4173);
  assert.equal(result.browserOpened, true);
  assert.deepEqual(harness.events.slice(0, 4), ["verify", "verify", "spawn", "health"]);
  assert.equal(harness.events.at(-1), "browser");
  assert.equal(harness.spawnEnv.CODECLAW_LAUNCHER_PROTOCOL, "1");
  assert.equal(harness.spawnEnv.CODECLAW_CANDIDATE_ID, CANDIDATE.candidateId);
  assert.equal(harness.spawnEnv.CODECLAW_PACKAGE_VERSION, CANDIDATE.packageVersion);
  assert.equal(harness.spawnEnv.CODECLAW_SOURCE_COMMIT, CANDIDATE.sourceCommit);
  assert.match(harness.spawnEnv.CODECLAW_STATE_DIR, new RegExp(`CodeClaw[\\\\/]launcher-v1[\\\\/]${CANDIDATE.candidateId}[\\\\/]state$`));
  assert.match(harness.spawnEnv.CODECLAW_DEMO_ROOT, new RegExp(`CodeClaw[\\\\/]launcher-v1[\\\\/]${CANDIDATE.candidateId}[\\\\/]demo$`));
  assert.equal(await fs.readFile(path.join(harness.spawnEnv.CODECLAW_DEMO_ROOT, "package.json"), "utf8"), DEMO_PACKAGE);
  await fs.writeFile(path.join(harness.spawnEnv.CODECLAW_DEMO_ROOT, "package.json"), "runtime mutation\n", "utf8");
  assert.equal(await fs.readFile(path.join(harness.candidateRoot, "examples", "demo-js", "package.json"), "utf8"), DEMO_PACKAGE);
  assert.equal("PRIVATE_API_KEY" in harness.spawnEnv, false);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, new RegExp(harness.spawnEnv.CODECLAW_SHUTDOWN_TOKEN));
  assert.doesNotMatch(serialized, new RegExp(escapeRegExp(harness.localAppData)));
  assert.equal(Object.keys(result).includes("child"), false);

  const status = await harness.launcher.status();
  assert.equal(status.state, "running");
  assert.equal(status.identityVerified, true);
  const stopped = await harness.launcher.stop();
  assert.equal(stopped.state, "stopped");
  assert.equal(stopped.portReleased, true);
  assert.equal(stopped.forced, false);
  assert.equal(harness.shutdownBody.instanceId, harness.spawnEnv.CODECLAW_INSTANCE_ID);
  assert.equal(harness.shutdownBody.token, harness.spawnEnv.CODECLAW_SHUTDOWN_TOKEN);
  assert.equal((await harness.launcher.status()).state, "not-running");
});

test("default launch safely skips an unknown 4173 occupant and uses 4174", async (t) => {
  const harness = await mockHarness(t, { occupiedPorts: new Set([4173]) });
  const result = await harness.launcher.start({ noBrowser: true });
  assert.equal(result.port, 4174);
  assert.equal(harness.spawnEnv.CODECLAW_PORT, "4174");
  assert.equal(result.browserSkipped, true);
  await harness.launcher.stop();
});

test("an occupied explicit port fails closed without spawn, browser, or termination", async (t) => {
  const harness = await mockHarness(t, { occupiedPorts: new Set([51234]) });
  await assert.rejects(
    () => harness.launcher.start({ port: 51234 }),
    { code: "LAUNCHER_EXPLICIT_PORT_IN_USE" }
  );
  assert.equal(harness.spawnCount, 0);
  assert.equal(harness.browserCount, 0);
  assert.equal(harness.terminationCount, 0);
});

test("a same-candidate claim without local HMAC authority blocks instead of starting a second port", async (t) => {
  const harness = await mockHarness(t, {
    occupiedPorts: new Set([4173]),
    claimedCandidateOnOccupiedPort: true
  });
  await assert.rejects(
    () => harness.launcher.start({ noBrowser: true }),
    { code: "LAUNCHER_INSTANCE_IDENTITY_UNVERIFIED" }
  );
  assert.equal(harness.spawnCount, 0);
  assert.equal(harness.browserCount, 0);
});

test("a free earlier port cannot hide the same candidate later in the bounded range", async (t) => {
  const harness = await mockHarness(t, {
    occupiedPorts: new Set([4174]),
    claimedCandidateOnOccupiedPort: true
  });
  await assert.rejects(
    () => harness.launcher.start({ noBrowser: true }),
    { code: "LAUNCHER_INSTANCE_IDENTITY_UNVERIFIED" }
  );
  assert.equal(harness.spawnCount, 0);
  assert.equal(harness.browserCount, 0);
});

test("a second launch reuses only the valid HMAC-bound same-candidate instance", async (t) => {
  const harness = await mockHarness(t);
  const first = await harness.launcher.start({ noBrowser: true });
  const second = await harness.launcher.start({ noBrowser: true });
  assert.equal(first.state, "started");
  assert.equal(second.state, "reused");
  assert.equal(second.instanceId, first.instanceId);
  assert.equal(harness.spawnCount, 1);
  await harness.launcher.stop();
});

test("concurrent launchers serialize candidate start and create only one service", async (t) => {
  const harness = await mockHarness(t);
  const [first, second] = await Promise.all([
    harness.launcher.start({ noBrowser: true }),
    harness.launcher.start({ noBrowser: true })
  ]);
  assert.deepEqual([first.state, second.state].sort(), ["reused", "started"]);
  assert.equal(first.instanceId, second.instanceId);
  assert.equal(harness.spawnCount, 1);
  await harness.launcher.stop();
});

test("stop never terminates an active PID after identity proof fails", async (t) => {
  const harness = await mockHarness(t);
  await harness.launcher.start({ noBrowser: true });
  harness.proofValid = false;
  await assert.rejects(() => harness.launcher.stop(), { code: "LAUNCHER_STOP_IDENTITY_MISMATCH" });
  assert.equal(harness.terminationCount, 0);
  assert.equal(harness.alive, true);
  harness.proofValid = true;
  await harness.launcher.stop();
});

test("forced cleanup runs only while the same instance HMAC remains valid", async (t) => {
  const verified = await mockHarness(t, { shutdownStops: false });
  await verified.launcher.start({ noBrowser: true });
  const stopped = await verified.launcher.stop();
  assert.equal(stopped.forced, true);
  assert.equal(verified.terminationCount, 1);

  const lost = await mockHarness(t, { shutdownStops: false, invalidateProofAfterShutdown: true });
  await lost.launcher.start({ noBrowser: true });
  await assert.rejects(() => lost.launcher.stop(), { code: "LAUNCHER_STOP_IDENTITY_LOST" });
  assert.equal(lost.terminationCount, 0);
  assert.equal(lost.alive, true);
  lost.proofValid = true;
  await lost.launcher.stop();
});

test("forced stop rejects direct-process success without verified tree cleanup", async (t) => {
  const harness = await mockHarness(t, {
    shutdownStops: false,
    treeTerminationVerified: false
  });
  await harness.launcher.start({ noBrowser: true });
  await assert.rejects(() => harness.launcher.stop(), { code: "LAUNCHER_STOP_TREE_UNVERIFIED" });
  assert.equal(harness.terminationCount, 1);
});

test("all launcher HTTP capabilities disable redirects and reject an unexpected response URL", async (t) => {
  const harness = await mockHarness(t);
  await harness.launcher.start({ noBrowser: true });
  await harness.launcher.status();
  assert.ok(harness.fetchRedirects.length > 0);
  assert.deepEqual(new Set(harness.fetchRedirects), new Set(["error"]));

  harness.responseUrlOverride = "http://127.0.0.1:4173/redirected";
  await assert.rejects(() => harness.launcher.stop(), { code: "LAUNCHER_STOP_IDENTITY_MISMATCH" });
  assert.equal(harness.shutdownBody, null);
  harness.responseUrlOverride = "";
  await harness.launcher.stop();
});

test("cancellation during a new browser handoff proves child cleanup before returning", async (t) => {
  let enterBrowser;
  let releaseBrowser;
  const browserEntered = new Promise((resolve) => { enterBrowser = resolve; });
  const browserGate = new Promise((resolve) => { releaseBrowser = resolve; });
  const harness = await mockHarness(t, {
    openBrowserHook: async () => {
      enterBrowser();
      await browserGate;
    }
  });
  const controller = new AbortController();
  const start = harness.launcher.start({ signal: controller.signal });
  await browserEntered;
  controller.abort();
  releaseBrowser();
  await assert.rejects(() => start, { code: "LAUNCHER_START_CANCELLED" });
  assert.equal(harness.terminationCount, 1);
  assert.equal(harness.alive, false);
});

test("cancellation during reused browser handoff does not stop the existing instance", async (t) => {
  let enterBrowser;
  let releaseBrowser;
  const browserEntered = new Promise((resolve) => { enterBrowser = resolve; });
  const browserGate = new Promise((resolve) => { releaseBrowser = resolve; });
  const harness = await mockHarness(t, {
    openBrowserHook: async () => {
      enterBrowser();
      await browserGate;
    }
  });
  await harness.launcher.start({ noBrowser: true });
  const controller = new AbortController();
  const reused = harness.launcher.start({ signal: controller.signal });
  await browserEntered;
  controller.abort();
  releaseBrowser();
  await assert.rejects(() => reused, { code: "LAUNCHER_START_CANCELLED" });
  assert.equal(harness.alive, true);
  assert.equal(harness.terminationCount, 0);
  await harness.launcher.stop();
});

test("a pre-spawn reservation recovers without a duplicate after control publication fails", async (t) => {
  let instanceRenames = 0;
  let failPublication = true;
  const fileSystem = fileSystemWithRename(async (source, target) => {
    if (path.basename(target) === "instance.json" && ++instanceRenames === 2 && failPublication) {
      throw Object.assign(new Error("simulated control publication failure"), { code: "EIO" });
    }
    return fs.rename(source, target);
  });
  const harness = await mockHarness(t, {
    fileSystem,
    startTreeTerminationVerified: false
  });
  await assert.rejects(() => harness.launcher.start({ noBrowser: true }), {
    code: "LAUNCHER_START_CLEANUP_UNVERIFIED"
  });
  const controlPath = path.join(harness.localAppData, "CodeClaw", "launcher-v1", CANDIDATE.candidateId, "instance.json");
  const reserved = JSON.parse(await fs.readFile(controlPath, "utf8"));
  assert.equal(reserved.phase, "reserved");
  assert.equal(reserved.serverPid, 0);

  failPublication = false;
  const recovered = await harness.launcher.start({ noBrowser: true });
  assert.equal(recovered.state, "reused");
  const recoveredControl = JSON.parse(await fs.readFile(controlPath, "utf8"));
  assert.equal(recoveredControl.serverPid, harness.child.pid);
  assert.equal(recoveredControl.phase, "ready");
  assert.equal(harness.spawnCount, 1);
  await harness.launcher.stop();
});

test("an unverified reserved control remains after the direct child later exits", async (t) => {
  let instanceRenames = 0;
  const fileSystem = fileSystemWithRename(async (source, target) => {
    if (path.basename(target) === "instance.json" && ++instanceRenames === 2) {
      throw Object.assign(new Error("simulated control publication failure"), { code: "EIO" });
    }
    return fs.rename(source, target);
  });
  const harness = await mockHarness(t, {
    fileSystem,
    startTreeTerminationVerified: false
  });
  await assert.rejects(() => harness.launcher.start({ noBrowser: true }), {
    code: "LAUNCHER_START_CLEANUP_UNVERIFIED"
  });
  harness.child.emit("exit", 0, null);
  await new Promise((resolve) => setTimeout(resolve, 75));
  const controlPath = path.join(harness.localAppData, "CodeClaw", "launcher-v1", CANDIDATE.candidateId, "instance.json");
  const retained = JSON.parse(await fs.readFile(controlPath, "utf8"));
  assert.equal(retained.phase, "reserved");
  const stopped = await harness.launcher.stop();
  assert.equal(stopped.state, "stale-control-removed");
});

test("a dead or pre-reboot reservation is safely recovered because an unreleased child gate cannot listen", async (t) => {
  const deadOwner = await mockHarness(t);
  await writeReservedControl(deadOwner, { launcherPid: 777_001 });
  const started = await deadOwner.launcher.start({ noBrowser: true });
  assert.equal(started.state, "started");
  assert.equal(deadOwner.spawnCount, 1);
  await deadOwner.launcher.stop();

  const rebooted = await mockHarness(t, {
    processAliveOverride: (pid) => pid === 777_002,
    uptimeMs: () => 10_000
  });
  await writeReservedControl(rebooted, {
    launcherPid: 777_002,
    launcherUptimeMs: 60_000
  });
  const afterReboot = await rebooted.launcher.start({ noBrowser: true });
  assert.equal(afterReboot.state, "started");
  assert.equal(rebooted.spawnCount, 1);
  await rebooted.launcher.stop();
});

test("a same-boot reservation with a live launcher owner blocks a second spawn", async (t) => {
  const harness = await mockHarness(t, {
    processAliveOverride: (pid) => pid === 777_003,
    uptimeMs: () => 60_000
  });
  await writeReservedControl(harness, {
    launcherPid: 777_003,
    launcherUptimeMs: 10_000
  });
  await assert.rejects(() => harness.launcher.start({ noBrowser: true }), {
    code: "LAUNCHER_INSTANCE_IDENTITY_UNVERIFIED"
  });
  assert.equal(harness.spawnCount, 0);
});

test("instance control canonicality rejects a UTF-8 BOM", async (t) => {
  const harness = await mockHarness(t);
  await harness.launcher.start({ noBrowser: true });
  const controlPath = path.join(harness.localAppData, "CodeClaw", "launcher-v1", CANDIDATE.candidateId, "instance.json");
  const canonical = await fs.readFile(controlPath);
  await fs.writeFile(controlPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), canonical]));
  await assert.rejects(() => harness.launcher.status(), { code: "LAUNCHER_INSTANCE_FILE_INVALID" });
  await fs.writeFile(controlPath, canonical);
  await harness.launcher.stop();
});

test("Windows Named Pipe lock release is not held open by a connected local client", {
  skip: process.platform !== "win32"
}, async (t) => {
  let socket = null;
  const harness = await mockHarness(t, {
    openBrowserHook: async () => {
      socket = net.connect(`\\\\.\\pipe\\CodeClaw-launcher-v1-${CANDIDATE.candidateId}`);
      await Promise.race([
        once(socket, "connect"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("pipe connect timeout")), 500))
      ]);
    }
  });
  t.after(() => socket?.destroy());
  const result = await Promise.race([
    harness.launcher.start(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("lock release timeout")), 1_500))
  ]);
  assert.equal(result.state, "started");
  await harness.launcher.stop();
});

async function mockHarness(t, {
  occupiedPorts = new Set(),
  claimedCandidateOnOccupiedPort = false,
  shutdownStops = true,
  invalidateProofAfterShutdown = false,
  treeTerminationVerified = true,
  startTreeTerminationVerified = true,
  fileSystem = fs,
  openBrowserHook = null,
  processAliveOverride = null,
  uptimeMs = null
} = {}) {
  const localAppData = await temporaryDirectory(t, "codeclaw-launcher-harness-");
  const candidateRoot = await temporaryDirectory(t, "codeclaw-launcher-candidate-");
  await fs.mkdir(path.join(candidateRoot, "examples", "demo-js"), { recursive: true });
  await fs.writeFile(path.join(candidateRoot, "examples", "demo-js", "package.json"), DEMO_PACKAGE, "utf8");
  const events = [];
  let spawnEnv = null;
  let spawnCount = 0;
  let browserCount = 0;
  let terminationCount = 0;
  let shutdownBody = null;
  let alive = false;
  let proofValid = true;
  let proofInvalidated = false;
  let responseUrlOverride = "";
  const fetchRedirects = [];
  const child = new EventEmitter();
  child.pid = 424_242;
  child.exitCode = null;
  child.signalCode = null;
  child.once("exit", (exitCode, signalCode) => {
    alive = false;
    child.exitCode = exitCode;
    child.signalCode = signalCode;
  });

  const dependencies = {
    fs: fileSystem,
    localAppData,
    env: {
      LOCALAPPDATA: localAppData,
      PATH: process.env.PATH || "",
      PRIVATE_API_KEY: "must-not-be-inherited"
    },
    pid: 313_131,
    randomUUID: () => "instance-00000001",
    randomToken: (bytes) => (bytes === 32 ? "s".repeat(43) : "n".repeat(32)),
    ...(uptimeMs ? { uptimeMs } : {}),
    spawnServer: ({ env }) => {
      events.push("spawn");
      spawnCount += 1;
      spawnEnv = env;
      alive = true;
      return child;
    },
    processAlive: (pid) => processAliveOverride ? processAliveOverride(pid) : pid === child.pid && alive,
    probeTcp: async (port) => occupiedPorts.has(port) || (alive && Number(spawnEnv?.CODECLAW_PORT) === port),
    fetch: async (url, init = {}) => {
      fetchRedirects.push(init.redirect);
      const parsed = new URL(url);
      if (init.method === "POST") {
        shutdownBody = JSON.parse(init.body);
        if (invalidateProofAfterShutdown && !proofInvalidated) {
          proofValid = false;
          proofInvalidated = true;
        }
        if (shutdownStops) alive = false;
        return responseWithUrl(jsonResponse({ ok: true }), responseUrlOverride);
      }
      events.push("health");
      if (!alive || !spawnEnv || Number(spawnEnv.CODECLAW_PORT) !== Number(parsed.port)) {
        return responseWithUrl(jsonResponse(claimedCandidateOnOccupiedPort
          ? { ok: true, app: "CodeClaw", launcherProtocol: 1, candidateId: CANDIDATE.candidateId }
          : { ok: false, app: "unrelated" }), responseUrlOverride);
      }
      const challenge = parsed.searchParams.get("challenge");
      const proof = launcherProof({
        shutdownToken: spawnEnv.CODECLAW_SHUTDOWN_TOKEN,
        candidateId: spawnEnv.CODECLAW_CANDIDATE_ID,
        instanceId: spawnEnv.CODECLAW_INSTANCE_ID,
        launchNonce: spawnEnv.CODECLAW_LAUNCH_NONCE,
        serverPid: child.pid,
        port: Number(spawnEnv.CODECLAW_PORT),
        challenge
      });
      return responseWithUrl(jsonResponse({
        ok: true,
        app: "CodeClaw",
        accepting: true,
        launcherProtocol: 1,
        candidateId: spawnEnv.CODECLAW_CANDIDATE_ID,
        packageVersion: spawnEnv.CODECLAW_PACKAGE_VERSION,
        sourceCommit: spawnEnv.CODECLAW_SOURCE_COMMIT,
        instanceId: spawnEnv.CODECLAW_INSTANCE_ID,
        launchNonce: spawnEnv.CODECLAW_LAUNCH_NONCE,
        serverPid: child.pid,
        port: Number(spawnEnv.CODECLAW_PORT),
        proof: proofValid ? proof : "x".repeat(43)
      }), responseUrlOverride);
    },
    openBrowser: async () => {
      events.push("browser");
      browserCount += 1;
      await openBrowserHook?.();
    },
    releaseServerStart: async () => {},
    terminatePidTree: async () => {
      terminationCount += 1;
      alive = false;
      return { terminated: true, treeTerminationVerified };
    },
    terminateChildTree: async () => {
      terminationCount += 1;
      if (startTreeTerminationVerified) alive = false;
      return {
        terminated: startTreeTerminationVerified,
        treeTerminationVerified: startTreeTerminationVerified
      };
    }
  };
  const launcher = createLocalLauncher({
    candidateRoot,
    verifyCandidateIntegrity: async () => {
      events.push("verify");
      return CANDIDATE;
    },
    dependencies,
    readyTimeoutMs: 500,
    healthTimeoutMs: 100,
    pollIntervalMs: 5,
    stopTimeoutMs: 100
  });
  const harness = { launcher, localAppData, candidateRoot, events, child, fetchRedirects };
  for (const [name, getter] of Object.entries({
    spawnEnv: () => spawnEnv,
    spawnCount: () => spawnCount,
    browserCount: () => browserCount,
    terminationCount: () => terminationCount,
    shutdownBody: () => shutdownBody,
    alive: () => alive,
    proofValid: () => proofValid,
    responseUrlOverride: () => responseUrlOverride
  })) {
    Object.defineProperty(harness, name, {
      get: getter,
      set: name === "proofValid"
        ? (value) => { proofValid = value; }
        : name === "responseUrlOverride"
          ? (value) => { responseUrlOverride = value; }
          : undefined,
      enumerable: true
    });
  }
  return harness;
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function responseWithUrl(response, url) {
  if (!url) return response;
  Object.defineProperty(response, "url", { value: url, configurable: true });
  return response;
}

function fileSystemWithRename(rename) {
  return new Proxy(fs, {
    get(target, property) {
      if (property === "rename") return rename;
      return Reflect.get(target, property);
    }
  });
}

async function writeReservedControl(harness, overrides = {}) {
  const runtimeDir = path.join(harness.localAppData, "CodeClaw", "launcher-v1", CANDIDATE.candidateId);
  await fs.mkdir(path.join(runtimeDir, "state"), { recursive: true });
  const control = {
    schemaVersion: 1,
    launcherProtocol: 1,
    candidateId: CANDIDATE.candidateId,
    packageVersion: CANDIDATE.packageVersion,
    sourceCommit: CANDIDATE.sourceCommit,
    instanceId: "reserved-0000000001",
    launchNonce: "n".repeat(32),
    shutdownToken: "s".repeat(43),
    port: 4173,
    launcherPid: 777_001,
    launcherUptimeMs: 10_000,
    serverPid: 0,
    phase: "reserved",
    startedAt: new Date().toISOString(),
    ...overrides
  };
  await fs.writeFile(path.join(runtimeDir, "instance.json"), `${JSON.stringify(control, null, 2)}\n`, "utf8");
}

async function temporaryDirectory(t, prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return directory;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
