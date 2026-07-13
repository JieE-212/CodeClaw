const KIB = 1024;
const MIB = 1024 * KIB;

export const RUNTIME_BUDGETS = deepFreeze({
  jsonRequest: {
    maxBytes: 1 * MIB
  },
  repositoryScan: {
    maxFiles: 800,
    maxEntries: 20_000,
    maxDirectories: 4_000,
    maxDepth: 64,
    maxSkippedItems: 2_000,
    maxSummaryFileBytes: 6_000,
    maxSummaryTotalBytes: 1 * MIB,
    maxManifestFileBytes: 256 * KIB,
    maxIgnoreFiles: 256,
    maxIgnoreFileBytes: 256 * KIB,
    maxIgnoreTotalBytes: 1 * MIB,
    maxIgnoreRules: 20_000,
    maxIgnoreRuleEvaluations: 5_000_000,
    maxIgnorePatternChars: 4_096,
    maxIgnoreMatchSteps: 10_000_000
  },
  toolRegistry: {
    maxListFiles: 500,
    maxTraversalEntries: 20_000,
    maxTraversalDirectories: 4_000,
    maxTraversalDepth: 64,
    maxReadBytes: 1 * MIB,
    maxSearchFiles: 300,
    maxSearchTotalBytes: 16 * MIB,
    maxSearchResults: 20,
    maxMatchesPerFile: 5,
    maxSearchPreviewChars: 800,
    maxSearchLineChars: 400,
    maxSearchResultBytes: 256 * KIB,
    maxIgnoreFiles: 256,
    maxIgnoreFileBytes: 256 * KIB,
    maxIgnoreTotalBytes: 1 * MIB,
    maxIgnoreRules: 20_000,
    maxIgnoreRuleEvaluations: 5_000_000,
    maxIgnorePatternChars: 4_096,
    maxIgnoreMatchSteps: 10_000_000
  },
  dataBoundary: {
    maxFiles: 100_000,
    maxTotalBytes: 10 * 1024 * MIB,
    maxEntries: 200_000,
    maxDirectories: 20_000,
    maxDepth: 64,
    maxExcludedItems: 20_000,
    maxBlockerItems: 2_000,
    maxIgnoreFiles: 256,
    maxIgnoreFileBytes: 256 * KIB,
    maxIgnoreTotalBytes: 1 * MIB,
    maxIgnoreRules: 20_000,
    maxIgnoreRuleEvaluations: 5_000_000,
    maxIgnorePatternChars: 4_096,
    maxIgnoreMatchSteps: 10_000_000
  },
  preflight: {
    maxContextFiles: 8
  }
});

export function boundedBudgetValue(value, hardMaximum, fallback = hardMaximum, minimum = 1) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) return fallback;
  return Math.min(parsed, hardMaximum);
}

export function runtimeBudgetError(code, message, {
  operation,
  limit,
  observed = null,
  status = 413
} = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.runtimeBudget = {
    operation: String(operation || "runtime"),
    limit: Number.isSafeInteger(limit) ? limit : null,
    observed: Number.isSafeInteger(observed) ? observed : null
  };
  return error;
}

export function publicRuntimeBudgetEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const operation = typeof value.operation === "string" ? value.operation : "runtime";
  const limit = Number.isSafeInteger(value.limit) && value.limit >= 0 ? value.limit : null;
  const observed = Number.isSafeInteger(value.observed) && value.observed >= 0 ? value.observed : null;
  return { operation, limit, observed };
}

export async function readFileHandleBounded(handle, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError("A bounded file read requires a non-negative safe integer byte limit.");
  }
  const buffer = Buffer.allocUnsafe(maxBytes + 1);
  let byteLength = 0;
  while (byteLength < buffer.byteLength) {
    const read = await handle.read(buffer, byteLength, buffer.byteLength - byteLength, null);
    if (read.bytesRead === 0) break;
    byteLength += read.bytesRead;
  }
  return {
    buffer: buffer.subarray(0, Math.min(byteLength, maxBytes)),
    byteLength,
    exceeded: byteLength > maxBytes
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
