import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { WorkspaceCapabilityStore } from "../packages/workspace-capability/src/index.js";
import { ToolRegistry } from "../packages/tool-registry/src/index.js";

test("only Demo and an explicitly activated registered copy receive mutation capabilities", async (t) => {
  const fixture = await workspaceFixture(t);
  const store = fixture.store();
  await store.initialize();

  const demo = await store.register(fixture.demo);
  assert.equal(demo.kind, "built-in-demo");
  assert.equal(demo.canWrite, true);

  const original = await store.register(fixture.source);
  assert.equal(original.kind, "original-readonly");
  assert.equal(original.canWrite, false);
  await assert.rejects(() => store.assertCanMutate(fixture.source, "apply patches"), (error) => error.code === "WORKSPACE_ORIGINAL_READ_ONLY");

  const preview = await store.previewCopy(fixture.source);
  assert.equal(preview.eligible, true);
  assert.equal(preview.disclosure.anonymized, false);
  assert.equal(preview.disclosure.safeToShare, false);
  const copy = await store.createCopy(preview);
  assert.equal(copy.kind, "disposable-copy");
  assert.equal(copy.canWrite, false);
  await assert.rejects(() => store.assertCanMutate(copy.rootPath, "apply patches"), (error) => error.code === "WORKSPACE_ACTIVATION_REQUIRED");

  const active = await store.activate({ workspaceId: copy.id, workspaceDigest: copy.workspaceDigest });
  assert.equal(active.canWrite, true);
  assert.equal(active.canRunCommands, true);
  assert.equal((await store.assertCanMutate(active.rootPath, "apply patches")).id, active.id);

  const markerRead = new ToolRegistry({ rootPath: active.rootPath }).call("read_file", { path: ".codeclaw-disposable-copy.json" });
  await assert.rejects(markerRead, /sensitive file/i);
  assert.equal(await fs.readFile(path.join(fixture.source, "src", "value.txt"), "utf8"), "original\n");
});

test("copy capability survives restart and permits normal copy edits without trusting the source", async (t) => {
  const fixture = await workspaceFixture(t);
  const first = fixture.store();
  await first.initialize();
  const original = await first.register(fixture.source);
  const preview = await first.previewCopy(fixture.source);
  const copy = await first.createCopy(preview);
  const active = await first.activate({ workspaceId: copy.id, workspaceDigest: copy.workspaceDigest });
  await fs.writeFile(path.join(active.rootPath, "src", "value.txt"), "edited in copy\n", "utf8");
  await fs.writeFile(path.join(fixture.source, "src", "value.txt"), "source changed later\n", "utf8");

  const restarted = fixture.store();
  await restarted.initialize();
  const recovered = await restarted.assertCanMutate(active.rootPath, "run project commands");
  assert.equal(recovered.id, active.id);
  assert.equal(recovered.canRunCommands, true);

  const refreshedOriginal = await restarted.register(fixture.source);
  await restarted.activate({ workspaceId: refreshedOriginal.id, workspaceDigest: refreshedOriginal.workspaceDigest });
  const listed = await restarted.list();
  const cleanupCopy = listed.workspaces.find((item) => item.id === active.id);
  const cleanup = await restarted.cleanup({ workspaceId: cleanupCopy.id, workspaceDigest: cleanupCopy.workspaceDigest });
  assert.equal(cleanup.removed, true);
  await assert.rejects(() => fs.stat(active.rootPath), (error) => error.code === "ENOENT");
  assert.equal(await fs.readFile(path.join(fixture.source, "src", "value.txt"), "utf8"), "source changed later\n");
});

test("create rejects a changed source and forged preview approval", async (t) => {
  const fixture = await workspaceFixture(t);
  const store = fixture.store();
  await store.initialize();
  const preview = await store.previewCopy(fixture.source);

  await assert.rejects(
    () => store.createCopy({ previewId: preview.previewId, previewDigest: "0".repeat(64) }),
    (error) => error.code === "WORKSPACE_COPY_PREVIEW_STALE"
  );
  await fs.writeFile(path.join(fixture.source, "src", "value.txt"), "changed after preview\n", "utf8");
  await assert.rejects(() => store.createCopy(preview), (error) => error.code === "WORKSPACE_COPY_SOURCE_CHANGED");
  assert.deepEqual((await fs.readdir(fixture.copyRoot)).filter((item) => item.startsWith("copy-")), []);
});

