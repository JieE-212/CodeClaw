import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PatchTransactionClaimStore, loadPatchStateOwnerId } from "../packages/patch-transaction/src/claim-store.js";
import { captureWorkspaceIdentity } from "../packages/shared/src/workspace-identity.js";

async function withTemporaryDirectory(prefix, run) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await run(base);
  } finally {
    await fs.rm(base, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function withClaimFixture(run) {
  return withTemporaryDirectory("codeclaw-claim-store-", async (base) => {
    const rootPath = path.join(base, "project");
    const storagePath = path.join(base, "claims");
    await fs.mkdir(rootPath, { recursive: true });
    const rootIdentity = (await captureWorkspaceIdentity(rootPath)).digest;
    return run({ base, rootPath, rootIdentity, storagePath });
  });
}

test("patch state owner id is stable for one state directory and distinct across state directories", async () => {
  await withTemporaryDirectory("codeclaw-claim-owner-", async (base) => {
    const stateA = path.join(base, "state-a");
    const stateB = path.join(base, "state-b");
    const firstA = await loadPatchStateOwnerId(stateA);
    const secondA = await loadPatchStateOwnerId(stateA);
    const firstB = await loadPatchStateOwnerId(stateB);

    assert.equal(secondA, firstA);
    assert.notEqual(firstB, firstA);
  });
});

test("a reserved claim without a journal can be cleared by its owner", async () => {
  await withClaimFixture(async ({ rootPath, rootIdentity, storagePath }) => {
    const transactionId = "apply-reserved-12345678";
    const store = new PatchTransactionClaimStore({ storagePath, ownerId: "owner-a" });
    await store.begin({ rootPath, rootIdentity, transactionId, operation: "apply" });

    const result = await store.assertCompatible({ rootPath, rootIdentity, pendingTransactionIds: [] });

    assert.equal(result.ok, true);
    assert.equal(result.clearedOrphan, true);
    assert.equal((await store.read(rootPath)).exists, false);
  });
});

test("a journaled claim without a journal is retained and blocks recovery", async () => {
  await withClaimFixture(async ({ rootPath, rootIdentity, storagePath }) => {
    const transactionId = "apply-journaled-12345678";
    const store = new PatchTransactionClaimStore({ storagePath, ownerId: "owner-a" });
    await store.begin({ rootPath, rootIdentity, transactionId, operation: "apply" });
    await store.markJournaled({ rootPath, rootIdentity, transactionId });

    await assert.rejects(
      () => store.assertCompatible({ rootPath, rootIdentity, pendingTransactionIds: [] }),
      (error) => error.code === "PATCH_TRANSACTION_JOURNAL_MISSING"
    );
    const retained = await store.read(rootPath);
    assert.equal(retained.exists, true);
    assert.equal(retained.record.phase, "journaled");
  });
});

test("a foreign owner cannot adopt an existing claim", async () => {
  await withClaimFixture(async ({ rootPath, rootIdentity, storagePath }) => {
    const transactionId = "apply-foreign-12345678";
    const ownerStore = new PatchTransactionClaimStore({ storagePath, ownerId: "owner-a" });
    const foreignStore = new PatchTransactionClaimStore({ storagePath, ownerId: "owner-b" });
    await ownerStore.begin({ rootPath, rootIdentity, transactionId, operation: "apply" });

    await assert.rejects(
      () => foreignStore.assertCompatible({ rootPath, rootIdentity, pendingTransactionIds: [transactionId] }),
      (error) => error.code === "PATCH_RECOVERY_OWNED_ELSEWHERE"
    );
    assert.equal((await ownerStore.read(rootPath)).exists, true);
  });
});

test("a pending journal without a claim blocks recovery", async () => {
  await withClaimFixture(async ({ rootPath, rootIdentity, storagePath }) => {
    const store = new PatchTransactionClaimStore({ storagePath, ownerId: "owner-a" });

    await assert.rejects(
      () => store.assertCompatible({
        rootPath,
        rootIdentity,
        pendingTransactionIds: ["apply-missing-12345678"]
      }),
      (error) => error.code === "PATCH_TRANSACTION_CLAIM_MISSING"
    );
  });
});

test("a claim accepts exactly its one pending journal and rejects mismatches or multiple journals", async () => {
  await withClaimFixture(async ({ rootPath, rootIdentity, storagePath }) => {
    const transactionId = "apply-pending-12345678";
    const store = new PatchTransactionClaimStore({ storagePath, ownerId: "owner-a" });
    await store.begin({ rootPath, rootIdentity, transactionId, operation: "apply" });

    const compatible = await store.assertCompatible({ rootPath, rootIdentity, pendingTransactionIds: [transactionId] });
    assert.equal(compatible.ok, true);
    assert.equal(compatible.claim.transactionId, transactionId);

    await assert.rejects(
      () => store.assertCompatible({
        rootPath,
        rootIdentity,
        pendingTransactionIds: ["apply-mismatch-12345678"]
      }),
      (error) => error.code === "PATCH_TRANSACTION_CLAIM_MISMATCH"
    );
    await assert.rejects(
      () => store.assertCompatible({
        rootPath,
        rootIdentity,
        pendingTransactionIds: [transactionId, "apply-second-12345678"]
      }),
      (error) => error.code === "PATCH_TRANSACTION_CLAIM_MISMATCH"
    );
    assert.equal((await store.read(rootPath)).exists, true);
  });
});

test("a complete claim without pending journals can be cleared", async () => {
  await withClaimFixture(async ({ rootPath, rootIdentity, storagePath }) => {
    const transactionId = "revert-complete-12345678";
    const store = new PatchTransactionClaimStore({ storagePath, ownerId: "owner-a" });
    await store.begin({ rootPath, rootIdentity, transactionId, operation: "revert" });
    await store.markComplete({ rootPath, rootIdentity, transactionId });

    const result = await store.assertCompatible({ rootPath, rootIdentity, pendingTransactionIds: [] });

    assert.equal(result.ok, true);
    assert.equal(result.clearedOrphan, true);
    assert.equal((await store.read(rootPath)).exists, false);
  });
});
