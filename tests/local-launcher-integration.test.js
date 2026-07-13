import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalLauncher } from "../packages/local-launcher/src/index.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEMO_PACKAGE = '{"name":"codeclaw-runtime-demo"}\n';
const CANDIDATE = Object.freeze({
  candidateId: "codeclaw-integration-0123456789abcdef",
  packageVersion: "0.1.0",
  sourceCommit: "b".repeat(40),
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

test("real launcher child becomes ready, reports status, stops explicitly, and leaves no process or port orphan", async (t) => {
  const fixture = await launcherFixture(t, healthyServerSource());
  const port = await availablePort();
  let started = null;
  t.after(async () => {
    await stopDirectChild(started?.child);
  });

  started = await fixture.launcher.start({ port, noBrowser: true });
  assert.equal(started.state, "started");
  assert.equal(started.port, port);
  assert.equal(started.browserSkipped, true);
  assert.equal((await fixture.launcher.status()).state, "running");
  const serverPid = started.child.pid;

  const stopped = await fixture.launcher.stop();
  assert.equal(stopped.state, "stopped");
  assert.equal(stopped.portReleased, true);
  assert.equal(stopped.forced, false);
  assert.equal(await waitForProcessGone(started.child, 2_000), true);
  assert.equal(processIsAlive(serverPid), false);
  await assertPortBindable(port);
  assert.equal((await fixture.launcher.status()).state, "not-running");
  await assert.rejects(
    fs.stat(path.join(fixture.localAppData, "CodeClaw", "launcher-v1", CANDIDATE.candidateId, "instance.json")),
    { code: "ENOENT" }
  );
});

test("default launcher stdin gate starts and stops the real CodeClaw server", { timeout: 20_000 }, async (t) => {
  const localAppData = await temporaryDirectory(t, "codeclaw-launcher-real-gate-");
  const demoPackage = await fs.readFile(path.join(PROJECT_ROOT, "examples", "demo-js", "package.json"));
  const candidate = {
    ...CANDIDATE,
    candidateId: "codeclaw-real-gate-0123456789abcdef",
    authority: {
      directories: ["examples", "examples/demo-js"],
      files: [{
        path: "examples/demo-js/package.json",
        size: demoPackage.byteLength,
        sha256: createHash("sha256").update(demoPackage).digest("hex")
      }]
    }
  };
  const launcher = createLocalLauncher({
    candidateRoot: PROJECT_ROOT,
    verifyCandidateIntegrity: async () => candidate,
    dependencies: { localAppData },
    readyTimeoutMs: 10_000,
    healthTimeoutMs: 500,
    pollIntervalMs: 25,
    stopTimeoutMs: 5_000
  });
  const port = await availablePort();
  let started = null;
  t.after(async () => stopDirectChild(started?.child));

  started = await launcher.start({ port, noBrowser: true });
  assert.equal(started.state, "started");
  assert.equal((await launcher.status()).state, "running");
  const stopped = await launcher.stop();
  assert.equal(stopped.state, "stopped");
  assert.equal(stopped.portReleased, true);
  assert.equal(await waitForProcessGone(started.child, 3_000), true);
  await assertPortBindable(port);
});

test("a child that never presents the matching ready identity is terminated and cleaned without opening a browser", async (t) => {
  let browserCalls = 0;
  let startedChild = null;
  const fixture = await launcherFixture(t, wrongIdentityServerSource(), {
    readyTimeoutMs: 300,
    dependencies: {
      openBrowser: async () => { browserCalls += 1; },
      terminateChildTree: async (child) => {
        startedChild = child;
        await stopDirectChild(child);
        return { terminated: !processIsAlive(child.pid), treeTerminationVerified: !processIsAlive(child.pid) };
      }
    }
  });
  const port = await availablePort();
  await assert.rejects(
    () => fixture.launcher.start({ port }),
    (error) => ["LAUNCHER_READY_TIMEOUT", "LAUNCHER_SERVER_EXITED_BEFORE_READY"].includes(error.code)
  );
  assert.equal(browserCalls, 0);
  assert.ok(startedChild?.pid > 0);
  assert.equal(await waitForProcessGone(startedChild, 2_000), true);
  await assertPortBindable(port);
  await assert.rejects(
    fs.stat(path.join(fixture.localAppData, "CodeClaw", "launcher-v1", CANDIDATE.candidateId, "instance.json")),
    { code: "ENOENT" }
  );
});

test("cancelling startup during readiness terminates the child before browser handoff", async (t) => {
  let browserCalls = 0;
  let startedChild = null;
  const fixture = await launcherFixture(t, wrongIdentityServerSource(), {
    readyTimeoutMs: 5_000,
    dependencies: {
      openBrowser: async () => { browserCalls += 1; },
      terminateChildTree: async (child) => {
        startedChild = child;
        await stopDirectChild(child);
        return { terminated: !processIsAlive(child.pid), treeTerminationVerified: !processIsAlive(child.pid) };
      }
    }
  });
  const port = await availablePort();
  const controller = new AbortController();
  const start = fixture.launcher.start({ port, signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(() => start, { code: "LAUNCHER_START_CANCELLED" });
  assert.equal(browserCalls, 0);
  assert.ok(startedChild?.pid > 0);
  assert.equal(await waitForProcessGone(startedChild, 2_000), true);
  await assertPortBindable(port);
});

test("failed startup retains control authority when process-tree cleanup cannot be verified", async (t) => {
  let startedChild = null;
  const fixture = await launcherFixture(t, wrongIdentityServerSource(), {
    readyTimeoutMs: 250,
    dependencies: {
      terminateChildTree: async (child) => {
        startedChild = child;
        return { terminated: false, treeTerminationVerified: false };
      }
    }
  });
  const port = await availablePort();
  t.after(async () => {
    await stopDirectChild(startedChild);
    await fs.rm(fixture.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await fs.rm(fixture.localAppData, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  let failure = null;
  try {
    await fixture.launcher.start({ port, noBrowser: true });
  } catch (error) {
    failure = error;
  }
  try {
    assert.equal(failure?.code, "LAUNCHER_START_CLEANUP_UNVERIFIED");
    assert.ok(startedChild?.pid > 0);
    assert.equal(processIsAlive(startedChild.pid), true);
    const control = JSON.parse(await fs.readFile(
      path.join(fixture.localAppData, "CodeClaw", "launcher-v1", CANDIDATE.candidateId, "instance.json"),
      "utf8"
    ));
    assert.equal(control.serverPid, startedChild.pid);
    assert.equal(control.port, port);
  } finally {
    await stopDirectChild(startedChild);
  }
});

test("an actual unknown loopback service on an explicit port is left running and untouched", async (t) => {
  const fixture = await launcherFixture(t, healthyServerSource());
  const unknown = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, app: "not-codeclaw" }));
  });
  await listen(unknown, 0);
  t.after(() => closeServer(unknown));
  const port = unknown.address().port;

  await assert.rejects(
    () => fixture.launcher.start({ port, noBrowser: true }),
    { code: "LAUNCHER_EXPLICIT_PORT_IN_USE" }
  );
  assert.equal(unknown.listening, true);
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal((await response.json()).app, "not-codeclaw");
});

async function launcherFixture(t, serverSource, { readyTimeoutMs = 4_000, dependencies = {} } = {}) {
  const root = await temporaryDirectory(t, "codeclaw-launcher-candidate-");
  const localAppData = await temporaryDirectory(t, "codeclaw-launcher-state-");
  await fs.mkdir(path.join(root, "apps", "web"), { recursive: true });
  await fs.writeFile(path.join(root, "apps", "web", "server.js"), serverSource, "utf8");
  await fs.mkdir(path.join(root, "examples", "demo-js"), { recursive: true });
  await fs.writeFile(path.join(root, "examples", "demo-js", "package.json"), DEMO_PACKAGE, "utf8");
  const launcher = createLocalLauncher({
    candidateRoot: root,
    verifyCandidateIntegrity: async () => CANDIDATE,
    dependencies: {
      localAppData,
      releaseServerStart: async (child, instance) => {
        child.stdin.end(`${instance.launchNonce}\n`);
      },
      ...dependencies
    },
    readyTimeoutMs,
    healthTimeoutMs: 500,
    pollIntervalMs: 25,
    stopTimeoutMs: 4_000
  });
  return { launcher, root, localAppData };
}

function healthyServerSource() {
  return `
import { createHmac, timingSafeEqual } from "node:crypto";
import http from "node:http";

const env = process.env;
const port = Number(env.CODECLAW_PORT);
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:" + port);
  if (request.method === "GET" && url.pathname === "/api/health") {
    const challenge = url.searchParams.get("challenge") || "";
    const canonical = "codeclaw-launcher-v1\\n" + env.CODECLAW_CANDIDATE_ID + "\\n" + env.CODECLAW_INSTANCE_ID + "\\n" + env.CODECLAW_LAUNCH_NONCE + "\\n" + process.pid + "\\n" + port + "\\n" + challenge;
    return send(response, {
      ok: true,
      app: "CodeClaw",
      accepting: true,
      launcherProtocol: Number(env.CODECLAW_LAUNCHER_PROTOCOL),
      candidateId: env.CODECLAW_CANDIDATE_ID,
      packageVersion: env.CODECLAW_PACKAGE_VERSION,
      sourceCommit: env.CODECLAW_SOURCE_COMMIT,
      instanceId: env.CODECLAW_INSTANCE_ID,
      launchNonce: env.CODECLAW_LAUNCH_NONCE,
      serverPid: process.pid,
      port,
      proof: createHmac("sha256", env.CODECLAW_SHUTDOWN_TOKEN).update(canonical, "utf8").digest("base64url")
    });
  }
  if (request.method === "POST" && url.pathname === "/api/system/shutdown") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const left = Buffer.from(String(body.token || ""));
    const right = Buffer.from(env.CODECLAW_SHUTDOWN_TOKEN);
    const valid = body.instanceId === env.CODECLAW_INSTANCE_ID && left.length === right.length && timingSafeEqual(left, right);
    if (!valid) return send(response, { ok: false }, 403);
    send(response, { ok: true });
    return setImmediate(() => server.close(() => process.exit(0)));
  }
  send(response, { ok: false }, 404);
});
server.listen(port, "127.0.0.1");
process.once("SIGTERM", () => server.close(() => process.exit(0)));
function send(response, value, status = 200) {
  const content = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(content) });
  response.end(content);
}
`;
}

function wrongIdentityServerSource() {
  return `
import http from "node:http";
const port = Number(process.env.CODECLAW_PORT);
const server = http.createServer((_request, response) => {
  const content = JSON.stringify({ ok: true, app: "CodeClaw", accepting: true, launcherProtocol: 1, candidateId: "wrong-candidate" });
  response.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(content) });
  response.end(content);
});
server.listen(port, "127.0.0.1");
process.once("SIGTERM", () => server.close(() => process.exit(0)));
`;
}

async function availablePort() {
  const server = net.createServer();
  await listen(server, 0);
  const port = server.address().port;
  await closeServer(server);
  return port;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function assertPortBindable(port) {
  const server = net.createServer();
  await listen(server, port);
  await closeServer(server);
}

async function stopDirectChild(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  try { child.kill(); } catch {}
  await waitForProcessGone(child, 2_000);
  if (child.exitCode === null && !child.signalCode) {
    try { child.kill("SIGKILL"); } catch {}
    await waitForProcessGone(child, 2_000);
  }
}

async function waitForProcessGone(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode) return true;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs));
  return Promise.race([once(child, "exit").then(() => true), timeout]);
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function temporaryDirectory(t, prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return directory;
}
