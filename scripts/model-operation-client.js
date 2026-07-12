const MODEL_OPERATIONS = new Set([
  "task-suggest",
  "context-files",
  "patch-proposal",
  "failure-fix"
]);

export async function previewAndApproveModelOperation(request, { operation, taskId, inspectPreview } = {}) {
  if (!MODEL_OPERATIONS.has(operation)) throw new Error(`Unsupported model operation: ${operation}`);
  if (typeof taskId !== "string" || !taskId) throw new Error("A task id is required for a model operation.");

  const previewEnvelope = await request("/api/model/preview", { operation, taskId });
  const previewPayload = unwrapPayload(previewEnvelope);
  const preview = previewPayload?.preview;
  if (!preview?.previewId || !preview.approvalDigest || preview.operation !== operation) {
    throw new Error(`Model preview for ${operation} was incomplete.`);
  }
  if (typeof preview.request?.bodyUtf8 !== "string"
    || !Number.isSafeInteger(preview.request?.byteLength)
    || typeof preview.request?.sha256 !== "string") {
    throw new Error(`Model preview for ${operation} did not expose the exact reviewed request.`);
  }

  if (inspectPreview) await inspectPreview(preview, previewEnvelope);

  const sendEnvelope = await request("/api/model/send", {
    previewId: preview.previewId,
    approvalDigest: preview.approvalDigest,
    approved: true
  });
  const sendPayload = unwrapPayload(sendEnvelope);
  if (sendPayload?.ok !== true || sendPayload.operation !== operation || !("result" in sendPayload)) {
    throw new Error(`Approved model send for ${operation} returned an incomplete result.`);
  }
  return {
    preview,
    previewEnvelope,
    sendEnvelope,
    payload: sendPayload,
    result: sendPayload.result,
    task: sendPayload.task
  };
}

function unwrapPayload(envelope) {
  return envelope && typeof envelope === "object" && envelope.payload && typeof envelope.payload === "object"
    ? envelope.payload
    : envelope;
}
