import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile, syncDirectory } from "../../shared/src/atomic-file.js";
import { CrossProcessLockManager, canonicalPathLockKey } from "../../shared/src/cross-process-lock.js";
import { captureWorkspaceIdentity } from "../../shared/src/workspace-identity.js";
import {
  buildDataBoundaryManifest,
  copyManifestPayload,
  DATA_BOUNDARY_POLICY_VERSION,
  DISPOSABLE_COPY_MARKER,
  isExactCopyTargetManifest,
  manifestsHaveSameSource
} from "../../data-boundary/src/index.js";

const SCHEMA_VERSION = 1;
const PREVIEW_TTL_MS = 15 * 60 * 1000;
const COPY_ROOT_OWNER_CLAIM = ".codeclaw-copy-root-owner.json";

export class WorkspaceCapabilityStore {
  constructor({ storagePath, copyRootPath, demoPath = "", previewTtlMs = PREVIEW_TTL_MS, lockManager = null } = {}) {
    if (!storagePath) throw new Error("Missing workspace capability storage path.");
    this.storagePath = path.resolve(storagePath);
    this.ownerPath = path.join(path.dirname(this.storagePath), "workspace-owner.json");
    this.privateStateDir = path.dirname(this.storagePath);
    this.copyRootPath = path.resolve(copyRootPath || path.join(path.dirname(this.storagePath), "disposable-copies"));
    this.demoPath = demoPath ? path.resolve(demoPath) : "";
    this.previewTtlMs = previewTtlMs;
    this.lockManager = lockManager || new CrossProcessLockManager({
      storagePath: path.join(path.dirname(this.storagePath), ".workspace-locks"),
      namespace: "workspace-capabilities",
      lockedCode: "WORKSPACE_STATE_LOCKED",
      lockedMessage: "Another CodeClaw process is updating workspace capabilities. Wait for it to finish, then retry."
    });
    this.owner = null;
    this.copyRootIdentity = "";
    this.demoIdentity = null;
    this.previews = new Map();
    this.initialized = false;
    this.mutationQueue = Promise.resolve();
  }

  async initialize() {
    if (this.initialized) return;
    await this.serializeMutation(async () => {
      if (this.initialized) return;
      await fs.mkdir(path.dirname(this.storagePath), { recursive: true, mode: 0o700 });
      this.privateStateDir = await fs.realpath(path.dirname(this.storagePath));
      this.owner = await this.loadOrCreateOwner();
      if (canonicalPath(this.owner.copyRootPath) !== canonicalPath(this.copyRootPath)) {
        throw workspaceError("WORKSPACE_COPY_ROOT_CHANGED", "The configured disposable-copy root does not match the private ownership record.");
      }
      if (this.owner.copyRootIdentity) {
        await this.assertRequestedCopyRootDirectory();
        const copyRoot = await captureWorkspaceIdentity(this.copyRootPath).catch(() => null);
        if (!copyRoot
          || canonicalPath(copyRoot.rootPath) !== canonicalPath(this.owner.copyRootPath)
          || copyRoot.digest !== this.owner.copyRootIdentity) {
          throw workspaceError("WORKSPACE_COPY_ROOT_CHANGED", "The private disposable-copy root no longer matches the directory CodeClaw registered. Cleanup and writes are disabled.");
        }
        this.copyRootPath = copyRoot.rootPath;
        this.copyRootIdentity = copyRoot.digest;
        await this.assertCopyRootClaim(copyRoot);
      } else if (await this.assertRequestedCopyRootDirectory({ allowMissing: true })) {
        const claim = await this.readCopyRootClaim({ allowMissing: true });
        if (claim) {
          const copyRoot = await captureWorkspaceIdentity(this.copyRootPath);
          await this.assertCopyRootClaim(copyRoot, claim);
          await this.persistOwnerRoot(copyRoot);
        }
      }
      this.demoIdentity = this.demoPath ? await captureTrustedDirectoryIdentity(this.demoPath) : null;
      let state = await this.readState({ allowMissing: true });
      if (!state) {
        const entries = await fs.readdir(this.copyRootPath).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
        if (entries.length) {
          throw workspaceError("WORKSPACE_STATE_MISSING", "Disposable-copy directories exist but their signed registry is missing. CodeClaw will not claim or delete them.");
        }
        state = emptyState(this.owner.ownerId);
        await this.writeState(state);
      }
      if ((state.copies.length || state.operations.length) && !this.copyRootIdentity) {
        throw workspaceError("WORKSPACE_COPY_ROOT_CHANGED", "Disposable-copy records exist without a registered private copy-root identity.");
      }
      const reconciled = await this.reconcileState(state);
      if (reconciled.changed) await this.writeState(reconciled.state);
      if (reconciled.blocked) {
        throw workspaceError("WORKSPACE_RECOVERY_REQUIRED", "An interrupted disposable-copy operation could not be safely reconciled. CodeClaw left it untouched and stopped before serving requests.");
      }
      this.initialized = true;
    });
  }

