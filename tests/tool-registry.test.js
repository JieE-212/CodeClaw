import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { getEventListeners } from "node:events";
import { promisify } from "node:util";
import { ToolRegistry } from "../packages/tool-registry/src/index.js";
import { patchWriteTemporaryPath } from "../packages/shared/src/atomic-file.js";
import { captureWorkspaceIdentity, captureWorkspaceParentIdentity } from "../packages/shared/src/workspace-identity.js";

const temporaryRoots = [];
const execFileAsync = promisify(execFile);

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

test("ToolRegistry enforces nested ignores, excluded parents, and protected state reads", async () => {
  const root = await makeTemporaryRoot("codeclaw-tools-read-boundary-");
  await fs.mkdir(path.join(root, "nested"));
  await fs.mkdir(path.join(root, "ignored"));
  await fs.mkdir(path.join(root, ".codeclaw"));
  await fs.mkdir(path.join(root, ".AWS"));
  await fs.writeFile(path.join(root, ".gitignore"), "ignored/\n!ignored/file.txt\n", "utf8");
  await fs.writeFile(path.join(root, "nested", ".gitignore"), "*.tmp\n!keep.tmp\n", "utf8");
  await fs.writeFile(path.join(root, "nested", "drop.tmp"), "nested-hidden-marker\n", "utf8");
  await fs.writeFile(path.join(root, "nested", "keep.tmp"), "nested-visible-marker\n", "utf8");
  await fs.writeFile(path.join(root, "ignored", "file.txt"), "parent-hidden-marker\n", "utf8");
  await fs.writeFile(path.join(root, ".codeclaw", "workspace-owner.json"), JSON.stringify({ secret: "synthetic-secret" }), "utf8");
  await fs.writeFile(path.join(root, ".AWS", "credentials"), "not-real\n", "utf8");
  await fs.writeFile(path.join(root, ".npmrc"), "not-real\n", "utf8");
  await fs.writeFile(path.join(root, "credentials.json"), "{}\n", "utf8");
  await fs.writeFile(path.join(root, "private.key"), "not-real\n", "utf8");
  for (const name of ["token.js", "tokenizer.js", "secretary.js"]) {
    await fs.writeFile(path.join(root, name), `export const fileName = ${JSON.stringify(name)};\n`, "utf8");
  }
  const registry = new ToolRegistry({ rootPath: root });

  const listed = await registry.call("list_files");
  assert.ok(listed.result.includes("nested/keep.tmp"));
  assert.ok(!listed.result.includes("nested/drop.tmp"));
  assert.ok(!listed.result.includes("ignored/file.txt"));
  assert.ok(!listed.result.some((item) => item.startsWith(".codeclaw/")));
  assert.ok(!listed.result.some((item) => item.startsWith(".AWS/")));
  for (const relative of [".npmrc", "credentials.json", "private.key"]) assert.ok(!listed.result.includes(relative), relative);
  for (const relative of ["token.js", "tokenizer.js", "secretary.js"]) {
    assert.ok(listed.result.includes(relative), relative);
    assert.match((await registry.call("read_file", { path: relative })).result, /fileName/);
  }
  assert.deepEqual((await registry.call("search_code", { query: "hidden-marker" })).result, []);
  await assert.rejects(
    () => registry.call("read_file", { path: "ignored/file.txt" }),
    (error) => error.code === "READ_IGNORED_PATH_REFUSED"
  );
  await assert.rejects(
    () => registry.call("read_file", { path: ".codeclaw/workspace-owner.json" }),
    (error) => error.code === "READ_PROTECTED_PATH_REFUSED"
  );
  await assert.rejects(
    () => registry.call("read_file", { path: ".AWS/credentials" }),
    (error) => error.code === "READ_PROTECTED_PATH_REFUSED"
  );
  for (const relative of [".npmrc", "credentials.json", "private.key"]) {
    await assert.rejects(() => registry.call("read_file", { path: relative }), /sensitive file/i);
  }
});

