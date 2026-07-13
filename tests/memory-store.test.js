import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MemoryStore } from "../packages/memory-store/src/index.js";

async function makeStore(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-memory-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return new MemoryStore({ storagePath: path.join(root, "memory.json") });
}

test("MemoryStore upserts repo profile and commands", async (t) => {
  const store = await makeStore(t);
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

test("MemoryStore updates notes", async (t) => {
  const store = await makeStore(t);
  await store.ensure("C:/repo-a");
  const memory = await store.updateNotes("C:/repo-a", "Use small patches.");
  assert.equal(memory.notes, "Use small patches.");
});

test("MemoryStore returns the latest updated project", async (t) => {
  const store = await makeStore(t);
  await store.ensure("C:/repo-a");
  await store.ensure("C:/repo-b");
  const latest = await store.updateNotes("C:/repo-a", "most recent");

  assert.equal((await store.latest()).rootPath, latest.rootPath);
});

test("MemoryStore appends task summaries and deduplicates task id", async (t) => {
  const store = await makeStore(t);
  await store.ensure("C:/repo-a");
  await store.appendTaskSummary("C:/repo-a", { id: "task-1", goal: "first", status: "completed", verification: { exitCode: 0, timedOut: false } }, "done");
  const memory = await store.appendTaskSummary("C:/repo-a", { id: "task-1", goal: "first again", status: "completed" }, "updated");

  assert.equal(memory.taskSummaries.length, 1);
  assert.equal(memory.taskSummaries[0].summary, "updated");
  assert.equal(memory.taskSummaries[0].goal, "first again");
});

test("MemoryStore serializes notes and summary removal across instances", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-memory-race-remove-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const storagePath = path.join(root, "memory.json");
  const notesStore = new MemoryStore({ storagePath });
  const revertStore = new MemoryStore({ storagePath });
  await notesStore.appendTaskSummary("C:/repo-a", { id: "task-1", status: "completed" }, "done");

  await Promise.all([
    notesStore.updateNotes("C:/repo-a", "keep this note"),
    revertStore.removeTaskSummary("C:/repo-a", "task-1")
  ]);

  const memory = await notesStore.get("C:/repo-a");
  assert.equal(memory.notes, "keep this note");
  assert.deepEqual(memory.taskSummaries, []);
});

test("MemoryStore serializes a new completion summary and notes across instances", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-memory-race-append-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const storagePath = path.join(root, "memory.json");
  const summaryStore = new MemoryStore({ storagePath });
  const notesStore = new MemoryStore({ storagePath });
  await summaryStore.ensure("C:/repo-a");

  await Promise.all([
    summaryStore.appendTaskSummary("C:/repo-a", { id: "task-2", goal: "finish", status: "completed" }, "done"),
    notesStore.updateNotes("C:/repo-a", "preserve me")
  ]);

  const memory = await summaryStore.get("C:/repo-a");
  assert.equal(memory.notes, "preserve me");
  assert.equal(memory.taskSummaries.length, 1);
  assert.equal(memory.taskSummaries[0].taskId, "task-2");
});

test("MemoryStore startup reconciliation removes summaries for reopened tasks", async (t) => {
  const store = await makeStore(t);
  await store.appendTaskSummary("C:/repo-a", { id: "task-running", status: "completed" }, "stale");
  await store.appendTaskSummary("C:/repo-a", { id: "task-complete", status: "completed" }, "keep");

  const result = await store.reconcileTaskSummaries([
    { id: "task-running", status: "running" },
    { id: "task-complete", status: "completed" }
  ]);

  assert.equal(result.removed, 1);
  const memory = await store.get("C:/repo-a");
  assert.deepEqual(memory.taskSummaries.map((summary) => summary.taskId), ["task-complete"]);
});