  async previewCopy(sourcePath) {
    await this.initialize();
    this.pruneExpiredPreviews();
    const requestedSource = path.resolve(sourcePath || ".");
    await this.assertSafeCopySource(requestedSource);
    const manifest = await buildDataBoundaryManifest(sourcePath);
    const source = { rootPath: manifest.rootPath };
    await this.assertSafeCopySource(source.rootPath);
    const previewId = `preview-${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + this.previewTtlMs).toISOString();
    const preview = { previewId, createdAt, expiresAt, sourcePath: source.rootPath, manifest };
    preview.previewDigest = this.sign({
      previewId,
      sourcePath: source.rootPath,
      rootIdentity: manifest.rootIdentity,
      manifestDigest: manifest.manifestDigest,
      expiresAt
    });
    this.previews.set(previewId, preview);
    return this.publicPreview(preview);
  }

  async createCopy({ previewId, previewDigest } = {}) {
    await this.initialize();
    return this.serializeMutation(async () => {
      this.pruneExpiredPreviews();
      const preview = this.previews.get(String(previewId || ""));
      if (!preview || preview.previewDigest !== previewDigest) {
        throw workspaceError("WORKSPACE_COPY_PREVIEW_STALE", "The copy preview is missing, expired, or changed. Run Preview again before creating a copy.");
      }
      if (!preview.manifest.eligible) {
        throw workspaceError("WORKSPACE_COPY_BLOCKED", "The source contains blocked data-boundary entries. Resolve them and run Preview again.");
      }
      await this.assertSafeCopySource(preview.sourcePath);
      await this.ensureCopyRootInitialized(preview.sourcePath);
      const currentSource = await buildDataBoundaryManifest(preview.sourcePath);
      await this.assertSafeCopySource(currentSource.rootPath);
      if (!currentSource.eligible || !manifestsHaveSameSource(preview.manifest, currentSource)) {
        throw workspaceError("WORKSPACE_COPY_SOURCE_CHANGED", "The source changed after Preview. No copy was created; run Preview again.");
      }

      const nonce = randomUUID();
      const id = `disposable-${randomUUID()}`;
      const directoryName = `copy-${id.slice("disposable-".length)}`;
      const stagingName = `.${directoryName}.creating-${randomUUID()}`;
      const stagingPath = path.join(this.copyRootPath, stagingName);
      const targetPath = path.join(this.copyRootPath, directoryName);
      const now = new Date().toISOString();
      let state = await this.readState();
      try {
        await this.assertCopyRootInventory(state);
      } catch {
        throw workspaceError("WORKSPACE_RECOVERY_REQUIRED", "The disposable-copy root contains an entry outside the signed ownership inventory. Creation remains disabled until it is reviewed.");
      }
      const operation = {
        operationId: `create-${randomUUID()}`,
        kind: "create-copy",
        phase: "reserved",
        workspaceId: id,
        directoryName,
        stagingName,
        sourceRootPath: preview.sourcePath,
        sourceManifest: preview.manifest,
        markerNonce: nonce,
        stagingRootIdentity: null,
        stagingEntity: null,
        targetRootIdentity: null,
        targetPayloadDigest: null,
        targetIdentityDigest: null,
        markerCreatedAt: null,
        discardName: null,
        discardRootIdentity: null,
        discardCreatedAt: null,
        createdAt: now,
        updatedAt: now
      };
      state.operations.push(operation);
      // The signed reservation must exist before the first directory is created.
      await this.writeState(state);

      try {
        await fs.mkdir(stagingPath, { recursive: false, mode: 0o700 });
        operation.stagingRootIdentity = (await captureWorkspaceIdentity(stagingPath)).digest;
        operation.stagingEntity = await captureDirectoryEntity(stagingPath);
        advanceCreateOperation(operation, "creating");
        await this.writeState(state);

        await copyManifestPayload(preview.sourcePath, stagingPath, preview.manifest);
        const targetManifest = await this.verifyExactCopyTarget(preview.manifest, stagingPath, {
          code: "WORKSPACE_COPY_VERIFY_FAILED",
          message: "The disposable copy did not exactly match its source Manifest. The incomplete copy will not be registered.",
          status: 500
        });
        const finalSource = await buildDataBoundaryManifest(preview.sourcePath);
        await this.assertSafeCopySource(finalSource.rootPath);
        if (!finalSource.eligible || !manifestsHaveSameSource(preview.manifest, finalSource)) {
          throw workspaceError("WORKSPACE_COPY_SOURCE_CHANGED", "The source changed while CodeClaw was copying it. The incomplete copy was discarded.");
        }

        operation.targetPayloadDigest = targetManifest.payloadDigest;
        operation.targetIdentityDigest = targetManifest.entryIdentityDigest;
        operation.markerCreatedAt = new Date().toISOString();
        const markerPayload = markerPayloadForOperation(operation, this.owner.ownerId);
        const marker = { ...markerPayload, integrity: this.sign(markerPayload) };
        await atomicWriteFile(path.join(stagingPath, DISPOSABLE_COPY_MARKER), `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
        await this.assertCopyRootIdentity();
        if (!(await this.stagingMatchesOperation(operation))) {
          throw workspaceError("WORKSPACE_COPY_OWNERSHIP_CHANGED", "The new copy directory changed before registration. CodeClaw stopped without claiming it.");
        }
        advanceCreateOperation(operation, "ready-to-rename");
        await this.writeState(state);
        await this.verifyOperationPayload(operation, stagingPath);

        await fs.rename(stagingPath, targetPath);
        await syncDirectory(this.copyRootPath);
        const targetEntity = await captureDirectoryEntity(targetPath);
        if (!sameDirectoryEntity(targetEntity, operation.stagingEntity)) {
          throw workspaceError("WORKSPACE_COPY_OWNERSHIP_CHANGED", "The disposable-copy directory changed during its final rename.");
        }
        operation.targetRootIdentity = (await captureWorkspaceIdentity(targetPath)).digest;
        advanceCreateOperation(operation, "renamed");
        await this.writeState(state);
        await this.verifyOperationPayload(operation, targetPath);

        const record = copyRecordFromOperation(operation, this.copyRootPath);
        state.copies.push(record);
        advanceCreateOperation(operation, "complete");
        await this.writeState(state);
        state.operations = state.operations.filter((item) => item.operationId !== operation.operationId);
        await this.writeState(state);
        this.previews.delete(preview.previewId);
        return this.publicWorkspace(record, state, { status: "verified" });
      } catch (error) {
        try {
          state = await this.readState();
          const reconciled = await this.reconcileState(state);
          if (reconciled.changed) await this.writeState(reconciled.state);
          if (reconciled.blocked) throw workspaceError("WORKSPACE_RECOVERY_REQUIRED", "The interrupted disposable-copy creation could not be safely reconciled. CodeClaw left every uncertain directory untouched.");
          const recovered = reconciled.state.copies.find((item) => item.id === id);
          if (recovered) {
            this.previews.delete(preview.previewId);
            return this.publicWorkspace(recovered, reconciled.state, { status: "verified" });
          }
        } catch (recoveryError) {
          if (recoveryError.code === "WORKSPACE_RECOVERY_REQUIRED") throw recoveryError;
          throw workspaceError("WORKSPACE_RECOVERY_REQUIRED", "The interrupted disposable-copy creation needs startup recovery. CodeClaw did not delete any directory it could not prove it owned.");
        }
        throw error;
      }
    });
  }

  async register(rootPath) {
    await this.initialize();
    const workspace = await captureWorkspaceIdentity(rootPath);
    return this.serializeMutation(async () => {
      const state = await this.readState();
      const special = await this.resolveSpecialWorkspace(workspace, state);
      if (special) return special;

      const id = `original-${createHash("sha256").update(canonicalPath(workspace.rootPath), "utf8").digest("hex").slice(0, 24)}`;
      const now = new Date().toISOString();
      const existing = state.originals.findIndex((item) => item.id === id);
      const record = {
        id,
        kind: "original-readonly",
        name: path.basename(workspace.rootPath),
        rootPath: workspace.rootPath,
        rootIdentity: workspace.digest,
        createdAt: existing === -1 ? now : state.originals[existing].createdAt,
        updatedAt: now
      };
      if (existing === -1) state.originals.push(record);
      else state.originals[existing] = record;
      await this.writeState(state);
      return this.publicWorkspace(record, state, { status: "read-only" });
    });
  }

  async describePath(rootPath) {
    await this.initialize();
    const workspace = await captureWorkspaceIdentity(rootPath);
    const state = await this.readState();
    const special = await this.resolveSpecialWorkspace(workspace, state);
    if (special) return special;
    const original = state.originals.find((item) => canonicalPath(item.rootPath) === canonicalPath(workspace.rootPath));
    if (original && original.rootIdentity === workspace.digest) return this.publicWorkspace(original, state, { status: "read-only" });
    return null;
  }

  async list() {
    await this.initialize();
    const state = await this.readState();
    const workspaces = [];
    if (this.demoIdentity) workspaces.push(this.publicDemo(state));
    for (const original of state.originals) {
      const matches = await workspaceMatches(original.rootPath, original.rootIdentity);
      workspaces.push(this.publicWorkspace(original, state, { status: matches ? "read-only" : "unavailable" }));
    }
    for (const copy of state.copies) {
      let status = copy.status === "cleanup-pending" ? "cleanup-pending" : "verified";
      if (status === "verified") {
        try {
          await this.verifyCopyRecord(copy, { verifyPayload: false });
        } catch {
          status = "invalid";
        }
      }
      workspaces.push(this.publicWorkspace(copy, state, { status }));
    }
    return {
      workspaces,
      active: workspaces.find((item) => item.id === state.activeWorkspaceId) || null
    };
  }

  async activate({ workspaceId, workspaceDigest } = {}) {
    await this.initialize();
    return this.serializeMutation(async () => {
      const state = await this.readState();
      const selected = this.findRecord(state, workspaceId);
      if (!selected) throw workspaceError("WORKSPACE_UNKNOWN", "The selected workspace is not registered by this CodeClaw state.", 404);
      const currentPublic = selected.kind === "built-in-demo"
        ? this.publicDemo(state)
        : this.publicWorkspace(selected, state, { status: selected.kind === "original-readonly" ? "read-only" : "verified" });
      if (workspaceDigest !== currentPublic.workspaceDigest) {
        throw workspaceError("WORKSPACE_APPROVAL_STALE", "The workspace record changed after review. Refresh the workspace list and choose it again.");
      }

      if (selected.kind === "built-in-demo") {
        if (!this.demoIdentity || !(await workspaceMatches(this.demoIdentity.rootPath, this.demoIdentity.digest))) {
          throw workspaceError("WORKSPACE_DEMO_CHANGED", "The built-in Demo directory changed identity and cannot be activated.");
        }
        state.activeWorkspaceId = selected.id;
        await this.writeState(state);
        return this.publicDemo(state);
      }
      if (selected.kind === "original-readonly") {
        if (!(await workspaceMatches(selected.rootPath, selected.rootIdentity))) {
          throw workspaceError("WORKSPACE_ORIGINAL_CHANGED", "The original project directory changed identity. Scan it again before continuing.");
        }
        state.activeWorkspaceId = selected.id;
        await this.writeState(state);
        return this.publicWorkspace(selected, state, { status: "read-only" });
      }

      await this.verifyCopyRecord(selected, { verifyPayload: selected.baselineState === "sealed" });
      selected.baselineState = "opened";
      selected.status = "active";
      selected.updatedAt = new Date().toISOString();
      state.activeWorkspaceId = selected.id;
      await this.writeState(state);
      return this.publicWorkspace(selected, state, { status: "verified" });
    });
  }

  async assertCanMutate(rootPath, action = "write") {
    await this.initialize();
    const workspace = await captureWorkspaceIdentity(rootPath).catch(() => null);
    if (!workspace) throw workspaceError("WORKSPACE_IDENTITY_CHANGED", `The workspace identity could not be verified before ${action}.`);
    if (this.demoIdentity
      && canonicalPath(workspace.rootPath) === canonicalPath(this.demoIdentity.rootPath)
      && workspace.digest === this.demoIdentity.digest) {
      return this.publicDemo(await this.readState());
    }

    const state = await this.readState();
    const copy = state.copies.find((item) => canonicalPath(item.rootPath) === canonicalPath(workspace.rootPath));
    if (!copy) {
      throw workspaceError("WORKSPACE_ORIGINAL_READ_ONLY", `Original projects are read-only. CodeClaw requires an activated, registered disposable copy before it can ${action}.`);
    }
    if (copy.rootIdentity !== workspace.digest) {
      throw workspaceError("WORKSPACE_COPY_IDENTITY_CHANGED", `The disposable copy directory changed identity before ${action}.`);
    }
    if (copy.status === "cleanup-pending") {
      throw workspaceError("WORKSPACE_CLEANUP_PENDING", `The disposable copy is pending cleanup and cannot ${action}.`);
    }
    if (state.activeWorkspaceId !== copy.id || copy.baselineState !== "opened") {
      throw workspaceError("WORKSPACE_ACTIVATION_REQUIRED", `Activate the verified disposable copy before attempting to ${action}.`);
    }
    await this.verifyCopyRecord(copy, { verifyPayload: false });
    return this.publicWorkspace(copy, state, { status: "verified" });
  }

  async cleanup({ workspaceId, workspaceDigest } = {}) {
    await this.initialize();
    return this.serializeMutation(async () => {
      let state = await this.readState();
      const copy = state.copies.find((item) => item.id === workspaceId);
      if (!copy) throw workspaceError("WORKSPACE_UNKNOWN", "The disposable copy is not registered by this CodeClaw state.", 404);
      const descriptor = this.publicWorkspace(copy, state, { status: copy.status === "cleanup-pending" ? "cleanup-pending" : "verified" });
      if (workspaceDigest !== descriptor.workspaceDigest) {
        throw workspaceError("WORKSPACE_APPROVAL_STALE", "The disposable-copy record changed after review. Refresh it before cleanup.");
      }
      if (state.activeWorkspaceId === copy.id) {
        throw workspaceError("WORKSPACE_CLEANUP_ACTIVE", "Activate Demo or an original read-only workspace before permanently deleting this disposable copy.");
      }
      if (copy.status !== "cleanup-pending") {
        await this.verifyCopyRecord(copy, { verifyPayload: false });
        const sourceEntity = await captureDirectoryEntity(copy.rootPath);
        const currentRoot = await captureWorkspaceIdentity(copy.rootPath);
        if (currentRoot.digest !== copy.rootIdentity) {
          throw workspaceError("WORKSPACE_CLEANUP_OWNERSHIP_CHANGED", "The disposable copy changed before cleanup could reserve it.");
        }
        const now = new Date().toISOString();
        copy.status = "cleanup-pending";
        copy.cleanup = {
          phase: "reserved",
          quarantineName: `.${copy.directoryName}.cleanup-${randomUUID()}`,
          sourceRootIdentity: copy.rootIdentity,
          sourceEntity,
          quarantineRootIdentity: null,
          createdAt: now,
          updatedAt: now
        };
        copy.updatedAt = now;
        await this.writeState(state);
      }
      const reconciled = await this.reconcileCleanupRecords(state);
      if (reconciled.blocked) {
        throw workspaceError("WORKSPACE_RECOVERY_REQUIRED", "The disposable-copy cleanup could not prove ownership of its quarantine. Every uncertain directory was left untouched.");
      }
      if (!reconciled.changed || state.copies.some((item) => item.id === copy.id)) {
        throw workspaceError("WORKSPACE_RECOVERY_REQUIRED", "The disposable-copy cleanup did not reach a durable completed state.");
      }
      try {
        await this.assertCopyRootInventory(state);
      } catch {
        throw workspaceError("WORKSPACE_RECOVERY_REQUIRED", "The owned quarantine was removed, but the disposable-copy root contains an unrelated entry. CodeClaw left it untouched and did not report cleanup success.");
      }
      await this.writeState(state);
      return { removed: true, workspaceId: copy.id };
    });
  }

  async resolveSpecialWorkspace(workspace, state) {
    if (this.demoIdentity
      && canonicalPath(workspace.rootPath) === canonicalPath(this.demoIdentity.rootPath)
      && workspace.digest === this.demoIdentity.digest) return this.publicDemo(state);
    const copy = state.copies.find((item) => canonicalPath(item.rootPath) === canonicalPath(workspace.rootPath));
    if (!copy) return null;
    if (copy.rootIdentity !== workspace.digest) {
      throw workspaceError("WORKSPACE_COPY_IDENTITY_CHANGED", "A registered disposable-copy path now refers to a different directory. It remains blocked.");
    }
    await this.verifyCopyRecord(copy, { verifyPayload: false });
    return this.publicWorkspace(copy, state, { status: copy.status === "cleanup-pending" ? "cleanup-pending" : "verified" });
  }

  async verifyCopyRecord(record, { verifyPayload = false } = {}) {
    await this.verifyCopyRootRecord(record);
    const markerPath = path.join(record.rootPath, DISPOSABLE_COPY_MARKER);
    let marker;
    try {
      marker = await readStableJsonFile(markerPath, { missing: null });
      if (!marker) throw new Error("missing marker");
    } catch {
      throw workspaceError("WORKSPACE_COPY_MARKER_INVALID", "The disposable-copy ownership marker is missing or invalid.");
    }
    const { integrity, ...payload } = marker;
    if (!this.verify(payload, integrity)
      || payload.ownerId !== this.owner.ownerId
      || payload.workspaceId !== record.id
      || payload.nonce !== record.markerNonce
      || payload.sourceManifestDigest !== record.sourceManifest?.manifestDigest
      || payload.targetPayloadDigest !== record.targetPayloadDigest
      || payload.targetIdentityDigest !== record.targetIdentityDigest) {
      throw workspaceError("WORKSPACE_COPY_MARKER_INVALID", "The disposable-copy ownership marker no longer matches the signed registry.");
    }
    if (verifyPayload) {
      await this.verifyExactCopyTarget(record.sourceManifest, record.rootPath, {
        requireDisposableMarker: true,
        expectedPayloadDigest: record.targetPayloadDigest,
        expectedIdentityDigest: record.targetIdentityDigest,
        code: "WORKSPACE_COPY_MANIFEST_CHANGED",
        message: "The disposable copy changed before its first activation. Create a fresh copy rather than trusting this one."
      });
    }
    return true;
  }

  async verifyExactCopyTarget(sourceManifest, rootPath, {
    requireDisposableMarker = false,
    expectedPayloadDigest = null,
    expectedIdentityDigest = null,
    code = "WORKSPACE_COPY_VERIFY_FAILED",
    message = "The disposable-copy target no longer exactly matches its reviewed source payload.",
    status = 409
  } = {}) {
    const targetManifest = await buildDataBoundaryManifest(rootPath, {
      allowDisposableMarker: requireDisposableMarker
    });
    if (!isExactCopyTargetManifest(sourceManifest, targetManifest, { requireDisposableMarker })
      || (expectedPayloadDigest && targetManifest.payloadDigest !== expectedPayloadDigest)
      || (expectedIdentityDigest && targetManifest.entryIdentityDigest !== expectedIdentityDigest)) {
      throw workspaceError(code, message, status);
    }
    return targetManifest;
  }

  async verifyCopyRootRecord(record) {
    await this.assertCopyRootIdentity();
    if (!validCopyRecord(record)) throw workspaceError("WORKSPACE_COPY_RECORD_INVALID", "A disposable-copy registry record is invalid.");
    const expectedPath = path.join(this.copyRootPath, record.directoryName);
    if (canonicalPath(expectedPath) !== canonicalPath(record.rootPath)) {
      throw workspaceError("WORKSPACE_COPY_PATH_INVALID", "A disposable-copy record points outside its private storage root.");
    }
    const workspace = await captureWorkspaceIdentity(record.rootPath).catch(() => null);
    if (!workspace || workspace.digest !== record.rootIdentity) {
      throw workspaceError("WORKSPACE_COPY_IDENTITY_CHANGED", "The disposable-copy directory no longer matches its registered identity.");
    }
    return true;
  }

  publicPreview(preview) {
    const manifest = preview.manifest;
    return {
      previewId: preview.previewId,
      previewDigest: preview.previewDigest,
      policyVersion: manifest.policyVersion,
      sourcePath: preview.sourcePath,
      targetParent: this.copyRootPath,
      createdAt: preview.createdAt,
      expiresAt: preview.expiresAt,
      eligible: manifest.eligible,
      fileCount: manifest.fileCount,
      directoryCount: manifest.directoryCount,
      totalBytes: manifest.totalBytes,
      payloadDigest: manifest.payloadDigest,
      manifestDigest: manifest.manifestDigest,
      excluded: manifest.excluded,
      blockers: manifest.blockers,
      disclosure: {
        containsSourceCode: true,
        anonymized: false,
        safeToShare: false,
        createsCopy: false
      }
    };
  }

  publicDemo(state) {
    const record = {
      id: "built-in-demo",
      kind: "built-in-demo",
      name: "Demo",
      rootPath: this.demoIdentity?.rootPath || this.demoPath,
      rootIdentity: this.demoIdentity?.digest || "",
      createdAt: null,
      updatedAt: null
    };
    return this.publicWorkspace(record, state, { status: this.demoIdentity ? "verified" : "unavailable" });
  }

  publicWorkspace(record, state, { status } = {}) {
    const active = state.activeWorkspaceId === record.id;
    const verified = status === "verified" || record.kind === "built-in-demo" && status !== "unavailable";
    const canMutate = record.kind === "built-in-demo" && verified
      || record.kind === "disposable-copy" && verified && active && record.baselineState === "opened";
    const descriptor = {
      id: record.id,
      kind: record.kind,
      name: record.name,
      rootPath: record.rootPath,
      sourceRootPath: record.sourceRootPath || null,
      status: status || record.status || "unknown",
      active,
      canWrite: canMutate,
      canRunCommands: canMutate,
      createdAt: record.createdAt || null,
      updatedAt: record.updatedAt || null,
      manifestDigest: record.sourceManifest?.manifestDigest || null,
      fileCount: record.sourceManifest?.fileCount ?? null,
      totalBytes: record.sourceManifest?.totalBytes ?? null,
      disclosure: record.kind === "disposable-copy" ? {
        containsSourceCode: true,
        anonymized: false,
        safeToShare: false
      } : null
    };
    descriptor.workspaceDigest = this.sign({
      id: descriptor.id,
      kind: descriptor.kind,
      rootPath: descriptor.rootPath,
      status: descriptor.status,
      active: descriptor.active,
      manifestDigest: descriptor.manifestDigest,
      updatedAt: descriptor.updatedAt
    });
    return descriptor;
  }

  findRecord(state, workspaceId) {
    if (workspaceId === "built-in-demo" && this.demoIdentity) return { id: "built-in-demo", kind: "built-in-demo" };
    return state.originals.find((item) => item.id === workspaceId)
      || state.copies.find((item) => item.id === workspaceId)
      || null;
  }

  async assertSafeCopySource(sourcePath) {
    const requested = path.resolve(sourcePath || ".");
    const source = await fs.realpath(requested).catch(() => requested);
    const privateState = await fs.realpath(this.privateStateDir).catch(() => path.resolve(this.privateStateDir));
    if (isWithin(source, privateState) || isWithin(privateState, source)) {
      throw workspaceError("WORKSPACE_COPY_PRIVATE_STATE_OVERLAP", "The copy source and CodeClaw's private capability state directory must not contain one another.");
    }
    const copyRootInspection = await this.inspectRequestedCopyRootPath({ allowMissing: true });
    const copyRoot = copyRootInspection.projectedPath;
    if (isWithin(source, copyRoot) || isWithin(copyRoot, source)) {
      throw workspaceError("WORKSPACE_COPY_SOURCE_UNSAFE", "The source and disposable-copy storage directory must not contain one another.");
    }
  }

  async stagingMatchesOperation(operation) {
    const stagingPath = operationStagingPath(this.copyRootPath, operation);
    const [workspace, entity] = await Promise.all([
      captureWorkspaceIdentity(stagingPath).catch(() => null),
      captureDirectoryEntity(stagingPath).catch(() => null)
    ]);
    return Boolean(workspace
      && entity
      && workspace.digest === operation.stagingRootIdentity
      && sameDirectoryEntity(entity, operation.stagingEntity));
  }

  async reconcileState(state) {
    let changed = false;
    let blocked = false;
    for (const operation of [...state.operations]) {
      try {
        const result = await this.reconcileCreateOperation(state, operation);
        changed ||= result.changed;
      } catch {
        blocked = true;
      }
    }
    const cleanup = await this.reconcileCleanupRecords(state);
    changed ||= cleanup.changed;
    blocked ||= cleanup.blocked;
    try {
      await this.assertCopyRootInventory(state);
    } catch {
      blocked = true;
    }
    return { changed, blocked, state };
  }

  async assertCopyRootInventory(state) {
    if (!this.copyRootIdentity) return;
    await this.assertCopyRootIdentity();
    const allowed = new Set([COPY_ROOT_OWNER_CLAIM]);
    for (const copy of state.copies) {
      if (typeof copy.directoryName === "string") allowed.add(copy.directoryName);
      if (copy.status === "cleanup-pending" && typeof copy.cleanup?.quarantineName === "string") {
        allowed.add(copy.cleanup.quarantineName);
      }
    }
    for (const operation of state.operations) {
      if (typeof operation.directoryName === "string") allowed.add(operation.directoryName);
      if (typeof operation.stagingName === "string") allowed.add(operation.stagingName);
      if (typeof operation.discardName === "string") allowed.add(operation.discardName);
    }
    const entries = await fs.readdir(this.copyRootPath);
    const unexpected = entries.filter((name) => !allowed.has(name));
    if (unexpected.length) {
      throw workspaceError("WORKSPACE_COPY_ROOT_INVENTORY_UNKNOWN", "The disposable-copy root contains an entry that is not owned by the signed registry.");
    }
  }

  async reconcileCreateOperation(state, operation) {
    if (!validCreateOperation(operation)) {
      throw workspaceError("WORKSPACE_CREATE_OPERATION_INVALID", "An interrupted disposable-copy reservation is invalid.");
    }
    await this.assertCopyRootIdentity();
    const stagingPath = operationStagingPath(this.copyRootPath, operation);
    const targetPath = operationTargetPath(this.copyRootPath, operation);
    let stagingExists = await fileExists(stagingPath);
    let targetExists = await fileExists(targetPath);

    if (operation.phase === "reserved") {
      if (stagingExists || targetExists) {
        throw workspaceError("WORKSPACE_CREATE_OWNERSHIP_UNKNOWN", "A reserved disposable-copy path exists without a persisted entity identity.");
      }
      removeCreateOperation(state, operation.operationId);
      return { changed: true };
    }

    if (operation.phase === "creating") {
      if (targetExists) {
        throw workspaceError("WORKSPACE_CREATE_STATE_CONFLICT", "A disposable-copy target appeared before the operation was ready to rename.");
      }
      if (!stagingExists) {
        removeCreateOperation(state, operation.operationId);
        return { changed: true };
      }
      if (!(await this.stagingMatchesOperation(operation))) {
        throw workspaceError("WORKSPACE_CREATE_OWNERSHIP_CHANGED", "The interrupted staging directory no longer matches its signed entity identity.");
      }
      operation.discardName = `.${operation.directoryName}.discard-${randomUUID()}`;
      operation.discardCreatedAt = new Date().toISOString();
      advanceCreateOperation(operation, "discard-reserved");
      await this.writeState(state);
    }

    if (operation.phase === "discard-reserved") {
      const discardPath = operationDiscardPath(this.copyRootPath, operation);
      const discardExists = await fileExists(discardPath);
      stagingExists = await fileExists(stagingPath);
      if (discardExists) {
        const discardEntity = await captureDirectoryEntity(discardPath);
        if (!sameDirectoryEntity(discardEntity, operation.stagingEntity)) {
          throw workspaceError("WORKSPACE_CREATE_OWNERSHIP_CHANGED", "The staging discard quarantine does not contain the signed staging entity.");
        }
      } else {
        if (!stagingExists || !(await this.stagingMatchesOperation(operation))) {
          throw workspaceError("WORKSPACE_CREATE_OWNERSHIP_CHANGED", "The staging entity changed before it could enter the discard quarantine.");
        }
        await fs.rename(stagingPath, discardPath);
        await syncDirectory(this.copyRootPath);
      }
      const discardEntity = await captureDirectoryEntity(discardPath);
      if (!sameDirectoryEntity(discardEntity, operation.stagingEntity)) {
        throw workspaceError("WORKSPACE_CREATE_OWNERSHIP_CHANGED", "The staging entity changed during its discard rename.");
      }
      operation.discardRootIdentity = (await captureWorkspaceIdentity(discardPath)).digest;
      advanceCreateOperation(operation, "discard-quarantined");
      await this.writeState(state);
    }

    if (operation.phase === "discard-quarantined") {
      const discardPath = operationDiscardPath(this.copyRootPath, operation);
      if (await fileExists(discardPath)) {
        const [discardWorkspace, discardEntity] = await Promise.all([
          captureWorkspaceIdentity(discardPath),
          captureDirectoryEntity(discardPath)
        ]);
        if (discardWorkspace.digest !== operation.discardRootIdentity
          || !sameDirectoryEntity(discardEntity, operation.stagingEntity)) {
          throw workspaceError("WORKSPACE_CREATE_OWNERSHIP_CHANGED", "The staging discard quarantine was replaced before deletion.");
        }
        await safeRemoveOwnedTree(discardPath, operation.discardRootIdentity, operation.stagingEntity);
        await syncDirectory(this.copyRootPath);
      }
      removeCreateOperation(state, operation.operationId);
      return { changed: true };
    }

    if (operation.phase === "ready-to-rename") {
      if (stagingExists && targetExists || !stagingExists && !targetExists) {
        throw workspaceError("WORKSPACE_CREATE_STATE_CONFLICT", "The verified staging and target paths do not match a recoverable rename state.");
      }
      if (stagingExists) {
        if (!(await this.stagingMatchesOperation(operation))) {
          throw workspaceError("WORKSPACE_CREATE_OWNERSHIP_CHANGED", "The verified staging directory changed before recovery could rename it.");
        }
        await this.verifyOperationPayload(operation, stagingPath);
        await fs.rename(stagingPath, targetPath);
        await syncDirectory(this.copyRootPath);
        stagingExists = false;
        targetExists = true;
      }
      const targetEntity = await captureDirectoryEntity(targetPath);
      if (!sameDirectoryEntity(targetEntity, operation.stagingEntity)) {
        throw workspaceError("WORKSPACE_CREATE_OWNERSHIP_CHANGED", "The renamed disposable copy is not the staging directory recorded by the signed operation.");
      }
      await this.verifyOperationPayload(operation, targetPath);
      operation.targetRootIdentity = (await captureWorkspaceIdentity(targetPath)).digest;
      advanceCreateOperation(operation, "renamed");
    }

    if (operation.phase === "renamed") {
      stagingExists = await fileExists(stagingPath);
      targetExists = await fileExists(targetPath);
      if (stagingExists || !targetExists) {
        throw workspaceError("WORKSPACE_CREATE_STATE_CONFLICT", "The renamed disposable-copy operation no longer has exactly one final target.");
      }
      const [targetWorkspace, targetEntity] = await Promise.all([
        captureWorkspaceIdentity(targetPath),
        captureDirectoryEntity(targetPath)
      ]);
      if (targetWorkspace.digest !== operation.targetRootIdentity
        || !sameDirectoryEntity(targetEntity, operation.stagingEntity)) {
        throw workspaceError("WORKSPACE_CREATE_OWNERSHIP_CHANGED", "The final disposable-copy target changed before its registry commit.");
      }
      await this.verifyOperationPayload(operation, targetPath);
      const record = copyRecordFromOperation(operation, this.copyRootPath);
      const existing = state.copies.find((item) => item.id === operation.workspaceId);
      if (existing && !copyRecordMatchesOperation(existing, operation, this.copyRootPath)) {
        throw workspaceError("WORKSPACE_CREATE_STATE_CONFLICT", "The final disposable-copy record conflicts with its interrupted create operation.");
      }
      if (!existing) state.copies.push(record);
      advanceCreateOperation(operation, "complete");
    }

    if (operation.phase === "complete") {
      const record = state.copies.find((item) => item.id === operation.workspaceId);
      if (!record || !copyRecordMatchesOperation(record, operation, this.copyRootPath)) {
        throw workspaceError("WORKSPACE_CREATE_STATE_CONFLICT", "A completed disposable-copy operation is missing its matching registry record.");
      }
      await this.verifyCopyRecord(record, { verifyPayload: record.baselineState === "sealed" });
      removeCreateOperation(state, operation.operationId);
      return { changed: true };
    }

    throw workspaceError("WORKSPACE_CREATE_OPERATION_INVALID", "The disposable-copy operation phase is not recoverable.");
  }

  async verifyOperationPayload(operation, rootPath) {
    const markerPath = path.join(rootPath, DISPOSABLE_COPY_MARKER);
    let marker;
    try {
      marker = await readStableJsonFile(markerPath, { missing: null });
      if (!marker) throw new Error("missing marker");
    } catch {
      throw workspaceError("WORKSPACE_COPY_MARKER_INVALID", "The interrupted disposable copy has no valid ownership marker.");
    }
    const { integrity, ...payload } = marker;
    const expected = markerPayloadForOperation(operation, this.owner.ownerId);
    if (!this.verify(payload, integrity) || !sameJson(payload, expected)) {
      throw workspaceError("WORKSPACE_COPY_MARKER_INVALID", "The interrupted disposable-copy marker does not match its signed reservation.");
    }
    await this.verifyExactCopyTarget(operation.sourceManifest, rootPath, {
      requireDisposableMarker: true,
      expectedPayloadDigest: operation.targetPayloadDigest,
      expectedIdentityDigest: operation.targetIdentityDigest,
      code: "WORKSPACE_COPY_VERIFY_FAILED",
      message: "The interrupted disposable-copy payload no longer exactly matches the verified Manifest."
    });
  }

  async assertCopyRootIdentity() {
    await this.assertRequestedCopyRootDirectory();
    const current = await captureWorkspaceIdentity(this.copyRootPath).catch(() => null);
    if (!current || current.digest !== this.copyRootIdentity) {
      throw workspaceError("WORKSPACE_COPY_ROOT_CHANGED", "The disposable-copy storage root changed identity. CodeClaw stopped before modifying or deleting anything.");
    }
    await this.assertCopyRootClaim(current);
  }

  async assertRequestedCopyRootDirectory({ allowMissing = false } = {}) {
    const inspection = await this.inspectRequestedCopyRootPath({ allowMissing });
    return inspection.stat;
  }

  async inspectRequestedCopyRootPath({ allowMissing = false } = {}) {
    const requestedPath = path.resolve(this.copyRootPath);
    const parsed = path.parse(requestedPath);
    const segments = path.relative(parsed.root, requestedPath).split(path.sep).filter(Boolean);
    const inspected = [];
    let currentPath = parsed.root;
    let currentStat = await fs.lstat(currentPath, { bigint: true });
    assertNormalCopyRootDirectory(currentPath, currentStat);
    inspected.push({ path: currentPath, entity: directoryEntityFromStat(currentStat) });

    for (let index = 0; index < segments.length; index += 1) {
      const candidate = path.join(currentPath, segments[index]);
      try {
        currentStat = await fs.lstat(candidate, { bigint: true });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        const missingSegments = segments.slice(index);
        const existingRealPath = await fs.realpath(currentPath);
        await assertInspectedDirectoryChainStable(inspected);
        if (!allowMissing) throw error;
        return {
          requestedPath,
          stat: null,
          existingPath: currentPath,
          existingRealPath,
          missingSegments,
          projectedPath: path.join(existingRealPath, ...missingSegments)
        };
      }
      assertNormalCopyRootDirectory(candidate, currentStat);
      currentPath = candidate;
      inspected.push({ path: currentPath, entity: directoryEntityFromStat(currentStat) });
    }

    const realPath = await fs.realpath(currentPath);
    await assertInspectedDirectoryChainStable(inspected);
    return {
      requestedPath,
      stat: currentStat,
      existingPath: currentPath,
      existingRealPath: realPath,
      missingSegments: [],
      projectedPath: realPath
    };
  }

  async readCopyRootClaim({ allowMissing = false } = {}) {
    const claimPath = path.join(this.copyRootPath, COPY_ROOT_OWNER_CLAIM);
    return readStableJsonFile(claimPath, { missing: allowMissing ? null : undefined, requirePrivate: true });
  }

  async assertCopyRootClaim(copyRoot, suppliedClaim = null) {
    let claim;
    try {
      claim = suppliedClaim || await this.readCopyRootClaim();
    } catch (error) {
      if (error.code === "ENOENT") {
        throw workspaceError("WORKSPACE_COPY_ROOT_CLAIM_MISSING", "The disposable-copy root ownership claim is missing. CodeClaw will not recreate or transfer authority.");
      }
      throw error;
    }
    if (claim?.ownerId !== this.owner.ownerId) {
      throw workspaceError("WORKSPACE_COPY_ROOT_OWNED_ELSEWHERE", "The configured disposable-copy root is already claimed by another CodeClaw state.");
    }
    const { integrity, ...payload } = claim || {};
    if (!validCopyRootClaim(payload)
      || !this.verify(payload, integrity)
      || canonicalPath(payload.copyRootPath) !== canonicalPath(copyRoot.rootPath)
      || payload.copyRootIdentity !== copyRoot.digest) {
      throw workspaceError("WORKSPACE_COPY_ROOT_CLAIM_INVALID", "The disposable-copy root ownership claim is invalid or no longer matches this directory.");
    }
    return claim;
  }

  async createOrVerifyCopyRootClaim(copyRoot) {
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      kind: "disposable-copy-root-owner",
      ownerId: this.owner.ownerId,
      copyRootPath: copyRoot.rootPath,
      copyRootIdentity: copyRoot.digest,
      createdAt: new Date().toISOString()
    };
    const document = { ...payload, integrity: this.sign(payload) };
    const claimPath = path.join(copyRoot.rootPath, COPY_ROOT_OWNER_CLAIM);
    let handle;
    try {
      handle = await fs.open(claimPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
      await handle.sync();
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      return this.waitForCopyRootClaim(copyRoot);
    } finally {
      await handle?.close();
    }
    await syncDirectory(copyRoot.rootPath);
    return this.assertCopyRootClaim(copyRoot);
  }

  async waitForCopyRootClaim(copyRoot) {
    let lastError = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        return await this.assertCopyRootClaim(copyRoot);
      } catch (error) {
        if (error.code === "WORKSPACE_COPY_ROOT_OWNED_ELSEWHERE") throw error;
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    if (lastError?.code === "WORKSPACE_COPY_ROOT_CLAIM_INVALID") throw lastError;
    throw workspaceError("WORKSPACE_COPY_ROOT_CLAIM_INVALID", "The disposable-copy root claim was not durably completed and cannot be trusted.");
  }

  async persistOwnerRoot(copyRoot) {
    this.copyRootPath = copyRoot.rootPath;
    this.copyRootIdentity = copyRoot.digest;
    this.owner = {
      ...this.owner,
      copyRootPath: copyRoot.rootPath,
      copyRootIdentity: copyRoot.digest,
      updatedAt: new Date().toISOString()
    };
    await atomicWriteFile(this.ownerPath, `${JSON.stringify(this.owner, null, 2)}\n`, { mode: 0o600 });
    await syncDirectory(path.dirname(this.ownerPath));
  }

  async ensureCopyRootInitialized(sourcePath) {
    if (this.copyRootIdentity) return this.assertCopyRootIdentity();
    const diskOwner = await readStableJsonFile(this.ownerPath, { missing: null, requirePrivate: true });
    if (validOwner(diskOwner)
      && diskOwner.ownerId === this.owner.ownerId
      && diskOwner.secret === this.owner.secret
      && diskOwner.copyRootIdentity) {
      this.owner = diskOwner;
      this.copyRootPath = path.resolve(diskOwner.copyRootPath);
      this.copyRootIdentity = diskOwner.copyRootIdentity;
      return this.assertCopyRootIdentity();
    }
    const source = await fs.realpath(path.resolve(sourcePath));
    let inspection = await this.inspectRequestedCopyRootPath({ allowMissing: true });
    if (isWithin(source, inspection.projectedPath) || isWithin(inspection.projectedPath, source)) {
      throw workspaceError("WORKSPACE_COPY_SOURCE_UNSAFE", "The source and disposable-copy storage directory must not contain one another.");
    }
    if (!inspection.stat) {
      await fs.mkdir(path.dirname(this.copyRootPath), { recursive: true, mode: 0o700 });
      inspection = await this.inspectRequestedCopyRootPath({ allowMissing: true });
      if (isWithin(source, inspection.projectedPath) || isWithin(inspection.projectedPath, source)) {
        throw workspaceError("WORKSPACE_COPY_SOURCE_UNSAFE", "The source and disposable-copy storage directory must not contain one another.");
      }
    }
    if (!inspection.stat) {
      try {
        await fs.mkdir(this.copyRootPath, { recursive: false, mode: 0o700 });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }
    inspection = await this.inspectRequestedCopyRootPath();
    if (isWithin(source, inspection.projectedPath) || isWithin(inspection.projectedPath, source)) {
      throw workspaceError("WORKSPACE_COPY_SOURCE_UNSAFE", "The source and disposable-copy storage directory must not contain one another.");
    }
    const root = await captureWorkspaceIdentity(this.copyRootPath);
    if (canonicalPath(root.rootPath) !== canonicalPath(inspection.projectedPath)) {
      throw workspaceError("WORKSPACE_COPY_ROOT_UNSAFE", "The disposable-copy root resolved somewhere unexpected after creation.");
    }
    const existingClaim = await this.readCopyRootClaim({ allowMissing: true });
    if (existingClaim) {
      await this.assertCopyRootClaim(root, existingClaim);
    } else {
      const entries = await fs.readdir(root.rootPath);
      if (entries.length) {
        throw workspaceError("WORKSPACE_OWNERSHIP_STATE_MISSING", "The unregistered disposable-copy root is not empty. CodeClaw will not claim its contents.");
      }
      const beforeClaim = await this.inspectRequestedCopyRootPath();
      if (canonicalPath(beforeClaim.projectedPath) !== canonicalPath(root.rootPath)
        || isWithin(source, beforeClaim.projectedPath)
        || isWithin(beforeClaim.projectedPath, source)) {
        throw workspaceError("WORKSPACE_COPY_ROOT_UNSAFE", "The disposable-copy root changed before ownership could be claimed.");
      }
      await this.createOrVerifyCopyRootClaim(root);
    }
    await this.persistOwnerRoot(root);
    await this.assertCopyRootIdentity();
  }

  async loadOrCreateOwner() {
    let owner = await readStableJsonFile(this.ownerPath, { missing: null, requirePrivate: true });
    if (!owner) {
      if (await fileExists(this.storagePath)) {
        throw workspaceError("WORKSPACE_OWNERSHIP_STATE_MISSING", "Private workspace state exists without its ownership key. CodeClaw will not recreate authority.");
      }
      const requestedRoot = await this.assertRequestedCopyRootDirectory({ allowMissing: true });
      if (requestedRoot) {
        const existingRoot = await captureWorkspaceIdentity(this.copyRootPath);
        const entries = await fs.readdir(existingRoot.rootPath);
        if (entries.length) {
          throw workspaceError("WORKSPACE_OWNERSHIP_STATE_MISSING", "Private copy state exists without its ownership key. CodeClaw will not claim those directories.");
        }
      }
      owner = {
        schemaVersion: SCHEMA_VERSION,
        ownerId: randomUUID(),
        secret: randomBytes(32).toString("base64url"),
        copyRootPath: path.resolve(this.copyRootPath),
        copyRootIdentity: null,
        createdAt: new Date().toISOString()
      };
      let handle;
      try {
        handle = await fs.open(this.ownerPath, "wx", 0o600);
        await handle.writeFile(`${JSON.stringify(owner, null, 2)}\n`, "utf8");
        await handle.sync();
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        owner = await readStableJsonFile(this.ownerPath, { missing: null, requirePrivate: true });
      } finally {
        await handle?.close();
      }
      await syncDirectory(path.dirname(this.ownerPath));
    }
    if (!validOwner(owner)) throw workspaceError("WORKSPACE_OWNER_INVALID", "The local workspace ownership record is invalid.");
    return owner;
  }

  async readState({ allowMissing = false } = {}) {
    let document;
    try {
      document = await readStableJsonFile(this.storagePath, { missing: allowMissing ? null : undefined, requirePrivate: true });
      if (!document) return null;
    } catch (error) {
      throw workspaceError("WORKSPACE_STATE_INTEGRITY_FAILED", "The signed workspace registry is missing or unreadable.");
    }
    const { integrity, ...state } = document;
    if (!validState(state, this.owner.ownerId, this.copyRootPath) || !this.verify(state, integrity)) {
      throw workspaceError("WORKSPACE_STATE_INTEGRITY_FAILED", "The signed workspace registry was modified or is invalid. Capabilities and cleanup remain disabled.");
    }
    return state;
  }

  async writeState(state) {
    if (!validState(state, this.owner.ownerId, this.copyRootPath)) throw workspaceError("WORKSPACE_STATE_INTEGRITY_FAILED", "CodeClaw refused to persist an invalid workspace registry.", 500);
    const document = { ...state, integrity: this.sign(state) };
    await atomicWriteFile(this.storagePath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  }

  async reconcileCleanupRecords(state) {
    let changed = false;
    let blocked = false;
    for (const copy of [...state.copies]) {
      if (copy.status !== "cleanup-pending") continue;
      try {
        const result = await this.reconcileCleanupRecord(state, copy);
        changed ||= result.changed;
      } catch {
        blocked = true;
      }
    }
    return { changed, blocked };
  }

  async reconcileCleanupRecord(state, copy) {
    if (!validCleanupRecord(copy)) {
      throw workspaceError("WORKSPACE_CLEANUP_STATE_INVALID", "The signed cleanup reservation is invalid.");
    }
    await this.assertCopyRootIdentity();
    const cleanup = copy.cleanup;
    const sourcePath = copy.rootPath;
    const quarantinePath = path.join(this.copyRootPath, cleanup.quarantineName);
    let sourceExists = await fileExists(sourcePath);
    let quarantineExists = await fileExists(quarantinePath);

    if (cleanup.phase === "reserved") {
      if (quarantineExists) {
        const quarantineEntity = await captureDirectoryEntity(quarantinePath);
        if (!sameDirectoryEntity(quarantineEntity, cleanup.sourceEntity)) {
          throw workspaceError("WORKSPACE_CLEANUP_OWNERSHIP_CHANGED", "The cleanup quarantine does not contain the reserved disposable-copy entity.");
        }
      } else {
        if (!sourceExists) {
          throw workspaceError("WORKSPACE_CLEANUP_OWNERSHIP_CHANGED", "Neither the reserved disposable copy nor its quarantine can be proven to exist.");
        }
        const [sourceWorkspace, sourceEntity] = await Promise.all([
          captureWorkspaceIdentity(sourcePath),
          captureDirectoryEntity(sourcePath)
        ]);
        if (sourceWorkspace.digest !== cleanup.sourceRootIdentity
          || !sameDirectoryEntity(sourceEntity, cleanup.sourceEntity)) {
          throw workspaceError("WORKSPACE_CLEANUP_OWNERSHIP_CHANGED", "The original disposable-copy path was replaced before quarantine.");
        }
        await fs.rename(sourcePath, quarantinePath);
        await syncDirectory(this.copyRootPath);
        sourceExists = false;
        quarantineExists = true;
      }

      const quarantineEntity = await captureDirectoryEntity(quarantinePath);
      if (!sameDirectoryEntity(quarantineEntity, cleanup.sourceEntity)) {
        throw workspaceError("WORKSPACE_CLEANUP_OWNERSHIP_CHANGED", "The disposable-copy entity changed during quarantine rename.");
      }
      cleanup.quarantineRootIdentity = (await captureWorkspaceIdentity(quarantinePath)).digest;
      cleanup.phase = "quarantined";
      cleanup.updatedAt = new Date().toISOString();
      copy.updatedAt = cleanup.updatedAt;
      // Persist the post-rename path before beginning recursive deletion.
      await this.writeState(state);
    }

    if (cleanup.phase === "quarantined") {
      quarantineExists = await fileExists(quarantinePath);
      if (quarantineExists) {
        const [quarantineWorkspace, quarantineEntity] = await Promise.all([
          captureWorkspaceIdentity(quarantinePath),
          captureDirectoryEntity(quarantinePath)
        ]);
        if (quarantineWorkspace.digest !== cleanup.quarantineRootIdentity
          || !sameDirectoryEntity(quarantineEntity, cleanup.sourceEntity)) {
          throw workspaceError("WORKSPACE_CLEANUP_OWNERSHIP_CHANGED", "The cleanup quarantine was replaced before recursive deletion.");
        }
        await safeRemoveOwnedTree(quarantinePath, cleanup.quarantineRootIdentity, cleanup.sourceEntity);
        await syncDirectory(this.copyRootPath);
      }
      state.copies = state.copies.filter((item) => item.id !== copy.id);
      if (state.activeWorkspaceId === copy.id) state.activeWorkspaceId = null;
      return { changed: true };
    }

    throw workspaceError("WORKSPACE_CLEANUP_STATE_INVALID", "The cleanup phase is not recoverable.");
  }

  sign(value) {
    return createHmac("sha256", Buffer.from(this.owner.secret, "base64url"))
      .update(JSON.stringify(sortJson(value)), "utf8")
      .digest("hex");
  }

  verify(value, signature) {
    if (typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) return false;
    const expected = Buffer.from(this.sign(value), "hex");
    const actual = Buffer.from(signature, "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  pruneExpiredPreviews() {
    const now = Date.now();
    for (const [id, preview] of this.previews) {
      if (Date.parse(preview.expiresAt) <= now) this.previews.delete(id);
    }
  }

  serializeMutation(operation) {
    const locked = async () => this.lockManager.withLock(await canonicalPathLockKey(this.storagePath), operation);
    const result = this.mutationQueue.then(locked, locked);
    this.mutationQueue = result.catch(() => {});
    return result;
  }
}

function advanceCreateOperation(operation, phase) {
  operation.phase = phase;
  operation.updatedAt = new Date().toISOString();
}

function removeCreateOperation(state, operationId) {
  state.operations = state.operations.filter((item) => item.operationId !== operationId);
}

function operationStagingPath(copyRootPath, operation) {
  return path.join(copyRootPath, operation.stagingName);
}

function operationTargetPath(copyRootPath, operation) {
  return path.join(copyRootPath, operation.directoryName);
}

function operationDiscardPath(copyRootPath, operation) {
  return path.join(copyRootPath, operation.discardName);
}

function markerPayloadForOperation(operation, ownerId) {
  return {
    schemaVersion: SCHEMA_VERSION,
    policyVersion: DATA_BOUNDARY_POLICY_VERSION,
    ownerId,
    workspaceId: operation.workspaceId,
    nonce: operation.markerNonce,
    sourceRootIdentity: operation.sourceManifest.rootIdentity,
    sourceManifestDigest: operation.sourceManifest.manifestDigest,
    targetPayloadDigest: operation.targetPayloadDigest,
    targetIdentityDigest: operation.targetIdentityDigest,
    createdAt: operation.markerCreatedAt
  };
}

function copyRecordFromOperation(operation, copyRootPath) {
  const now = new Date().toISOString();
  return {
    id: operation.workspaceId,
    kind: "disposable-copy",
    name: path.basename(operation.sourceRootPath),
    directoryName: operation.directoryName,
    rootPath: operationTargetPath(copyRootPath, operation),
    rootIdentity: operation.targetRootIdentity,
    sourceRootPath: operation.sourceRootPath,
    sourceRootIdentity: operation.sourceManifest.rootIdentity,
    sourceManifest: operation.sourceManifest,
    targetPayloadDigest: operation.targetPayloadDigest,
    targetIdentityDigest: operation.targetIdentityDigest,
    markerNonce: operation.markerNonce,
    baselineState: "sealed",
    status: "ready",
    createdAt: operation.markerCreatedAt,
    updatedAt: now
  };
}

function copyRecordMatchesOperation(record, operation, copyRootPath) {
  return validCopyRecord(record)
    && record.id === operation.workspaceId
    && record.directoryName === operation.directoryName
    && canonicalPath(record.rootPath) === canonicalPath(operationTargetPath(copyRootPath, operation))
    && record.rootIdentity === operation.targetRootIdentity
    && canonicalPath(record.sourceRootPath) === canonicalPath(operation.sourceRootPath)
    && record.sourceRootIdentity === operation.sourceManifest.rootIdentity
    && record.sourceManifest?.manifestDigest === operation.sourceManifest.manifestDigest
    && record.targetPayloadDigest === operation.targetPayloadDigest
    && record.targetIdentityDigest === operation.targetIdentityDigest
    && record.markerNonce === operation.markerNonce;
}

function validCreateOperation(operation) {
  if (!operation
    || operation.kind !== "create-copy"
    || !/^create-[0-9a-f-]{36}$/.test(operation.operationId || "")
    || !/^disposable-[0-9a-f-]{36}$/.test(operation.workspaceId || "")
    || operation.directoryName !== `copy-${operation.workspaceId.slice("disposable-".length)}`
    || !new RegExp(`^\\.${escapeRegExp(operation.directoryName)}\\.creating-[0-9a-f-]{36}$`).test(operation.stagingName || "")
    || !["reserved", "creating", "discard-reserved", "discard-quarantined", "ready-to-rename", "renamed", "complete"].includes(operation.phase)
    || !path.isAbsolute(operation.sourceRootPath || "")
    || !/^[0-9a-f-]{36}$/.test(operation.markerNonce || "")
    || !validSourceManifest(operation.sourceManifest)
    || canonicalPath(operation.sourceRootPath) !== canonicalPath(operation.sourceManifest.rootPath)
    || typeof operation.createdAt !== "string"
    || typeof operation.updatedAt !== "string") return false;

  const hasStaging = validDigest(operation.stagingRootIdentity) && validDirectoryEntity(operation.stagingEntity);
  const hasPayload = validDigest(operation.targetPayloadDigest)
    && validDigest(operation.targetIdentityDigest)
    && typeof operation.markerCreatedAt === "string";
  const hasTarget = validDigest(operation.targetRootIdentity);
  if (operation.phase === "reserved") {
    return operation.stagingRootIdentity === null
      && operation.stagingEntity === null
      && operation.targetRootIdentity === null
      && operation.targetPayloadDigest === null
      && operation.targetIdentityDigest === null
      && operation.markerCreatedAt === null
      && operation.discardName === null
      && operation.discardRootIdentity === null
      && operation.discardCreatedAt === null;
  }
  if (!hasStaging) return false;
  if (operation.phase === "creating") {
    return operation.targetRootIdentity === null
      && operation.targetPayloadDigest === null
      && operation.targetIdentityDigest === null
      && operation.markerCreatedAt === null
      && operation.discardName === null
      && operation.discardRootIdentity === null
      && operation.discardCreatedAt === null;
  }
  if (["discard-reserved", "discard-quarantined"].includes(operation.phase)) {
    const hasDiscardName = new RegExp(`^\\.${escapeRegExp(operation.directoryName)}\\.discard-[0-9a-f-]{36}$`).test(operation.discardName || "");
    return operation.targetRootIdentity === null
      && operation.targetPayloadDigest === null
      && operation.targetIdentityDigest === null
      && operation.markerCreatedAt === null
      && hasDiscardName
      && typeof operation.discardCreatedAt === "string"
      && (operation.phase === "discard-reserved"
        ? operation.discardRootIdentity === null
        : validDigest(operation.discardRootIdentity));
  }
  if (!hasPayload) return false;
  if (operation.discardName !== null || operation.discardRootIdentity !== null || operation.discardCreatedAt !== null) return false;
  return operation.phase === "ready-to-rename" ? operation.targetRootIdentity === null : hasTarget;
}

function validSourceManifest(manifest) {
  return manifest?.schemaVersion === 1
    && manifest.policyVersion === DATA_BOUNDARY_POLICY_VERSION
    && typeof manifest.rootPath === "string"
    && path.isAbsolute(manifest.rootPath)
    && validDigest(manifest.rootIdentity)
    && validDigest(manifest.payloadDigest)
    && validDigest(manifest.entryIdentityDigest)
    && validDigest(manifest.manifestDigest)
    && manifest.eligible === true
    && Array.isArray(manifest.files)
    && Array.isArray(manifest.directories)
    && Array.isArray(manifest.excluded)
    && Array.isArray(manifest.blockers);
}

async function captureDirectoryEntity(directoryPath) {
  const stat = await fs.lstat(directoryPath, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw workspaceError("WORKSPACE_CREATE_OWNERSHIP_CHANGED", "A disposable-copy lifecycle path is not a normal directory.");
  }
  return directoryEntityFromStat(stat);
}

function directoryEntityFromStat(stat) {
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    birthtimeNs: stat.birthtimeNs.toString()
  };
}

function assertNormalCopyRootDirectory(directoryPath, stat) {
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw workspaceError("WORKSPACE_COPY_ROOT_UNSAFE", `Every existing disposable-copy root ancestor must be a normal directory; a file, link, junction, or reparse path was found at ${directoryPath}.`);
  }
}

