export const STATE_LIMITS = Object.freeze({
  taskStoreBytes: 64 * 1024 * 1024,
  taskCount: 250,
  taskGoalBytes: 16 * 1024,
  taskToolCalls: 200,
  taskVerificationHistory: 50,
  taskModelEvents: 100,
  taskContextFiles: 100,
  taskAppliedPatches: 200,
  memoryStoreBytes: 16 * 1024 * 1024,
  memoryProjects: 200,
  memoryNotesBytes: 64 * 1024,
  memoryCommands: 100,
  auditEntryBytes: 64 * 1024,
  auditSegmentBytes: 8 * 1024 * 1024,
  auditReadBytes: 16 * 1024 * 1024
});

export function boundedHistory(values, limit, dropped = 0) {
  const source = Array.isArray(values) ? values : [];
  const overflow = Math.max(0, source.length - limit);
  return {
    values: overflow ? source.slice(-limit) : source,
    dropped: normalizeDroppedCount(dropped) + overflow
  };
}

export function assertUtf8Bytes(value, limit, code, label) {
  const bytes = Buffer.byteLength(String(value || ""), "utf8");
  if (bytes <= limit) return bytes;
  throw stateLimitError(code, `${label} exceeds the ${limit}-byte local state limit. Shorten it and retry.`, 413);
}

export function stateLimitError(code, message, status = 507) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeDroppedCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
