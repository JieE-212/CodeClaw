import { WorkspaceCapabilityStore } from "../../packages/workspace-capability/src/index.js";

const [mode, phase, storagePath, copyRootPath, demoPath, value] = process.argv.slice(2);
const store = new WorkspaceCapabilityStore({ storagePath, copyRootPath, demoPath });

const writeState = store.writeState.bind(store);
store.writeState = async (state) => {
  await writeState(state);
  const reachedCreatePhase = ["create", "recover"].includes(mode)
    && state.operations.some((operation) => operation.phase === phase);
  const reachedCleanupPhase = mode === "cleanup"
    && state.copies.some((copy) => copy.id === value && copy.status === "cleanup-pending" && copy.cleanup?.phase === phase);
  if (reachedCreatePhase || reachedCleanupPhase) process.exit(86);
};

await store.initialize();

if (mode === "create") {
  const preview = await store.previewCopy(value);
  await store.createCopy(preview);
} else if (mode === "cleanup") {
  const listed = await store.list();
  const workspace = listed.workspaces.find((item) => item.id === value);
  if (!workspace) throw new Error(`Unknown cleanup workspace: ${value}`);
  await store.cleanup({ workspaceId: workspace.id, workspaceDigest: workspace.workspaceDigest });
} else if (mode === "recover") {
  throw new Error(`Lifecycle recovery did not stop at ${phase}.`);
} else {
  throw new Error(`Unknown lifecycle mode: ${mode}`);
}

throw new Error(`Lifecycle child did not stop at ${mode}:${phase}.`);
