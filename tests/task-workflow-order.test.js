import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const [server, taskStore] = await Promise.all([
  fs.readFile(new URL("../apps/web/server.js", import.meta.url), "utf8"),
  fs.readFile(new URL("../packages/task-store/src/index.js", import.meta.url), "utf8")
]);

test("task verification stays inside the project lock from patch check through persistence", () => {
  const callTool = functionBody(server, "callTool");
  assert.match(callTool, /body\.tool === "run_command" && body\.approved === true && task/);
  assert.match(callTool, /serializePatchOperation\(rootPath, async \(\) => \{[\s\S]*ensurePatchRecoveryReady[\s\S]*assertActivePatchesCurrent[\s\S]*registry\.call\(body\.tool[\s\S]*assertActivePatchesCurrent[\s\S]*appendToolCall[\s\S]*setVerification/s);
  assert.match(callTool, /setVerification\(body\.taskId, commandResult\.result, \{ expectedPatchSetDigest \}\)/);
  assert.match(taskStore, /options\.expectedPatchSetDigest !== currentPatchSetDigest/);
  assert.match(taskStore, /TASK_VERIFY_PATCH_CHANGED/);
});

test("task completion revalidates identity, content, patch provenance, and revision under the project lock", () => {
  const complete = functionBody(server, "completeTask");
  const ready = functionBody(server, "assertTaskReadyToComplete");
  assert.match(complete, /serializePatchOperation\(existing\.rootPath/);
  assert.match(complete, /ensurePatchRecoveryReady\(current\.rootPath, current\.rootIdentity\)/);
  assert.match(complete, /assertActivePatchesCurrent\(current/);
  assert.match(complete, /expectedRevision:\s*current\.revision/);
  assert.match(complete, /beforeCommit:\s*\(\{ currentTask \}\) => assertTaskReadyToComplete\(currentTask\)/);
  assert.match(ready, /activePatchSetDigest\(task\)/);
  assert.match(ready, /verification\.patchSetDigest !== patchSetDigest/);
});

test("active file checks use only the top patch per path while provenance binds the whole set", () => {
  const current = functionBody(server, "assertActivePatchesCurrent");
  assert.match(current, /const topPatchByPath = new Map\(\)/);
  assert.match(current, /topPatchByPath\.set\(normalizePatchPath\(patch\.path\), patch\)/);
  assert.match(current, /for \(const patch of topPatchByPath\.values\(\)\)/);
  assert.match(current, /patch\.patchIdentity !== appliedPatchIdentity\(patch\)/);
});

test("concurrent repository scans keep request-local profile and workspace responses", () => {
  const scan = functionBody(server, "scanRepo");
  assert.match(scan, /const profile = await scanRepositoryWithFriendlyErrors\(repositoryPath\)/);
  assert.match(scan, /const workspace = await workspaceCapabilityStore\.register\(profile\.rootPath\)/);
  assert.match(scan, /bindLastWorkspace\(workspace, profile\.rootPath, profile\.commands\)/);
  assert.match(scan, /return json\(response, \{ ok: true, profile, memory, workspace \}\)/);
  assert.equal((scan.match(/lastRepoProfile/g) || []).length, 1, "scan globals may be updated only at the consistent commit point");
});

test("startup reconciles derived task memory before and after transaction recovery", () => {
  const start = functionBody(server, "startServer");
  const reconcileCalls = [...start.matchAll(/memoryStore\.reconcileTaskSummaries\(await taskStore\.readAll\(\)\)/g)];
  assert.equal(reconcileCalls.length, 2);
  const recovery = start.indexOf("patchRecoveryStatus = await recoverPatchTransactions");
  assert.ok(reconcileCalls[0].index < recovery && recovery < reconcileCalls[1].index);
});

function functionBody(source, name) {
  const start = source.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  assert.notEqual(start, -1, `missing function ${name}`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = brace; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unclosed function ${name}`);
}
