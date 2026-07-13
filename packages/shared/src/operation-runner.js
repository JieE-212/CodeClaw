import { throwIfAborted } from "./operation-manager.js";

export async function runManagedOperation(manager, {
  id,
  kind,
  timeoutMs,
  metadata,
  request = null,
  response = null
} = {}, work) {
  if (!manager || typeof manager.start !== "function" || typeof work !== "function") {
    throw new TypeError("A managed operation requires a manager and work function.");
  }

  const operation = manager.start({ id, kind, timeoutMs, metadata });
  const removeDisconnectListeners = bindDisconnectCancellation(manager, operation, request, response);
  try {
    const result = await work(operation);
    if (!operation.committed) throwIfAborted(operation.signal);
    return result;
  } catch (error) {
    if (!operation.committed) throwIfAborted(operation.signal);
    throw error;
  } finally {
    removeDisconnectListeners();
    operation.finish();
  }
}

function bindDisconnectCancellation(manager, operation, request, response) {
  const cancel = () => manager.cancel(operation.id, "The local client disconnected before the operation completed.");
  const close = () => {
    if (!response?.writableEnded) cancel();
  };

  request?.once?.("aborted", cancel);
  response?.once?.("close", close);
  return () => {
    request?.off?.("aborted", cancel);
    response?.off?.("close", close);
  };
}
