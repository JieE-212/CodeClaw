import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AuditLog, summarizeToolResult } from "../packages/audit-log/src/index.js";

async function makeLog() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-audit-"));
  return new AuditLog({ storagePath: path.join(root, "audit.jsonl") });
}

test("AuditLog records and returns latest events first", async () => {
  const log = await makeLog();
  await log.record({ type: "repo.scan", title: "Scan", rootPath: "C:/repo-a", detail: "first" });
  await log.record({ type: "tool.call", title: "Tool", rootPath: "C:/repo-a", detail: "second" });

  const events = await log.latest({ rootPath: "C:/repo-a" });
  assert.equal(events.length, 2);
  assert.equal(events[0].title, "Tool");
  assert.equal(events[1].title, "Scan");
});

test("AuditLog filters by root path and ignores malformed lines", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-audit-"));
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
});