async function assertInspectedDirectoryChainStable(inspected) {
  for (const item of inspected) {
    let stat;
    try {
      stat = await fs.lstat(item.path, { bigint: true });
    } catch {
      throw workspaceError("WORKSPACE_COPY_ROOT_UNSAFE", "The disposable-copy root ancestry changed during safety inspection.");
    }
    assertNormalCopyRootDirectory(item.path, stat);
    if (!sameDirectoryEntity(directoryEntityFromStat(stat), item.entity)) {
      throw workspaceError("WORKSPACE_COPY_ROOT_UNSAFE", "The disposable-copy root ancestry changed during safety inspection.");
    }
  }
}

async function captureTrustedDirectoryIdentity(directoryPath) {
  try {
    const before = await captureDirectoryEntity(directoryPath);
    const workspace = await captureWorkspaceIdentity(directoryPath);
    const [afterRequested, resolved] = await Promise.all([
      captureDirectoryEntity(directoryPath),
      captureDirectoryEntity(workspace.rootPath)
    ]);
    return sameDirectoryEntity(before, afterRequested) && sameDirectoryEntity(afterRequested, resolved)
      ? workspace
      : null;
  } catch {
    return null;
  }
}

function validDirectoryEntity(entity) {
  return entity
    && typeof entity.dev === "string"
    && /^\d+$/.test(entity.dev)
    && typeof entity.ino === "string"
    && /^\d+$/.test(entity.ino)
    && typeof entity.birthtimeNs === "string"
    && /^\d+$/.test(entity.birthtimeNs);
}