test("ToolRegistry search_code cannot read a hard-linked file discovered after listing", async (t) => {
  const base = await makeTemporaryRoot("codeclaw-tools-search-link-");
  const root = path.join(base, "root");
  const external = path.join(base, "external.txt");
  await fs.mkdir(root);
  await fs.writeFile(external, "outside-hardlink-marker\n", "utf8");
  try {
    await fs.link(external, path.join(root, "alias.txt"));
  } catch (error) {
    if (["EACCES", "EPERM", "ENOSYS", "EXDEV"].includes(error.code)) return t.skip("Hard links are unavailable in this environment.");
    throw error;
  }

  const registry = new ToolRegistry({ rootPath: root });
  assert.deepEqual((await registry.call("search_code", { query: "outside-hardlink-marker" })).result, []);
  await assert.rejects(
    () => registry.call("read_file", { path: "alias.txt" }),
    /hard-linked file/i
  );
});

test("ToolRegistry read_file rejects a same-path entity replacement between validation and open", async (t) => {
  const base = await makeTemporaryRoot("codeclaw-tools-read-race-");
  const root = path.join(base, "root");
  const target = path.join(root, "target.txt");
  const moved = path.join(root, "target-original.txt");
  const external = path.join(base, "external.txt");
  await fs.mkdir(root);
  await fs.writeFile(target, "reviewed-content\n", "utf8");
  await fs.writeFile(external, "outside-content\n", "utf8");
  try {
    const probe = path.join(base, "hardlink-probe.txt");
    await fs.link(external, probe);
    await fs.unlink(probe);
  } catch (error) {
    if (["EACCES", "EPERM", "ENOSYS", "EXDEV"].includes(error.code)) return t.skip("Hard links are unavailable in this environment.");
    throw error;
  }

  const originalOpen = fs.open.bind(fs);
  let replaced = false;
  t.mock.method(fs, "open", async (filePath, ...args) => {
    if (!replaced && path.resolve(filePath) === path.resolve(target)) {
      replaced = true;
      await fs.rename(target, moved);
      await fs.link(external, target);
    }
    return originalOpen(filePath, ...args);
  });

  const registry = new ToolRegistry({ rootPath: root });
  await assert.rejects(
    () => registry.call("read_file", { path: "target.txt" }),
    (error) => error.code === "READ_PATH_CHANGED"
  );
});

test("ToolRegistry Git tools neither execute fsmonitor nor discover a parent repository", async (t) => {
  const root = await makeTemporaryRoot("codeclaw-tools-git-boundary-");
  await execFileAsync("git", ["init"], { cwd: root });
  await fs.writeFile(path.join(root, "monitor.sh"), ["#!/bin/sh", "echo invoked > fsmonitor-ran.txt", "echo '{}'", ""].join("\n"), "utf8");
  await execFileAsync("git", ["config", "core.fsmonitor", "./monitor.sh"], { cwd: root });

  const inheritedGitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase().startsWith("GIT_")));
  t.after(() => {
    for (const name of Object.keys(process.env).filter((item) => item.toUpperCase().startsWith("GIT_"))) delete process.env[name];
    Object.assign(process.env, inheritedGitEnvironment);
  });
  process.env.GIT_DIR = path.join(root, "redirected-git-dir");
  process.env.GIT_WORK_TREE = path.join(root, "redirected-work-tree");
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = "core.fsmonitor";
  process.env.GIT_CONFIG_VALUE_0 = "./monitor.sh";

  const rootRegistry = new ToolRegistry({ rootPath: root });
  const status = await rootRegistry.call("git_status");
  assert.equal(status.ok, true);
  await assert.rejects(() => fs.stat(path.join(root, "fsmonitor-ran.txt")), (error) => error.code === "ENOENT");

  const nested = path.join(root, "nested-workspace");
  await fs.mkdir(nested);
  const nestedRegistry = new ToolRegistry({ rootPath: nested });
  await assert.rejects(
    () => nestedRegistry.call("git_status"),
    (error) => error.code === "GIT_WORKSPACE_ROOT_REQUIRED"
  );
  await assert.rejects(
    () => nestedRegistry.call("git_diff"),
    (error) => error.code === "GIT_WORKSPACE_ROOT_REQUIRED"
  );
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

