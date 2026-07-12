import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ModelOutboundPreviewStore } from "../packages/model-outbound/src/preview-store.js";
import { ModelProvider } from "../packages/model-provider/src/index.js";

const digest = (value) => createHash("sha256").update(value).digest("hex");

function fixture(overrides = {}) {
  const body = Buffer.from('{"model":"测试-😀","messages":[]}', "utf8");
  const prepared = {
    version: 1,
    operation: "task-suggest",
    provider: Object.freeze({ type: "openai-compatible", name: "test", model: "测试-😀" }),
    bodyText: body.toString("utf8"),
    exactBody: body.toString("utf8"),
    byteLength: body.byteLength,
    sha256: digest(body),
    endpoint: "https://example.test/v1/chat/completions",
    networkRequired: true,
    target: Object.freeze({ channel: "network", willLeaveDevice: true, endpoint: "https://example.test/v1/chat/completions" }),
    disclosure: Object.freeze({
      sendsNetworkRequest: true,
      willLeaveDevice: true,
      endpoint: "https://example.test/v1/chat/completions",
      dataKinds: Object.freeze(["task-goal"]),
      files: Object.freeze([])
    })
  };
  Object.defineProperty(prepared, "bodyBuffer", { enumerable: false, get: () => Buffer.from(body) });
  Object.freeze(prepared);
  return {
    operation: "task-suggest",
    task: { id: "task-1", revision: 7, rootPath: "C:/repo", rootIdentity: digest("root"), workspaceId: "workspace-1" },
    workspace: { id: "workspace-1" },
    manifest: { manifestDigest: digest("manifest"), policyVersion: "codeclaw-data-boundary-v2", files: [], excluded: [] },
    configGeneration: "generation-1",
    prepared,
    disclosure: {
      policyVersion: "codeclaw-data-boundary-v2",
      manifestDigest: digest("manifest"),
      files: [],
      dataClasses: ["task-goal"],
      containsSourceCode: false,
      anonymized: false,
      safeToShare: false,
      excludedCount: 0
    },
    ...overrides
  };
}

function providerFixture(provider, operation = "task-suggest") {
  const input = fixture();
  const prepared = provider.prepare(operation, { goal: "review and discard" });
  return {
    ...input,
    operation,
    prepared,
    disclosure: {
      ...input.disclosure,
      dataClasses: [...prepared.disclosure.dataKinds],
      containsSourceCode: false
    }
  };
}

test("model preview exposes the exact UTF-8 body, byte count, and digest", () => {
  const store = new ModelOutboundPreviewStore({ secret: Buffer.alloc(32, 1) });
  const input = fixture();
  const preview = store.create(input);

  assert.equal(preview.request.bodyUtf8, input.prepared.bodyText);
  assert.equal(preview.request.byteLength, input.prepared.bodyBuffer.length);
  assert.equal(preview.request.sha256, digest(input.prepared.bodyBuffer));
  assert.equal(preview.request.willLeaveDevice, true);
  assert.equal(preview.disclosure.dataClasses[0], "task-goal");
});