function sameDirectoryEntity(left, right) {
  return validDirectoryEntity(left)
    && validDirectoryEntity(right)
    && left.dev === right.dev
    && left.ino === right.ino
    && left.birthtimeNs === right.birthtimeNs;
}

function sameJson(left, right) {
  return JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function safeRemoveOwnedTree(rootPath, expectedIdentity, expectedEntity = null) {
  const [workspace, entity] = await Promise.all([
    captureWorkspaceIdentity(rootPath).catch(() => null),
    captureDirectoryEntity(rootPath).catch(() => null)
  ]);
  if (!workspace
    || !entity
    || workspace.digest !== expectedIdentity
    || expectedEntity && !sameDirectoryEntity(entity, expectedEntity)) {
    throw workspaceError("WORKSPACE_CLEANUP_OWNERSHIP_CHANGED", "The directory selected for cleanup no longer matches CodeClaw's ownership record.");
  }
  await inspectSafeTree(workspace.rootPath);
  const [beforeRemove, entityBeforeRemove] = await Promise.all([
    captureWorkspaceIdentity(rootPath).catch(() => null),
    captureDirectoryEntity(rootPath).catch(() => null)
  ]);
  if (!beforeRemove
    || !entityBeforeRemove
    || beforeRemove.digest !== expectedIdentity
    || expectedEntity && !sameDirectoryEntity(entityBeforeRemove, expectedEntity)) {
    throw workspaceError("WORKSPACE_CLEANUP_OWNERSHIP_CHANGED", "The directory selected for cleanup changed after inspection.");
  }
  await removeSafeTree(workspace.rootPath, true, { expectedIdentity, expectedEntity: expectedEntity || entityBeforeRemove });
}

async function inspectSafeTree(currentPath) {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(currentPath, entry.name);
    const stat = await fs.lstat(target, { bigint: true });
    if (stat.isSymbolicLink()) throw workspaceError("WORKSPACE_CLEANUP_LINK_FOUND", "Cleanup stopped because the disposable copy contains a link. Remove it manually, then retry.");
    if (stat.isDirectory()) await inspectSafeTree(target);
    else if (!stat.isFile() || stat.nlink !== 1n) throw workspaceError("WORKSPACE_CLEANUP_ENTRY_UNSAFE", "Cleanup stopped because the disposable copy contains an unowned or unsupported filesystem entry.");
  }
}