test("ToolRegistry child commands do not inherit launcher capabilities", async (t) => {
  const root = await makeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const previousToken = process.env.CODECLAW_SHUTDOWN_TOKEN;
  const previousState = process.env.CODECLAW_STATE_DIR;
  process.env.CODECLAW_SHUTDOWN_TOKEN = "launcher-secret-capability";
  process.env.CODECLAW_STATE_DIR = "private-launcher-state";
  t.after(() => {
    if (previousToken === undefined) delete process.env.CODECLAW_SHUTDOWN_TOKEN;
    else process.env.CODECLAW_SHUTDOWN_TOKEN = previousToken;
    if (previousState === undefined) delete process.env.CODECLAW_STATE_DIR;
    else process.env.CODECLAW_STATE_DIR = previousState;
  });
  const command = "node -e \"console.log(JSON.stringify({token:process.env.CODECLAW_SHUTDOWN_TOKEN||null,state:process.env.CODECLAW_STATE_DIR||null,path:Boolean(process.env.PATH)}))\"";
  const registry = new ToolRegistry({ rootPath: root, allowedCommands: [{ name: "env", command }] });

  const result = await registry.call("run_command", { name: "env" }, { approved: true });
  assert.equal(result.result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.result.stdout.trim()), { token: null, state: null, path: true });
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

  try {
    const result = await registry.call("run_command", { name: "slow", timeoutMs: 50 }, { approved: true });
    assert.equal(result.ok, true);
    assert.equal(result.result.timedOut, true);
    assert.equal(result.result.treeTermination.treeTerminationVerified, true);
  } catch (error) {
    if (process.platform !== "win32" || error.code !== "PROCESS_TREE_TERMINATION_UNVERIFIED") throw error;
    assert.equal(error.trigger, "timeout");
    assert.equal(error.treeTermination.treeTerminationVerified, false);
  }
});

test("ToolRegistry exposes bounded list, read, and search evidence without changing result types", async () => {
  const root = await makeTemporaryRoot("codeclaw-tools-budget-");
  await fs.writeFile(path.join(root, "a.txt"), "find-me-a", "utf8");
  await fs.writeFile(path.join(root, "b.txt"), "find-me-b", "utf8");
  const registry = new ToolRegistry({
    rootPath: root,
    runtimeBudget: {
      maxListFiles: 1,
      maxReadBytes: 32,
      maxSearchFiles: 2,
      maxSearchTotalBytes: 18,
      maxSearchResults: 1
    }
  });

  const listed = await registry.call("list_files");
  assert.ok(Array.isArray(listed.result));
  assert.equal(listed.result.length, 1);
  assert.equal(listed.truncated, true);
  assert.ok(listed.budget.reasons.includes("max-files"));

  const read = await registry.call("read_file", { path: "a.txt" });
  assert.equal(read.result, "find-me-a");
  assert.equal(read.truncated, false);
  assert.equal(read.budget.used.bytesRead, 9);

  const searched = await registry.call("search_code", { query: "find-me" });
  assert.ok(Array.isArray(searched.result));
  assert.deepEqual(searched.result.map((item) => item.path), ["a.txt"]);
  assert.equal(searched.truncated, true);
  assert.ok(searched.budget.reasons.includes("max-results"));
  assert.equal(searched.budget.used.resultBytes, Buffer.byteLength(JSON.stringify(searched.result), "utf8"));
});

