import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { OperationManager, throwIfAborted } from "../packages/shared/src/operation-manager.js";

test("OperationManager enforces global, per-kind, and unique-ID limits", () => {
  const manager = new OperationManager({ maxActive: 2, maxPerKind: 1, defaultTimeoutMs: 1000 });
  const scan = manager.start({ id: "scan-1", kind: "scan" });
  assert.throws(() => manager.start({ id: "scan-2", kind: "scan" }), (error) => error.code === "OPERATION_KIND_LIMIT_REACHED" && error.status === 429);
  const model = manager.start({ id: "model-1", kind: "model" });
  assert.throws(() => manager.start({ id: "other-1", kind: "verify" }), (error) => error.code === "OPERATION_LIMIT_REACHED" && error.status === 429);
  assert.throws(() => manager.start({ id: "scan-1", kind: "verify" }), (error) => error.code === "OPERATION_ID_CONFLICT");
  assert.equal(scan.finish(), true);
  assert.equal(scan.finish(), false);
  assert.equal(model.finish(), true);
  assert.deepEqual(manager.list(), []);
});

test("OperationManager cancellation exposes a bounded public error and requires finalization", () => {
  const manager = new OperationManager({ defaultTimeoutMs: 1000 });
  const operation = manager.start({ id: "scan-cancel", kind: "scan", metadata: { taskId: "task-1", path: "must-not-survive/path" } });
  assert.equal(manager.cancel(operation.id), true);
  assert.equal(operation.signal.aborted, true);
  assert.throws(() => throwIfAborted(operation.signal), (error) => error.code === "OPERATION_CANCELLED" && error.status === 409);
  assert.equal(manager.list()[0].metadata.path, undefined);
  assert.equal(manager.cancel("missing"), false);
  operation.finish();
  assert.deepEqual(manager.list(), []);
});

test("OperationManager closes cancellation before a successful state commit", () => {
  const manager = new OperationManager({ defaultTimeoutMs: 1000 });
  const operation = manager.start({ id: "scan-commit", kind: "scan" });

  assert.equal(operation.beginCommit(), true);
  assert.equal(operation.beginCommit(), false);
  assert.equal(manager.list()[0].phase, "committing");
  assert.equal(manager.cancel(operation.id), false);
  assert.equal(manager.abortAll(), 0);
  assert.equal(operation.signal.aborted, false);
  assert.equal(operation.confirmCommit(), true);
  assert.equal(operation.committed, true);
  assert.equal(manager.list()[0].phase, "committed");
  assert.equal(operation.confirmCommit(), false);
  operation.finish();
});

test("OperationManager gives the non-cancellable commit phase a separate deadline", async () => {
  const manager = new OperationManager({ defaultTimeoutMs: 1000, commitTimeoutMs: 20 });
  const operation = manager.start({ id: "hung-commit", kind: "verify" });
  operation.beginCommit();

  await delay(35);
  assert.throws(() => throwIfAborted(operation.signal), (error) => error.code === "OPERATION_COMMIT_TIMEOUT" && error.status === 504);
  operation.finish();
});

test("OperationManager deadlines abort slow work and abortAll covers shutdown", async () => {
  const manager = new OperationManager({ maxActive: 3, maxPerKind: 3, defaultTimeoutMs: 20, maxTimeoutMs: 50 });
  const timed = manager.start({ id: "timed", kind: "scan" });
  await delay(35);
  assert.throws(() => throwIfAborted(timed.signal), (error) => error.code === "OPERATION_TIMEOUT" && error.status === 408);
  const one = manager.start({ id: "one", kind: "model", timeoutMs: 1000 });
  const two = manager.start({ id: "two", kind: "verify", timeoutMs: 1000 });
  assert.equal(manager.abortAll(), 2);
  assert.throws(() => throwIfAborted(one.signal), (error) => error.code === "OPERATION_CANCELLED");
  assert.throws(() => throwIfAborted(two.signal), (error) => error.code === "OPERATION_CANCELLED");
  timed.finish();
  one.finish();
  two.finish();
});

test("OperationManager waitForIdle distinguishes bounded shutdown from completed cleanup", async () => {
  const manager = new OperationManager({ defaultTimeoutMs: 1000 });
  const operation = manager.start({ kind: "scan" });

  assert.equal(await manager.waitForIdle(10), false);
  const idle = manager.waitForIdle(1000);
  operation.finish();
  assert.equal(await idle, true);
  assert.equal(await manager.waitForIdle(10), true);
});
