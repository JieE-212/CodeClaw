import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import {
  AutomationResourceScope,
  findAvailablePort,
  listenOnLoopback,
  withAutomationResources
} from "../scripts/automation-resource-scope.js";

test("work failure still removes every owned temporary directory", async () => {
  let first;
  let second;
  const expected = new Error("injected work failure");
  await assert.rejects(
    withAutomationResources(async (scope) => {
      first = await scope.temporaryDirectory("codeclaw-resource-first-");
      second = await scope.temporaryDirectory("codeclaw-resource-second-");
      throw expected;
    }),
    (error) => error === expected
  );
  await assert.rejects(fs.access(first), { code: "ENOENT" });
  await assert.rejects(fs.access(second), { code: "ENOENT" });
});

test("cleanup continues in LIFO order and aggregates work plus cleanup failures", async () => {
  const calls = [];
  const primary = new Error("primary failure");
  await assert.rejects(
    withAutomationResources(async (scope) => {
      scope.defer("first cleanup", async () => {
        calls.push("first");
        throw new Error("first cleanup failed");
      });
      scope.defer("second cleanup", async () => {
        calls.push("second");
        throw new Error("second cleanup failed");
      });
      throw primary;
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, primary);
      assert.equal(error.errors[0], primary);
      assert.deepEqual(error.errors.slice(1).map((item) => item.resource), ["second cleanup", "first cleanup"]);
      return true;
    }
  );
  assert.deepEqual(calls, ["second", "first"]);
});

test("a child that ignores graceful cleanup is force-terminated", async () => {
  const child = new FakeChild();
  await withAutomationResources(async (scope) => {
    scope.child(child, "injected child", { graceMs: 10, forceMs: 100 });
  });
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(child.exitCode, 137);
});

test("tracked listeners close before their owned directory is removed", async () => {
  let directoryPath;
  let port;
  await withAutomationResources(async (scope) => {
    directoryPath = await scope.temporaryDirectory("codeclaw-resource-server-");
    const server = scope.server(net.createServer(), "injected listener", { graceMs: 100, forceMs: 100 });
    port = (await listenOnLoopback(server, 0)).port;
    await fs.writeFile(path.join(directoryPath, "state.txt"), "temporary\n", "utf8");
  });
  await assert.rejects(fs.access(directoryPath), { code: "ENOENT" });
  const replacement = net.createServer();
  try {
    await listenOnLoopback(replacement, port);
  } finally {
    await new Promise((resolve) => replacement.close(resolve));
  }
});

test("listener cleanup failure does not skip owned temporary-directory cleanup", async () => {
  let directoryPath;
  const failingServer = {
    listening: true,
    close(callback) {
      callback(new Error("injected listener cleanup failure"));
    }
  };
  await assert.rejects(
    withAutomationResources(async (scope) => {
      directoryPath = await scope.temporaryDirectory("codeclaw-resource-listener-failure-");
      scope.server(failingServer, "injected failing listener", { graceMs: 10, forceMs: 10 });
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 1);
      assert.equal(error.errors[0].resource, "injected failing listener");
      return true;
    }
  );
  await assert.rejects(fs.access(directoryPath), { code: "ENOENT" });
});

test("temporary directory identity replacement is refused without deleting the replacement", async (t) => {
  const scope = new AutomationResourceScope();
  const directoryPath = await scope.temporaryDirectory("codeclaw-resource-identity-");
  const movedPath = `${directoryPath}-original`;
  await fs.rename(directoryPath, movedPath);
  await fs.mkdir(directoryPath);
  const sentinel = path.join(directoryPath, "sentinel.txt");
  await fs.writeFile(sentinel, "preserve replacement\n", "utf8");
  t.after(async () => {
    await fs.rm(directoryPath, { recursive: true, force: true });
    await fs.rm(movedPath, { recursive: true, force: true });
  });

  const errors = await scope.cleanup();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "AUTOMATION_TEMP_IDENTITY_CHANGED");
  assert.equal(await fs.readFile(sentinel, "utf8"), "preserve replacement\n");
});

test("free-port probes close their listener before returning", async () => {
  const port = await findAvailablePort();
  const server = net.createServer();
  try {
    await listenOnLoopback(server, port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("temporary directory prefixes are constrained before filesystem mutation", async () => {
  const scope = new AutomationResourceScope();
  await assert.rejects(
    scope.temporaryDirectory("unsafe-"),
    { code: "AUTOMATION_TEMP_PREFIX_INVALID" }
  );
  assert.deepEqual(await scope.cleanup(), []);
});

class FakeChild extends EventEmitter {
  exitCode = null;
  signalCode = null;
  signals = [];

  kill(signal = "SIGTERM") {
    this.signals.push(signal);
    if (signal === "SIGKILL") {
      queueMicrotask(() => {
        this.exitCode = 137;
        this.signalCode = "SIGKILL";
        this.emit("exit", this.exitCode, this.signalCode);
        this.emit("close", this.exitCode, this.signalCode);
      });
    }
    return true;
  }
}
