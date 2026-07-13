import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { OperationManager } from "../packages/shared/src/operation-manager.js";
import { runManagedOperation } from "../packages/shared/src/operation-runner.js";

test("runManagedOperation rejects cancellation and always releases its slot", async () => {
  const manager = new OperationManager({ defaultTimeoutMs: 1000 });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const pending = runManagedOperation(manager, { id: "scan-1", kind: "scan" }, async () => gate);

  assert.equal(manager.cancel("scan-1"), true);
  release({ ok: true });
  await assert.rejects(pending, { code: "OPERATION_CANCELLED", status: 409 });
  assert.deepEqual(manager.list(), []);
});

test("runManagedOperation treats a disconnected client as cancellation", async () => {
  const manager = new OperationManager({ defaultTimeoutMs: 1000 });
  const request = new EventEmitter();
  const response = Object.assign(new EventEmitter(), { writableEnded: false });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const pending = runManagedOperation(manager, { id: "preflight-1", kind: "preflight", request, response }, async () => gate);

  response.emit("close");
  release({ ok: true });
  await assert.rejects(pending, { code: "OPERATION_CANCELLED" });
  assert.equal(request.listenerCount("aborted"), 0);
  assert.equal(response.listenerCount("close"), 0);
});

test("runManagedOperation finishes an atomic commit after cancellation closes", async () => {
  const manager = new OperationManager({ defaultTimeoutMs: 1000 });
  const response = Object.assign(new EventEmitter(), { writableEnded: false });
  let committed = false;
  const result = await runManagedOperation(manager, {
    id: "verify-1",
    kind: "verify",
    response
  }, async (operation) => {
    assert.equal(operation.beginCommit(), true);
    response.emit("close");
    committed = true;
    assert.equal(operation.confirmCommit(), true);
    return "saved";
  });

  assert.equal(result, "saved");
  assert.equal(committed, true);
  assert.deepEqual(manager.list(), []);
});

test("runManagedOperation returns a confirmed durable commit even if its deadline fired during the write", async () => {
  const manager = new OperationManager({ defaultTimeoutMs: 1000, commitTimeoutMs: 20 });
  const result = await runManagedOperation(manager, {
    id: "durable-after-deadline",
    kind: "preflight"
  }, async (operation) => {
    operation.beginCommit();
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(operation.signal.aborted, true);
    assert.equal(operation.confirmCommit(), true);
    return "durably-saved";
  });

  assert.equal(result, "durably-saved");
  assert.deepEqual(manager.list(), []);
});
