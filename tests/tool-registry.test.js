import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "../packages/tool-registry/src/index.js";

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-tools-"));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, ".gitignore"), "*.log\n");
  await fs.writeFile(path.join(root, "src", "index.js"), "export const marker = 'find-me';\n");
  await fs.writeFile(path.join(root, "debug.log"), "find-me but ignored\n");
  return root;
}

test("ToolRegistry list_files and search_code respect gitignore", async () => {
  const root = await makeFixture();
  const registry = new ToolRegistry({ rootPath: root });

  const listed = await registry.call("list_files");
  assert.equal(listed.ok, true);
  assert.ok(listed.result.includes("src/index.js"));
  assert.ok(!listed.result.includes("debug.log"));

  const searched = await registry.call("search_code", { query: "find-me" });
  assert.equal(searched.ok, true);
  assert.deepEqual(searched.result.map((item) => item.path), ["src/index.js"]);
  assert.equal(searched.result[0].matches[0].line, 1);
  assert.match(searched.result[0].matches[0].text, /find-me/);
});

test("ToolRegistry blocks write tools without approval", async () => {
  const root = await makeFixture();
  const registry = new ToolRegistry({ rootPath: root });

  const result = await registry.call("write_patch", { path: "src/index.js" });
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
});

test("ToolRegistry write_patch writes approved content and returns a diff", async () => {
  const root = await makeFixture();
  const registry = new ToolRegistry({ rootPath: root });

  const result = await registry.call("write_patch", { path: "src/index.js", content: "export const marker = 'changed';\n" }, { approved: true });
  assert.equal(result.ok, true);
  assert.equal(result.result.path, "src/index.js");
  assert.match(result.result.diff, /\+export const marker = 'changed';/);
  assert.equal(await fs.readFile(path.join(root, "src", "index.js"), "utf8"), "export const marker = 'changed';\n");
});

test("ToolRegistry write_patch refuses ignored and escaping paths", async () => {
  const root = await makeFixture();
  const registry = new ToolRegistry({ rootPath: root });

  await assert.rejects(
    () => registry.call("write_patch", { path: "debug.log", content: "nope\n" }, { approved: true }),
    /ignored file/
  );
  await assert.rejects(
    () => registry.call("write_patch", { path: "../escape.js", content: "nope\n" }, { approved: true }),
    /escapes project root/
  );
});

test("ToolRegistry run_command only runs allowlisted commands", async () => {
  const root = await makeFixture();
  const registry = new ToolRegistry({
    rootPath: root,
    allowedCommands: [{ name: "ok", command: "node -e \"console.log('ok')\"" }]
  });

  const blocked = await registry.call("run_command", { command: "node -e \"console.log('ok')\"" });
  assert.equal(blocked.blocked, true);

  const result = await registry.call("run_command", { command: "node -e \"console.log('ok')\"" }, { approved: true });
  assert.equal(result.ok, true);
  assert.equal(result.result.exitCode, 0);
  assert.match(result.result.stdout, /ok/);

  await assert.rejects(
    () => registry.call("run_command", { command: "node -e \"console.log('nope')\"" }, { approved: true }),
    /not allowed/
  );
});

test("ToolRegistry run_command returns nonzero exits without throwing", async () => {
  const root = await makeFixture();
  const registry = new ToolRegistry({
    rootPath: root,
    allowedCommands: [{ name: "fail", command: "node -e \"process.exit(7)\"" }]
  });

  const result = await registry.call("run_command", { name: "fail" }, { approved: true });
  assert.equal(result.ok, true);
  assert.equal(result.result.exitCode, 7);
});

test("ToolRegistry run_command refuses dangerous allowed commands", async () => {
  const root = await makeFixture();
  const registry = new ToolRegistry({
    rootPath: root,
    allowedCommands: [{ name: "publish", command: "git push origin main" }]
  });

  await assert.rejects(
    () => registry.call("run_command", { name: "publish" }, { approved: true }),
    /dangerous command/
  );
});

test("ToolRegistry run_command reports timeouts", async () => {
  const root = await makeFixture();
  const registry = new ToolRegistry({
    rootPath: root,
    allowedCommands: [{ name: "slow", command: "node -e \"setTimeout(() => {}, 1000)\"" }]
  });

  const result = await registry.call("run_command", { name: "slow", timeoutMs: 50 }, { approved: true });
  assert.equal(result.ok, true);
  assert.equal(result.result.timedOut, true);
});