test("ToolRegistry refuses a file that grows beyond the read budget after stat", async (t) => {
  const root = await makeTemporaryRoot("codeclaw-tools-read-growth-budget-");
  const target = path.join(root, "growing.txt");
  await fs.writeFile(target, "1234", "utf8");
  const originalOpen = fs.open.bind(fs);
  let grew = false;
  t.mock.method(fs, "open", async (filePath, ...args) => {
    const handle = await originalOpen(filePath, ...args);
    if (path.resolve(filePath) !== path.resolve(target)) return handle;
    const originalRead = handle.read.bind(handle);
    handle.read = async (...readArgs) => {
      if (!grew) {
        grew = true;
        await fs.appendFile(target, "567890", "utf8");
      }
      return originalRead(...readArgs);
    };
    return handle;
  });
  const registry = new ToolRegistry({ rootPath: root, runtimeBudget: { maxReadBytes: 4 } });

  await assert.rejects(
    () => registry.call("read_file", { path: "growing.txt" }),
    (error) => error.code === "TOOL_READ_FILE_TOO_LARGE"
      && error.status === 413
      && error.runtimeBudget.limit === 4
      && error.runtimeBudget.observed === 5
  );
});

test("ToolRegistry bounds aggregate search bytes and keeps extensionless code searchable", async () => {
  const root = await makeTemporaryRoot("codeclaw-tools-search-budget-");
  await fs.writeFile(path.join(root, "a.txt"), "1234567890", "utf8");
  await fs.writeFile(path.join(root, "b.txt"), "find-me", "utf8");
  const byteLimited = new ToolRegistry({
    rootPath: root,
    runtimeBudget: { maxReadBytes: 32, maxSearchFiles: 2, maxSearchTotalBytes: 10 }
  });
  const searched = await byteLimited.call("search_code", { query: "find-me" });
  assert.deepEqual(searched.result, []);
  assert.equal(searched.truncated, true);
  assert.ok(searched.budget.reasons.includes("max-total-read-bytes"));
  assert.equal(searched.budget.used.bytesRead, 10);

  await fs.writeFile(path.join(root, "Makefile"), "build: # extensionless-marker\n", "utf8");
  await fs.writeFile(path.join(root, "native.h"), "#define HEADER_MARKER 1\n", "utf8");
  await fs.writeFile(path.join(root, "image.png"), Buffer.from([0xff, 0xfe, 0xfd]));
  const compatible = new ToolRegistry({ rootPath: root });
  assert.deepEqual((await compatible.call("search_code", { query: "extensionless-marker" })).result.map((item) => item.path), ["Makefile"]);
  assert.deepEqual((await compatible.call("search_code", { query: "HEADER_MARKER" })).result.map((item) => item.path), ["native.h"]);
  const binary = await compatible.call("search_code", { query: "not-present" });
  assert.equal(binary.budget.used.nonTextFilesSkipped, 1);
  assert.equal(binary.truncated, false);
});

test("ToolRegistry caps long-line search output around the actual match", async () => {
  const root = await makeTemporaryRoot("codeclaw-tools-search-output-budget-");
  await fs.writeFile(path.join(root, "long.txt"), `${"x".repeat(500)}needle${"y".repeat(500)}\n`, "utf8");
  const registry = new ToolRegistry({
    rootPath: root,
    runtimeBudget: { maxSearchLineChars: 40, maxSearchResultBytes: 512 }
  });

  const searched = await registry.call("search_code", { query: "needle" });
  assert.equal(searched.result.length, 1);
  const match = searched.result[0].matches[0];
  assert.ok(match.text.length <= 40);
  assert.match(match.text, /needle/);
  assert.ok(match.textStartColumn > 1);
  assert.equal(match.textTruncated, true);
  assert.ok(searched.budget.used.resultBytes <= searched.budget.limits.maxResultBytes);
});

