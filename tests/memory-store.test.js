import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MemoryStore } from "../packages/memory-store/src/index.js";

async function makeStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-memory-"));
  return new MemoryStore({ storagePath: path.join(root, "memory.json") });
}

test("MemoryStore upserts repo profile and commands", async () => {
  const store = await makeStore();
  const memory = await store.upsertProfile({
    rootPath: "C:/repo-a",
    name: "repo-a",
    fileCount: 3,
    skippedCount: 1,
    languages: [{ name: "JavaScript", count: 2 }],
    frameworks: ["Vite"],
    packageManagers: ["npm"],
    keyFiles: ["package.json", "src/index.js"],
    commands: [{ name: "test", command: "npm run test", source: "package.json" }]
  });

  assert.equal(memory.name, "repo-a");
  assert.equal(memory.profile.fileCount, 3);
  assert.equal(memory.commands[0].command, "npm run test");
  assert.equal((await store.get("C:/repo-a")).profile.languages[0].name, "JavaScript");
});

test("MemoryStore updates notes", async () => {
  const store = await makeStore();
  await store.ensure("C:/repo-a");
  const memory = await store.updateNotes("C:/repo-a", "Use small patches.");
  assert.equal(memory.notes, "Use small patches.");
});

test("MemoryStore returns the latest updated project", async () => {
  const store = await makeStore();
  await store.ensure("C:/repo-a");
  await store.ensure("C:/repo-b");
  const latest = await store.updateNotes("C:/repo-a", "most recent");

  assert.equal((await store.latest()).rootPath, latest.rootPath);
});

test("MemoryStore appends task summaries and deduplicates task id", async () => {
  const store = await makeStore();
  await store.ensure("C:/repo-a");
  await store.appendTaskSummary("C:/repo-a", { id: "task-1", goal: "first", status: "completed", verification: { exitCode: 0, timedOut: false } }, "done");
  const memory = await store.appendTaskSummary("C:/repo-a", { id: "task-1", goal: "first again", status: "completed" }, "updated");

  assert.equal(memory.taskSummaries.length, 1);
  assert.equal(memory.taskSummaries[0].summary, "updated");
  assert.equal(memory.taskSummaries[0].goal, "first again");
});
