import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const DEFAULT_GRACE_MS = 5_000;
const DEFAULT_FORCE_MS = 5_000;
const TEMP_PREFIX = /^codeclaw-[a-z0-9]+(?:-[a-z0-9]+)*-$/;

export class AutomationResourceScope {
  #resources = [];
  #closed = false;

  defer(label, cleanup) {
    if (this.#closed) throw resourceError("AUTOMATION_SCOPE_CLOSED", "Automation resource cleanup has already started.");
    if (typeof label !== "string" || !label.trim() || typeof cleanup !== "function") {
      throw new TypeError("Automation cleanup needs a label and a function.");
    }
    this.#resources.push({ label: label.trim(), cleanup });
  }

  async temporaryDirectory(prefix, { parentPath = os.tmpdir() } = {}) {
    if (!TEMP_PREFIX.test(prefix || "")) {
      throw resourceError("AUTOMATION_TEMP_PREFIX_INVALID", "Automation temporary directories require a codeclaw-* prefix ending in a dash.");
    }
    const parent = path.resolve(parentPath);
    const directoryPath = await fs.mkdtemp(path.join(parent, prefix));
    const identity = await captureDirectoryIdentity(directoryPath);
    this.defer(`temporary directory ${directoryPath}`, () => removeOwnedTemporaryDirectory(directoryPath, {
      parentPath: parent,
      prefix,
      identity
    }));
    return directoryPath;
  }

  child(child, label = "child process", options = {}) {
    if (!child || typeof child.kill !== "function") throw new TypeError("Automation child cleanup needs a ChildProcess-like value.");
    this.defer(label, () => stopChildProcess(child, options));
    return child;
  }

  server(server, label = "listening server", options = {}) {
    if (!server || typeof server.close !== "function") throw new TypeError("Automation server cleanup needs a closeable server.");
    this.defer(label, () => closeListeningServer(server, options));
    return server;
  }

  async cleanup() {
    if (this.#closed) return [];
    this.#closed = true;
    const errors = [];
    for (const entry of this.#resources.slice().reverse()) {
      try {
        await entry.cleanup();
      } catch (error) {
        errors.push(cleanupError(entry.label, error));
      }
    }
    this.#resources = [];
    return errors;
  }
}

export async function withAutomationResources(work) {
  if (typeof work !== "function") throw new TypeError("Automation work must be a function.");
  const scope = new AutomationResourceScope();
  let value;
  let workError = null;
  try {
    value = await work(scope);
  } catch (error) {
    workError = normalizeError(error);
  }

  const cleanupErrors = await scope.cleanup();
  if (workError && cleanupErrors.length) {
    throw new AggregateError(
      [workError, ...cleanupErrors],
      `Automation failed and ${cleanupErrors.length} resource cleanup operation(s) also failed.`,
      { cause: workError }
    );
  }
  if (workError) throw workError;
  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, `${cleanupErrors.length} automation resource cleanup operation(s) failed.`);
  }
  return value;
}

async function stopChildProcess(child, { graceMs = DEFAULT_GRACE_MS, forceMs = DEFAULT_FORCE_MS } = {}) {
  validateTimeout(graceMs, "grace");
  validateTimeout(forceMs, "force");
  if (!child || childHasExited(child)) return;

  const signalErrors = [];
  try {
    child.kill();
  } catch (error) {
    signalErrors.push(normalizeError(error));
  }
  if (await waitForChildExit(child, graceMs)) return;

  try {
    child.kill("SIGKILL");
  } catch (error) {
    signalErrors.push(normalizeError(error));
  }
  if (await waitForChildExit(child, forceMs)) return;

  const timeout = resourceError("AUTOMATION_CHILD_STOP_TIMEOUT", "Automation child process did not exit after graceful and forced termination.");
  if (!signalErrors.length) throw timeout;
  throw new AggregateError([...signalErrors, timeout], timeout.message, { cause: timeout });
}