test("marker tampering and same-path replacement revoke activation and cleanup", async (t) => {
  const fixture = await workspaceFixture(t);
  const store = fixture.store();
  await store.initialize();
  const original = await store.register(fixture.source);
  const copy = await store.createCopy(await store.previewCopy(fixture.source));
  await fs.writeFile(path.join(copy.rootPath, ".codeclaw-disposable-copy.json"), "{}\n", "utf8");
  await assert.rejects(
    () => store.activate({ workspaceId: copy.id, workspaceDigest: copy.workspaceDigest }),
    (error) => error.code === "WORKSPACE_COPY_MARKER_INVALID"
  );
  await assert.rejects(
    () => store.cleanup({ workspaceId: copy.id, workspaceDigest: copy.workspaceDigest }),
    (error) => error.code === "WORKSPACE_COPY_MARKER_INVALID"
  );

  const cleanCopy = await store.createCopy(await store.previewCopy(fixture.source));
  const moved = `${cleanCopy.rootPath}-moved`;
  await fs.rename(cleanCopy.rootPath, moved);
  await fs.mkdir(cleanCopy.rootPath);
  await store.activate({ workspaceId: original.id, workspaceDigest: original.workspaceDigest });
  await assert.rejects(
    () => store.cleanup({ workspaceId: cleanCopy.id, workspaceDigest: cleanCopy.workspaceDigest }),
    (error) => error.code === "WORKSPACE_COPY_IDENTITY_CHANGED"
  );
  assert.equal((await fs.stat(moved)).isDirectory(), true);
});