async function removeSafeTree(currentPath, root = false, rootProof = null) {
  if (root && rootProof) {
    const [workspace, entity] = await Promise.all([
      captureWorkspaceIdentity(currentPath).catch(() => null),
      captureDirectoryEntity(currentPath).catch(() => null)
    ]);
    if (!workspace
      || !entity
      || workspace.digest !== rootProof.expectedIdentity
      || !sameDirectoryEntity(entity, rootProof.expectedEntity)) {
      throw workspaceError("WORKSPACE_CLEANUP_OWNERSHIP_CHANGED", "The quarantine changed immediately before recursive deletion.");
    }
  }
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const ordered = root
    ? [...entries.filter((entry) => entry.name !== DISPOSABLE_COPY_MARKER), ...entries.filter((entry) => entry.name === DISPOSABLE_COPY_MARKER)]
    : entries;
  for (const entry of ordered) {
    const target = path.join(currentPath, entry.name);
    const stat = await fs.lstat(target, { bigint: true });
    if (stat.isSymbolicLink()) throw workspaceError("WORKSPACE_CLEANUP_LINK_FOUND", "Cleanup stopped because a link appeared during deletion.");
    if (stat.isDirectory()) await removeSafeTree(target, false, null);
    else if (stat.isFile() && stat.nlink === 1n) await fs.unlink(target);
    else throw workspaceError("WORKSPACE_CLEANUP_ENTRY_UNSAFE", "Cleanup stopped because an entry changed during deletion.");
  }
  await fs.rmdir(currentPath);
}