test("ToolRegistry enforces custom ignore rule evaluation budgets", async () => {
  const root = await makeTemporaryRoot("codeclaw-tools-ignore-budget-");
  await fs.writeFile(path.join(root, ".gitignore"), "*.tmp\n*.log\n", "utf8");
  await fs.writeFile(path.join(root, "a.txt"), "visible\n", "utf8");
  const registry = new ToolRegistry({ rootPath: root, runtimeBudget: { maxIgnoreRuleEvaluations: 1 } });

  await assert.rejects(
    () => registry.call("list_files"),
    (error) => error.code === "GITIGNORE_RUNTIME_BUDGET_EXCEEDED"
      && error.runtimeBudget.operation === "gitignore-rule-evaluations"
      && error.runtimeBudget.limit === 1
  );
});

test("ToolRegistry rejects an already-aborted signal before every cancellable tool", async () => {
  const root = await makeFixture();
  const command = "node -e \"setTimeout(() => {}, 1000)\"";
  const registry = new ToolRegistry({ rootPath: root, allowedCommands: [{ name: "slow", command }] });
  const controller = new AbortController();
  const reason = Object.assign(new Error("tool cancelled"), { code: "OPERATION_CANCELLED", status: 409 });
  controller.abort(reason);

  for (const [tool, args, options] of [
    ["list_files", {}, {}],
    ["read_file", { path: "src/index.js" }, {}],
    ["search_code", { query: "marker" }, {}],
    ["git_status", {}, {}],
    ["run_command", { name: "slow" }, { approved: true }]
  ]) {
    await assert.rejects(
      () => registry.call(tool, args, { ...options, signal: controller.signal }),
      (error) => error === reason,
      tool
    );
  }
});

test("ToolRegistry aborts during ignore reads and never returns a partial success", async (t) => {
  const root = await makeFixture();
  const controller = new AbortController();
  const reason = Object.assign(new Error("ignore cancelled"), { code: "OPERATION_CANCELLED", status: 409 });
  const originalOpen = fs.open.bind(fs);
  t.mock.method(fs, "open", async (filePath, ...args) => {
    const handle = await originalOpen(filePath, ...args);
    if (path.basename(filePath) === ".gitignore") controller.abort(reason);
    return handle;
  });
  const registry = new ToolRegistry({ rootPath: root });

  await assert.rejects(() => registry.call("list_files", {}, { signal: controller.signal }), (error) => error === reason);
});

test("ToolRegistry search does not convert cancellation into an unreadable-file omission", async (t) => {
  const root = await makeFixture();
  const target = path.join(root, "src", "index.js");
  const controller = new AbortController();
  const reason = Object.assign(new Error("search cancelled"), { code: "OPERATION_CANCELLED", status: 409 });
  const originalOpen = fs.open.bind(fs);
  t.mock.method(fs, "open", async (filePath, ...args) => {
    const handle = await originalOpen(filePath, ...args);
    if (path.resolve(filePath) === path.resolve(target)) controller.abort(reason);
    return handle;
  });
  const registry = new ToolRegistry({ rootPath: root });

  await assert.rejects(
    () => registry.call("search_code", { query: "find-me" }, { signal: controller.signal }),
    (error) => error === reason
  );
});

test("ToolRegistry cancellation terminates a command wrapper and descendant or fails closed", { timeout: 15_000 }, async (t) => {
  const root = await makeFixture();
  const pidFile = "command-cancel-pids.json";
  const command = commandTreeFixture(pidFile);
  const registry = new ToolRegistry({ rootPath: root, allowedCommands: [{ name: "tree", command }] });
  const controller = new AbortController();
  const reason = Object.assign(new Error("command cancelled"), { code: "OPERATION_CANCELLED", status: 409 });
  const pending = registry.call("run_command", { name: "tree" }, { approved: true, signal: controller.signal });
  const pids = await waitForPidFile(path.join(root, pidFile));
  t.after(() => {
    stopProcess(pids.parent);
    stopProcess(pids.child);
  });

  controller.abort(reason);
  let rejected;
  try {
    await pending;
    assert.fail("A cancelled command must not return success.");
  } catch (error) {
    rejected = error;
  }
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  if (rejected.code === "PROCESS_TREE_TERMINATION_UNVERIFIED") {
    assert.equal(rejected.operationCode, "OPERATION_CANCELLED");
    assert.equal(rejected.treeTermination.treeTerminationVerified, false);
    if (process.platform === "win32") {
      t.skip("Windows taskkill tree verification is unavailable in this sandbox; the command failed closed.");
      return;
    }
    assert.fail("POSIX process-group termination should be verifiable.");
  }
  assert.equal(rejected, reason);
  assert.equal(rejected.treeTermination.treeTerminationVerified, true);
  await waitForProcessesToStop([pids.parent, pids.child]);
});

