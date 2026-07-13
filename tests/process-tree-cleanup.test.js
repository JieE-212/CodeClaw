import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { processSpawnOptions, terminateProcessTree } from "../packages/shared/src/process-tree.js";

test("terminateProcessTree stops a command wrapper and its child process", { timeout: 15_000 }, async (t) => {
  const parentScript = [
    'const { spawn } = require("node:child_process");',
    'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });',
    'console.log(child.pid);',
    'setInterval(() => {}, 1000);'
  ].join("");
  const parent = spawn(process.execPath, ["-e", parentScript], processSpawnOptions({ stdio: ["ignore", "pipe", "ignore"] }));
  const descendantPid = await readPid(parent);
  t.after(async () => {
    await terminateProcessTree(parent);
    stopPid(descendantPid);
  });
  assert.equal(isAlive(parent.pid), true);
  assert.equal(isAlive(descendantPid), true);

  const result = await terminateProcessTree(parent, { graceMs: 100, forceAfterMs: 1000 });
  assert.equal(result.attempted, true);
  if (process.platform === "win32" && result.helperExitCode !== 0) {
    stopPid(descendantPid);
    await waitUntil(() => !isAlive(parent.pid) && !isAlive(descendantPid), 5000);
    t.skip("Windows taskkill tree termination is unavailable in this sandbox.");
    return;
  }
  await waitUntil(() => !isAlive(parent.pid) && !isAlive(descendantPid), 5000);
  assert.equal(result.terminated, true);
  assert.equal(result.treeTerminationVerified, true);
  assert.equal(isAlive(parent.pid), false);
  assert.equal(isAlive(descendantPid), false);
});

test("terminateProcessTree still attempts the process group after its wrapper exits", { timeout: 15_000 }, async (t) => {
  const parentScript = [
    'const { spawn } = require("node:child_process");',
    'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });',
    'child.unref();',
    'console.log(child.pid);'
  ].join("");
  const parent = spawn(process.execPath, ["-e", parentScript], processSpawnOptions({ stdio: ["ignore", "pipe", "ignore"] }));
  const descendantPid = await readPid(parent);
  await new Promise((resolve, reject) => {
    parent.once("close", resolve);
    parent.once("error", reject);
  });
  t.after(() => stopPid(descendantPid));
  if (!isAlive(descendantPid)) {
    t.skip("This environment already terminates the descendant when its wrapper exits.");
    return;
  }

  const result = await terminateProcessTree(parent, { graceMs: 100, forceAfterMs: 1000 });
  assert.equal(result.attempted, true);
  if (process.platform === "win32" && !result.treeTerminationVerified) {
    t.skip("Windows cannot verify descendants after their wrapper exits without a Job Object.");
    return;
  }
  await waitUntil(() => !isAlive(descendantPid), 5000);
  assert.equal(result.terminated, true);
  assert.equal(isAlive(descendantPid), false);
});

function readPid(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for descendant PID.")), 3000);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      const match = output.match(/\b(\d+)\b/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(Number(match[1]));
    });
    child.once("error", reject);
  });
}

function isAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopPid(pid) {
  if (!isAlive(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Best-effort cleanup for an environment that denied taskkill.
  }
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for process tree cleanup.");
}
