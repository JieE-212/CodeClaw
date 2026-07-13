import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AuditLog, summarizeToolResult } from "../packages/audit-log/src/index.js";

async function makeLog(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-audit-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return new AuditLog({ storagePath: path.join(root, "audit.jsonl") });
}

test("AuditLog records and returns latest events first", async (t) => {
  const log = await makeLog(t);
  await log.record({ type: "repo.scan", title: "Scan", rootPath: "C:/repo-a", detail: "first" });
  await log.record({ type: "tool.call", title: "Tool", rootPath: "C:/repo-a", detail: "second" });

  const events = await log.latest({ rootPath: "C:/repo-a" });
  assert.equal(events.length, 2);
  assert.equal(events[0].title, "Tool");
  assert.equal(events[1].title, "Scan");
});

test("AuditLog filters by root path and ignores malformed lines", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-audit-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const storagePath = path.join(root, "audit.jsonl");
  const log = new AuditLog({ storagePath });
  await log.record({ type: "repo.scan", rootPath: "C:/repo-a" });
  await fs.appendFile(storagePath, "not-json\n", "utf8");
  await log.record({ type: "repo.scan", rootPath: "C:/repo-b" });

  const events = await log.latest({ rootPath: "C:/repo-b" });
  assert.equal(events.length, 1);
  assert.equal(events[0].rootPath, path.resolve("C:/repo-b"));
});

test("summarizeToolResult creates compact descriptions", () => {
  assert.equal(summarizeToolResult({ blocked: true, message: "needs approval" }), "needs approval");
  assert.equal(summarizeToolResult({ result: { exitCode: 0, timedOut: false } }), "exitCode=0, timedOut=false");
  assert.equal(summarizeToolResult({ result: ["a", "b"] }), "2 item(s) returned.");
  assert.equal(
    summarizeToolResult({ result: ["a"], truncated: true, budget: { reasons: ["max-files"] } }),
    "1 item(s) returned. Partial result (max-files)."
  );
});

test("model audit events retain only bounded metadata and never persist bodies", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-audit-private-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const storagePath = path.join(root, "audit.jsonl");
  const log = new AuditLog({ storagePath });
  const sentinel = "MODEL-BODY-SECRET-SENTINEL";
  const entry = await log.record({
    type: "model.send",
    detail: sentinel,
    metadata: {
      operation: "task-suggest",
      provider: "test",
      model: "safe-name",
      requestSha256: "a".repeat(64),
      requestBytes: 42,
      content: sentinel,
      prompt: sentinel,
      upstreamError: sentinel,
      apiKey: sentinel
    }
  });

  assert.equal(entry.detail, "");
  assert.equal(entry.metadata.operation, "task-suggest");
  assert.equal(entry.metadata.requestBytes, 42);
  assert.equal(Object.hasOwn(entry.metadata, "content"), false);
  assert.equal((await fs.readFile(storagePath, "utf8")).includes(sentinel), false);
});

test("legacy model and server errors can be redacted in place", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-audit-migrate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const storagePath = path.join(root, "audit.jsonl");
  const sentinel = "LEGACY-UPSTREAM-SECRET-SENTINEL";
  await fs.writeFile(storagePath, [
    JSON.stringify({ id: "1", time: "2026-01-01T00:00:00.000Z", type: "model.suggest", status: "ok", title: "old", detail: sentinel, rootPath: null, metadata: { taskId: "task-1", content: sentinel } }),
    JSON.stringify({ id: "2", time: "2026-01-01T00:00:00.000Z", type: "server.error", status: "error", title: "old", detail: sentinel, rootPath: null, metadata: { code: "MODEL_UPSTREAM_HTTP_ERROR", error: sentinel } })
  ].join("\n") + "\n", "utf8");
  const log = new AuditLog({ storagePath });

  const result = await log.redactLegacyModelData();
  const content = await fs.readFile(storagePath, "utf8");
  const entries = await log.readAll();
  assert.equal(result.changed, true);
  assert.equal(content.includes(sentinel), false);
  assert.deepEqual(entries[0].metadata, { taskId: "task-1" });
  assert.deepEqual(entries[1].metadata, { code: "MODEL_UPSTREAM_HTTP_ERROR" });
});