test("ToolRegistry preserves OPERATION_TIMEOUT while terminating the command tree", { timeout: 15_000 }, async (t) => {
  const root = await makeFixture();
  const command = "node -e \"setInterval(() => {}, 1000)\"";
  const registry = new ToolRegistry({ rootPath: root, allowedCommands: [{ name: "slow-signal", command }] });
  const controller = new AbortController();
  const reason = Object.assign(new Error("operation deadline"), { code: "OPERATION_TIMEOUT", status: 408 });
  const pending = registry.call("run_command", { name: "slow-signal" }, { approved: true, signal: controller.signal });
  setTimeout(() => controller.abort(reason), 75);

  await assert.rejects(pending, (error) => {
    if (error.code === "PROCESS_TREE_TERMINATION_UNVERIFIED" && process.platform === "win32") {
      assert.equal(error.operationCode, "OPERATION_TIMEOUT");
      return true;
    }
    assert.equal(error, reason);
    assert.equal(error.treeTermination.treeTerminationVerified, true);
    return true;
  });
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("ToolRegistry gives abort precedence when it overlaps command timeout and supports frozen reasons", { timeout: 15_000 }, async () => {
  const root = await makeFixture();
  const command = "node -e \"setInterval(() => {}, 1000)\"";
  const registry = new ToolRegistry({ rootPath: root, allowedCommands: [{ name: "overlap", command }] });
  const controller = new AbortController();
  const reason = Object.freeze(Object.assign(new Error("overlap cancelled"), { code: "OPERATION_CANCELLED", status: 409 }));
  const pending = registry.call("run_command", { name: "overlap", timeoutMs: 50 }, { approved: true, signal: controller.signal });
  setTimeout(() => controller.abort(reason), 60);

  await assert.rejects(pending, (error) => {
    if (error.code === "PROCESS_TREE_TERMINATION_UNVERIFIED") {
      assert.equal(error.trigger, "abort");
      assert.equal(error.operationCode, "OPERATION_CANCELLED");
      assert.equal(error.treeTermination.treeTerminationVerified, false);
      return true;
    }
    assert.equal(error.code, "OPERATION_CANCELLED");
    assert.equal(error.status, 409);
    assert.equal(error.treeTermination.treeTerminationVerified, true);
    return true;
  });
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("ToolRegistry removes abort listeners after a normal command", async () => {
  const root = await makeFixture();
  const command = "node -e \"console.log('done')\"";
  const registry = new ToolRegistry({ rootPath: root, allowedCommands: [{ name: "done", command }] });
  const controller = new AbortController();
  const result = await registry.call("run_command", { name: "done" }, { approved: true, signal: controller.signal });
  assert.equal(result.result.exitCode, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

function commandTreeFixture(pidFile) {
  const script = [
    "const fs=require('node:fs')",
    "const {spawn}=require('node:child_process')",
    "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true})",
    `fs.writeFileSync('${pidFile}',JSON.stringify({parent:process.pid,child:child.pid}))`,
    "setInterval(()=>{},1000)"
  ].join(";");
  return `node -e \"${script}\"`;
}

async function waitForPidFile(filePath) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (Number.isSafeInteger(parsed.parent) && Number.isSafeInteger(parsed.child)) return parsed;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the command process fixture.");
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopProcess(pid) {
  if (!processIsAlive(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
}

async function waitForProcessesToStop(pids) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !processIsAlive(pid))) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("The cancelled command process tree remained alive.");
}