test("signed registry Manifest tampering fails closed after restart", async (t) => {
  const fixture = await workspaceFixture(t);
  const first = fixture.store();
  await first.initialize();
  await first.createCopy(await first.previewCopy(fixture.source));
  const state = JSON.parse(await fs.readFile(fixture.statePath, "utf8"));
  state.copies[0].sourceManifest.files[0].sha256 = "0".repeat(64);
  await fs.writeFile(fixture.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const restarted = fixture.store();
  await assert.rejects(() => restarted.initialize(), (error) => error.code === "WORKSPACE_STATE_INTEGRITY_FAILED");
});

test("a re-signed but structurally conflicting registry still fails closed", async (t) => {
  const fixture = await workspaceFixture(t);
  const first = fixture.store();
  await first.initialize();
  await first.createCopy(await first.previewCopy(fixture.source));
  const owner = JSON.parse(await fs.readFile(path.join(fixture.state, "workspace-owner.json"), "utf8"));
  const document = JSON.parse(await fs.readFile(fixture.statePath, "utf8"));
  const { integrity: _integrity, ...state } = document;
  state.copies.push({ ...state.copies[0] });
  const integrity = createHmac("sha256", Buffer.from(owner.secret, "base64url"))
    .update(JSON.stringify(sortJsonForTest(state)), "utf8")
    .digest("hex");
  await fs.writeFile(fixture.statePath, `${JSON.stringify({ ...state, integrity }, null, 2)}\n`, "utf8");

  const restarted = fixture.store();
  await assert.rejects(() => restarted.initialize(), (error) => error.code === "WORKSPACE_STATE_INTEGRITY_FAILED");
});

test("linked capability state files are never trusted as authority", async (t) => {
  const fixture = await workspaceFixture(t);
  const first = fixture.store();
  await first.initialize();
  const linked = `${fixture.statePath}.linked`;
  try {
    await fs.link(fixture.statePath, linked);
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS", "EXDEV"].includes(error.code)) return t.skip("Hard links are unavailable in this environment.");
    throw error;
  }
  const restarted = fixture.store();
  await assert.rejects(() => restarted.initialize(), (error) => error.code === "WORKSPACE_STATE_INTEGRITY_FAILED");
});

test("durable create phases recover only signed owned staging and finish verified renames", async (t) => {
  for (const phase of ["reserved", "creating", "ready-to-rename", "renamed", "complete"]) {
    await t.test(phase, async (t) => {
      const fixture = await workspaceFixture(t);
      await runLifecycleChild({
        mode: "create",
        phase,
        fixture,
        value: fixture.source
      });

      const interrupted = JSON.parse(await fs.readFile(fixture.statePath, "utf8"));
      assert.equal(interrupted.operations.length, 1);
      assert.equal(interrupted.operations[0].phase, phase);

      const restarted = fixture.store();
      await restarted.initialize();
      const listed = await restarted.list();
      const copies = listed.workspaces.filter((item) => item.kind === "disposable-copy");
      const shouldComplete = ["ready-to-rename", "renamed", "complete"].includes(phase);
      assert.equal(copies.length, shouldComplete ? 1 : 0);
      if (shouldComplete) {
        assert.equal(await fs.readFile(path.join(copies[0].rootPath, "src", "value.txt"), "utf8"), "original\n");
      }
      const recoveredState = JSON.parse(await fs.readFile(fixture.statePath, "utf8"));
      assert.deepEqual(recoveredState.operations, []);
      assert.equal((await fs.readdir(fixture.copyRoot)).some((name) => /^\.copy-.*\.(creating|discard|cleanup)-/.test(name)), false);
    });
  }
});

test("copy creation rejects excluded target injections at every registration boundary", async (t) => {
  await t.test("pre-marker verification rejects a replacement containing .git without deleting it", async (t) => {
    const fixture = await workspaceFixture(t);
    const store = fixture.store();
    await store.initialize();
    const verifyExactCopyTarget = store.verifyExactCopyTarget.bind(store);
    const recordedStaging = path.join(fixture.base, "recorded-staging");
    let replacementStaging = "";

    store.verifyExactCopyTarget = async (sourceManifest, rootPath, options = {}) => {
      if (!replacementStaging && !options.requireDisposableMarker) {
        replacementStaging = rootPath;
        await fs.rename(rootPath, recordedStaging);
        await fs.cp(recordedStaging, rootPath, { recursive: true, errorOnExist: true, force: false });
        await fs.mkdir(path.join(rootPath, ".git"));
        await fs.writeFile(path.join(rootPath, ".git", "injected.txt"), "must survive\n", "utf8");
      }
      return verifyExactCopyTarget(sourceManifest, rootPath, options);
    };

    await assert.rejects(
      async () => store.createCopy(await store.previewCopy(fixture.source)),
      (error) => error.code === "WORKSPACE_RECOVERY_REQUIRED"
    );
    assert.equal(await fs.readFile(path.join(replacementStaging, ".git", "injected.txt"), "utf8"), "must survive\n");
    assert.equal(await fs.readFile(path.join(recordedStaging, "src", "value.txt"), "utf8"), "original\n");
    const state = JSON.parse(await fs.readFile(fixture.statePath, "utf8"));
    assert.equal(state.copies.length, 0);
    assert.equal(state.operations[0].phase, "creating");
  });

  await t.test("post-marker verification rejects node_modules and leaves the blocked staging tree intact", async (t) => {
    const fixture = await workspaceFixture(t);
    const store = fixture.store();
    await store.initialize();
    const verifyOperationPayload = store.verifyOperationPayload.bind(store);
    let injectedPath = "";

    store.verifyOperationPayload = async (operation, rootPath) => {
      if (!injectedPath && path.basename(rootPath) === operation.stagingName) {
        injectedPath = path.join(rootPath, "node_modules", "injected.txt");
        await fs.mkdir(path.dirname(injectedPath));
        await fs.writeFile(injectedPath, "must survive\n", "utf8");
      }
      return verifyOperationPayload(operation, rootPath);
    };

    await assert.rejects(
      async () => store.createCopy(await store.previewCopy(fixture.source)),
      (error) => error.code === "WORKSPACE_RECOVERY_REQUIRED"
    );
    assert.equal(await fs.readFile(injectedPath, "utf8"), "must survive\n");
    const state = JSON.parse(await fs.readFile(fixture.statePath, "utf8"));
    assert.equal(state.copies.length, 0);
    assert.equal(state.operations[0].phase, "ready-to-rename");
  });

  await t.test("post-rename verification rejects a gitignored extra and leaves the final tree unregistered", async (t) => {
    const fixture = await workspaceFixture(t);
    await fs.writeFile(path.join(fixture.source, ".gitignore"), "ignored-extra/\n", "utf8");
    const store = fixture.store();
    await store.initialize();
    const verifyOperationPayload = store.verifyOperationPayload.bind(store);
    let injectedPath = "";

    store.verifyOperationPayload = async (operation, rootPath) => {
      if (!injectedPath && path.basename(rootPath) === operation.directoryName) {
        injectedPath = path.join(rootPath, "ignored-extra", "injected.txt");
        await fs.mkdir(path.dirname(injectedPath));
        await fs.writeFile(injectedPath, "must survive\n", "utf8");
      }
      return verifyOperationPayload(operation, rootPath);
    };

    await assert.rejects(
      async () => store.createCopy(await store.previewCopy(fixture.source)),
      (error) => error.code === "WORKSPACE_RECOVERY_REQUIRED"
    );
    assert.equal(await fs.readFile(injectedPath, "utf8"), "must survive\n");
    const state = JSON.parse(await fs.readFile(fixture.statePath, "utf8"));
    assert.equal(state.copies.length, 0);
    assert.equal(state.operations[0].phase, "renamed");
  });
});

test("sealed copies reject excluded additions before first activation", async (t) => {
  const fixture = await workspaceFixture(t);
  const store = fixture.store();
  await store.initialize();
  const copy = await store.createCopy(await store.previewCopy(fixture.source));
  const injectedPath = path.join(copy.rootPath, ".git", "injected.txt");
  await fs.mkdir(path.dirname(injectedPath));
  await fs.writeFile(injectedPath, "must survive\n", "utf8");

  await assert.rejects(
    () => store.activate({ workspaceId: copy.id, workspaceDigest: copy.workspaceDigest }),
    (error) => error.code === "WORKSPACE_COPY_MANIFEST_CHANGED"
  );
  assert.equal(await fs.readFile(injectedPath, "utf8"), "must survive\n");
  const state = JSON.parse(await fs.readFile(fixture.statePath, "utf8"));
  assert.equal(state.copies[0].baselineState, "sealed");
  assert.equal(state.activeWorkspaceId, null);
});

test("create recovery fails closed when a recorded staging entity is replaced", async (t) => {
  const fixture = await workspaceFixture(t);
  await runLifecycleChild({ mode: "create", phase: "creating", fixture, value: fixture.source });
  const interrupted = JSON.parse(await fs.readFile(fixture.statePath, "utf8"));
  const operation = interrupted.operations[0];
  const stagingPath = path.join(fixture.copyRoot, operation.stagingName);
  const movedPath = `${stagingPath}-recorded-entity`;
  await fs.rename(stagingPath, movedPath);
  await fs.mkdir(stagingPath);

  const restarted = fixture.store();
  await assert.rejects(() => restarted.initialize(), (error) => error.code === "WORKSPACE_RECOVERY_REQUIRED");
  assert.equal((await fs.stat(stagingPath)).isDirectory(), true);
  assert.equal((await fs.stat(movedPath)).isDirectory(), true);
});

test("staging discard never touches a same-path replacement after quarantine", async (t) => {
  const fixture = await workspaceFixture(t);
  await runLifecycleChild({ mode: "create", phase: "creating", fixture, value: fixture.source });
  await runLifecycleChild({ mode: "recover", phase: "discard-quarantined", fixture, value: fixture.source });
  const interrupted = JSON.parse(await fs.readFile(fixture.statePath, "utf8"));
  const operation = interrupted.operations[0];
  const stagingPath = path.join(fixture.copyRoot, operation.stagingName);
  const discardPath = path.join(fixture.copyRoot, operation.discardName);
  await assert.rejects(() => fs.stat(stagingPath), (error) => error.code === "ENOENT");
  assert.equal((await fs.stat(discardPath)).isDirectory(), true);
  await fs.mkdir(stagingPath);
  const sentinel = path.join(stagingPath, "unrelated.txt");
  await fs.writeFile(sentinel, "must survive\n", "utf8");

  const restarted = fixture.store();
  await assert.rejects(() => restarted.initialize(), (error) => error.code === "WORKSPACE_RECOVERY_REQUIRED");
  assert.equal(await fs.readFile(sentinel, "utf8"), "must survive\n");
  await assert.rejects(() => fs.stat(discardPath), (error) => error.code === "ENOENT");
});

test("cleanup-pending deletion resumes after process interruption", async (t) => {
  const fixture = await workspaceFixture(t);
  const first = fixture.store();
  await first.initialize();
  const copy = await first.createCopy(await first.previewCopy(fixture.source));
  await runLifecycleChild({ mode: "cleanup", phase: "reserved", fixture, value: copy.id });
  assert.equal((await fs.stat(copy.rootPath)).isDirectory(), true);

  const restarted = fixture.store();
  await restarted.initialize();
  await assert.rejects(() => fs.stat(copy.rootPath), (error) => error.code === "ENOENT");
  assert.equal((await restarted.list()).workspaces.some((item) => item.id === copy.id), false);
});

test("cleanup resumes from a durable quarantine after rename interruption", async (t) => {
  const fixture = await workspaceFixture(t);
  const first = fixture.store();
  await first.initialize();
  const copy = await first.createCopy(await first.previewCopy(fixture.source));
  await runLifecycleChild({ mode: "cleanup", phase: "quarantined", fixture, value: copy.id });
  const interrupted = JSON.parse(await fs.readFile(fixture.statePath, "utf8"));
  const cleanup = interrupted.copies.find((item) => item.id === copy.id).cleanup;
  const quarantinePath = path.join(fixture.copyRoot, cleanup.quarantineName);
  await assert.rejects(() => fs.stat(copy.rootPath), (error) => error.code === "ENOENT");
  assert.equal((await fs.stat(quarantinePath)).isDirectory(), true);

  const restarted = fixture.store();
  await restarted.initialize();
  await assert.rejects(() => fs.stat(quarantinePath), (error) => error.code === "ENOENT");
  assert.equal((await restarted.list()).workspaces.some((item) => item.id === copy.id), false);
});

test("cleanup never touches a same-path replacement created after quarantine", async (t) => {
  const fixture = await workspaceFixture(t);
  const first = fixture.store();
  await first.initialize();
  const copy = await first.createCopy(await first.previewCopy(fixture.source));
  await runLifecycleChild({ mode: "cleanup", phase: "quarantined", fixture, value: copy.id });
  const interrupted = JSON.parse(await fs.readFile(fixture.statePath, "utf8"));
  const cleanup = interrupted.copies.find((item) => item.id === copy.id).cleanup;
  const quarantinePath = path.join(fixture.copyRoot, cleanup.quarantineName);
  await fs.mkdir(copy.rootPath);
  const sentinel = path.join(copy.rootPath, "unrelated.txt");
  await fs.writeFile(sentinel, "must survive\n", "utf8");

  const restarted = fixture.store();
  await assert.rejects(() => restarted.initialize(), (error) => error.code === "WORKSPACE_RECOVERY_REQUIRED");
  assert.equal(await fs.readFile(sentinel, "utf8"), "must survive\n");
  await assert.rejects(() => fs.stat(quarantinePath), (error) => error.code === "ENOENT");
});

test("runtime cleanup does not report success when the original path is replaced after quarantine", async (t) => {
  const fixture = await workspaceFixture(t);
  const store = fixture.store();
  await store.initialize();
  const copy = await store.createCopy(await store.previewCopy(fixture.source));
  const writeState = store.writeState.bind(store);
  const sentinel = path.join(copy.rootPath, "unrelated.txt");
  let replacementCreated = false;
  store.writeState = async (state) => {
    await writeState(state);
    const quarantined = state.copies.find((item) => item.id === copy.id)?.cleanup?.phase === "quarantined";
    if (quarantined && !replacementCreated) {
      replacementCreated = true;
      await fs.mkdir(copy.rootPath);
      await fs.writeFile(sentinel, "must survive\n", "utf8");
    }
  };

  await assert.rejects(
    () => store.cleanup({ workspaceId: copy.id, workspaceDigest: copy.workspaceDigest }),
    (error) => error.code === "WORKSPACE_RECOVERY_REQUIRED"
  );
  assert.equal(await fs.readFile(sentinel, "utf8"), "must survive\n");
});

test("cleanup recovery leaves a replaced target untouched and requires review", async (t) => {
  const fixture = await workspaceFixture(t);
  const first = fixture.store();
  await first.initialize();
  const copy = await first.createCopy(await first.previewCopy(fixture.source));
  await runLifecycleChild({ mode: "cleanup", phase: "reserved", fixture, value: copy.id });
  const movedPath = `${copy.rootPath}-recorded-entity`;
  await fs.rename(copy.rootPath, movedPath);
  await fs.mkdir(copy.rootPath);

  const restarted = fixture.store();
  await assert.rejects(() => restarted.initialize(), (error) => error.code === "WORKSPACE_RECOVERY_REQUIRED");
  assert.equal((await fs.stat(copy.rootPath)).isDirectory(), true);
  assert.equal((await fs.stat(movedPath)).isDirectory(), true);
});

test("copy preview rejects either-direction overlap with private capability state", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-private-overlap-"));
  const demo = path.join(base, "demo");
  const copyRoot = path.join(base, "copies");
  await fs.mkdir(demo);
  await fs.writeFile(path.join(demo, "demo.txt"), "demo\n", "utf8");
  t.after(() => fs.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

  const sourceContainingState = path.join(base, "source-containing-state");
  const nestedState = path.join(sourceContainingState, "private-state");
  await fs.mkdir(path.join(sourceContainingState, "src"), { recursive: true });
  await fs.writeFile(path.join(sourceContainingState, "src", "value.txt"), "source\n", "utf8");
  const nestedStore = new WorkspaceCapabilityStore({
    storagePath: path.join(nestedState, "workspace-capabilities.json"),
    copyRootPath: copyRoot,
    demoPath: demo
  });
  await nestedStore.initialize();
  await assert.rejects(
    () => nestedStore.previewCopy(sourceContainingState),
    (error) => error.code === "WORKSPACE_COPY_PRIVATE_STATE_OVERLAP"
  );

  const stateContainingSource = path.join(base, "state-containing-source");
  const nestedSource = path.join(stateContainingSource, "source");
  await fs.mkdir(nestedSource, { recursive: true });
  await fs.writeFile(path.join(nestedSource, "value.txt"), "source\n", "utf8");
  const outerStore = new WorkspaceCapabilityStore({
    storagePath: path.join(stateContainingSource, "workspace-capabilities.json"),
    copyRootPath: path.join(base, "other-copies"),
    demoPath: demo
  });
  await outerStore.initialize();
  await assert.rejects(
    () => outerStore.previewCopy(nestedSource),
    (error) => error.code === "WORKSPACE_COPY_PRIVATE_STATE_OVERLAP"
  );

  const dotdotSource = path.join(base, "dotdot-prefix-source");
  const dotdotCopyRoot = path.join(dotdotSource, "..managed-copies");
  await fs.mkdir(dotdotSource);
  await fs.writeFile(path.join(dotdotSource, "value.txt"), "source\n", "utf8");
  const dotdotCopyStore = new WorkspaceCapabilityStore({
    storagePath: path.join(base, "dotdot-copy-state", "workspace-capabilities.json"),
    copyRootPath: dotdotCopyRoot,
    demoPath: demo
  });
  await dotdotCopyStore.initialize();
  await assert.rejects(
    () => dotdotCopyStore.previewCopy(dotdotSource),
    (error) => error.code === "WORKSPACE_COPY_SOURCE_UNSAFE"
  );
  await assert.rejects(() => fs.stat(dotdotCopyRoot), (error) => error.code === "ENOENT");

  const dotdotStateSource = path.join(base, "dotdot-prefix-state-source");
  const dotdotState = path.join(dotdotStateSource, "..private-state");
  await fs.mkdir(dotdotStateSource);
  await fs.writeFile(path.join(dotdotStateSource, "value.txt"), "source\n", "utf8");
  const dotdotStateStore = new WorkspaceCapabilityStore({
    storagePath: path.join(dotdotState, "workspace-capabilities.json"),
    copyRootPath: path.join(base, "dotdot-state-copies"),
    demoPath: demo
  });
  await dotdotStateStore.initialize();
  await assert.rejects(
    () => dotdotStateStore.previewCopy(dotdotStateSource),
    (error) => error.code === "WORKSPACE_COPY_PRIVATE_STATE_OVERLAP"
  );
});

test("one canonical copy root can be atomically claimed by only one state", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-root-claim-"));
  const source = path.join(base, "source");
  const demo = path.join(base, "demo");
  const copyRoot = path.join(base, "copies");
  const states = [path.join(base, "state-a"), path.join(base, "state-b")];
  await fs.mkdir(source);
  await fs.mkdir(demo);
  await fs.writeFile(path.join(source, "value.txt"), "source\n", "utf8");
  await fs.writeFile(path.join(demo, "demo.txt"), "demo\n", "utf8");
  t.after(() => fs.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

  const stores = states.map((state) => new WorkspaceCapabilityStore({
    storagePath: path.join(state, "workspace-capabilities.json"),
    copyRootPath: copyRoot,
    demoPath: demo
  }));
  await Promise.all(stores.map((store) => store.initialize()));
  const previews = await Promise.all(stores.map((store) => store.previewCopy(source)));
  const results = await Promise.allSettled(stores.map((store, index) => store.createCopy(previews[index])));
  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  const winnerIndex = results.findIndex((result) => result.status === "fulfilled");
  const loserIndex = winnerIndex === 0 ? 1 : 0;
  assert.equal(results[loserIndex].reason.code, "WORKSPACE_COPY_ROOT_OWNED_ELSEWHERE");

  const winnerRestart = new WorkspaceCapabilityStore({
    storagePath: path.join(states[winnerIndex], "workspace-capabilities.json"),
    copyRootPath: copyRoot,
    demoPath: demo
  });
  await winnerRestart.initialize();
  assert.equal((await winnerRestart.list()).workspaces.filter((item) => item.kind === "disposable-copy").length, 1);

  const loserRestart = new WorkspaceCapabilityStore({
    storagePath: path.join(states[loserIndex], "workspace-capabilities.json"),
    copyRootPath: copyRoot,
    demoPath: demo
  });
  await assert.rejects(
    () => loserRestart.initialize(),
    (error) => error.code === "WORKSPACE_COPY_ROOT_OWNED_ELSEWHERE"
  );

  const unownedState = path.join(base, "state-without-authority");
  const takeover = new WorkspaceCapabilityStore({
    storagePath: path.join(unownedState, "workspace-capabilities.json"),
    copyRootPath: copyRoot,
    demoPath: demo
  });
  await assert.rejects(
    () => takeover.initialize(),
    (error) => error.code === "WORKSPACE_OWNERSHIP_STATE_MISSING"
  );

  await fs.rm(path.join(states[winnerIndex], "workspace-capabilities.json"));
  const missingState = new WorkspaceCapabilityStore({
    storagePath: path.join(states[winnerIndex], "workspace-capabilities.json"),
    copyRootPath: copyRoot,
    demoPath: demo
  });
  await assert.rejects(
    () => missingState.initialize(),
    (error) => error.code === "WORKSPACE_STATE_MISSING"
  );
});

test("create refuses an unknown entry added to the managed root at runtime", async (t) => {
  const fixture = await workspaceFixture(t);
  const store = fixture.store();
  await store.initialize();
  await store.createCopy(await store.previewCopy(fixture.source));
  const unknown = path.join(fixture.copyRoot, "unregistered-directory");
  await fs.mkdir(unknown);
  const preview = await store.previewCopy(fixture.source);

  await assert.rejects(
    () => store.createCopy(preview),
    (error) => error.code === "WORKSPACE_RECOVERY_REQUIRED"
  );
  assert.equal((await fs.stat(unknown)).isDirectory(), true);
});

test("a pre-existing copy-root symlink or junction is rejected before realpath", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-root-link-"));
  t.after(() => fs.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const source = path.join(base, "source");
  const demo = path.join(base, "demo");
  const realRoot = path.join(base, "real-copies");
  const linkedRoot = path.join(base, "linked-copies");
  const state = path.join(base, "state");
  await fs.mkdir(source);
  await fs.mkdir(demo);
  await fs.mkdir(realRoot);
  await fs.writeFile(path.join(source, "value.txt"), "source\n", "utf8");
  await fs.writeFile(path.join(demo, "demo.txt"), "demo\n", "utf8");
  try {
    await fs.symlink(realRoot, linkedRoot, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) return t.skip("Directory links are unavailable in this environment.");
    throw error;
  }
  const store = new WorkspaceCapabilityStore({
    storagePath: path.join(state, "workspace-capabilities.json"),
    copyRootPath: linkedRoot,
    demoPath: demo
  });
  await assert.rejects(
    () => store.initialize(),
    (error) => error.code === "WORKSPACE_COPY_ROOT_UNSAFE"
  );
  assert.deepEqual(await fs.readdir(realRoot), []);
});

test("a missing copy root below a linked ancestor is rejected before mkdir or ownership claim", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-root-parent-link-"));
  const source = path.join(base, "source");
  const demo = path.join(base, "demo");
  const linkedParent = path.join(base, "linked-parent");
  const copyRoot = path.join(linkedParent, "nested", "copies");
  await fs.mkdir(source);
  await fs.mkdir(demo);
  await fs.writeFile(path.join(source, "value.txt"), "source\n", "utf8");
  await fs.writeFile(path.join(demo, "demo.txt"), "demo\n", "utf8");
  try {
    await fs.symlink(source, linkedParent, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    await fs.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) return t.skip("Directory links are unavailable in this environment.");
    throw error;
  }
  t.after(async () => {
    await unlinkDirectoryLink(linkedParent);
    await fs.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const store = new WorkspaceCapabilityStore({
    storagePath: path.join(base, "state", "workspace-capabilities.json"),
    copyRootPath: copyRoot,
    demoPath: demo
  });
  await assert.rejects(
    () => store.initialize(),
    (error) => error.code === "WORKSPACE_COPY_ROOT_UNSAFE"
  );
  await assert.rejects(() => fs.stat(path.join(source, "nested")), (error) => error.code === "ENOENT");
  await assert.rejects(() => fs.stat(path.join(source, "nested", "copies", ".codeclaw-copy-root-owner.json")), (error) => error.code === "ENOENT");
});

test("a linked Demo root never grants mutation authority to its target", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-demo-link-"));
  t.after(() => fs.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const original = path.join(base, "real-original");
  const linkedDemo = path.join(base, "linked-demo");
  await fs.mkdir(original);
  await fs.writeFile(path.join(original, "value.txt"), "original\n", "utf8");
  try {
    await fs.symlink(original, linkedDemo, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) return t.skip("Directory links are unavailable in this environment.");
    throw error;
  }

  const store = new WorkspaceCapabilityStore({
    storagePath: path.join(base, "state", "workspace-capabilities.json"),
    copyRootPath: path.join(base, "copies"),
    demoPath: linkedDemo
  });
  await store.initialize();
  assert.equal((await store.list()).workspaces.some((item) => item.kind === "built-in-demo"), false);
  const registered = await store.register(original);
  assert.equal(registered.kind, "original-readonly");
  await assert.rejects(
    () => store.assertCanMutate(original, "write files"),
    (error) => error.code === "WORKSPACE_ORIGINAL_READ_ONLY"
  );
});

async function runLifecycleChild({ mode, phase, fixture, value }) {
  const childPath = path.resolve("tests", "helpers", "workspace-lifecycle-child.js");
  const args = [childPath, mode, phase, fixture.statePath, fixture.copyRoot, fixture.demo, value];
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert.equal(code, 86, output || `Lifecycle child exited with ${code}.`);
}

async function unlinkDirectoryLink(linkPath) {
  try {
    await fs.unlink(linkPath);
  } catch (error) {
    if (error.code === "ENOENT") return;
    if (process.platform === "win32" && ["EPERM", "EACCES", "EISDIR"].includes(error.code)) {
      await fs.rmdir(linkPath);
      return;
    }
    throw error;
  }
}

function sortJsonForTest(value) {
  if (Array.isArray(value)) return value.map(sortJsonForTest);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJsonForTest(value[key])]));
}

async function workspaceFixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-workspaces-"));
  const source = path.join(base, "source");
  const demo = path.join(base, "demo");
  const state = path.join(base, "state");
  const copyRoot = path.join(base, "copies");
  const statePath = path.join(state, "workspace-capabilities.json");
  await fs.mkdir(path.join(source, "src"), { recursive: true });
  await fs.mkdir(demo);
  await fs.writeFile(path.join(source, "src", "value.txt"), "original\n", "utf8");
  await fs.writeFile(path.join(source, "package.json"), '{"scripts":{"test":"node --test"}}\n', "utf8");
  await fs.writeFile(path.join(demo, "demo.txt"), "demo\n", "utf8");
  t.after(() => fs.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return {
    base,
    source,
    demo,
    state,
    copyRoot,
    statePath,
    store: () => new WorkspaceCapabilityStore({ storagePath: statePath, copyRootPath: copyRoot, demoPath: demo })
  };
}
