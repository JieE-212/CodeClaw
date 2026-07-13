import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { createTestResources } from "./helpers/test-resources.js";

test("launcher health identity, proof, no-store, and authenticated shutdown stay bound to one instance", { timeout: 20_000 }, async (t) => {
  const resources = await createTestResources(t, "codeclaw-launcher-server-");
  const port = await findFreePort();
  const identity = {
    candidateId: "codeclaw-0123456789abcdef01234567",
    packageVersion: "0.1.0",
    sourceCommit: "0123456789abcdef0123456789abcdef01234567",
    instanceId: "instance_0123456789abcdef",
    launchNonce: "nonce_0123456789abcdef01234567",
    shutdownToken: "token_0123456789abcdef0123456789abcdef01234567"
  };
  const child = spawn(process.execPath, ["apps/web/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODECLAW_PORT: String(port),
      CODECLAW_STATE_DIR: resources.stateDir,
      CODECLAW_PROJECT_LOCK_DIR: resources.lockDir,
      CODECLAW_DISPOSABLE_ROOT: resources.copyRoot,
      CODECLAW_LAUNCHER_PROTOCOL: "1",
      CODECLAW_CANDIDATE_ID: identity.candidateId,
      CODECLAW_PACKAGE_VERSION: identity.packageVersion,
      CODECLAW_SOURCE_COMMIT: identity.sourceCommit,
      CODECLAW_INSTANCE_ID: identity.instanceId,
      CODECLAW_LAUNCH_NONCE: identity.launchNonce,
      CODECLAW_SHUTDOWN_TOKEN: identity.shutdownToken
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  child.stdin.end(`${identity.launchNonce}\n`);
  identity.serverPid = child.pid;
  identity.port = port;
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  t.after(async () => {
    if (exited(child)) return;
    child.kill();
    if (!(await waitForExit(child, 2500))) child.kill("SIGKILL");
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForReady(child, baseUrl, () => output);

  const challenge = "challenge_0123456789abcdef";
  const response = await fetch(`${baseUrl}/api/health?challenge=${challenge}`);
  const health = await response.json();
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual({
    ok: health.ok,
    app: health.app,
    accepting: health.accepting,
    launcherProtocol: health.launcherProtocol,
    candidateId: health.candidateId,
    packageVersion: health.packageVersion,
    sourceCommit: health.sourceCommit,
    instanceId: health.instanceId,
    launchNonce: health.launchNonce,
    serverPid: health.serverPid,
    host: health.host,
    port: health.port
  }, {
    ok: true,
    app: "CodeClaw",
    accepting: true,
    launcherProtocol: 1,
    candidateId: identity.candidateId,
    packageVersion: identity.packageVersion,
    sourceCommit: identity.sourceCommit,
    instanceId: identity.instanceId,
    launchNonce: identity.launchNonce,
    serverPid: identity.serverPid,
    host: "127.0.0.1",
    port
  });
  assert.equal(health.proof, launcherProof(identity, challenge));

  const unboundApi = await fetch(`${baseUrl}/api/system/check`);
  const unboundPayload = await unboundApi.json();
  assert.equal(unboundApi.status, 409);
  assert.equal(unboundPayload.code, "LAUNCHER_PAGE_IDENTITY_MISMATCH");

  const staleApi = await fetch(`${baseUrl}/api/system/check`, {
    headers: launcherBrowserHeaders({ ...identity, instanceId: "instance_stale_0123456789" })
  });
  const stalePayload = await staleApi.json();
  assert.equal(staleApi.status, 409);
  assert.equal(stalePayload.code, "LAUNCHER_PAGE_IDENTITY_MISMATCH");

  const boundApi = await fetch(`${baseUrl}/api/system/check`, { headers: launcherBrowserHeaders(identity) });
  const boundPayload = await boundApi.json();
  assert.equal(boundApi.status, 200);
  assert.equal(boundPayload.ok, true);

  const wrong = await postJson(baseUrl, "/api/system/shutdown", {
    instanceId: identity.instanceId,
    token: `${identity.shutdownToken}x`
  });
  assert.equal(wrong.response.status, 403);
  assert.equal(wrong.payload.code, "LAUNCHER_SHUTDOWN_UNAUTHORIZED");
  assert.equal(exited(child), false);

  const stopped = await postJson(baseUrl, "/api/system/shutdown", {
    instanceId: identity.instanceId,
    token: identity.shutdownToken
  });
  assert.equal(stopped.response.status, 202);
  assert.deepEqual(stopped.payload, {
    ok: true,
    accepted: true,
    candidateId: identity.candidateId,
    instanceId: identity.instanceId
  });
  assert.equal(await waitForExit(child, 5000), true);
});

test("launcher-mode server refuses to initialize state or listen without an exact completed start gate", { timeout: 10_000 }, async (t) => {
  const resources = await createTestResources(t, "codeclaw-launcher-gate-");
  const port = await findFreePort();
  const child = spawn(process.execPath, ["apps/web/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODECLAW_PORT: String(port),
      CODECLAW_STATE_DIR: resources.stateDir,
      CODECLAW_PROJECT_LOCK_DIR: resources.lockDir,
      CODECLAW_DISPOSABLE_ROOT: resources.copyRoot,
      CODECLAW_LAUNCHER_PROTOCOL: "1",
      CODECLAW_CANDIDATE_ID: "codeclaw-0123456789abcdef01234567",
      CODECLAW_PACKAGE_VERSION: "0.1.0",
      CODECLAW_SOURCE_COMMIT: "0123456789abcdef0123456789abcdef01234567",
      CODECLAW_INSTANCE_ID: "instance_0123456789abcdef",
      CODECLAW_LAUNCH_NONCE: "nonce_0123456789abcdef01234567",
      CODECLAW_SHUTDOWN_TOKEN: "token_0123456789abcdef0123456789abcdef01234567"
    },
    stdio: ["pipe", "ignore", "ignore"],
    windowsHide: true
  });
  t.after(async () => {
    if (exited(child)) return;
    child.kill();
    if (!(await waitForExit(child, 2_500))) child.kill("SIGKILL");
  });
  child.stdin.end("wrong-launch-gate\n");
  assert.equal(await waitForExit(child, 5_000), true);
  assert.notEqual(child.exitCode, 0);
  assert.equal(await exists(resources.stateDir), false);
  await assertPortBindable(port);
});

test("machine-candidate markers require the launcher before server state initialization", async () => {
  const source = await fs.readFile(new URL("../apps/web/server.js", import.meta.url), "utf8");
  const guard = source.indexOf("await assertCandidateUsesLauncher(applicationRoot, launcherIdentity.enabled)");
  const startGate = source.indexOf("await waitForLauncherStartGate(process.stdin, launcherIdentity)");
  const firstStateStore = source.indexOf("new AuditLog(");
  assert.ok(guard > 0 && guard < startGate && startGate < firstStateStore);
  assert.match(source, /CODECLAW_CANDIDATE_AUTHORITY\.json\.sha256/);
  assert.match(source, /PACKAGE_MANIFEST\.md/);
  assert.doesNotMatch(source, /assertCandidateUsesLauncher\(process\.cwd\(\)/);
});

function launcherProof(identity, challenge) {
  return createHmac("sha256", identity.shutdownToken)
    .update([
      "codeclaw-launcher-v1",
      identity.candidateId,
      identity.instanceId,
      identity.launchNonce,
      String(identity.serverPid),
      String(identity.port),
      challenge
    ].join("\n"), "utf8")
    .digest("base64url");
}

function launcherBrowserHeaders(identity) {
  return {
    "x-codeclaw-candidate-id": identity.candidateId,
    "x-codeclaw-instance-id": identity.instanceId
  };
}

async function postJson(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  });
  return { response, payload: await response.json() };
}

async function waitForReady(child, baseUrl, output) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (exited(child)) throw new Error(`Server exited before launcher health became ready.\n${output()}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      const payload = await response.json();
      if (response.ok && payload.ok && payload.accepting) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Server did not become ready.\n${output()}`);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const selected = server.address().port;
      server.close((error) => error ? reject(error) : resolve(selected));
    });
  });
}

function waitForExit(child, timeoutMs) {
  if (exited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => finish(false), timeoutMs);
    const finish = (value) => {
      clearTimeout(timeout);
      child.off("exit", onExit);
      resolve(value);
    };
    const onExit = () => finish(true);
    child.once("exit", onExit);
  });
}

async function assertPortBindable(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function exited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}