function emptyState(ownerId) {
  return { schemaVersion: SCHEMA_VERSION, ownerId, activeWorkspaceId: null, originals: [], copies: [], operations: [] };
}

function validOwner(owner) {
  return owner?.schemaVersion === SCHEMA_VERSION
    && typeof owner.ownerId === "string"
    && /^[A-Za-z0-9_-]{43}$/.test(owner.secret || "")
    && typeof owner.copyRootPath === "string"
    && (owner.copyRootIdentity === null || validDigest(owner.copyRootIdentity));
}

function validCopyRootClaim(claim) {
  return claim?.schemaVersion === SCHEMA_VERSION
    && claim.kind === "disposable-copy-root-owner"
    && typeof claim.ownerId === "string"
    && typeof claim.copyRootPath === "string"
    && path.isAbsolute(claim.copyRootPath)
    && validDigest(claim.copyRootIdentity)
    && typeof claim.createdAt === "string";
}

function validState(state, ownerId, copyRootPath) {
  if (state?.schemaVersion !== SCHEMA_VERSION
    || state.ownerId !== ownerId
    || !Array.isArray(state.originals)
    || !Array.isArray(state.copies)
    || !Array.isArray(state.operations)
    || !validCreateOperations(state.operations)) return false;

  const workspaceIds = new Set();
  const workspacePaths = new Set();
  const directoryNames = new Set([COPY_ROOT_OWNER_CLAIM]);
  for (const original of state.originals) {
    if (!validOriginalRecord(original)) return false;
    const rootKey = canonicalPath(original.rootPath);
    if (workspaceIds.has(original.id)
      || workspacePaths.has(rootKey)) return false;
    workspaceIds.add(original.id);
    workspacePaths.add(rootKey);
  }
  for (const copy of state.copies) {
    if (!validCopyRecord(copy)) return false;
    const rootKey = canonicalPath(copy.rootPath);
    const expectedRoot = path.join(copyRootPath, copy.directoryName);
    if (canonicalPath(copy.rootPath) !== canonicalPath(expectedRoot)
      || workspaceIds.has(copy.id)
      || workspacePaths.has(rootKey)
      || directoryNames.has(copy.directoryName)
      || copy.status === "cleanup-pending" && !validCleanupRecord(copy)
      || copy.status !== "cleanup-pending" && copy.cleanup != null) return false;
    workspaceIds.add(copy.id);
    workspacePaths.add(rootKey);
    directoryNames.add(copy.directoryName);
    if (copy.status === "cleanup-pending") {
      if (directoryNames.has(copy.cleanup.quarantineName)) return false;
      directoryNames.add(copy.cleanup.quarantineName);
    }
  }

  for (const operation of state.operations) {
    const matchingCopy = state.copies.find((copy) => copy.id === operation.workspaceId);
    if (matchingCopy) {
      if (operation.phase !== "complete"
        || !copyRecordMatchesOperation(matchingCopy, operation, copyRootPath)) return false;
    } else if (workspaceIds.has(operation.workspaceId)) return false;
    if (directoryNames.has(operation.directoryName) && operation.phase !== "complete") return false;
    if (!directoryNames.has(operation.directoryName)) directoryNames.add(operation.directoryName);
    for (const name of [operation.stagingName, operation.discardName].filter(Boolean)) {
      if (directoryNames.has(name)) return false;
      directoryNames.add(name);
    }
  }

  if (state.activeWorkspaceId === null || state.activeWorkspaceId === "built-in-demo") return true;
  if (typeof state.activeWorkspaceId !== "string" || !workspaceIds.has(state.activeWorkspaceId)) return false;
  const activeCopy = state.copies.find((copy) => copy.id === state.activeWorkspaceId);
  return !activeCopy || activeCopy.baselineState === "opened" && activeCopy.status === "active";
}

