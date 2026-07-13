import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AuditLog } from "../packages/audit-log/src/index.js";
import { MemoryStore } from "../packages/memory-store/src/index.js";
import { TaskStore } from "../packages/task-store/src/index.js";
import { STATE_LIMITS } from "../packages/shared/src/state-limits.js";

test("TaskStore migration bounds non-recovery histories and records dropped counts", async (t) => {
  const root = await temporaryRoot(t, "codeclaw-state-task-history-");
  const storagePath = path.join(root, "tasks.json");
  const task = {
    id: "task-history",
    revision: 1,
    goal: "bounded history",
    status: "running",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    toolCalls: Array.from({ length: STATE_LIMITS.taskToolCalls + 5 }, (_, index) => ({ tool: "read_file", index })),
    verificationHistory: Array.from({ length: STATE_LIMITS.taskVerificationHistory + 4 }, (_, index) => ({ exitCode: index % 2, time: "2026-01-01T00:00:00.000Z" })),
    modelEvents: Array.from({ length: STATE_LIMITS.taskModelEvents + 3 }, () => ({ operation: "task-suggest", status: "ok", time: "2026-01-01T00:00:00.000Z" })),
    contextFiles: Array.from({ length: STATE_LIMITS.taskContextFiles + 2 }, (_, index) => ({ path: `src/${index}.js`, size: 0, sha256: "", contentComplete: false, source: "read_file", time: "2026-01-01T00:00:00.000Z" })),
    appliedPatches: []
  };
  await fs.writeFile(storagePath, `${JSON.stringify([task])}\n`, "utf8");
  const store = new TaskStore({ storagePath });
  const initialized = await store.initialize();
  assert.equal(initialized.migrated, 1);
  const migrated = await store.get(task.id);
  assert.equal(migrated.toolCalls.length, STATE_LIMITS.taskToolCalls);
  assert.equal(migrated.toolCallsDropped, 5);
  assert.equal(migrated.verificationHistory.length, STATE_LIMITS.taskVerificationHistory);
  assert.equal(migrated.verificationHistoryDropped, 4);
  assert.equal(migrated.modelEvents.length, STATE_LIMITS.taskModelEvents);
  assert.equal(migrated.modelEventsDropped, 3);
  assert.equal(migrated.contextFiles.length, STATE_LIMITS.taskContextFiles);
  assert.equal(migrated.contextFilesDropped, 2);
});

test("TaskStore fails closed at task, goal, and patch-history capacity without deleting recovery records", async (t) => {
  const root = await temporaryRoot(t, "codeclaw-state-task-capacity-");
  const storagePath = path.join(root, "tasks.json");
  await fs.writeFile(storagePath, JSON.stringify(Array.from({ length: STATE_LIMITS.taskCount + 1 }, (_, index) => ({ id: `task-${index}`, goal: "g" }))), "utf8");
  const oversized = new TaskStore({ storagePath });
  await assert.rejects(oversized.initialize(), (error) => error.code === "TASK_STORE_CAPACITY");

  const boundedPath = path.join(root, "bounded.json");
  const store = new TaskStore({ storagePath: boundedPath });
  await assert.rejects(
    store.create({ goal: "x".repeat(STATE_LIMITS.taskGoalBytes + 1) }),
    (error) => error.code === "TASK_GOAL_TOO_LARGE" && error.status === 413
  );
  const task = await store.create({ goal: "patch capacity" });
  const patches = Array.from({ length: STATE_LIMITS.taskAppliedPatches + 1 }, (_, index) => ({
    path: `src/${index}.js`, previousContent: "", nextContent: String(index)
  }));
  await assert.rejects(store.recordAppliedPatches(task.id, patches), (error) => error.code === "TASK_PATCH_HISTORY_CAPACITY");
  assert.deepEqual((await store.get(task.id)).appliedPatches, []);
});

test("MemoryStore migration bounds commands, summaries, and key files with explicit drop counts", async (t) => {
  const root = await temporaryRoot(t, "codeclaw-state-memory-history-");
  const storagePath = path.join(root, "memory.json");
  const memory = {
    rootPath: path.join(root, "project"),
    profile: { keyFiles: Array.from({ length: 70 }, (_, index) => `src/${index}.js`) },
    commands: Array.from({ length: STATE_LIMITS.memoryCommands + 5 }, (_, index) => ({ command: `command-${index}`, lastSeenAt: new Date(index * 1000).toISOString() })),
    taskSummaries: Array.from({ length: 35 }, (_, index) => ({ taskId: `task-${index}` })),
    notes: "safe"
  };
  await fs.writeFile(storagePath, JSON.stringify([memory]), "utf8");
  const store = new MemoryStore({ storagePath });
  const initialized = await store.initialize();
  assert.equal(initialized.changed, true);
  const migrated = await store.get(memory.rootPath);
  assert.equal(migrated.commands.length, STATE_LIMITS.memoryCommands);
  assert.equal(migrated.commandsDropped, 5);
  assert.equal(migrated.taskSummaries.length, 30);
  assert.equal(migrated.taskSummariesDropped, 5);
  assert.equal(migrated.profile.keyFiles.length, 60);
  await assert.rejects(
    store.updateNotes(memory.rootPath, "n".repeat(STATE_LIMITS.memoryNotesBytes + 1)),
    (error) => error.code === "MEMORY_NOTES_TOO_LARGE" && error.status === 413
  );
  assert.equal((await store.get(memory.rootPath)).notes, "safe");
});

test("AuditLog rotates bounded generations with digest evidence and rejects oversized entries", async (t) => {
  const root = await temporaryRoot(t, "codeclaw-state-audit-rotation-");
  const storagePath = path.join(root, "audit.jsonl");
  const log = new AuditLog({ storagePath, limits: { entryBytes: 2048, segmentBytes: 4096, readBytes: 8192 } });
  for (let index = 0; index < 14; index += 1) {
    await log.record({ type: "test.event", title: `event-${index}`, detail: "d".repeat(700), metadata: { index } });
  }
  const entries = await log.latest({ limit: 50_000 });
  assert.ok(entries.some((entry) => entry.type === "audit.rotation"));
  assert.equal(entries[0].title, "event-13");
  assert.ok((await fs.stat(`${storagePath}.1`)).size <= 8192);
  assert.ok((await fs.stat(storagePath)).size <= 4096);
  await assert.rejects(
    log.record({ type: "test.large", detail: "x".repeat(3000) }),
    (error) => error.code === "AUDIT_ENTRY_TOO_LARGE" && error.status === 413
  );
});

async function temporaryRoot(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
