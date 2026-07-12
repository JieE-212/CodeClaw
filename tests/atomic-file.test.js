import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { atomicRemoveFile, atomicWriteFile } from "../packages/shared/src/atomic-file.js";
import { canonicalPathLockKey } from "../packages/shared/src/cross-process-lock.js";

test("atomic write failure cleanup never follows a replacement junction", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-atomic-cleanup-"));
  const work = path.join(base, "work");
  const movedWork = path.join(base, "moved-work");
  const outside = path.join(base, "outside");
  await fs.mkdir(work);
  await fs.mkdir(outside);
  t.after(() => fs.rm(base, { recursive: true, force: true }));

  const probe = path.join(base, "link-probe");
  try {
    await fs.symlink(outside, probe, process.platform === "win32" ? "junction" : "dir");
    await fs.rm(probe, { force: true });
  } catch (error) {
    if (["EACCES", "ENOSYS", "EPERM"].includes(error.code)) {
      t.skip(`This environment cannot create a test junction (${error.code}).`);
      return;
    }
    throw error;
  }

  let temporaryName = "";
  await assert.rejects(
    () => atomicWriteFile(path.join(work, "target.txt"), "next\n", {
      beforeReplace: async () => {
        temporaryName = (await fs.readdir(work)).find((name) => name.endsWith(".tmp"));
        await fs.rename(work, movedWork);
        await fs.symlink(outside, work, process.platform === "win32" ? "junction" : "dir");
        await fs.writeFile(path.join(outside, temporaryName), "outside-sentinel\n", "utf8");
        throw new Error("simulated baseline conflict");
      }
    }),
    (error) => error.code === "ATOMIC_TEMP_CLEANUP_UNSAFE"
  );

  assert.equal(await fs.readFile(path.join(outside, temporaryName), "utf8"), "outside-sentinel\n");
});

test("atomic write refuses a normally returning callback that replaced the parent directory", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-atomic-replace-parent-"));
  const work = path.join(base, "work");
  const movedWork = path.join(base, "moved-work");
  await fs.mkdir(work);
  await fs.writeFile(path.join(work, "target.txt"), "original\n", "utf8");
  t.after(() => fs.rm(base, { recursive: true, force: true }));

  let temporaryName = "";
  await assert.rejects(
    () => atomicWriteFile(path.join(work, "target.txt"), "next\n", {
      beforeReplace: async () => {
        temporaryName = (await fs.readdir(work)).find((name) => name.endsWith(".tmp"));
        await fs.rename(work, movedWork);
        await fs.mkdir(work);
        await fs.writeFile(path.join(work, "target.txt"), "replacement-sentinel\n", "utf8");
        await fs.writeFile(path.join(work, temporaryName), "replacement-temp-sentinel\n", "utf8");
      }
    }),
    (error) => error.code === "ATOMIC_TEMP_CLEANUP_UNSAFE"
  );

  assert.equal(await fs.readFile(path.join(work, "target.txt"), "utf8"), "replacement-sentinel\n");
  assert.equal(await fs.readFile(path.join(work, temporaryName), "utf8"), "replacement-temp-sentinel\n");
  assert.equal(await fs.readFile(path.join(movedWork, "target.txt"), "utf8"), "original\n");
});

test("atomic remove never follows a parent directory replaced during its safety callback", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-atomic-remove-"));
  const work = path.join(base, "work");
  const movedWork = path.join(base, "moved-work");
  const outside = path.join(base, "outside");
  await fs.mkdir(work);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(work, "target.txt"), "owned\n", "utf8");
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  try {
    const probe = path.join(base, "link-probe");
    await fs.symlink(outside, probe, process.platform === "win32" ? "junction" : "dir");
    await fs.rm(probe, { force: true });
  } catch (error) {
    if (["EACCES", "ENOSYS", "EPERM"].includes(error.code)) {
      t.skip(`This environment cannot create a test junction (${error.code}).`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    () => atomicRemoveFile(path.join(work, "target.txt"), {
      beforeRemove: async () => {
        await fs.rename(work, movedWork);
        await fs.symlink(outside, work, process.platform === "win32" ? "junction" : "dir");
        await fs.writeFile(path.join(outside, "target.txt"), "outside-sentinel\n", "utf8");
      }
    }),
    (error) => error.code === "ATOMIC_TEMP_CLEANUP_UNSAFE"
  );
  assert.equal(await fs.readFile(path.join(outside, "target.txt"), "utf8"), "outside-sentinel\n");
});

test("project lock keys resolve junction aliases to the same canonical root", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-lock-key-"));
  const real = path.join(base, "real");
  const alias = path.join(base, "alias");
  await fs.mkdir(real);
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  try {
    await fs.symlink(real, alias, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EACCES", "ENOSYS", "EPERM"].includes(error.code)) {
      t.skip(`This environment cannot create a test junction (${error.code}).`);
      return;
    }
    throw error;
  }
  assert.equal(await canonicalPathLockKey(real), await canonicalPathLockKey(alias));
});