function validCreateOperations(operations) {
  const operationIds = new Set();
  const workspaceIds = new Set();
  const stagingNames = new Set();
  for (const operation of operations) {
    if (!validCreateOperation(operation)
      || operationIds.has(operation.operationId)
      || workspaceIds.has(operation.workspaceId)
      || stagingNames.has(operation.stagingName)) return false;
    operationIds.add(operation.operationId);
    workspaceIds.add(operation.workspaceId);
    stagingNames.add(operation.stagingName);
  }
  return true;
}

function validCopyRecord(record) {
  return record?.kind === "disposable-copy"
    && /^disposable-[0-9a-f-]{36}$/.test(record.id || "")
    && record.directoryName === `copy-${record.id.slice("disposable-".length)}`
    && typeof record.name === "string"
    && typeof record.rootPath === "string"
    && path.isAbsolute(record.rootPath)
    && validDigest(record.rootIdentity)
    && typeof record.sourceRootPath === "string"
    && path.isAbsolute(record.sourceRootPath)
    && validDigest(record.sourceRootIdentity)
    && validSourceManifest(record.sourceManifest)
    && canonicalPath(record.sourceRootPath) === canonicalPath(record.sourceManifest.rootPath)
    && record.sourceRootIdentity === record.sourceManifest.rootIdentity
    && validDigest(record.targetPayloadDigest)
    && validDigest(record.targetIdentityDigest)
    && /^[0-9a-f-]{36}$/.test(record.markerNonce || "")
    && ["sealed", "opened"].includes(record.baselineState)
    && ["ready", "active", "cleanup-pending"].includes(record.status)
    && typeof record.createdAt === "string"
    && typeof record.updatedAt === "string";
}

