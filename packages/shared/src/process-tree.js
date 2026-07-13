import { spawn } from "node:child_process";

export async function terminateProcessTree(child, { graceMs = 250, forceAfterMs = 1000, helperTimeoutMs = 2000 } = {}) {
  const pid = child?.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0) return { attempted: false, forced: false, terminated: false };
  if (process.platform === "win32") {
    const result = await runTaskkill(pid, helperTimeoutMs);
    if (result.exitCode !== 0 && child.exitCode === null && !child.signalCode) {
      try {
        child.kill();
      } catch {
        // The direct child may already have exited.
      }
      await waitForExit(child, forceAfterMs);
    }
    const directExited = await waitForExit(child, forceAfterMs);
    return {
      attempted: true,
      forced: true,
      terminated: result.exitCode === 0,
      directExited,
      treeTerminationVerified: result.exitCode === 0,
      helperExitCode: result.exitCode,
      helperTimedOut: result.timedOut
    };
  }

  if (!isProcessGroupAlive(pid)) return { attempted: true, forced: false, terminated: true, directExited: true, treeTerminationVerified: true };
  signalProcessGroup(pid, child, "SIGTERM");
  if (await waitForProcessGroupExit(pid, graceMs)) {
    return { attempted: true, forced: false, terminated: true, directExited: await waitForExit(child, 1), treeTerminationVerified: true };
  }
  signalProcessGroup(pid, child, "SIGKILL");
  const terminated = await waitForProcessGroupExit(pid, forceAfterMs);
  return { attempted: true, forced: true, terminated, directExited: await waitForExit(child, 1), treeTerminationVerified: terminated };
}

export function processSpawnOptions(options = {}) {
  return {
    ...options,
    shell: false,
    windowsHide: true,
    ...(process.platform === "win32" ? {} : { detached: true })
  };
}

function signalProcessGroup(pid, child, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process may have exited between the state check and the signal.
    }
  }
}

function isProcessGroupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + Math.max(1, timeoutMs);
  while (Date.now() < deadline) {
    if (!isProcessGroupAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !isProcessGroupAlive(pid);
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("close", onClose);
      resolve(value);
    };
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(false), Math.max(1, timeoutMs));
    timer.unref?.();
    child.once("close", onClose);
  });
}

function runTaskkill(pid, timeoutMs) {
  return new Promise((resolve) => {
    const helper = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore"
    });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      helper.removeAllListeners("error");
      helper.removeAllListeners("close");
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        helper.kill();
      } catch {
        // The helper may already have exited at the deadline.
      }
      finish({ exitCode: null, timedOut: true });
    }, Math.max(50, timeoutMs));
    timer.unref?.();
    helper.once("error", () => finish({ exitCode: null, timedOut: false }));
    helper.once("close", (exitCode) => finish({ exitCode, timedOut: false }));
  });
}