async function closeListeningServer(server, { graceMs = DEFAULT_GRACE_MS, forceMs = DEFAULT_FORCE_MS } = {}) {
  validateTimeout(graceMs, "grace");
  validateTimeout(forceMs, "force");
  if (!server || !server.listening) return;

  const closed = new Promise((resolve) => {
    try {
      server.close((error) => resolve({ error: error || null }));
    } catch (error) {
      resolve({ error: normalizeError(error) });
    }
  });
  let result = await settleWithin(closed, graceMs);
  if (!result.settled) {
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    result = await settleWithin(closed, forceMs);
  }
  if (!result.settled) {
    throw resourceError("AUTOMATION_SERVER_CLOSE_TIMEOUT", "Automation server did not close after its connections were terminated.");
  }
  if (result.value.error) throw result.value.error;
}

export async function listenOnLoopback(server, port = 0) {
  if (!server || typeof server.listen !== "function") throw new TypeError("A listenable server is required.");
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new TypeError("The listener port is invalid.");
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(server.address());
    };
    server.once("error", onError);
    server.once("listening", onListening);
    try {
      server.listen(port, "127.0.0.1");
    } catch (error) {
      server.off("error", onError);
      server.off("listening", onListening);
      reject(error);
    }
  });
}

export async function findAvailablePort() {
  return withAutomationResources(async (scope) => {
    const probe = scope.server(net.createServer(), "free-port probe", { graceMs: 1_000, forceMs: 1_000 });
    const address = await listenOnLoopback(probe, 0);
    return address.port;
  });
}

async function removeOwnedTemporaryDirectory(directoryPath, { parentPath, prefix, identity }) {
  const resolved = path.resolve(directoryPath);
  const parent = path.resolve(parentPath);
  const name = path.basename(resolved);
  if (path.dirname(resolved) !== parent || !name.startsWith(prefix) || name.length <= prefix.length) {
    throw resourceError("AUTOMATION_TEMP_PATH_INVALID", "Automation refused to remove a temporary directory outside its recorded parent and prefix.");
  }

  let current;
  try {
    current = await captureDirectoryIdentity(resolved);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (!sameIdentity(current, identity)) {
    throw resourceError("AUTOMATION_TEMP_IDENTITY_CHANGED", "Automation refused to remove a temporary directory whose identity changed.");
  }
  await fs.rm(resolved, { recursive: true, force: false, maxRetries: 5, retryDelay: 100 });
}

async function captureDirectoryIdentity(directoryPath) {
  const stat = await fs.lstat(directoryPath, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw resourceError("AUTOMATION_TEMP_IDENTITY_INVALID", "Automation temporary path is not an owned directory.");
  }
  return { dev: stat.dev, ino: stat.ino, birthtimeNs: stat.birthtimeNs };
}

function sameIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino && left?.birthtimeNs === right?.birthtimeNs;
}

function waitForChildExit(child, timeoutMs) {
  if (childHasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off?.("exit", onExit);
      child.off?.("close", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    child.once?.("exit", onExit);
    child.once?.("close", onExit);
    timer = setTimeout(() => finish(childHasExited(child)), timeoutMs);
    timer.unref?.();
    if (childHasExited(child)) finish(true);
  });
}

function childHasExited(child) {
  return child?.exitCode !== null && child?.exitCode !== undefined
    || child?.signalCode !== null && child?.signalCode !== undefined;
}

function settleWithin(promise, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish({ settled: false }), timeoutMs);
    timer.unref?.();
    promise.then((value) => finish({ settled: true, value }));
  });
}

function validateTimeout(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`Automation ${label} timeout must be a positive integer.`);
}

function cleanupError(label, error) {
  const cause = normalizeError(error);
  const wrapped = new Error(`Cleanup failed for ${label}: ${cause.message}`, { cause });
  wrapped.name = "AutomationCleanupError";
  wrapped.code = cause.code || "AUTOMATION_CLEANUP_FAILED";
  wrapped.resource = label;
  return wrapped;
}

function normalizeError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

function resourceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
