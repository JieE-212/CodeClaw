import path from "node:path";
import { WorkspaceCapabilityStore } from "../../packages/workspace-capability/src/index.js";

export function createWorkspaceCapabilityStore({ stateDir, copyRoot, demoPath = path.resolve("examples", "demo-js") }) {
  return new WorkspaceCapabilityStore({
    storagePath: path.join(stateDir, "workspace-capabilities.json"),
    copyRootPath: copyRoot,
    demoPath
  });
}

export async function createActivatedWorkspace({ sourcePath, store = null, stateDir = "", copyRoot = "", demoPath }) {
  const capabilityStore = store || createWorkspaceCapabilityStore({ stateDir, copyRoot, demoPath });
  await capabilityStore.initialize();
  const preview = await capabilityStore.previewCopy(sourcePath);
  if (!preview.eligible) {
    const details = preview.blockers.map((item) => `${item.path}: ${item.reason}`).join(", ");
    throw new Error(`Disposable workspace fixture is not eligible: ${details || "unknown data-boundary blocker"}`);
  }
  const created = await capabilityStore.createCopy(preview);
  const workspace = await capabilityStore.activate({
    workspaceId: created.id,
    workspaceDigest: created.workspaceDigest
  });
  return { store: capabilityStore, workspace, rootPath: workspace.rootPath };
}

export async function activateRegisteredWorkspace(store, workspaceId) {
  const listed = await store.list();
  const workspace = listed.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) throw new Error(`Unknown workspace fixture: ${workspaceId}`);
  return store.activate({ workspaceId, workspaceDigest: workspace.workspaceDigest });
}

export async function registerReadonlyWorkspace({ rootPath, stateDir, copyRoot, demoPath }) {
  const store = createWorkspaceCapabilityStore({ stateDir, copyRoot, demoPath });
  await store.initialize();
  const workspace = await store.register(rootPath);
  if (workspace.kind !== "original-readonly") {
    throw new Error(`Expected a read-only foreign workspace, received ${workspace.kind}.`);
  }
  return { store, workspace };
}