function validOriginalRecord(record) {
  return record?.kind === "original-readonly"
    && /^original-[a-f0-9]{24}$/.test(record.id || "")
    && typeof record.name === "string"
    && typeof record.rootPath === "string"
    && path.isAbsolute(record.rootPath)
    && validDigest(record.rootIdentity)
    && typeof record.createdAt === "string"
    && typeof record.updatedAt === "string";
}

function validCleanupRecord(record) {
  const cleanup = record?.cleanup;
  return validCopyRecord(record)
    && record.status === "cleanup-pending"
    && cleanup
    && ["reserved", "quarantined"].includes(cleanup.phase)
    && new RegExp(`^\\.${escapeRegExp(record.directoryName)}\\.cleanup-[0-9a-f-]{36}$`).test(cleanup.quarantineName)
    && cleanup.sourceRootIdentity === record.rootIdentity
    && validDirectoryEntity(cleanup.sourceEntity)
    && (cleanup.phase === "reserved"
      ? cleanup.quarantineRootIdentity === null
      : validDigest(cleanup.quarantineRootIdentity))
    && typeof cleanup.createdAt === "string"
    && typeof cleanup.updatedAt === "string";
}

function validDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function canonicalPath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithin(child, parent) {
  const rel = path.relative(parent, child);
  return rel === ""
    || rel !== ".."
      && !rel.startsWith(`..${path.sep}`)
      && !path.isAbsolute(rel);
}

async function workspaceMatches(rootPath, identity) {
  try {
    return (await captureWorkspaceIdentity(rootPath)).digest === identity;
  } catch {
    return false;
  }
}

async function readStableJsonFile(filePath, { missing = undefined, requirePrivate = false } = {}) {
  let before;
  try {
    before = await fs.lstat(filePath, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT" && missing !== undefined) return missing;
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
    throw workspaceError("WORKSPACE_STATE_FILE_UNSAFE", "A private workspace state file is linked or is not a normal file.");
  }
  if (requirePrivate && process.platform !== "win32" && (before.mode & 0o077n) !== 0n) {
    throw workspaceError("WORKSPACE_STATE_FILE_UNSAFE", "A private workspace state file has unsafe group or world permissions.");
  }
  const handle = await fs.open(filePath, "r");
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameFileEntity(before, opened) || !opened.isFile() || opened.nlink !== 1n) {
      throw workspaceError("WORKSPACE_STATE_FILE_UNSAFE", "A private workspace state file changed while it was opened.");
    }
    const raw = await handle.readFile("utf8");
    const after = await handle.stat({ bigint: true });
    const pathAfter = await fs.lstat(filePath, { bigint: true });
    if (!sameStableFileStat(opened, after) || !sameFileEntity(opened, pathAfter)) {
      throw workspaceError("WORKSPACE_STATE_FILE_UNSAFE", "A private workspace state file changed while it was read.");
    }
    return JSON.parse(raw);
  } finally {
    await handle.close();
  }
}

function sameFileEntity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs;
}

function sameStableFileStat(left, right) {
  return sameFileEntity(left, right)
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

async function fileExists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function workspaceError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