test("approved model previews are synchronously consumed exactly once", async () => {
  const store = new ModelOutboundPreviewStore({ secret: Buffer.alloc(32, 2) });
  const preview = store.create(fixture());
  const attempts = await Promise.allSettled(Array.from({ length: 2 }, async () => {
    const record = store.take({ previewId: preview.previewId, approvalDigest: preview.approvalDigest, approved: true });
    await Promise.resolve();
    return record;
  }));

  assert.deepEqual(attempts.map((item) => item.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(attempts.find((item) => item.status === "rejected").reason.code, "MODEL_PREVIEW_UNKNOWN");
  assert.equal(store.size, 0);
});

test("missing approval and a mismatched digest do not consume a preview", () => {
  const store = new ModelOutboundPreviewStore({ secret: Buffer.alloc(32, 3) });
  const preview = store.create(fixture());
  assert.throws(
    () => store.take({ previewId: preview.previewId, approvalDigest: preview.approvalDigest }),
    (error) => error.code === "MODEL_SEND_APPROVAL_REQUIRED"
  );
  assert.throws(
    () => store.take({ previewId: preview.previewId, approvalDigest: "0".repeat(64), approved: true }),
    (error) => error.code === "MODEL_PREVIEW_APPROVAL_MISMATCH"
  );
  assert.equal(store.size, 1);
  assert.equal(store.take({ previewId: preview.previewId, approvalDigest: preview.approvalDigest, approved: true }).taskRevision, 7);
});

test("explicit cancellation consumes the preview and wipes the provider request buffer", async () => {
  const provider = new ModelProvider({ type: "mock" });
  const input = providerFixture(provider);
  const store = new ModelOutboundPreviewStore({ secret: Buffer.alloc(32, 8) });
  const preview = store.create(input);
  assert.equal(store.discard({ previewId: preview.previewId, approvalDigest: preview.approvalDigest }).discarded, true);
  assert.equal(input.prepared.bodyBuffer.every((byte) => byte === 0), true);
  await assert.rejects(provider.executePrepared(input.prepared), { code: "invalid_prepared_request" });
  assert.throws(
    () => store.take({ previewId: preview.previewId, approvalDigest: preview.approvalDigest, approved: true }),
    (error) => error.code === "MODEL_PREVIEW_UNKNOWN"
  );
});

test("TTL expiry wipes an idle preview without requiring another store operation", async () => {
  const provider = new ModelProvider({ type: "mock" });
  const input = providerFixture(provider);
  const store = new ModelOutboundPreviewStore({ ttlMs: 20, secret: Buffer.alloc(32, 9) });
  store.create(input);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(input.prepared.bodyBuffer.every((byte) => byte === 0), true);
  await assert.rejects(provider.executePrepared(input.prepared), { code: "invalid_prepared_request" });
  assert.equal(store.size, 0);
});

test("expired and capacity-evicted previews cannot be consumed", () => {
  let now = 1_000;
  const store = new ModelOutboundPreviewStore({ ttlMs: 50, maxPreviews: 1, now: () => now, secret: Buffer.alloc(32, 4) });
  const first = store.create(fixture());
  const second = store.create(fixture({ task: { ...fixture().task, id: "task-2" } }));
  assert.throws(
    () => store.take({ previewId: first.previewId, approvalDigest: first.approvalDigest, approved: true }),
    (error) => error.code === "MODEL_PREVIEW_UNKNOWN"
  );
  now += 51;
  assert.throws(
    () => store.take({ previewId: second.previewId, approvalDigest: second.approvalDigest, approved: true }),
    (error) => error.code === "MODEL_PREVIEW_UNKNOWN"
  );
});

test("config clearing and release overwrite retained request buffers best effort", () => {
  const store = new ModelOutboundPreviewStore({ secret: Buffer.alloc(32, 5) });
  const preview = store.create(fixture());
  const record = store.take({ previewId: preview.previewId, approvalDigest: preview.approvalDigest, approved: true });
  assert.notEqual(record.publicBody.every((byte) => byte === 0), true);
  store.release(record);
  assert.equal(record.publicBody, null);
  assert.equal(record.prepared, null);
  assert.equal(record.disclosure, null);
  assert.equal(record.rootPath, "");
  const pending = store.create(fixture());
  store.clear();
  assert.equal(store.size, 0);
  assert.throws(
    () => store.take({ previewId: pending.previewId, approvalDigest: pending.approvalDigest, approved: true }),
    (error) => error.code === "MODEL_PREVIEW_UNKNOWN"
  );
});

test("preview creation rejects operation and displayed endpoint mismatches", () => {
  const store = new ModelOutboundPreviewStore({ secret: Buffer.alloc(32, 6) });
  const input = fixture();
  assert.throws(
    () => store.create({ ...input, operation: "context-files" }),
    (error) => error.code === "MODEL_REQUEST_INVALID"
  );

  const actualBody = input.prepared.bodyBuffer;
  const mismatched = {
    ...input.prepared,
    endpoint: "https://actual.example/v1/chat/completions",
    target: Object.freeze({ channel: "network", willLeaveDevice: true, endpoint: "https://displayed.example/v1/chat/completions" })
  };
  Object.defineProperty(mismatched, "bodyBuffer", { enumerable: false, get: () => Buffer.from(actualBody) });
  Object.freeze(mismatched);
  assert.throws(
    () => store.create({ ...input, prepared: mismatched }),
    (error) => error.code === "MODEL_REQUEST_INVALID"
  );
  assert.throws(
    () => store.create({ ...input, disclosure: { ...input.disclosure, dataClasses: ["different"] } }),
    (error) => error.code === "MODEL_DISCLOSURE_INVALID"
  );
});

test("loopback and local targets preserve device-bound disclosure", () => {
  const store = new ModelOutboundPreviewStore({ secret: Buffer.alloc(32, 7) });
  const input = fixture();
  const loopback = {
    ...input.prepared,
    endpoint: "http://127.0.0.1:11434/v1/chat/completions",
    target: Object.freeze({ channel: "loopback", willLeaveDevice: false, endpoint: "http://127.0.0.1:11434/v1/chat/completions" }),
    disclosure: Object.freeze({
      ...input.prepared.disclosure,
      willLeaveDevice: false,
      endpoint: "http://127.0.0.1:11434/v1/chat/completions"
    })
  };
  Object.defineProperty(loopback, "bodyBuffer", { enumerable: false, get: () => input.prepared.bodyBuffer });
  Object.freeze(loopback);
  const loopbackPreview = store.create({ ...input, prepared: loopback });
  assert.equal(loopbackPreview.request.channel, "loopback");
  assert.equal(loopbackPreview.request.willLeaveDevice, false);

  const local = {
    ...input.prepared,
    endpoint: null,
    networkRequired: false,
    target: Object.freeze({ channel: "local", willLeaveDevice: false, endpoint: null }),
    disclosure: Object.freeze({
      ...input.prepared.disclosure,
      sendsNetworkRequest: false,
      willLeaveDevice: false,
      endpoint: null
    })
  };
  Object.defineProperty(local, "bodyBuffer", { enumerable: false, get: () => input.prepared.bodyBuffer });
  Object.freeze(local);
  const localPreview = store.create({ ...input, prepared: local });
  assert.equal(localPreview.request.channel, "local");
  assert.equal(localPreview.request.willLeaveDevice, false);
  assert.equal(localPreview.request.endpoint, null);
});
