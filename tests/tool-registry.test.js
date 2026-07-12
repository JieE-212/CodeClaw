import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "../packages/tool-registry/src/index.js";
import { patchWriteTemporaryPath } from "../packages/shared/src/atomic-file.js";
import { captureWorkspaceIdentity, captureWorkspaceParentIdentity } from "../packages/shared/src/workspace-identity.js";

const temporaryRoots = [];

async function makeFixture() {
  const root = await makeTemporaryRoot("codeclaw-tools-");
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, ".gitignore"), "*.log\n");
  await fs.writeFile(path.join(root, "src", "index.js"), "export const marker = 'find-me';\n");
  await fs.writeFile(path.join(root, "debug.log"), "find-me but ignored\n");
  return root;
}

async function makeTemporaryRoot(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

test.after(async () => {
  for (const root of temporaryRoots) await fs.rm(root, { recursive: true, force: true });
});

async function reviewedWriteIdentity(root, filePath) {
  const workspace = await captureWorkspaceIdentity(root);
  const parent = await captureWorkspaceParentIdentity(workspace.rootPath, filePath);
  return { rootIdentity: workspace.digest, parentIdentity: parent.digest };
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

test("ToolRegistry refuses approved writes without a transaction id", async () => {
  const root = await makeFixture();
  const registry = new ToolRegistry({ rootPath: root });
  await assert.rejects(
    () => registry.call("write_patch", { path: "src/index.js", content: "no transaction\n" }, { approved: true }),
    (error) => error.code === "PATCH_TRANSACTION_REQUIRED"
  );
});

test("ToolRegistry write_patch writes approved content and returns a diff", async () => {
  const root = await makeFixture();
  const registry = new ToolRegistry({ rootPath: root });
  const identity = await reviewedWriteIdentity(root, "src/index.js");

  const result = await registry.call("write_patch", {
    path: "src/index.js",
    content: "export const marker = 'changed';\n",
    transactionId: "apply-tooltest-12345678",
    ...identity,
    onTemporaryReady: async () => {}
  }, { approved: true });
  assert.equal(result.ok, true);
  assert.equal(result.result.path, "src/index.js");
  assert.match(result.result.diff, /\+export const marker = 'changed';/);
  assert.equal(await fs.readFile(path.join(root, "src", "index.js"), "utf8"), "export const marker = 'changed';\n");
});

test("ToolRegistry write_patch refuses ignored and escaping paths", async () => {
  const root = await makeFixture();
  const registry = new ToolRegistry({ rootPath: root });
  const ignoredIdentity = await reviewedWriteIdentity(root, "debug.log");
  const rootIdentity = await reviewedWriteIdentity(root, ".gitignore");
  await fs.mkdir(path.join(root, ".codeclaw"), { recursive: true });
  const protectedIdentity = await reviewedWriteIdentity(root, ".codeclaw/tasks.json");

  await assert.rejects(
    () => registry.call("write_patch", { path: "debug.log", content: "nope\n", transactionId: "apply-tooltest-12345678", ...ignoredIdentity }, { approved: true }),
    /ignored file/
  );
  await assert.rejects(
    () => registry.call("write_patch", { path: "../escape.js", content: "nope\n", transactionId: "apply-tooltest-12345678", ...rootIdentity }, { approved: true }),
    (error) => error.code === "PATCH_PARENT_CHANGED" || /escapes project root/.test(error.message)
  );
  await assert.rejects(
    () => registry.call("write_patch", { path: ".codeclaw/tasks.json", content: "nope\n", transactionId: "apply-tooltest-12345678", ...protectedIdentity }, { approved: true }),
    (error) => error.code === "PATCH_PROTECTED_PATH_REFUSED"
  );
});

test("ToolRegistry rejects Windows aliases, device names, and non-UTF-8 targets", async () => {
  const root = await makeFixture();
  const registry = new ToolRegistry({ rootPath: root });
  const rootIdentity = await reviewedWriteIdentity(root, ".gitignore");
  const srcIdentity = await reviewedWriteIdentity(root, "src/index.js");
  for (const unsafePath of ["file.txt:stream", "NUL.txt", "src/trailing. ", "C:/absolute.txt"]) {
    const identity = unsafePath.startsWith("src/") ? srcIdentity : rootIdentity;
    await assert.rejects(
      () => registry.call("write_patch", { path: unsafePath, content: "nope\n", transactionId: "apply-tooltest-12345678", ...identity }, { approved: true }),
      (error) => error.code === "PATCH_PARENT_CHANGED" || /unsafe|reserved|dot or space|relative project file/.test(error.message)
    );
  }

  await fs.writeFile(path.join(root, "src", "binary.txt"), Buffer.from([0xff, 0xfe, 0x00, 0x61]));
  const binaryIdentity = await reviewedWriteIdentity(root, "src/binary.txt");
  await assert.rejects(
    () => registry.call("write_patch", { path: "src/binary.txt", content: "replacement\n", transactionId: "apply-tooltest-12345678", ...binaryIdentity }, { approved: true }),
    (error) => error.code === "PATCH_NON_UTF8_REFUSED"
  );
});

test("ToolRegistry strict UTF-8 reads preserve a leading BOM for exact rollback", async () => {
  const root = await makeFixture();
  const registry = new ToolRegistry({ rootPath: root });
  await fs.writeFile(path.join(root, "src", "bom.txt"), "\uFEFFcontent\n", "utf8");
  const result = await registry.call("read_file", { path: "src/bom.txt" });
  assert.equal(result.result, "\uFEFFcontent\n");
});

test("ToolRegistry refuses reads and writes through a linked directory", async (t) => {
  const root = await makeFixture();
  const outside = await makeTemporaryRoot("codeclaw-tools-outside-");
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(outside, "outside.txt"), "outside-original\n", "utf8");
  try {
    await fs.symlink(outside, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
      t.skip(`This environment cannot create a test link (${error.code}).`);
      return;
    }
    throw error;
  }

  const registry = new ToolRegistry({ rootPath: root });
  const writeIdentity = await reviewedWriteIdentity(root, ".gitignore");
  await assert.rejects(
    () => registry.call("read_file", { path: "linked/outside.txt" }),
    (error) => error.code === "PATH_SYMLINK_REFUSED"
  );
  await assert.rejects(
    () => registry.call("write_patch", { path: "linked/outside.txt", content: "should-not-write\n", transactionId: "apply-tooltest-12345678", ...writeIdentity }, { approved: true }),
    (error) => error.code === "PATCH_PARENT_CHANGED" || error.code === "PATH_SYMLINK_REFUSED"
  );
  assert.equal(await fs.readFile(path.join(outside, "outside.txt"), "utf8"), "outside-original\n");
});

test("ToolRegistry refuses reads and writes through a hard-linked file", async (t) => {
  const root = await makeFixture();
  const outside = await makeTemporaryRoot("codeclaw-tools-hardlink-outside-");
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });
  const outsidePath = path.join(outside, "outside.txt");
  const linkedPath = path.join(root, "hardlinked.txt");
  await fs.writeFile(outsidePath, "outside-original\n", "utf8");
  try {
    await fs.link(outsidePath, linkedPath);
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS", "EXDEV"].includes(error.code)) {
      t.skip(`This environment cannot create a test hard link (${error.code}).`);
      return;
    }
    throw error;
  }

  const registry = new ToolRegistry({ rootPath: root });
  const writeIdentity = await reviewedWriteIdentity(root, "hardlinked.txt");
  await assert.rejects(
    () => registry.call("read_file", { path: "hardlinked.txt" }),
    (error) => error.code === "PATH_HARDLINK_REFUSED"
  );
  await assert.rejects(
    () => registry.call("write_patch", { path: "hardlinked.txt", content: "should-not-write\n", transactionId: "apply-tooltest-12345678", ...writeIdentity }, { approved: true }),
    (error) => error.code === "PATH_HARDLINK_REFUSED"
  );
  assert.equal(await fs.readFile(outsidePath, "utf8"), "outside-original\n");
});

test("ToolRegistry preserves a deterministic patch temporary file without journal ownership", async (t) => {
  const root = await makeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const registry = new ToolRegistry({ rootPath: root });
  const transactionId = "apply-unowned-12345678";
  const identity = await reviewedWriteIdentity(root, "src/index.js");
  const temporaryPath = patchWriteTemporaryPath(path.join(root, "src", "index.js"), transactionId);
  await fs.writeFile(temporaryPath, "unowned-sentinel\n", "utf8");

  await assert.rejects(
    () => registry.cleanupPatchTemporary({
      path: "src/index.js",
      transactionId,
      ...identity
    }),
    (error) => error.code === "PATCH_TEMP_OWNERSHIP_UNKNOWN"
  );
  assert.equal(await fs.readFile(temporaryPath, "utf8"), "unowned-sentinel\n");
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
