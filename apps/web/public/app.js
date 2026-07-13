import { initI18n, t } from "./i18n.js";
import { visualizeModelReviewBody } from "./model-review-text.js";

const launcherPageIdentity = readLauncherPageIdentity();

const healthStatus = document.querySelector("#healthStatus");
const navItems = [...document.querySelectorAll("[data-nav-view]")];
const viewPanels = [...document.querySelectorAll("[data-view]")];
const viewEyebrow = document.querySelector("#viewEyebrow");
const viewTitle = document.querySelector("#viewTitle");
const languageSelect = document.querySelector("#languageSelect");
const repoPath = document.querySelector("#repoPath");
const pathHelper = document.querySelector("#pathHelper");
const pathHelperCopy = document.querySelector("#pathHelperCopy");
const pathMode = document.querySelector("#pathMode");
const scanButton = document.querySelector("#scanButton");
const cancelScanButton = document.querySelector("#cancelScanButton");
const examplePathButton = document.querySelector("#examplePathButton");
const demoButton = document.querySelector("#demoButton");
const preflightButton = document.querySelector("#preflightButton");
const cancelPreflightButton = document.querySelector("#cancelPreflightButton");
const preflightState = document.querySelector("#preflightState");
const preflightOutput = document.querySelector("#preflightOutput");
const workspaceState = document.querySelector("#workspaceState");
const workspaceCapability = document.querySelector("#workspaceCapability");
const previewCopyButton = document.querySelector("#previewCopyButton");
const createCopyButton = document.querySelector("#createCopyButton");
const refreshWorkspacesButton = document.querySelector("#refreshWorkspacesButton");
const copyPreviewOutput = document.querySelector("#copyPreview");
const workspaceList = document.querySelector("#workspaceList");
const recentRepos = document.querySelector("#recentRepos");
const systemCheck = document.querySelector("#systemCheck");
const planButton = document.querySelector("#planButton");
const clearButton = document.querySelector("#clearButton");
const completeTaskButton = document.querySelector("#completeTaskButton");
const goalInput = document.querySelector("#goalInput");
const scanState = document.querySelector("#scanState");
const repoSummary = document.querySelector("#repoSummary");
const contextOutput = document.querySelector("#contextOutput");
const timeline = document.querySelector("#timeline");
const planIntent = document.querySelector("#planIntent");
const toolSelect = document.querySelector("#toolSelect");
const toolArg = document.querySelector("#toolArg");
const callToolButton = document.querySelector("#callToolButton");
const toolOutput = document.querySelector("#toolOutput");
const toolState = document.querySelector("#toolState");
const verifyCommandSelect = document.querySelector("#verifyCommandSelect");
const runVerifyButton = document.querySelector("#runVerifyButton");
const cancelVerifyButton = document.querySelector("#cancelVerifyButton");
const fixFailureButton = document.querySelector("#fixFailureButton");
const verifyOutput = document.querySelector("#verifyOutput");
const verifyState = document.querySelector("#verifyState");
const auditList = document.querySelector("#auditList");
const auditState = document.querySelector("#auditState");
const taskSummary = document.querySelector("#taskSummary");
const taskState = document.querySelector("#taskState");
const reviewDraft = document.querySelector("#reviewDraft");
const memoryState = document.querySelector("#memoryState");
const memoryOutput = document.querySelector("#memoryOutput");
const memoryNotes = document.querySelector("#memoryNotes");
const saveMemoryButton = document.querySelector("#saveMemoryButton");
const refreshMemoryButton = document.querySelector("#refreshMemoryButton");
const modelPreset = document.querySelector("#modelPreset");
const modelType = document.querySelector("#modelType");
const modelBaseUrl = document.querySelector("#modelBaseUrl");
const modelName = document.querySelector("#modelName");
const modelApiKey = document.querySelector("#modelApiKey");
const saveModelButton = document.querySelector("#saveModelButton");
const suggestButton = document.querySelector("#suggestButton");
const contextButton = document.querySelector("#contextButton");
const readContextButton = document.querySelector("#readContextButton");
const contextCandidates = document.querySelector("#contextCandidates");
const modelOutput = document.querySelector("#modelOutput");
const modelState = document.querySelector("#modelState");
const modelCostHint = document.querySelector("#modelCostHint");
const cancelModelOperationButton = document.querySelector("#cancelModelOperationButton");
const modelOutboundReview = document.querySelector("#modelOutboundReview");
const modelReviewClose = document.querySelector("#modelReviewClose");
const modelReviewOperation = document.querySelector("#modelReviewOperation");
const modelReviewProvider = document.querySelector("#modelReviewProvider");
const modelReviewChannel = document.querySelector("#modelReviewChannel");
const modelReviewLeavesDevice = document.querySelector("#modelReviewLeavesDevice");
const modelReviewEndpoint = document.querySelector("#modelReviewEndpoint");
const modelReviewExpires = document.querySelector("#modelReviewExpires");
const modelReviewBytes = document.querySelector("#modelReviewBytes");
const modelReviewSha = document.querySelector("#modelReviewSha");
const modelReviewBody = document.querySelector("#modelReviewBody");
const modelReviewControlWarning = document.querySelector("#modelReviewControlWarning");
const modelReviewDataClasses = document.querySelector("#modelReviewDataClasses");
const modelReviewFiles = document.querySelector("#modelReviewFiles");
const modelReviewStatus = document.querySelector("#modelReviewStatus");
const modelReviewCancel = document.querySelector("#modelReviewCancel");
const modelReviewApprove = document.querySelector("#modelReviewApprove");
const proposePatchButton = document.querySelector("#proposePatchButton");
const applyPatchButton = document.querySelector("#applyPatchButton");
const revertPatchButton = document.querySelector("#revertPatchButton");
const revertPatchSelect = document.querySelector("#revertPatchSelect");
const patchOutput = document.querySelector("#patchOutput");
const patchState = document.querySelector("#patchState");
const patchGate = document.querySelector("#patchGate");
const applyReview = document.querySelector("#applyReview");
const workflowSteps = document.querySelector("#workflowSteps");
const workflowState = document.querySelector("#workflowState");
const workflowNext = document.querySelector("#workflowNext");
const workflowPrimary = document.querySelector("#workflowPrimary");
const workflowSecondary = document.querySelector("#workflowSecondary");
const workflowStatus = document.querySelector("#workflowStatus");
const workflowMode = document.querySelector("#workflowMode");
const preflightReceipt = document.querySelector("#preflightReceipt");
const sessionRecovery = document.querySelector("#sessionRecovery");
const sessionRecoveryTitle = document.querySelector("#sessionRecoveryTitle");
const sessionRecoveryBody = document.querySelector("#sessionRecoveryBody");
const continueSessionButton = document.querySelector("#continueSessionButton");
const startFreshButton = document.querySelector("#startFreshButton");
const verifyBoundary = document.querySelector("#verifyBoundary");
let repoProfile = null;
let currentTask = null;
let currentMemory = null;
let currentPreflight = null;
let currentAuditEvents = [];
let currentModelStatus = null;
let suggestedContextFiles = [];
let systemInfo = null;
let currentWorkspace = null;
let disposableCopyPreview = null;
let knownWorkspaces = [];
let workspaceNotice = null;
let activeView = "workspace";
let pendingSessionPayload = null;
let sessionRecoveryMode = "hidden";
let sessionRestoreSuperseded = false;
let workflowGeneration = 0;
let activeModelReview = null;
let resolveModelReview = null;
let modelReviewFocusFallback = null;
const activeOperations = new Map();
const EXPERIENCE_MODES = new Set(["beginner", "advanced"]);
const workflowModel = {
  mode: "beginner",
  currentStep: "project",
  demoRequested: false,
  primaryAction: null,
  secondaryAction: null
};
const DYNAMIC_I18N_KEYS = Object.freeze([
  "applyBoundary.body",
  "applyReview.rollback.body",
  "applyReview.writeWarning.body",
  "model.review.channel.local",
  "model.review.channel.loopback",
  "model.review.channel.network",
  "model.review.operation.contextFiles",
  "model.review.operation.failureFix",
  "model.review.operation.patchProposal",
  "model.review.operation.taskSuggest",
  "model.review.warning.body",
  "runtimeBudget.complete",
  "runtimeBudget.partial",
  "model.apiKey.placeholder",
  "model.cost.custom.detail",
  "model.cost.custom.level",
  "model.cost.custom.title",
  "model.cost.dashscope.detail",
  "model.cost.dashscope.level",
  "model.cost.dashscope.title",
  "model.cost.flash.detail",
  "model.cost.flash.level",
  "model.cost.flash.title",
  "model.cost.mock.detail",
  "model.cost.mock.level",
  "model.cost.mock.title",
  "model.cost.openai.detail",
  "model.cost.openai.level",
  "model.cost.openai.title",
  "model.cost.pro.detail",
  "model.cost.pro.level",
  "model.cost.pro.title",
  "patch.failure.missingContextContent.body",
  "patch.failure.missingContextContent.state",
  "patch.failure.missingTestContext.body",
  "patch.failure.missingTestContext.state",
  "patch.failure.unsupportedGoal.body",
  "patch.failure.unsupportedGoal.state",
  "path.mode.copy.body",
  "path.mode.copy.title",
  "path.mode.demo.body",
  "path.mode.demo.title",
  "path.mode.empty.body",
  "path.mode.empty.title",
  "path.mode.example.body",
  "path.mode.example.title",
  "path.mode.real.body",
  "path.mode.real.title",
  "path.mode.unverified.body",
  "path.mode.unverified.title",
  "preflight.autoProgress.body",
  "preflight.restored.body",
  "preflight.restored.state",
  "session.context.state",
  "session.recovery.pending.body",
  "session.recovery.pending.title",
  "session.recovery.restored.body",
  "session.recovery.restored.title",
  "trust.confirm.body",
  "trust.local.body",
  "trust.preflight.body",
  "workflow.boundary.command.body",
  "workflow.boundary.network.body",
  "workflow.boundary.read.body",
  "workflow.boundary.state.body",
  "workflow.boundary.write.body",
  "workflow.impact.state",
  "workflow.receipt.body",
  "workspace.capability.copy.body",
  "workspace.capability.demo.body",
  "workspace.capability.empty.body",
  "workspace.capability.invalid.body",
  "workspace.capability.original.body",
  "workspace.disclosure.body",
  "workspace.preview.blocked",
  "workspace.preview.eligible"
]);
const RECENT_REPOS_KEY = "codeclaw.recentRepos.v1";
const MODEL_PRESETS = {
  mock: { type: "mock", baseUrl: "", model: "mock-codeclaw", apiKeyPlaceholderKey: "model.apiKey.placeholder" },
  dashscope: { type: "openai-compatible", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", apiKeyPlaceholderKey: "model.apiKey.placeholder" },
  "deepseek-pro": { type: "openai-compatible", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro", apiKeyPlaceholderKey: "model.apiKey.placeholder" },
  "deepseek-flash": { type: "openai-compatible", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", apiKeyPlaceholderKey: "model.apiKey.placeholder" },
  openai: { type: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "", apiKeyPlaceholderKey: "model.apiKey.placeholder" },
  custom: { type: "openai-compatible", baseUrl: "", model: "", apiKeyPlaceholderKey: "model.apiKey.placeholder" }
};
const MODEL_COST_PROFILES = {
  mock: {
    levelKey: "model.cost.mock.level",
    titleKey: "model.cost.mock.title",
    detailKey: "model.cost.mock.detail",
    badge: "safe"
  },
  dashscope: {
    levelKey: "model.cost.dashscope.level",
    titleKey: "model.cost.dashscope.title",
    detailKey: "model.cost.dashscope.detail",
    badge: "normal"
  },
  "deepseek-flash": {
    levelKey: "model.cost.flash.level",
    titleKey: "model.cost.flash.title",
    detailKey: "model.cost.flash.detail",
    badge: "recommended"
  },
  "deepseek-pro": {
    levelKey: "model.cost.pro.level",
    titleKey: "model.cost.pro.title",
    detailKey: "model.cost.pro.detail",
    badge: "costly"
  },
  openai: {
    levelKey: "model.cost.openai.level",
    titleKey: "model.cost.openai.title",
    detailKey: "model.cost.openai.detail",
    badge: "normal"
  },
  custom: {
    levelKey: "model.cost.custom.level",
    titleKey: "model.cost.custom.title",
    detailKey: "model.cost.custom.detail",
    badge: "normal"
  }
};
let recentRepoItems = loadRecentRepos();
let launcherPageLocked = false;

initI18n({ select: languageSelect });
boot();
syncToolInputs();
bindNavigation();
bindI18n();
bindWorkflow();
bindSessionRecovery();
bindWorkspaceSafety();
bindModelOutboundReview();
setActiveView(activeView);
renderRecentRepos();
renderPathHelperForInput(repoPath?.value || "");
renderPathModeForInput(repoPath?.value || "");
renderVerifyBoundary();
renderWorkspaceSafety();
renderWorkflow();
updateControls();

async function boot() {
  try {
    const health = await request("/api/health");
    assertLauncherPageIdentity(health);
    healthStatus.textContent = health.ok ? t("health.online") : t("health.error");
    healthStatus.classList.toggle("ok", Boolean(health.ok));
    systemInfo = await request("/api/system/check");
    renderSystemCheck(systemInfo);
    renderPathModeForInput(repoPath?.value || "");
    await refreshWorkspaces({ adoptActive: true, silent: true });
    await refreshModelStatus();
    await restoreLastSession();
    await refreshAudit();
  } catch (error) {
    if (error?.code === "LAUNCHER_PAGE_IDENTITY_MISMATCH") {
      lockInterfaceForLauncherMismatch();
      return;
    }
    healthStatus.textContent = t("health.offline");
    renderSystemCheck(null, t("system.offline.detail"));
  }
}

function assertLauncherPageIdentity(health) {
  if (!launcherPageIdentity.supplied && health?.launcherProtocol !== 1) return;
  if (!launcherPageIdentity.candidateId || !launcherPageIdentity.instanceId
    || health?.launcherProtocol !== 1
    || health?.candidateId !== launcherPageIdentity.candidateId
    || health?.instanceId !== launcherPageIdentity.instanceId) {
    const error = new Error("The browser URL does not match the running CodeClaw candidate.");
    error.code = "LAUNCHER_PAGE_IDENTITY_MISMATCH";
    throw error;
  }
  document.body.dataset.launchIdentity = "verified";
}

function readLauncherPageIdentity() {
  const parameters = new URLSearchParams(window.location.search);
  const candidateId = parameters.get("candidate");
  const instanceId = parameters.get("instance");
  return Object.freeze({
    supplied: candidateId !== null || instanceId !== null,
    candidateId: candidateId || "",
    instanceId: instanceId || ""
  });
}

function lockInterfaceForLauncherMismatch() {
  launcherPageLocked = true;
  document.body.dataset.launchIdentity = "mismatch";
  enforceLauncherPageLock();
  healthStatus.textContent = t("health.launchIdentityMismatch");
  healthStatus.classList.remove("ok");
  renderSystemCheck(null, t("health.launchIdentityMismatch"));
  if (workflowStatus) workflowStatus.textContent = t("health.launchIdentityMismatch");
}

function enforceLauncherPageLock() {
  if (!launcherPageLocked) return;
  for (const control of document.querySelectorAll("button, input, select, textarea")) control.disabled = true;
}

function renderSystemCheck(info, error = "") {
  if (!systemCheck) return;
  if (error) {
    systemCheck.className = "system-check error";
    systemCheck.textContent = error;
    return;
  }
  if (!info) {
    systemCheck.className = "system-check";
    systemCheck.textContent = t("system.checking");
    return;
  }
  const demoState = info.demoExists ? t("system.demo.available") : t("system.demo.missing");
  const model = info.model?.configured ? `${info.model.type}:${info.model.model}` : t("system.model.unconfigured");
  const recovery = info.recovery?.ok === false ? t("system.recovery.blocked") : t("system.recovery.ready");
  const candidate = info.launcher
    ? `CodeClaw ${info.launcher.packageVersion} / ${String(info.launcher.sourceCommit || "").slice(0, 12)} / ${info.launcher.candidateId}`
    : "";
  systemCheck.className = `system-check ${info.demoExists && info.recovery?.ok !== false ? "ok" : "warn"}`;
  systemCheck.textContent = [candidate, info.node, demoState, model, recovery].filter(Boolean).join(" / ");
}

function bindNavigation() {
  for (const item of navItems) {
    item.addEventListener("click", () => setActiveView(item.dataset.navView));
  }
}

function bindI18n() {
  window.addEventListener("codeclaw:languagechange", () => {
    setActiveView(activeView);
    renderSystemCheck(systemInfo);
    renderRecentRepos();
    renderPathHelperForInput(repoPath?.value || "");
    renderPathModeForInput(repoPath?.value || "");
    renderPreflightReport(currentPreflight);
    renderTask(currentTask);
    if (currentModelStatus) renderModelStatus(currentModelStatus);
    else renderModelCostHint();
    renderAudit(currentAuditEvents);
    renderSessionRecovery();
    renderVerifyBoundary();
    renderWorkspaceSafety();
    renderWorkflow();
    if (activeModelReview) renderModelOutboundReview(activeModelReview);
    syncToolInputs();
    updateControls();
  });
}

function bindWorkflow() {
  workflowMode?.addEventListener("change", (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    if (!input || input.name !== "experienceMode" || !EXPERIENCE_MODES.has(input.value)) return;
    workflowModel.mode = input.value;
    syncVisibility();
    renderWorkflow();
  });
  workflowPrimary?.addEventListener("click", () => workflowModel.primaryAction?.());
  workflowSecondary?.addEventListener("click", () => workflowModel.secondaryAction?.());
}

function setActiveView(view) {
  activeView = view || "workspace";
  syncVisibility();
  const copy = {
    workspace: [t("view.workspace.eyebrow"), t("view.workspace.title")],
    memory: [t("view.memory.eyebrow"), t("view.memory.title")],
    audit: [t("view.audit.eyebrow"), t("view.audit.title")],
    settings: [t("view.settings.eyebrow"), t("view.settings.title")]
  }[activeView] || ["CodeClaw", t("view.workspace.title")];
  if (viewEyebrow) viewEyebrow.textContent = copy[0];
  if (viewTitle) viewTitle.textContent = copy[1];
  renderSessionRecovery();
}

function syncVisibility() {
  document.body.dataset.activeView = activeView;
  document.body.dataset.experienceMode = workflowModel.mode;
  for (const item of navItems) {
    const current = item.dataset.navView === activeView;
    item.classList.toggle("active", current);
    if (current) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  }
  for (const panel of viewPanels) {
    const views = String(panel.dataset.view || "").split(/\s+/);
    const advancedOnly = panel.dataset.experience === "advanced";
    panel.hidden = !views.includes(activeView) || (advancedOnly && workflowModel.mode !== "advanced");
  }
  for (const element of document.querySelectorAll("[data-experience='advanced']:not([data-view])")) {
    element.hidden = workflowModel.mode !== "advanced";
  }
  for (const input of workflowMode?.querySelectorAll("input[name='experienceMode']") || []) {
    input.checked = input.value === workflowModel.mode;
  }
}

function bindSessionRecovery() {
  continueSessionButton?.addEventListener("click", () => {
    if (!pendingSessionPayload) return;
    const payload = pendingSessionPayload;
    pendingSessionPayload = null;
    hydrateRestoredSession(payload);
  });
  startFreshButton?.addEventListener("click", () => startFreshClientWorkflow());
}

function bindWorkspaceSafety() {
  previewCopyButton?.addEventListener("click", previewDisposableCopy);
  createCopyButton?.addEventListener("click", createDisposableCopy);
  refreshWorkspacesButton?.addEventListener("click", () => refreshWorkspaces({ adoptActive: false }));
  workspaceList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-workspace-action]");
    if (!button) return;
    const workspace = knownWorkspaces.find((item) => workspaceIdentifier(item) === button.dataset.workspaceId);
    if (!workspace) return;
    if (button.dataset.workspaceAction === "activate") activateWorkspace(workspace);
    if (button.dataset.workspaceAction === "cleanup") cleanupWorkspace(workspace);
  });
}

async function previewDisposableCopy() {
  if (currentWorkspace?.kind !== "original-readonly" || !currentWorkspace.rootPath) {
    workspaceNotice = { severity: "warn", message: t("workspace.error.originalRequired") };
    renderWorkspaceSafety();
    return;
  }

  const target = captureWorkflowTarget(false);
  previewCopyButton.disabled = true;
  disposableCopyPreview = null;
  workspaceNotice = { severity: "pending", message: t("workspace.preview.running") };
  renderWorkspaceSafety();
  try {
    const payload = await request("/api/workspaces/copy/preview", { sourcePath: currentWorkspace.rootPath });
    if (!workflowTargetIsCurrent(target)) return;
    disposableCopyPreview = payload.preview || null;
    workspaceNotice = null;
  } catch (error) {
    if (!workflowTargetIsCurrent(target)) return;
    workspaceNotice = { severity: "error", message: friendlyErrorMessage(error) };
  } finally {
    renderWorkspaceSafety();
    updateControls();
  }
}

async function createDisposableCopy() {
  const preview = disposableCopyPreview;
  if (!preview?.previewId || !preview?.previewDigest) {
    workspaceNotice = { severity: "warn", message: t("workspace.error.previewRequired") };
    renderWorkspaceSafety();
    return;
  }
  if (!preview.eligible || preview.blockers?.length) {
    workspaceNotice = { severity: "error", message: t("workspace.error.previewBlocked") };
    renderWorkspaceSafety();
    return;
  }

  const target = captureWorkflowTarget(false);
  createCopyButton.disabled = true;
  workspaceNotice = { severity: "pending", message: t("workspace.create.running") };
  renderWorkspaceSafety();
  try {
    const payload = await request("/api/workspaces/copy/create", {
      previewId: preview.previewId,
      previewDigest: preview.previewDigest
    });
    if (!workflowTargetIsCurrent(target)) return;
    if (payload.workspace) mergeKnownWorkspace(payload.workspace);
    disposableCopyPreview = null;
    workspaceNotice = { severity: "ok", message: t("workspace.notice.created") };
    await refreshWorkspaces({ adoptActive: false, silent: true });
  } catch (error) {
    if (!workflowTargetIsCurrent(target)) return;
    workspaceNotice = { severity: "error", message: friendlyErrorMessage(error) };
  } finally {
    renderWorkspaceSafety();
    updateControls();
  }
}

async function refreshWorkspaces({ adoptActive = false, silent = false } = {}) {
  if (refreshWorkspacesButton) refreshWorkspacesButton.disabled = true;
  try {
    const payload = await request("/api/workspaces");
    knownWorkspaces = Array.isArray(payload.workspaces) ? payload.workspaces.filter(isServerWorkspace) : [];
    const active = resolveActiveWorkspace(payload.active, knownWorkspaces);
    if (adoptActive) {
      if (active) adoptServerWorkspace(active, { syncPath: Boolean(active.rootPath) });
      else clearWorkspaceAuthority();
    } else if (currentWorkspace) {
      const refreshed = knownWorkspaces.find((item) => workspaceIdentifier(item) === workspaceIdentifier(currentWorkspace));
      if (refreshed) currentWorkspace = { ...refreshed, active: Boolean(refreshed.active || active && workspaceIdentifier(active) === workspaceIdentifier(refreshed)) };
    }
    renderWorkspaceSafety();
    return payload;
  } catch (error) {
    if (!silent) workspaceNotice = { severity: "error", message: friendlyErrorMessage(error) };
    renderWorkspaceSafety();
    return null;
  } finally {
    if (refreshWorkspacesButton) refreshWorkspacesButton.disabled = false;
  }
}

async function activateWorkspace(workspace) {
  const workspaceId = workspaceIdentifier(workspace);
  if (!workspaceId || !workspace.workspaceDigest) return;
  advanceWorkflowGeneration();
  const target = captureWorkflowTarget(false);
  workspaceNotice = { severity: "pending", message: t("workspace.activate.running") };
  renderWorkspaceSafety();
  try {
    const payload = await request("/api/workspaces/activate", {
      workspaceId,
      workspaceDigest: workspace.workspaceDigest
    });
    if (!workflowTargetIsCurrent(target)) return;
    advanceWorkflowGeneration();
    const goal = goalInput.value;
    resetWorkspaceBoundState();
    goalInput.value = goal;
    adoptServerWorkspace(payload.workspace, { syncPath: true });
    repoProfile = payload.profile || null;
    if (repoProfile) {
      renderRepoSummary(repoProfile);
      renderVerifyCommands(repoProfile.commands || []);
      rememberRepo(repoProfile);
    }
    disposableCopyPreview = null;
    workspaceNotice = { severity: "ok", message: t("workspace.notice.activated") };
    scanState.textContent = t("workspace.activation.needsPreflight");
    renderPreflightReport(null);
    renderWorkspaceSafety();
    renderWorkflow();
    updateControls();
  } catch (error) {
    if (!workflowTargetIsCurrent(target)) return;
    workspaceNotice = { severity: "error", message: friendlyErrorMessage(error) };
    renderWorkspaceSafety();
  }
}

async function cleanupWorkspace(workspace) {
  const workspaceId = workspaceIdentifier(workspace);
  if (workspace.kind !== "disposable-copy" || !workspaceId || !workspace.workspaceDigest) return;
  if (isActiveWorkspace(workspace)) {
    workspaceNotice = { severity: "warn", message: t("workspace.cleanup.activeBlocked") };
    renderWorkspaceSafety();
    return;
  }
  const approved = window.confirm([
    t("workspace.cleanup.confirm.title", { name: workspace.name || t("workspace.kind.copy") }),
    "",
    t("workspace.cleanup.confirm.delete"),
    t("workspace.cleanup.confirm.original"),
    t("workspace.cleanup.confirm.ownership")
  ].join("\n"));
  if (!approved) return;

  workspaceNotice = { severity: "pending", message: t("workspace.cleanup.running") };
  renderWorkspaceSafety();
  try {
    await request("/api/workspaces/cleanup", {
      workspaceId,
      workspaceDigest: workspace.workspaceDigest,
      approved: true
    });
    knownWorkspaces = knownWorkspaces.filter((item) => workspaceIdentifier(item) !== workspaceId);
    workspaceNotice = { severity: "ok", message: t("workspace.notice.cleaned") };
    await refreshWorkspaces({ adoptActive: true, silent: true });
  } catch (error) {
    workspaceNotice = { severity: "error", message: friendlyErrorMessage(error) };
  } finally {
    renderWorkspaceSafety();
    updateControls();
  }
}

function resolveActiveWorkspace(active, workspaces) {
  if (isServerWorkspace(active)) return active;
  const activeId = typeof active === "string" ? active : active?.workspaceId || active?.id;
  return workspaces.find((item) => item.active || activeId && workspaceIdentifier(item) === activeId) || null;
}

function mergeKnownWorkspace(workspace) {
  if (!isServerWorkspace(workspace)) return;
  const id = workspaceIdentifier(workspace);
  knownWorkspaces = [workspace, ...knownWorkspaces.filter((item) => workspaceIdentifier(item) !== id)];
}

function adoptServerWorkspace(workspace, { syncPath = false } = {}) {
  if (!isServerWorkspace(workspace)) {
    clearWorkspaceAuthority();
    return;
  }
  currentWorkspace = workspace;
  mergeKnownWorkspace(workspace);
  if (syncPath && workspace.rootPath) repoPath.value = workspace.rootPath;
  renderPathModeForInput(repoPath.value);
  renderWorkspaceSafety();
}

function clearWorkspaceAuthority() {
  currentWorkspace = null;
  disposableCopyPreview = null;
  workspaceNotice = null;
  renderPathModeForInput(repoPath?.value || "");
  renderWorkspaceSafety();
}

function isServerWorkspace(workspace) {
  return Boolean(workspace && ["built-in-demo", "original-readonly", "disposable-copy"].includes(workspace.kind) && workspaceIdentifier(workspace));
}

function workspaceIdentifier(workspace) {
  return String(workspace?.workspaceId || workspace?.id || "");
}

function isActiveWorkspace(workspace) {
  return Boolean(workspace?.active);
}

function workspaceCanWrite() {
  return Boolean(currentWorkspace?.canWrite === true && ["built-in-demo", "disposable-copy"].includes(currentWorkspace.kind) && !workspaceStatusInvalid(currentWorkspace.status));
}

function workspaceCanRunCommands() {
  return Boolean(currentWorkspace?.canRunCommands === true && ["built-in-demo", "disposable-copy"].includes(currentWorkspace.kind) && !workspaceStatusInvalid(currentWorkspace.status));
}

function workspaceStatusInvalid(status) {
  return ["invalid", "blocked", "missing", "tampered", "unverified", "unavailable", "cleanup-pending"].includes(String(status || "").toLowerCase());
}

function renderWorkspaceSafety() {
  renderWorkspaceCapability();
  renderCopyPreview();
  renderWorkspaceList();
  if (previewCopyButton) previewCopyButton.disabled = currentWorkspace?.kind !== "original-readonly" || workspaceStatusInvalid(currentWorkspace?.status);
  if (createCopyButton) createCopyButton.disabled = !disposableCopyPreview?.eligible || !disposableCopyPreview?.previewId || !disposableCopyPreview?.previewDigest || Boolean(disposableCopyPreview?.blockers?.length);
}

function renderWorkspaceCapability() {
  if (!workspaceCapability || !workspaceState) return;
  if (!currentWorkspace) {
    workspaceState.textContent = t("workspace.state.unverified");
    workspaceCapability.className = "workspace-capability empty";
    workspaceCapability.innerHTML = `<strong>${escapeHtml(t("workspace.capability.empty.title"))}</strong><span>${escapeHtml(t("workspace.capability.empty.body"))}</span>`;
    return;
  }
  const copy = workspaceCapabilityCopy(currentWorkspace);
  workspaceState.textContent = copy.state;
  workspaceCapability.className = `workspace-capability ${copy.className}`;
  workspaceCapability.innerHTML = `
    <div><strong>${escapeHtml(copy.title)}</strong><span>${escapeHtml(copy.body)}</span></div>
    <dl>
      <div><dt>${escapeHtml(t("workspace.capability.write"))}</dt><dd>${escapeHtml(currentWorkspace.canWrite ? t("workspace.allowed") : t("workspace.denied"))}</dd></div>
      <div><dt>${escapeHtml(t("workspace.capability.command"))}</dt><dd>${escapeHtml(currentWorkspace.canRunCommands ? t("workspace.allowed") : t("workspace.denied"))}</dd></div>
      <div><dt>${escapeHtml(t("workspace.capability.status"))}</dt><dd>${escapeHtml(workspaceStatusLabel(currentWorkspace.status))}</dd></div>
    </dl>
    ${currentWorkspace.rootPath ? `<code>${escapeHtml(currentWorkspace.rootPath)}</code>` : ""}
  `;
}

function workspaceCapabilityCopy(workspace) {
  if (workspaceStatusInvalid(workspace.status)) return {
    className: "invalid",
    state: t("workspace.state.invalid"),
    title: t("workspace.capability.invalid.title"),
    body: t("workspace.capability.invalid.body")
  };
  if (workspace.kind === "built-in-demo") return {
    className: "demo",
    state: t("workspace.state.demo"),
    title: t("workspace.capability.demo.title"),
    body: t("workspace.capability.demo.body")
  };
  if (workspace.kind === "disposable-copy") return {
    className: "copy",
    state: t("workspace.state.copy"),
    title: t("workspace.capability.copy.title"),
    body: t("workspace.capability.copy.body")
  };
  return {
    className: "readonly",
    state: t("workspace.state.original"),
    title: t("workspace.capability.original.title"),
    body: t("workspace.capability.original.body")
  };
}

function workspaceStatusLabel(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "verified" || normalized === "ready") return t("workspace.status.verified");
  if (normalized === "read-only") return t("workspace.status.readonly");
  if (normalized === "active") return t("workspace.status.active");
  if (workspaceStatusInvalid(normalized)) return t("workspace.status.invalid");
  return status ? String(status) : t("workspace.status.unknown");
}

function renderCopyPreview() {
  if (!copyPreviewOutput) return;
  if (!disposableCopyPreview) {
    copyPreviewOutput.className = `copy-preview ${workspaceNotice?.severity || "empty"}`;
    copyPreviewOutput.innerHTML = `<strong>${escapeHtml(t("workspace.preview.title"))}</strong><span>${escapeHtml(workspaceNotice?.message || t("workspace.preview.empty"))}</span>`;
    return;
  }
  const preview = disposableCopyPreview;
  const blockers = Array.isArray(preview.blockers) ? preview.blockers : [];
  const excluded = Array.isArray(preview.excluded) ? preview.excluded : [];
  const ready = Boolean(preview.eligible && !blockers.length);
  copyPreviewOutput.className = `copy-preview ${ready ? "ready" : "blocked"}`;
  copyPreviewOutput.innerHTML = `
    <div class="copy-preview-head"><strong>${escapeHtml(t("workspace.preview.title"))}</strong><span>${escapeHtml(t(ready ? "workspace.preview.eligible" : "workspace.preview.blocked"))}</span></div>
    <div class="copy-preview-metrics">
      <div><strong>${escapeHtml(String(preview.fileCount || 0))}</strong><span>${escapeHtml(t("workspace.preview.files"))}</span></div>
      <div><strong>${escapeHtml(formatBytes(preview.totalBytes || 0))}</strong><span>${escapeHtml(t("workspace.preview.bytes"))}</span></div>
      <div><strong>${escapeHtml(String(excluded.length))}</strong><span>${escapeHtml(t("workspace.preview.excluded"))}</span></div>
      <div><strong>${escapeHtml(String(blockers.length))}</strong><span>${escapeHtml(t("workspace.preview.blockers"))}</span></div>
    </div>
    <p><strong>${escapeHtml(t("workspace.preview.source"))}</strong><span>${escapeHtml(preview.sourcePath || "-")}</span></p>
    <p><strong>${escapeHtml(t("workspace.preview.target"))}</strong><span>${escapeHtml(preview.targetParent || "-")}</span></p>
    ${excluded.length ? `<details><summary>${escapeHtml(t("workspace.preview.excludedDetail"))}</summary>${excluded.map((item) => `<code>${escapeHtml(formatWorkspaceIssue(item))}</code>`).join("")}</details>` : ""}
    ${blockers.length ? `<details open><summary>${escapeHtml(t("workspace.preview.blockerDetail"))}</summary>${blockers.map((item) => `<code>${escapeHtml(formatWorkspaceIssue(item))}</code>`).join("")}</details>` : ""}
  `;
}

function renderWorkspaceList() {
  if (!workspaceList) return;
  if (!knownWorkspaces.length) {
    workspaceList.innerHTML = `<div class="workspace-list-empty">${escapeHtml(t("workspace.list.empty"))}</div>`;
    return;
  }
  workspaceList.innerHTML = knownWorkspaces.map((workspace) => {
    const id = workspaceIdentifier(workspace);
    const active = isActiveWorkspace(workspace);
    const canCleanup = workspace.kind === "disposable-copy" && !active;
    return `
      <article class="workspace-list-item ${active ? "active" : ""}">
        <div class="workspace-list-copy">
          <strong>${escapeHtml(workspace.name || workspaceKindLabel(workspace.kind))}</strong>
          <span>${escapeHtml(workspaceKindLabel(workspace.kind))} · ${escapeHtml(active ? t("workspace.list.active") : workspaceStatusLabel(workspace.status))}</span>
          ${workspace.rootPath ? `<code>${escapeHtml(workspace.rootPath)}</code>` : ""}
        </div>
        <div class="workspace-list-actions">
          <button class="secondary" type="button" data-workspace-action="activate" data-workspace-id="${escapeHtml(id)}" ${active ? "disabled" : ""}>${escapeHtml(active ? t("workspace.list.active") : t("workspace.button.activate"))}</button>
          ${workspace.kind === "disposable-copy" ? `<button class="secondary danger" type="button" data-workspace-action="cleanup" data-workspace-id="${escapeHtml(id)}" ${canCleanup ? "" : `disabled title="${escapeHtml(t("workspace.cleanup.activeBlocked"))}"`}>${escapeHtml(t("workspace.button.cleanup"))}</button>` : ""}
        </div>
      </article>`;
  }).join("");
}

function workspaceKindLabel(kind) {
  if (kind === "built-in-demo") return t("workspace.kind.demo");
  if (kind === "disposable-copy") return t("workspace.kind.copy");
  return t("workspace.kind.original");
}

function formatWorkspaceIssue(item) {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return String(item || "-");
  return [item.path, item.reason || item.code, item.detail].filter(Boolean).join(" · ") || t("workspace.preview.unknownIssue");
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function loadRecentRepos() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_REPOS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item?.path).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function saveRecentRepos() {
  try {
    localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(recentRepoItems.slice(0, 5)));
  } catch {}
}

function rememberRepo(profile) {
  if (!profile?.rootPath) return;
  const item = {
    name: profile.name || profile.rootPath.split(/[\\/]/).filter(Boolean).at(-1) || "Repository",
    path: profile.rootPath,
    scannedAt: profile.scannedAt || new Date().toISOString()
  };
  recentRepoItems = [item, ...recentRepoItems.filter((repo) => repo.path !== item.path)].slice(0, 5);
  saveRecentRepos();
  renderRecentRepos();
}

function renderRecentRepos() {
  if (!recentRepos) return;
  if (!recentRepoItems.length) {
    recentRepos.innerHTML = `<div class="recent-empty">${escapeHtml(t("path.recent.empty"))}</div>`;
    return;
  }
  recentRepos.innerHTML = `
    <div class="recent-title">${escapeHtml(t("path.recent.title"))}</div>
    <div class="recent-list">
      ${recentRepoItems.map((item, index) => `
        <button class="recent-repo" data-recent-index="${index}" type="button">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.path)}</span>
        </button>`).join("")}
    </div>`;
  for (const button of recentRepos.querySelectorAll("[data-recent-index]")) {
    button.addEventListener("click", () => {
      const item = recentRepoItems[Number.parseInt(button.dataset.recentIndex, 10)];
      if (!item) return;
      startFreshClientWorkflow();
      repoPath.value = item.path;
      renderPathHelper("ok", t("path.selectedRecent"));
      renderPathModeForInput(repoPath.value);
      setActiveView("workspace");
      updateControls();
      preflightButton.click();
    });
  }
}

async function restoreLastSession() {
  const payload = await request("/api/session/last");
  if (sessionRestoreSuperseded) return;
  if (!payload.session || !payload.profile) {
    renderTask(null);
    return;
  }

  pendingSessionPayload = payload;
  sessionRecoveryMode = "pending";
  renderSessionRecovery();
}

function hydrateRestoredSession(payload) {
  advanceWorkflowGeneration();
  repoProfile = payload.profile;
  adoptTaskResponse(payload.task, { replace: true });
  currentMemory = payload.memory || currentMemory;
  currentPreflight = null;
  repoPath.value = repoProfile.rootPath;
  if (payload.workspace) adoptServerWorkspace(payload.workspace);
  else clearWorkspaceAuthority();
  renderPathHelper("ok", t("path.restored"));
  renderPathModeForInput(repoPath.value);
  if (!goalInput.value.trim() && currentTask?.goal) goalInput.value = currentTask.goal;
  rememberRepo(repoProfile);
  renderRepoSummary(repoProfile);
  renderVerifyCommands(repoProfile.commands || []);
  renderMemory(currentMemory);
  if (currentTask?.plan) {
    renderPlan(currentTask.plan);
    planIntent.textContent = currentTask.plan.intent || t("session.plan.restored");
  }
  if (currentTask?.contextFiles?.length) {
    suggestedContextFiles = currentTask.contextFiles.map((file) => ({ path: file.path, reason: file.summary || t("session.context.reason") }));
    renderContextCandidates(suggestedContextFiles);
    modelState.textContent = t("session.context.state");
    modelOutput.textContent = t("session.context.output", { count: currentTask.contextFiles.length });
  }
  renderTask(currentTask);
  renderRestoredPreflightNotice(payload.session);
  scanState.textContent = t("session.state.restored");
  toolState.textContent = t("tool.state.ready");
  sessionRecoveryMode = "restored";
  renderSessionRecovery();
  updateControls();
}

function renderSessionRecovery() {
  if (!sessionRecovery) return;
  const visible = sessionRecoveryMode !== "hidden" && activeView === "workspace";
  sessionRecovery.hidden = !visible;
  if (!visible) return;

  const project = pendingSessionPayload?.profile?.name || repoProfile?.name || t("session.recovery.projectFallback");
  const pending = sessionRecoveryMode === "pending";
  sessionRecovery.className = `session-recovery ${pending ? "pending" : "restored"}`;
  sessionRecoveryTitle.textContent = t(pending ? "session.recovery.pending.title" : "session.recovery.restored.title");
  sessionRecoveryBody.textContent = t(pending ? "session.recovery.pending.body" : "session.recovery.restored.body", { project });
  continueSessionButton.hidden = !pending;
  continueSessionButton.textContent = t("session.recovery.continue");
  startFreshButton.textContent = t("session.recovery.fresh");
}

function resetWorkspaceBoundState() {
  repoProfile = null;
  currentTask = null;
  currentMemory = null;
  currentPreflight = null;
  suggestedContextFiles = [];
  repoSummary.innerHTML = "";
  contextOutput.textContent = t("context.output.start");
  timeline.innerHTML = "";
  planIntent.textContent = t("state.waiting");
  scanState.textContent = t("scan.state.notScanned");
  toolState.textContent = t("tool.state.waitingProject");
  patchState.textContent = t("patch.state.none");
  patchOutput.textContent = t("patch.output.readContextFirst");
  toolArg.value = "";
  toolOutput.textContent = t("tool.output.scanFirst");
  renderPreflightReport(null);
  renderContextCandidates([]);
  renderTask(null);
  renderMemory(null);
  renderRevertPatchOptions(null);
  renderVerifyCommands([]);
  if (currentModelStatus) renderModelStatus(currentModelStatus);
}

function startFreshClientWorkflow() {
  advanceWorkflowGeneration();
  sessionRestoreSuperseded = true;
  pendingSessionPayload = null;
  sessionRecoveryMode = "hidden";
  workflowModel.demoRequested = false;
  resetWorkspaceBoundState();
  repoPath.value = "";
  goalInput.value = "";
  clearWorkspaceAuthority();
  renderPathHelperForInput("");
  renderPathModeForInput("");
  renderSessionRecovery();
    renderWorkflow();
  updateControls();
}

demoButton.addEventListener("click", () => {
  setActiveView("workspace");
  startFreshClientWorkflow();
  workflowModel.demoRequested = true;
  if (systemInfo?.demoPath) repoPath.value = systemInfo.demoPath;
  if (!goalInput.value.trim()) goalInput.value = t("demo.goal.default");
  renderPathHelper("ok", t("path.demo"));
  renderPathModeForInput(repoPath.value);
  updateControls();
  if (repoPath.value.trim()) preflightButton.click();
});

examplePathButton?.addEventListener("click", () => {
  startFreshClientWorkflow();
  repoPath.value = "C:\\Users\\you\\project";
  currentPreflight = null;
  renderPreflightReport(null);
  renderPathHelper("warn", t("path.example"));
  renderPathModeForInput(repoPath.value);
  updateControls();
  repoPath.focus();
  repoPath.select();
});

repoPath.addEventListener("input", () => {
  advanceWorkflowGeneration();
  const nextPath = repoPath.value;
  if (sessionRecoveryMode !== "hidden") {
    sessionRestoreSuperseded = true;
    pendingSessionPayload = null;
    sessionRecoveryMode = "hidden";
    renderSessionRecovery();
  }
  if (currentWorkspace || repoProfile || currentTask || currentPreflight) resetWorkspaceBoundState();
  workflowModel.demoRequested = false;
  repoPath.value = nextPath;
  clearWorkspaceAuthority();
  renderPathHelperForInput(repoPath.value);
  renderPathModeForInput(repoPath.value);
  updateControls();
});
goalInput.addEventListener("input", () => {
  advanceWorkflowGeneration();
  currentPreflight = null;
  renderPreflightReport(null);
    renderWorkflow();
  updateControls();
});
contextCandidates.addEventListener("change", () => {
  renderWorkflow();
  updateControls();
});
cancelScanButton.addEventListener("click", () => cancelActiveOperation("scan", scanState));
cancelPreflightButton.addEventListener("click", () => cancelActiveOperation("preflight", preflightState));
cancelModelOperationButton.addEventListener("click", () => cancelActiveOperation("model-send", modelState));
cancelVerifyButton.addEventListener("click", () => cancelActiveOperation("verify", verifyState));

scanButton.addEventListener("click", async () => {
  const path = repoPath.value.trim();
  if (!path) {
    scanState.textContent = t("scan.state.enterPath");
    renderPathHelper("error", t("path.empty"));
    return;
  }
  const target = captureWorkflowTarget(false);
  scanButton.disabled = true;
  scanState.textContent = t("scan.state.scanning");
  renderPathHelper("warn", t("path.checking"));
  try {
    const result = await requestManagedOperation("scan", "/api/repo/scan", { path });
    if (!workflowTargetIsCurrent(target)) return;
    repoProfile = result.profile;
    adoptServerWorkspace(result.workspace);
    currentPreflight = null;
    renderPreflightReport(null);
    rememberRepo(repoProfile);
    renderPathHelper("ok", t("path.scanOk"));
    renderPathModeForInput(repoPath.value);
    scanState.textContent = t("scan.state.scanned");
    toolState.textContent = t("tool.state.ready");
    renderRepoSummary(repoProfile);
    renderVerifyCommands(repoProfile.commands || []);
    await refreshMemory();
    renderWorkflow();
    await refreshAudit();
  } catch (error) {
    if (!workflowTargetIsCurrent(target)) return;
    scanState.textContent = operationWasCancelled(error) ? t("operation.state.cancelled") : t("scan.state.failed");
    renderPathHelper("error", friendlyErrorMessage(error).split("\n\n")[0]);
    contextOutput.textContent = friendlyErrorMessage(error);
  } finally {
    updateControls();
  }
});

preflightButton.addEventListener("click", async () => {
  const path = repoPath.value.trim();
  if (!path) {
    preflightState.textContent = t("preflight.state.enterPath");
    renderPathHelper("error", t("path.empty"));
    return;
  }
  const target = captureWorkflowTarget(false);
  preflightButton.disabled = true;
  preflightState.textContent = t("preflight.state.running");
  renderPathHelper("warn", t("path.preflightRunning"));
  renderPreflightReport({ pending: true });
  try {
    const payload = await requestManagedOperation("preflight", "/api/preflight/run", {
      path,
      goal: goalInput.value.trim() || t("preflight.goal.default")
    });
    if (!workflowTargetIsCurrent(target)) return;
    currentPreflight = payload.report;
    repoProfile = payload.profile;
    adoptServerWorkspace(payload.workspace);
    adoptTaskResponse(payload.task, { replace: true });
    currentMemory = payload.memory || currentMemory;
    suggestedContextFiles = (currentPreflight.contextFiles || []).map((file) => ({ path: file.path, reason: file.reason || t("preflight.reason.default") }));
    rememberRepo(repoProfile);
    renderRepoSummary(repoProfile);
    renderVerifyCommands(repoProfile.commands || []);
    if (currentTask?.plan) {
      renderPlan(currentTask.plan);
      planIntent.textContent = currentTask.plan.intent || t("verify.state.ready");
    }
    renderContextCandidates(suggestedContextFiles);
    modelState.textContent = suggestedContextFiles.length ? t("model.state.preflightContext") : t("model.state.context");
    modelOutput.textContent = preflightNextAction(currentPreflight);
    renderTask(currentTask);
    renderMemory(currentMemory);
    renderPreflightReport(currentPreflight);
    renderPathHelper("ok", t("path.preflightOk"));
    renderPathModeForInput(repoPath.value);
    scanState.textContent = t("scan.state.preflighted");
    toolState.textContent = t("tool.state.readOnlyReady");
    await refreshAudit();
  } catch (error) {
    if (!workflowTargetIsCurrent(target)) return;
    currentPreflight = null;
    preflightState.textContent = operationWasCancelled(error) ? t("operation.state.cancelled") : t("preflight.state.failed");
    renderPathHelper("error", friendlyErrorMessage(error).split("\n\n")[0]);
    preflightOutput.textContent = friendlyErrorMessage(error);
  } finally {
    renderWorkflow();
    updateControls();
  }
});

planButton.addEventListener("click", async () => {
  const goal = goalInput.value.trim();
  if (!goal) return;
  const target = captureWorkflowTarget(false);
  planButton.disabled = true;
  planIntent.textContent = t("plan.state.generating");
  try {
    if (!currentTask || currentTask.goal !== goal || currentTask.rootPath !== repoProfile?.rootPath) {
      const created = await request("/api/tasks/create", { goal, rootPath: repoProfile?.rootPath });
      if (!workflowTargetIsCurrent(target)) return;
      adoptTaskResponse(created.task, { replace: true });
    }
    const taskTarget = captureWorkflowTarget(true);
    const result = await request("/api/agent/plan", { goal, taskId: currentTask.id });
    if (!workflowTargetIsCurrent(taskTarget)) return;
    if (result.task && !adoptTaskResponse(result.task)) return;
    renderPlan(result.plan);
    renderTask(currentTask);
    planIntent.textContent = result.plan.intent;
    await refreshAudit();
  } catch (error) {
    if (!workflowTargetIsCurrent(target)) return;
    timeline.innerHTML = `<li><h4>${escapeHtml(t("plan.state.failed"))}</h4><p>${escapeHtml(friendlyErrorMessage(error))}</p></li>`;
  } finally {
    updateControls();
  }
});

clearButton.addEventListener("click", () => {
  advanceWorkflowGeneration();
  goalInput.value = "";
  currentPreflight = null;
  renderPreflightReport(null);
  timeline.innerHTML = "";
  planIntent.textContent = t("state.waiting");
  updateControls();
});

completeTaskButton.addEventListener("click", async () => {
  if (!currentTask) {
    taskState.textContent = t("task.state.none");
    return;
  }
  if (!currentPreflight) {
    taskState.textContent = t("control.needPreflight");
    return;
  }
  if (!taskHasActivePatch(currentTask)) {
    taskState.textContent = t("control.needAppliedPatch");
    return;
  }
  if (!taskHasCurrentSuccessfulVerification(currentTask)) {
    taskState.textContent = t("control.needSuccessfulVerify");
    return;
  }
  const target = captureWorkflowTarget(true);
  completeTaskButton.disabled = true;
  try {
    const result = await request("/api/tasks/complete", { taskId: currentTask.id });
    if (!workflowTargetIsCurrent(target)) return;
    if (result.task && !adoptTaskResponse(result.task)) return;
    if (result.memory) currentMemory = result.memory;
    renderTask(currentTask);
    renderMemory(currentMemory);
    await refreshAudit();
  } catch (error) {
    if (!workflowTargetIsCurrent(target)) return;
    const message = friendlyErrorMessage(error);
    taskState.textContent = message;
    taskSummary.textContent = message;
  } finally {
    updateControls();
  }
});

saveMemoryButton.addEventListener("click", async () => {
  if (!repoProfile) {
    memoryState.textContent = t("tool.state.scanFirst");
    return;
  }
  const target = captureWorkflowTarget(false);
  saveMemoryButton.disabled = true;
  memoryState.textContent = t("memory.state.saving");
  try {
    const result = await request("/api/memory/notes", { rootPath: repoProfile.rootPath, notes: memoryNotes.value });
    if (!workflowTargetIsCurrent(target)) return;
    currentMemory = result.memory;
    renderMemory(currentMemory);
    await refreshAudit();
  } catch (error) {
    if (!workflowTargetIsCurrent(target)) return;
    memoryState.textContent = t("memory.state.saveFailed");
    memoryOutput.textContent = friendlyErrorMessage(error);
  } finally {
    updateControls();
  }
});

refreshMemoryButton.addEventListener("click", refreshMemory);
modelPreset.addEventListener("change", applyModelPreset);

saveModelButton.addEventListener("click", async () => {
  if (modelPreset.value === "deepseek-pro") {
    const approved = window.confirm(t("model.confirm.pro"));
    if (!approved) return;
  }
  saveModelButton.disabled = true;
  modelState.textContent = t("model.state.saving");
  try {
    const payload = await request("/api/model/config", {
      type: modelType.value,
      name: modelPreset.value === "custom" ? modelType.value : modelPreset.value,
      baseUrl: modelBaseUrl.value.trim(),
      model: modelName.value.trim() || (modelType.value === "mock" ? "mock-codeclaw" : ""),
      apiKey: modelApiKey.value
    });
    renderModelStatus(payload);
  } catch (error) {
    modelState.textContent = t("model.state.configFailed");
    modelOutput.textContent = friendlyErrorMessage(error);
  } finally {
    modelApiKey.value = "";
    updateControls();
  }
});

function bindModelOutboundReview() {
  if (!modelOutboundReview) return;
  modelReviewClose.addEventListener("click", () => finishModelOutboundReview(false));
  modelReviewCancel.addEventListener("click", () => finishModelOutboundReview(false));
  modelReviewApprove.addEventListener("click", () => finishModelOutboundReview(true));
  modelOutboundReview.addEventListener("cancel", (event) => {
    event.preventDefault();
    finishModelOutboundReview(false);
  });
  modelOutboundReview.addEventListener("close", () => {
    if (resolveModelReview) finishModelOutboundReview(false);
  });
  modelOutboundReview.addEventListener("click", (event) => {
    if (event.target !== modelOutboundReview) return;
    const bounds = modelOutboundReview.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (outside) finishModelOutboundReview(false);
  });
}

async function executeReviewedModelOperation(operation, trigger, stateElement) {
  if (!currentTask?.id) throw new Error(t("model.review.taskRequired"));
  stateElement.textContent = t("model.review.state.preparing");
  const payload = await request("/api/model/preview", { operation, taskId: currentTask.id });
  assertModelOutboundPreview(payload.preview, operation);
  stateElement.textContent = t("model.review.state.waiting");
  let reviewClosed = false;
  try {
    let approved;
    try {
      approved = await showModelOutboundReview(payload.preview, stateElement);
    } catch (error) {
      await discardModelOutboundPreview(payload.preview);
      throw error;
    }
    reviewClosed = true;
    if (!approved) {
      await discardModelOutboundPreview(payload.preview);
      stateElement.textContent = t("model.review.state.cancelled");
      await refreshAudit().catch(() => {});
      return null;
    }

    stateElement.textContent = t("model.review.state.sending");
    try {
      return await requestManagedOperation("model-send", "/api/model/send", {
        previewId: payload.preview.previewId,
        approvalDigest: payload.preview.approvalDigest,
        approved: true
      });
    } catch (error) {
      await refreshAudit().catch(() => {});
      throw error;
    }
  } finally {
    if (reviewClosed) {
      updateControls();
      trigger?.focus?.();
    }
  }
}

async function discardModelOutboundPreview(preview) {
  try {
    await request("/api/model/cancel", {
      previewId: preview.previewId,
      approvalDigest: preview.approvalDigest
    });
  } catch {}
}

function showModelOutboundReview(preview, focusFallback) {
  if (!modelOutboundReview || typeof modelOutboundReview.showModal !== "function") {
    throw new Error(t("model.review.unsupported"));
  }
  if (resolveModelReview || modelOutboundReview.open) {
    throw new Error(t("model.review.busy"));
  }
  activeModelReview = preview;
  modelReviewFocusFallback = focusFallback instanceof HTMLElement ? focusFallback : null;
  if (modelReviewFocusFallback) modelReviewFocusFallback.tabIndex = -1;
  renderModelOutboundReview(preview);

  return new Promise((resolve, reject) => {
    resolveModelReview = resolve;
    try {
      modelOutboundReview.showModal();
      modelReviewCancel.focus();
    } catch (error) {
      resolveModelReview = null;
      activeModelReview = null;
      modelReviewFocusFallback = null;
      clearModelOutboundReview();
      reject(error);
    }
  });
}

function finishModelOutboundReview(approved) {
  if (!resolveModelReview) return;
  const resolve = resolveModelReview;
  const focusFallback = modelReviewFocusFallback;
  resolveModelReview = null;
  activeModelReview = null;
  modelReviewFocusFallback = null;
  if (modelOutboundReview.open) modelOutboundReview.close(approved ? "approved" : "cancelled");
  clearModelOutboundReview();
  focusFallback?.focus?.();
  resolve(approved === true);
}

function renderModelOutboundReview(preview) {
  const requestInfo = preview?.request || {};
  const disclosure = preview?.disclosure || {};
  const provider = preview?.provider || {};
  const channel = requestInfo.channel;
  const operationKey = {
    "task-suggest": "model.review.operation.taskSuggest",
    "context-files": "model.review.operation.contextFiles",
    "patch-proposal": "model.review.operation.patchProposal",
    "failure-fix": "model.review.operation.failureFix"
  }[preview?.operation];

  modelReviewOperation.textContent = operationKey ? t(operationKey) : String(preview?.operation || "");
  modelReviewProvider.textContent = [provider.name || provider.type, provider.model].filter(Boolean).join(" / ") || t("model.review.value.unavailable");
  modelReviewChannel.textContent = t(`model.review.channel.${channel}`);
  modelReviewChannel.dataset.channel = channel;
  modelReviewLeavesDevice.textContent = requestInfo.willLeaveDevice ? t("model.output.yes") : t("model.output.no");
  modelReviewLeavesDevice.dataset.value = requestInfo.willLeaveDevice ? "yes" : "no";
  modelReviewEndpoint.textContent = requestInfo.endpoint || t("model.review.endpoint.local");
  modelReviewExpires.textContent = formatModelReviewTime(preview?.expiresAt);
  modelReviewBytes.textContent = formatModelReviewNumber(requestInfo.byteLength);
  modelReviewSha.textContent = requestInfo.sha256 || t("model.review.value.unavailable");
  const visualizedBody = visualizeModelReviewBody(typeof requestInfo.bodyUtf8 === "string" ? requestInfo.bodyUtf8 : "");
  modelReviewBody.textContent = visualizedBody.text;
  modelReviewControlWarning.hidden = visualizedBody.controlCount === 0;
  modelReviewControlWarning.textContent = visualizedBody.controlCount
    ? t("model.review.body.controls", { count: visualizedBody.controlCount })
    : "";
  const dataClasses = Array.isArray(disclosure.dataClasses) ? disclosure.dataClasses : [];
  modelReviewDataClasses.textContent = dataClasses.length
    ? t("model.review.dataClasses", { items: dataClasses.join(", ") })
    : t("model.review.dataClasses.none");
  renderModelReviewFiles(Array.isArray(disclosure.files) ? disclosure.files : []);
  modelReviewStatus.textContent = t("model.review.status.ready");
}

function renderModelReviewFiles(files) {
  modelReviewFiles.replaceChildren();
  if (!files.length) {
    const empty = document.createElement("p");
    empty.className = "model-review-empty";
    empty.textContent = t("model.review.files.empty");
    modelReviewFiles.append(empty);
    return;
  }

  for (const file of files) {
    const item = document.createElement("article");
    item.className = "model-review-file";
    const path = document.createElement("strong");
    path.textContent = String(file?.path || t("model.review.value.unavailable"));
    const details = document.createElement("dl");
    appendModelReviewFileField(details, t("model.review.file.mode"), file?.mode || t("model.review.value.unavailable"), true);
    appendModelReviewFileField(details, t("model.review.file.transmittedBytes"), formatModelReviewNumber(file?.transmittedUtf8Bytes));
    appendModelReviewFileField(details, t("model.review.file.sourceBytes"), formatModelReviewNumber(file?.byteLength));
    appendModelReviewFileField(details, t("model.review.file.sha"), file?.sha256 || t("model.review.value.unavailable"), true);
    appendModelReviewFileField(details, t("model.review.file.contentIncluded"), file?.contentIncluded ? t("model.output.yes") : t("model.output.no"));
    item.append(path, details);
    modelReviewFiles.append(item);
  }
}

function appendModelReviewFileField(list, label, value, useCode = false) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const detail = document.createElement("dd");
  const valueNode = useCode ? document.createElement("code") : document.createElement("span");
  term.textContent = label;
  valueNode.textContent = String(value);
  detail.append(valueNode);
  wrapper.append(term, detail);
  list.append(wrapper);
}

function clearModelOutboundReview() {
  modelReviewBody.textContent = "";
  modelReviewControlWarning.textContent = "";
  modelReviewControlWarning.hidden = true;
  for (const element of [
    modelReviewOperation,
    modelReviewProvider,
    modelReviewChannel,
    modelReviewLeavesDevice,
    modelReviewEndpoint,
    modelReviewExpires,
    modelReviewBytes,
    modelReviewSha,
    modelReviewDataClasses,
    modelReviewStatus
  ]) element.textContent = "";
  delete modelReviewChannel.dataset.channel;
  delete modelReviewLeavesDevice.dataset.value;
  modelReviewFiles.replaceChildren();
}

function assertModelOutboundPreview(preview, expectedOperation) {
  const requestInfo = preview?.request;
  const disclosure = preview?.disclosure;
  const channel = requestInfo?.channel;
  const encodedBytes = typeof requestInfo?.bodyUtf8 === "string" ? new TextEncoder().encode(requestInfo.bodyUtf8).byteLength : -1;
  const targetMatches = channel === "local"
    ? requestInfo?.willLeaveDevice === false && requestInfo?.endpoint === null
    : channel === "loopback"
      ? requestInfo?.willLeaveDevice === false && typeof requestInfo?.endpoint === "string" && requestInfo.endpoint.length > 0
      : channel === "network"
        ? requestInfo?.willLeaveDevice === true && typeof requestInfo?.endpoint === "string" && requestInfo.endpoint.length > 0
        : false;
  const filesValid = Array.isArray(disclosure?.files) && disclosure.files.every((file) => (
    typeof file?.path === "string" && file.path.length > 0
    && typeof file?.mode === "string" && file.mode.length > 0
    && Number.isSafeInteger(file?.byteLength) && file.byteLength >= 0
    && Number.isSafeInteger(file?.transmittedUtf8Bytes) && file.transmittedUtf8Bytes >= 0
    && /^[0-9a-f]{64}$/i.test(file?.sha256 || "")
  ));
  if (preview?.operation !== expectedOperation
    || typeof preview?.previewId !== "string" || !preview.previewId
    || !/^[0-9a-f]{64}$/i.test(preview?.approvalDigest || "")
    || !targetMatches
    || !Number.isSafeInteger(requestInfo?.byteLength) || requestInfo.byteLength < 0
    || encodedBytes !== requestInfo.byteLength
    || !/^[0-9a-f]{64}$/i.test(requestInfo?.sha256 || "")
    || !Array.isArray(disclosure?.dataClasses)
    || !filesValid) {
    const error = new Error(t("error.modelReviewBlocked"));
    error.code = "MODEL_REQUEST_INVALID";
    throw error;
  }
}

function formatModelReviewNumber(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0
    ? new Intl.NumberFormat(document.documentElement.lang || "en").format(number)
    : t("model.review.value.unavailable");
}

function formatModelReviewTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? t("model.review.value.unavailable") : date.toLocaleString();
}

suggestButton.addEventListener("click", async () => {
  const target = captureWorkflowTarget(true);
  suggestButton.disabled = true;
  try {
    const payload = await executeReviewedModelOperation("task-suggest", suggestButton, modelState);
    if (!payload) return;
    if (!workflowTargetIsCurrent(target)) return;
    if (payload.task && !adoptTaskResponse(payload.task)) return;
    modelState.textContent = payload.result?.provider || t("model.review.state.completed");
    modelOutput.textContent = payload.result?.content || t("model.review.result.empty");
    renderTask(currentTask);
    await refreshAudit();
  } catch (error) {
    if (!workflowTargetIsCurrent(target)) return;
    modelState.textContent = operationWasCancelled(error) ? t("operation.state.cancelled") : t("model.state.suggestFailed");
    modelOutput.textContent = friendlyErrorMessage(error);
  } finally {
    updateControls();
  }
});

contextButton.addEventListener("click", async () => {
  const target = captureWorkflowTarget(true);
  contextButton.disabled = true;
  try {
    const payload = await executeReviewedModelOperation("context-files", contextButton, modelState);
    if (!payload) return;
    if (!workflowTargetIsCurrent(target)) return;
    if (payload.task && !adoptTaskResponse(payload.task)) return;
    suggestedContextFiles = payload.result?.files || [];
    modelState.textContent = t("model.state.contextCandidates", { count: suggestedContextFiles.length });
    renderContextCandidates(suggestedContextFiles);
    modelOutput.textContent = (payload.result?.note || t("model.context.noteFallback")).trim();
    renderTask(currentTask);
    renderWorkflow();
    await refreshAudit();
  } catch (error) {
    if (!workflowTargetIsCurrent(target)) return;
    modelState.textContent = operationWasCancelled(error) ? t("operation.state.cancelled") : t("model.state.contextFailed");
    modelOutput.textContent = friendlyErrorMessage(error);
  } finally {
    updateControls();
  }
});

readContextButton.addEventListener("click", async () => {
  if (!repoProfile) return;
  const selected = selectedContextFiles();
  if (!selected.length) {
    modelOutput.textContent = t("model.state.noSelectedContext");
    return;
  }

  const target = captureWorkflowTarget(true);
  readContextButton.disabled = true;
  modelState.textContent = t("model.state.readingContext");
  try {
    const outputs = [];
    for (const file of selected) {
      const result = await request("/api/tools/call", { tool: "read_file", args: { path: file.path }, rootPath: repoProfile.rootPath, taskId: currentTask?.id });
      if (!workflowTargetIsCurrent(target)) return;
      if (result.task && !adoptTaskResponse(result.task)) return;
      outputs.push(`${file.path}: ${typeof result.result === "string" ? result.result.length : 0} chars`);
    }
    renderTask(currentTask);
    modelState.textContent = t("model.state.readContextDone");
    modelOutput.textContent = outputs.join("\n");
    await refreshAudit();
  } catch (error) {
    if (!workflowTargetIsCurrent(target)) return;
    modelState.textContent = t("model.state.readFailed");
    modelOutput.textContent = friendlyErrorMessage(error);
  } finally {
    updateControls();
  }
});

proposePatchButton.addEventListener("click", async () => {
  if (!currentTask) {
    patchState.textContent = t("patch.state.noTask");
    return;
  }
  const gate = preflightPatchGateStatus();
  if (gate.blocksPatch) {
    patchState.textContent = gate.title;
    patchOutput.textContent = gate.detail;
    return;
  }
  const target = captureWorkflowTarget(true);
  proposePatchButton.disabled = true;
  try {
    const payload = await executeReviewedModelOperation("patch-proposal", proposePatchButton, patchState);
    if (!payload) return;
    if (!workflowTargetIsCurrent(target)) return;
    if (payload.task && !adoptTaskResponse(payload.task)) return;
    renderPatchProposal(payload.result);
    renderTask(currentTask);
    await refreshAudit();
  } catch (error) {
    if (!workflowTargetIsCurrent(target)) return;
    patchState.textContent = operationWasCancelled(error) ? t("operation.state.cancelled") : t("patch.state.draftFailed");
    patchOutput.textContent = friendlyErrorMessage(error);
  } finally {
    updateControls();
  }
});

applyPatchButton.addEventListener("click", async () => {
  const approvedProposal = currentTask?.patchProposal;
  const files = patchProposalFiles(approvedProposal);
  if (!files.length) {
    patchState.textContent = t("patch.state.noAvailable");
    return;
  }
  const gate = applyPatchGateStatus();
  if (gate.blocksPatch) {
    patchState.textContent = gate.title;
    patchOutput.textContent = gate.detail;
    return;
  }
  const review = patchReviewModel(approvedProposal, currentTask);
  const approved = window.confirm([
    t("confirm.apply.title", { target: patchTargetLabel(approvedProposal) }),
    "",
    t("confirm.apply.review", { count: review.files.length, added: review.total.added, removed: review.total.removed }),
    t("confirm.apply.risks", { risks: review.risks.slice(0, 2).join("; ") }),
    "",
    t("confirm.apply.workspace", { workspace: currentWorkspace?.name || workspaceKindLabel(currentWorkspace?.kind) }),
    t("confirm.apply.write"),
    currentWorkspace?.kind === "disposable-copy" ? t("confirm.apply.copyProtected") : t("confirm.apply.demoProtected"),
    t("confirm.apply.rollback")
  ].join("\n"));
  if (!approved) return;
  const target = captureWorkflowTarget(true);
  applyPatchButton.disabled = true;
  patchState.textContent = t("patch.state.applying");
  try {
    const result = await request("/api/tasks/apply-patch", {
      taskId: currentTask.id,
      proposalId: approvedProposal.proposalId,
      proposalDigest: approvedProposal.proposalDigest,
      approved: true
    });
    if (!workflowTargetIsCurrent(target)) return;
    if (result.task && !adoptTaskResponse(result.task)) return;
    if (result.workspace) adoptServerWorkspace(result.workspace);
    patchState.textContent = t("patch.state.applied");
    patchOutput.textContent = result.result?.diff || currentTask.patchProposal.diff || t("patch.output.appliedFallback");
    renderTask(currentTask);
    await refreshAudit();
  } catch (error) {
    if (!workflowTargetIsCurrent(target)) return;
    patchState.textContent = t("patch.state.applyFailed");
    patchOutput.textContent = friendlyErrorMessage(error);
  } finally {
    updateControls();
  }
});

revertPatchButton.addEventListener("click", async () => {
  if (!currentTask?.appliedPatches?.some((patch) => !patch.revertedAt)) {
    patchState.textContent = t("patch.state.noRevert");
    return;
  }
  const gate = workspaceWriteGateStatus();
  if (gate.blocksPatch) {
    patchState.textContent = gate.title;
    patchOutput.textContent = gate.detail;
    return;
  }
  const selectedIndex = Number.parseInt(revertPatchSelect.value, 10);
  const selectedPatch = currentTask.appliedPatches?.[selectedIndex];
  const approved = window.confirm([
    t("confirm.revert.title", { target: selectedPatch?.path || t("confirm.revert.targetFallback") }),
    "",
    t("confirm.revert.write"),
    t("confirm.revert.review")
  ].join("\n"));
  if (!approved) return;
  const target = captureWorkflowTarget(true);
  revertPatchButton.disabled = true;
  patchState.textContent = t("patch.state.reverting");
  try {
    const result = await request("/api/tasks/revert-patch", {
      taskId: currentTask.id,
      patchIndex: Number.isNaN(selectedIndex) ? undefined : selectedIndex,
      patchIdentity: selectedPatch?.patchIdentity,
      workspaceIdentity: currentTask.rootIdentity,
      approved: true
    });
    if (!workflowTargetIsCurrent(target)) return;
    if (result.task && !adoptTaskResponse(result.task)) return;
    if (result.workspace) adoptServerWorkspace(result.workspace);
    patchState.textContent = t("patch.state.reverted");
    patchOutput.textContent = result.result?.diff || t("patch.output.revertedFallback");
    renderTask(currentTask);
    await refreshAudit();
  } catch (error) {
    if (!workflowTargetIsCurrent(target)) return;
    patchState.textContent = t("patch.state.revertFailed");
    patchOutput.textContent = friendlyErrorMessage(error);
  } finally {
    updateControls();
  }
});

callToolButton.addEventListener("click", async () => {
  if (!repoProfile) {
    toolState.textContent = t("tool.state.scanFirst");
    return;
  }

  const tool = toolSelect.value;
  const target = captureWorkflowTarget(true);
  callToolButton.disabled = true;
  toolState.textContent = t("tool.state.calling");
  try {
    let result = await callTool(tool, false);
    if (!workflowTargetIsCurrent(target)) return;
    if (result.blocked) {
      const approved = window.confirm([
        t("confirm.tool.title", { tool }),
        "",
        t("confirm.tool.riskPrefix", { risk: result.permission.risk }),
        t("confirm.tool.cancel")
      ].join("\n"));
      if (approved) {
        result = await callTool(tool, true);
        if (!workflowTargetIsCurrent(target)) return;
      }
    }
    if (result.task && !adoptTaskResponse(result.task)) return;
    toolState.textContent = result.blocked ? t("tool.state.blocked") : result.permission.level;
    renderToolResult(tool, result);
    renderTask(currentTask);
    await refreshAudit();
  } catch (error) {
    if (!workflowTargetIsCurrent(target)) return;
    toolState.textContent = t("tool.state.failed");
    toolOutput.textContent = friendlyErrorMessage(error);
  } finally {
    updateControls();
  }
});

toolSelect.addEventListener("change", syncToolInputs);
verifyCommandSelect.addEventListener("change", () => {
  renderVerifyBoundary();
  updateControls();
});

runVerifyButton.addEventListener("click", async () => {
  if (!repoProfile) {
    verifyState.textContent = t("verify.state.scanFirst");
    return;
  }
  if (!currentPreflight) {
    verifyState.textContent = t("verify.state.preflightRequired");
    return;
  }
  if (!taskHasActivePatch(currentTask)) {
    verifyState.textContent = t("control.needAppliedPatch");
    return;
  }

  const workspaceGate = workspaceCommandGateStatus();
  if (workspaceGate.blocksCommand) {
    verifyState.textContent = t("verify.state.workspaceBlocked");
    verifyOutput.textContent = workspaceGate.detail;
    return;
  }

  const command = selectedVerifyCommand();
  if (!command) {
    verifyState.textContent = t("verify.state.noCommand");
    return;
  }

  const target = captureWorkflowTarget(true);
  runVerifyButton.disabled = true;
  verifyState.textContent = t("verify.state.waitingConfirm");
  try {
    let result = await request("/api/tools/call", { tool: "run_command", args: { command: command.command }, rootPath: repoProfile.rootPath, taskId: currentTask?.id });
    if (!workflowTargetIsCurrent(target)) return;
    if (result.blocked) {
      const approved = window.confirm([
        t("confirm.verify.title"),
        "",
        t("confirm.verify.command", { command: command.command }),
        result.permission.risk,
        "",
        t("confirm.verify.risk")
      ].join("\n"));
      if (approved) {
        verifyState.textContent = t("verify.state.running");
        result = await requestManagedOperation("verify", "/api/tools/call", { tool: "run_command", args: { command: command.command }, rootPath: repoProfile.rootPath, taskId: currentTask?.id, approved: true });
        if (!workflowTargetIsCurrent(target)) return;
      }
    }
    if (result.task && !adoptTaskResponse(result.task)) return;
    if (result.workspace) adoptServerWorkspace(result.workspace);
    verifyState.textContent = result.result?.timedOut ? t("verify.state.timeout") : result.result?.exitCode === 0 ? t("verify.state.passed") : t("verify.state.failed");
    renderVerifyResult(command, result);
    renderTask(currentTask);
    await refreshAudit();
  } catch (error) {
    if (!workflowTargetIsCurrent(target)) return;
    verifyState.textContent = operationWasCancelled(error) ? t("operation.state.cancelled") : t("verify.state.runFailed");
    verifyOutput.textContent = friendlyErrorMessage(error);
  } finally {
    updateControls();
  }
});

fixFailureButton.addEventListener("click", async () => {
  if (!currentTask?.failureSummary) {
    verifyState.textContent = t("verify.state.noFailure");
    return;
  }
  const target = captureWorkflowTarget(true);
  fixFailureButton.disabled = true;
  try {
    const payload = await executeReviewedModelOperation("failure-fix", fixFailureButton, verifyState);
    if (!payload) return;
    if (!workflowTargetIsCurrent(target)) return;
    if (payload.task && !adoptTaskResponse(payload.task)) return;
    verifyState.textContent = t("verify.state.fixReady");
    modelOutput.textContent = payload.result?.content || t("model.review.result.empty");
    renderTask(currentTask);
    await refreshAudit();
  } catch (error) {
    if (!workflowTargetIsCurrent(target)) return;
    verifyState.textContent = operationWasCancelled(error) ? t("operation.state.cancelled") : t("verify.state.fixFailed");
    verifyOutput.textContent = friendlyErrorMessage(error);
  } finally {
    updateControls();
  }
});

function syncToolInputs() {
  const tool = toolSelect.value;
  const usesArg = tool === "read_file" || tool === "search_code";
  toolArg.disabled = !usesArg;
  toolArg.placeholder = tool === "read_file" ? "README.md" : tool === "search_code" ? "createTaskPlan" : t("tool.arg.noArgs");
  if (!usesArg) toolArg.value = "";
  updateControls();
}

function taskHasActivePatch(task) {
  return Boolean(task?.appliedPatches?.some((patch) => !patch.revertedAt));
}

function advanceWorkflowGeneration() {
  workflowGeneration += 1;
}

function captureWorkflowTarget(trackTask = true) {
  return {
    generation: workflowGeneration,
    path: repoPath?.value.trim() || "",
    taskId: trackTask ? currentTask?.id || null : null,
    workspaceId: workspaceIdentifier(currentWorkspace),
    workspaceRoot: currentWorkspace?.rootPath || ""
  };
}

function workflowTargetIsCurrent(target) {
  if (!target || target.generation !== workflowGeneration) return false;
  if (target.path !== (repoPath?.value.trim() || "")) return false;
  if (target.workspaceId !== workspaceIdentifier(currentWorkspace)) return false;
  if (target.workspaceRoot !== (currentWorkspace?.rootPath || "")) return false;
  return !target.taskId || target.taskId === currentTask?.id;
}

function adoptTaskResponse(task, options) {
  const replace = options?.replace === true;
  if (!task?.id) return false;
  if (replace) {
    currentTask = task;
    return true;
  }
  if (!currentTask) return false;
  if (task.id !== currentTask.id) return false;
  const incomingRevision = Number.isSafeInteger(task.revision) ? task.revision : 0;
  const currentRevision = Number.isSafeInteger(currentTask.revision) ? currentTask.revision : 0;
  if (incomingRevision < currentRevision) return false;
  currentTask = task;
  return true;
}

function taskHasCurrentSuccessfulVerification(task) {
  const activePatches = (task?.appliedPatches || []).filter((patch) => !patch.revertedAt);
  const verification = task?.verification;
  if (!activePatches.length || !verification || verification.exitCode !== 0 || verification.timedOut) return false;
  if (!/^[a-f0-9]{64}$/i.test(verification.patchSetDigest || "")) return false;
  const verifiedAt = Date.parse(verification.time || "");
  const latestAppliedAt = Math.max(...activePatches.map((patch) => Date.parse(patch.time || "")).filter(Number.isFinite));
  return Number.isFinite(verifiedAt) && Number.isFinite(latestAppliedAt) && verifiedAt >= latestAppliedAt;
}

function updateControls() {
  if (launcherPageLocked) {
    enforceLauncherPageLock();
    return;
  }
  const hasRepoPath = Boolean(repoPath.value.trim());
  const hasRepo = Boolean(repoProfile?.rootPath);
  const hasGoal = Boolean(goalInput.value.trim() || currentTask?.goal);
  const hasTask = Boolean(currentTask?.id);
  const hasPlan = Boolean(currentTask?.plan);
  const hasContext = Boolean(currentTask?.contextFiles?.length);
  const hasContextCandidates = Boolean(suggestedContextFiles.length);
  const selectedContextCount = selectedContextFiles().length;
  const proposalFiles = patchProposalFiles(currentTask?.patchProposal);
  const activePatches = currentTask?.appliedPatches?.filter((patch) => !patch.revertedAt).length || 0;
  const verificationCommand = selectedVerifyCommand();
  const taskComplete = currentTask?.status === "completed";
  const startsNewTask = Boolean(goalInput.value.trim() && goalInput.value.trim() !== currentTask?.goal);
  const hasActivePatch = taskHasActivePatch(currentTask);
  const hasSuccessfulVerification = taskHasCurrentSuccessfulVerification(currentTask);
  const patchDraftGateStatus = preflightPatchGateStatus();
  const patchApplyGateStatus = applyPatchGateStatus();
  const writeGateStatus = workspaceWriteGateStatus();
  const commandGateStatus = workspaceCommandGateStatus();
  const selectedToolRunsProcess = ["git_status", "git_diff"].includes(toolSelect.value);
  const scanBusy = activeOperations.has("scan");
  const preflightBusy = activeOperations.has("preflight");
  const modelBusy = activeOperations.has("model-send");
  const verifyBusy = activeOperations.has("verify");

  setControlState(scanButton, !hasRepoPath || scanBusy, scanBusy ? t("operation.state.running") : hasRepoPath ? "" : t("control.needProjectPathDemo"));
  setControlState(preflightButton, !hasRepoPath || preflightBusy, preflightBusy ? t("operation.state.running") : hasRepoPath ? "" : t("control.needProjectPath"));
  setControlState(planButton, !hasGoal || taskComplete && !startsNewTask, !hasGoal ? t("control.needGoal") : taskComplete && !startsNewTask ? t("control.taskComplete") : "");
  setControlState(completeTaskButton, !hasTask || taskComplete || !currentPreflight || !hasActivePatch || !hasSuccessfulVerification, !hasTask ? t("control.needTask") : taskComplete ? t("control.taskComplete") : !currentPreflight ? t("control.needPreflight") : !hasActivePatch ? t("control.needAppliedPatch") : !hasSuccessfulVerification ? t("control.needSuccessfulVerify") : "");
  setControlState(saveMemoryButton, !hasRepo, hasRepo ? "" : t("control.needScan"));
  setControlState(refreshMemoryButton, !hasRepo, hasRepo ? "" : t("control.needScan"));
  setControlState(saveModelButton, false);
  setControlState(suggestButton, !hasTask || taskComplete || modelBusy, modelBusy ? t("operation.state.running") : !hasTask ? t("control.needPlan") : taskComplete ? t("control.taskComplete") : "");
  setControlState(contextButton, !hasTask || !hasRepo || taskComplete || modelBusy, modelBusy ? t("operation.state.running") : !hasTask ? t("control.needPlan") : !hasRepo ? t("control.needScan") : taskComplete ? t("control.taskComplete") : "");
  setControlState(readContextButton, !hasTask || !hasContextCandidates || selectedContextCount === 0 || taskComplete, !hasTask ? t("control.needPlan") : !hasContextCandidates ? t("control.needContextCandidates") : selectedContextCount === 0 ? t("control.needContextSelection") : taskComplete ? t("control.taskComplete") : "");
  setControlState(proposePatchButton, !hasTask || !hasContext || taskComplete || patchDraftGateStatus.blocksPatch || modelBusy, modelBusy ? t("operation.state.running") : !hasTask ? t("control.needPlan") : !hasContext ? t("control.needReadContext") : taskComplete ? t("control.taskComplete") : patchDraftGateStatus.detail);
  setControlState(applyPatchButton, !proposalFiles.length || activePatches > 0 || taskComplete || patchApplyGateStatus.blocksPatch, !proposalFiles.length ? t("control.needApplicablePatch") : activePatches > 0 ? t("control.hasActivePatch") : taskComplete ? t("control.taskComplete") : patchApplyGateStatus.detail);
  setControlState(revertPatchButton, activePatches === 0 || writeGateStatus.blocksPatch, activePatches === 0 ? t("control.noRevertPatch") : writeGateStatus.detail);
  setControlState(callToolButton, !hasRepo || selectedToolRunsProcess && commandGateStatus.blocksCommand, !hasRepo ? t("control.needScan") : selectedToolRunsProcess ? commandGateStatus.detail : "");
  setControlState(runVerifyButton, !hasRepo || !currentPreflight || !hasActivePatch || !verificationCommand || taskComplete || commandGateStatus.blocksCommand || verifyBusy, verifyBusy ? t("operation.state.running") : !hasRepo ? t("control.needScan") : !currentPreflight ? t("control.needPreflight") : !hasActivePatch ? t("control.needAppliedPatch") : !verificationCommand ? t("control.noVerifyCommand") : taskComplete ? t("control.taskComplete") : commandGateStatus.detail);
  setControlState(fixFailureButton, !currentTask?.failureSummary || taskComplete || modelBusy, modelBusy ? t("operation.state.running") : taskComplete ? t("control.taskComplete") : currentTask?.failureSummary ? "" : t("control.needFailedVerify"));
  renderActiveOperationControls();
  renderPatchGate(proposalFiles.length ? patchApplyGateStatus : patchDraftGateStatus);
  renderApplyReview(currentTask?.patchProposal, currentTask, patchApplyGateStatus);
  renderVerifyBoundary();
  renderWorkspaceSafety();
  renderWorkflow();

  if (!hasPlan && !hasGoal) planIntent.textContent = t("state.waiting");
  if (!hasRepo) toolState.textContent = t("tool.state.waitingProject");
}

function preflightPatchGateStatus() {
  const hasPath = Boolean(repoPath.value.trim() || repoProfile?.rootPath);
  if (!hasPath) {
    return {
      severity: "warn",
      title: t("patch.gate.preflight.title"),
      detail: t("patch.gate.preflight.path"),
      blocksPatch: true
    };
  }
  if (!currentPreflight) {
    return {
      severity: "warn",
      title: t("patch.gate.preflight.title"),
      detail: t("patch.gate.preflight.run"),
      blocksPatch: true
    };
  }

  const blockers = currentPreflight.nextGate?.blockers || [];
  const warnings = currentPreflight.nextGate?.warnings || [];
  if (blockers.length) {
    return {
      severity: "blocked",
      title: t("patch.gate.blocked.title"),
      detail: t("patch.gate.blocked.detail", { count: blockers.length }),
      blocksPatch: true
    };
  }
  if (warnings.length) {
    return {
      severity: "warn",
      title: t("patch.gate.warn.title"),
      detail: t("patch.gate.warn.detail", { count: warnings.length }),
      blocksPatch: true
    };
  }
  return {
    severity: "ok",
    title: t("patch.gate.ok.title"),
    detail: t("patch.gate.ok.detail"),
    blocksPatch: false
  };
}

function applyPatchGateStatus() {
  const preflightGate = preflightPatchGateStatus();
  return preflightGate.blocksPatch ? preflightGate : workspaceWriteGateStatus();
}

function workspaceWriteGateStatus() {
  if (!currentWorkspace) return {
    severity: "blocked",
    title: t("patch.gate.workspace.title"),
    detail: t("patch.gate.workspace.unverified"),
    blocksPatch: true
  };
  if (currentWorkspace.kind === "original-readonly") return {
    severity: "blocked",
    title: t("patch.gate.workspace.originalTitle"),
    detail: t("patch.gate.workspace.originalDetail"),
    blocksPatch: true
  };
  if (!workspaceCanWrite()) return {
    severity: "blocked",
    title: t("patch.gate.workspace.invalidTitle"),
    detail: t("patch.gate.workspace.invalidDetail"),
    blocksPatch: true
  };
  return {
    severity: "ok",
    title: t("patch.gate.workspace.readyTitle"),
    detail: currentWorkspace.kind === "built-in-demo" ? t("patch.gate.workspace.demoReady") : t("patch.gate.workspace.copyReady"),
    blocksPatch: false
  };
}

function workspaceCommandGateStatus() {
  if (!currentWorkspace) return { blocksCommand: true, detail: t("verifyBoundary.unverified") };
  if (currentWorkspace.kind === "original-readonly") return { blocksCommand: true, detail: t("verifyBoundary.originalReadonly") };
  if (!workspaceCanRunCommands()) return { blocksCommand: true, detail: t("verifyBoundary.invalidWorkspace") };
  return { blocksCommand: false, detail: "" };
}

function renderPatchGate(gate) {
  if (!patchGate || !gate) return;
  patchGate.className = `patch-gate ${gate.severity}`;
  patchGate.innerHTML = `<strong>${escapeHtml(gate.title)}</strong><span>${escapeHtml(gate.detail)}</span>`;
}

function renderApplyReview(proposal, task, gate = applyPatchGateStatus()) {
  if (!applyReview) return;
  const model = patchReviewModel(proposal, task);
  if (!model.files.length) {
    applyReview.className = "apply-review empty";
    applyReview.innerHTML = `
      <strong>${escapeHtml(t("applyReview.title"))}</strong>
      <span>${escapeHtml(t("applyReview.empty"))}</span>
    `;
    return;
  }

  const blocked = Boolean(gate?.blocksPatch);
  applyReview.className = `apply-review ${blocked ? "blocked" : "ready"}`;
  applyReview.innerHTML = `
    <div class="apply-review-head">
      <div>
        <strong>${escapeHtml(t("applyReview.title"))}</strong>
        <span>${escapeHtml(model.summary)}</span>
      </div>
      <span>${escapeHtml(blocked ? t("applyReview.blocked") : t("applyReview.ready"))}</span>
    </div>
    <div class="apply-review-metrics">
      <div><strong>${model.files.length}</strong><span>${escapeHtml(t("applyReview.files"))}</span></div>
      <div><strong>+${model.total.added}</strong><span>${escapeHtml(t("applyReview.added"))}</span></div>
      <div><strong>-${model.total.removed}</strong><span>${escapeHtml(t("applyReview.removed"))}</span></div>
    </div>
    <div class="apply-review-warning"><strong>${escapeHtml(t("applyReview.writeWarning.title"))}</strong><span>${escapeHtml(t("applyReview.writeWarning.body"))}</span></div>
    <div class="apply-review-list">
      <strong>${escapeHtml(t("applyReview.changedFiles"))}</strong>
      ${model.files.map((file) => `<p>${escapeHtml(file.path)} <span>${escapeHtml(file.summary || t("patch.summary.fallback"))}</span></p>`).join("")}
    </div>
    <div class="apply-review-list">
      <strong>${escapeHtml(t("applyReview.risks"))}</strong>
      ${model.risks.map((risk) => `<p>${escapeHtml(risk)}</p>`).join("")}
    </div>
    <div class="apply-review-list">
      <strong>${escapeHtml(t("applyReview.rollback"))}</strong>
      <p>${escapeHtml(t("applyReview.rollback.body"))}</p>
    </div>
  `;
}

function buildWorkflowSnapshot() {
  const hasPath = Boolean(repoPath.value.trim() || repoProfile?.rootPath);
  const preflightWarnings = currentPreflight?.nextGate?.warnings?.length || 0;
  const preflightBlockers = currentPreflight?.nextGate?.blockers?.length || 0;
  const hasPlan = Boolean(currentTask?.plan);
  const hasContext = Boolean(currentTask?.contextFiles?.length);
  const hasPatch = Boolean(currentTask?.patchProposal);
  const hasActivePatch = taskHasActivePatch(currentTask);
  const verified = taskHasCurrentSuccessfulVerification(currentTask);
  const completed = verified && Boolean(currentTask?.summary);
  const steps = buildWorkflowSteps();

  if (!hasPath) return {
    state: t("workflow.state.project"),
    copy: t("workflow.next.project"),
    primary: t("workflow.action.demo"),
    secondary: t("workflow.action.ownProject"),
    action: () => demoButton.click(),
    secondaryAction: () => { repoPath.focus(); repoPath.scrollIntoView({ behavior: "smooth", block: "center" }); },
    steps
  };
  if (!currentPreflight) return {
    state: t("workflow.state.preflight"),
    copy: t("workflow.next.preflight"),
    primary: t("workflow.action.preflight"),
    secondary: t("workflow.action.project"),
    action: () => preflightButton.click(),
    secondaryAction: () => { repoPath.focus(); repoPath.scrollIntoView({ behavior: "smooth", block: "center" }); },
    steps
  };
  if (preflightBlockers || preflightWarnings) return {
    state: preflightBlockers ? t("workflow.state.blocked") : t("workflow.state.warning"),
    copy: preflightBlockers ? t("workflow.next.blocked") : t("workflow.next.warning"),
    primary: t("workflow.action.rerunPreflight"),
    secondary: t("workflow.action.reviewPreflight"),
    action: () => preflightButton.click(),
    secondaryAction: () => document.querySelector("[data-workflow-section='preflight']")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    steps
  };
  if (!hasPlan) return {
    state: t("workflow.state.plan"),
    copy: t("workflow.next.plan"),
    primary: t("workflow.action.plan"),
    secondary: t("workflow.action.rerunPreflight"),
    action: () => {
      if (!goalInput.value.trim()) goalInput.value = currentTask?.goal || t("workflow.defaultGoal");
      planButton.click();
    },
    secondaryAction: () => preflightButton.click(),
    steps
  };
  if (!hasContext) return {
    state: t("workflow.state.context"),
    copy: t("workflow.next.context"),
    primary: suggestedContextFiles.length ? t("workflow.action.readContext") : t("workflow.action.chooseContext"),
    secondary: t("workflow.action.rerunPreflight"),
    action: runWorkflowContextAction,
    secondaryAction: () => preflightButton.click(),
    steps
  };
  if (!hasPatch) return {
    state: t("workflow.state.patch"),
    copy: t("workflow.next.patch"),
    primary: t("workflow.action.patch"),
    secondary: t("workflow.action.reviewContext"),
    action: runWorkflowPatchAction,
    secondaryAction: () => document.querySelector("[data-workflow-section='context']")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    steps
  };
  if (!hasActivePatch && !workspaceCanWrite()) return {
    state: t("workflow.state.workspace"),
    copy: t("workflow.next.workspace"),
    primary: disposableCopyPreview?.eligible ? t("workspace.button.create") : t("workspace.button.prepare"),
    secondary: t("workspace.button.refresh"),
    secondaryAction: () => refreshWorkspaces({ adoptActive: false }),
    action: runWorkspacePreparationAction,
    steps
  };
  if (!hasActivePatch) return {
    state: t("workflow.state.apply"),
    copy: t("workflow.next.apply"),
    primary: t("workflow.action.apply"),
    secondary: t("workflow.action.reviewPatch"),
    action: runWorkflowPatchAction,
    secondaryAction: () => document.querySelector("[data-workflow-section='patch']")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    steps
  };
  if (!verified) return {
    state: t("workflow.state.verify"),
    copy: t("workflow.next.verify"),
    primary: t("workflow.action.verify"),
    secondary: t("workflow.action.reviewApplied"),
    action: () => runVerifyButton.click(),
    secondaryAction: () => document.querySelector("[data-workflow-section='workspace']")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    steps
  };
  if (!completed) return {
    state: t("workflow.state.complete"),
    copy: t("workflow.next.complete"),
    primary: t("workflow.action.complete"),
    secondary: t("workflow.action.reviewVerify"),
    action: () => completeTaskButton.click(),
    secondaryAction: () => document.querySelector("[data-workflow-section='verify']")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    steps
  };
  return {
    state: t("workflow.state.done"),
    copy: t("workflow.next.done"),
    primary: t("workflow.action.audit"),
    secondary: t("workflow.action.newTask"),
    action: () => setActiveView("audit"),
    secondaryAction: () => { goalInput.focus(); goalInput.scrollIntoView({ behavior: "smooth", block: "center" }); },
    steps
  };
}

function renderWorkflow() {
  if (!workflowSteps || !workflowState || !workflowNext || !workflowPrimary || !workflowSecondary) return;
  const snapshot = buildWorkflowSnapshot();
  const current = snapshot.steps.find((step) => !step.done) || snapshot.steps.at(-1);
  workflowModel.currentStep = current.id;
  workflowModel.primaryAction = snapshot.action;
  workflowModel.secondaryAction = snapshot.secondaryAction;
  workflowState.textContent = snapshot.state;
  workflowNext.textContent = snapshot.copy;
  workflowPrimary.textContent = snapshot.primary;
  workflowSecondary.textContent = snapshot.secondary;
  workflowPrimary.disabled = typeof snapshot.action !== "function";
  workflowSecondary.disabled = typeof snapshot.secondaryAction !== "function";
  renderWorkflowSteps(snapshot.steps, current.id);
  const receiptMessage = renderPreflightReceipt();
  const statusMessage = receiptMessage || snapshot.copy;
  if (workflowStatus.dataset.message !== statusMessage) {
    workflowStatus.dataset.message = statusMessage;
    workflowStatus.textContent = statusMessage;
  }
}

function runWorkspacePreparationAction() {
  setActiveView("workspace");
  workspaceCapability?.closest(".workspace-safety-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (currentWorkspace?.kind === "original-readonly" && disposableCopyPreview?.eligible) {
    createCopyButton.click();
    return;
  }
  if (currentWorkspace?.kind === "original-readonly") previewCopyButton.click();
}

function setControlState(control, disabled, title = "") {
  if (!control) return;
  control.disabled = Boolean(disabled);
  control.title = disabled ? title : "";
}

function renderPreflightReceipt() {
  if (!preflightReceipt) return "";
  const visible = workflowModel.demoRequested
    && currentPreflight
    && currentWorkspace?.kind === "built-in-demo";
  preflightReceipt.hidden = !visible;
  if (!visible) {
    preflightReceipt.replaceChildren();
    return "";
  }
  const planReady = Boolean(currentTask?.plan);
  const readCount = currentTask?.contextFiles?.length || 0;
  const message = t("workflow.receipt.body", {
    plan: planReady ? t("model.output.yes") : t("model.output.no"),
    count: readCount,
    writes: 0,
    commands: 0
  });
  preflightReceipt.innerHTML = `
    <strong>${escapeHtml(t("workflow.receipt.title"))}</strong>
    <span>${escapeHtml(message)}</span>`;
  return message;
}

function renderRepoSummary(profile) {
  const languages = profile.languages?.map((item) => item.name).join(", ") || t("repo.unknown");
  const frameworks = profile.frameworks?.join(", ") || t("repo.none");
  const commands = profile.commands?.map((item) => item.command).join("\n") || t("repo.none");
  const runtimeBudgetEvidence = formatRuntimeBudgetEvidence(profile.budget, profile.truncated, profile.detailOmissions);
  repoSummary.innerHTML = `
    <div class="metric"><strong>${profile.fileCount}</strong><span>${escapeHtml(t("repo.metric.files"))}</span></div>
    <div class="metric"><strong>${profile.skippedCount}</strong><span>${escapeHtml(t("repo.metric.skipped"))}</span></div>
    <div class="metric"><strong>${escapeHtml(languages)}</strong><span>${escapeHtml(t("repo.metric.languages"))}</span></div>
    <div class="metric"><strong>${profile.frameworks?.length || 0}</strong><span>${escapeHtml(t("repo.metric.frameworks"))}</span></div>`;
  contextOutput.textContent = [
    `${t("repo.output.project")}: ${profile.name}`,
    `${t("repo.output.path")}: ${profile.rootPath}`,
    `${t("repo.output.languages")}: ${languages}`,
    `${t("repo.output.frameworks")}: ${frameworks}`,
    `${t("repo.output.commands")}:`,
    commands,
    ...(runtimeBudgetEvidence ? ["", `${t("runtimeBudget.title")}:`, runtimeBudgetEvidence] : []),
    "",
    `${t("repo.output.keyFiles")}:`,
    profile.keyFiles.join("\n")
  ].join("\n");
}

function renderPreflightReport(report) {
  if (!preflightOutput || !preflightState) return;
  if (!report) {
    preflightState.textContent = t("preflight.status.notRun");
    preflightOutput.textContent = t("preflight.default");
    return;
  }
  if (report.pending) {
    preflightState.textContent = t("preflight.status.running");
    preflightOutput.textContent = t("preflight.pending");
    return;
  }

  const warnings = report.nextGate?.warnings || [];
  const blockers = report.nextGate?.blockers || [];
  const runtimeBudgetEvidence = [
    formatRuntimeBudgetEvidence(report.repo?.budget, report.repo?.truncated, report.repo?.detailOmissions),
    formatRuntimeBudgetEvidence(report.search?.budget, report.search?.truncated),
    ...(report.readFiles || []).map((item) => formatRuntimeBudgetEvidence(item.budget, item.truncated))
  ].filter(Boolean);
  const coverage = report.contextCoverage || { sourceFiles: 0, testFiles: 0, docsOrMetadata: 0 };
  const status = blockers.length ? t("preflight.status.blocked") : warnings.length ? t("preflight.status.warn") : t("preflight.status.ok");
  preflightState.textContent = status;
  preflightOutput.innerHTML = `
    <div class="preflight-metrics">
      <div class="metric"><strong>${coverage.sourceFiles}</strong><span>${escapeHtml(t("preflight.metric.source"))}</span></div>
      <div class="metric"><strong>${coverage.testFiles}</strong><span>${escapeHtml(t("preflight.metric.tests"))}</span></div>
      <div class="metric"><strong>${coverage.docsOrMetadata}</strong><span>${escapeHtml(t("preflight.metric.docs"))}</span></div>
      <div class="metric"><strong>${report.writeAttempted ? escapeHtml(t("preflight.yes")) : escapeHtml(t("preflight.no"))}</strong><span>${escapeHtml(t("preflight.metric.write"))}</span></div>
    </div>
    <div class="preflight-gate ${blockers.length ? "blocked" : warnings.length ? "warn" : "ok"}">
      <strong>${escapeHtml(status)}</strong>
      <span>${escapeHtml(report.nextGate?.note || "")}</span>
    </div>
    ${currentTask?.plan && currentTask?.contextFiles?.length ? `
      <div class="preflight-auto-progress">
        <strong>${escapeHtml(t("preflight.autoProgress.title"))}</strong>
        <span>${escapeHtml(t("preflight.autoProgress.body", { count: currentTask.contextFiles.length }))}</span>
      </div>` : ""}
    <div class="preflight-next"><strong>${escapeHtml(t("preflight.next"))}</strong><span>${escapeHtml(preflightNextAction(report))}</span></div>
    ${blockers.length ? `<div class="preflight-list"><strong>${escapeHtml(t("preflight.blockers"))}</strong>${blockers.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</div>` : ""}
    ${warnings.length ? `<div class="preflight-list"><strong>${escapeHtml(t("preflight.warnings"))}</strong>${warnings.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</div>` : ""}
    ${runtimeBudgetEvidence.length ? `<div class="preflight-list"><strong>${escapeHtml(t("runtimeBudget.title"))}</strong>${runtimeBudgetEvidence.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</div>` : ""}
    <div class="preflight-list"><strong>${escapeHtml(t("preflight.context"))}</strong>${(report.contextFiles || []).map((item) => `<p>${escapeHtml(item.path)} <span>${escapeHtml(item.reason || "")}</span></p>`).join("") || `<p>${escapeHtml(t("preflight.noContext"))}</p>`}</div>
  `;
}

function formatRuntimeBudgetEvidence(budget, truncated = false, detailOmissions = []) {
  if (!budget?.operation) return "";
  const reasons = [...new Set([...(budget.reasons || []), ...(detailOmissions || [])])];
  const partial = truncated === true || reasons.length > 0;
  return t("runtimeBudget.evidence", {
    operation: budget.operation,
    status: t(partial ? "runtimeBudget.partial" : "runtimeBudget.complete"),
    reasons: reasons.join(", ") || t("repo.none")
  });
}

function renderRestoredPreflightNotice(session) {
  if (!preflightOutput || !preflightState) return;
  const project = session?.rootPath || repoProfile?.rootPath || t("preflight.restored.projectFallback");
  preflightState.textContent = t("preflight.restored.state");
  preflightOutput.innerHTML = `
    <div class="preflight-gate warn">
      <strong>${escapeHtml(t("preflight.restored.title"))}</strong>
      <span>${escapeHtml(t("preflight.restored.body", { project }))}</span>
    </div>
    <div class="preflight-next"><strong>${escapeHtml(t("preflight.restored.next"))}</strong><span>${escapeHtml(t("preflight.restored.nextBody"))}</span></div>
  `;
}

function preflightNextAction(report) {
  if (!report) return t("preflight.next.none");
  const blockers = report.nextGate?.blockers?.length || 0;
  const warnings = report.nextGate?.warnings?.length || 0;
  if (blockers) return t("preflight.next.blockers");
  if (warnings) return t("preflight.next.warnings");
  if (currentTask?.contextFiles?.length) return t("preflight.next.contextRead");
  return t("preflight.next.plan");
}

function renderVerifyCommands(commands) {
  verifyCommandSelect.innerHTML = "";
  if (!commands.length) {
    verifyState.textContent = t("verify.state.noCommand");
    verifyOutput.textContent = t("verify.output.noCommand");
    renderVerifyBoundary();
    return;
  }

  for (const [index, item] of commands.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${item.name}: ${item.command}`;
    verifyCommandSelect.append(option);
  }
  verifyState.textContent = t("verify.state.ready");
  verifyOutput.textContent = t("verify.output.ready");
  renderVerifyBoundary();
}

function renderVerifyBoundary() {
  if (!verifyBoundary) return;
  const command = selectedVerifyCommand();
  if (!command) {
    verifyBoundary.className = "boundary-note command-boundary empty";
    verifyBoundary.innerHTML = `<strong>${escapeHtml(t("verifyBoundary.title"))}</strong><span>${escapeHtml(t("verifyBoundary.empty"))}</span>`;
    return;
  }
  const workspaceGate = workspaceCommandGateStatus();
  if (workspaceGate.blocksCommand) {
    verifyBoundary.className = "boundary-note command-boundary blocked";
    verifyBoundary.innerHTML = `
      <strong>${escapeHtml(t("verifyBoundary.command", { command: command.command }))}</strong>
      <span>${escapeHtml(workspaceGate.detail)}</span>
    `;
    return;
  }
  const name = command.name || t("verifyBoundary.detectedCommand");
  verifyBoundary.className = "boundary-note command-boundary ready";
  verifyBoundary.innerHTML = `
    <strong>${escapeHtml(t("verifyBoundary.command", { command: command.command }))}</strong>
    <span>${escapeHtml(t("verifyBoundary.reason", { name }))}</span>
  `;
}

function renderPlan(plan) {
  timeline.innerHTML = plan.steps.map((step, index) => `
    <li><h4>${index + 1}. ${escapeHtml(step.title)}</h4><p>${escapeHtml(step.detail)}</p><div class="tool-list">${step.tools.map((tool) => `<span>${escapeHtml(tool)}</span>`).join("")}</div></li>`).join("");
}

async function callTool(tool, approved) {
  return request("/api/tools/call", { tool, args: argsForTool(tool), rootPath: repoProfile.rootPath, taskId: currentTask?.id, approved });
}

function argsForTool(tool) {
  const value = toolArg.value.trim();
  if (tool === "read_file") return { path: value };
  if (tool === "search_code") return { query: value };
  return {};
}

function renderToolResult(tool, result) {
  if (result.result?.diff) {
    toolOutput.textContent = `${tool} (${result.permission.level})\n\n${result.result.diff}`;
    return;
  }

  const payload = {
    tool,
    permission: result.permission,
    blocked: Boolean(result.blocked),
    truncated: result.truncated === true,
    budget: result.budget || undefined,
    result: result.result || result.message
  };
  toolOutput.textContent = formatToolPayload(payload);
}

function selectedVerifyCommand() {
  const index = Number.parseInt(verifyCommandSelect.value, 10);
  return repoProfile?.commands?.[index] || null;
}

function renderPathHelper(severity = "", message = "") {
  if (!pathHelper || !pathHelperCopy) return;
  pathHelper.className = `path-helper ${severity}`.trim();
  pathHelperCopy.textContent = message || t("path.helper.default");
}

function renderPathModeForInput(value) {
  if (!pathMode) return;
  const pathValue = String(value || "").trim();
  let titleKey = "path.mode.empty.title";
  let bodyKey = "path.mode.empty.body";
  let modeClass = "empty";
  if (pathValue === "C:\\Users\\you\\project") {
    titleKey = "path.mode.example.title";
    bodyKey = "path.mode.example.body";
    modeClass = "example";
  } else if (currentWorkspace?.kind === "built-in-demo") {
    titleKey = "path.mode.demo.title";
    bodyKey = "path.mode.demo.body";
    modeClass = "demo";
  } else if (currentWorkspace?.kind === "disposable-copy") {
    titleKey = "path.mode.copy.title";
    bodyKey = "path.mode.copy.body";
    modeClass = "copy";
  } else if (currentWorkspace?.kind === "original-readonly") {
    titleKey = "path.mode.real.title";
    bodyKey = "path.mode.real.body";
    modeClass = "real";
  } else if (pathValue) {
    titleKey = "path.mode.unverified.title";
    bodyKey = "path.mode.unverified.body";
    modeClass = "unverified";
  }
  pathMode.className = `path-mode ${modeClass}`;
  pathMode.innerHTML = `<strong>${escapeHtml(t(titleKey))}</strong><span>${escapeHtml(t(bodyKey))}</span>`;
}

function renderPathHelperForInput(value) {
  const pathValue = String(value || "").trim();
  if (!pathValue) {
    renderPathHelper("", t("path.helper.default"));
    return;
  }
  if (/\.(js|ts|tsx|jsx|json|md|py|java|go|rs|cs|cpp|c|h|txt|yml|yaml|toml|lock)$/i.test(pathValue)) {
    renderPathHelper("warn", t("path.looksFile"));
    return;
  }
  if (/\\(?:windows|program files|program files \(x86\)|system32)(?:\\|$)/i.test(pathValue)) {
    renderPathHelper("warn", t("path.looksProtected"));
    return;
  }
  if (pathValue === "C:\\Users\\you\\project") {
    renderPathHelper("warn", t("path.looksExample"));
    return;
  }
  renderPathHelper("ok", t("path.looksFolder"));
}

function renderVerifyResult(command, result) {
  if (result.blocked) {
    verifyOutput.textContent = t("verify.output.blocked");
    return;
  }

  const output = result.result;
  verifyOutput.textContent = [
    t("verify.output.command", { command: command.command }),
    t("verify.output.exitCode", { code: output.exitCode }),
    t("verify.output.duration", { duration: output.durationMs }),
    t("verify.output.timedOut", { value: output.timedOut ? t("model.output.yes") : t("model.output.no") }),
    "",
    t("verify.output.stdout"),
    output.stdout || t("verify.output.empty"),
    "",
    t("verify.output.stderr"),
    output.stderr || t("verify.output.empty")
  ].join("\n");
}

async function refreshModelStatus() {
  const payload = await request("/api/model/status");
  currentModelStatus = payload;
  renderModelStatus(payload);
}

function renderModelStatus(payload) {
  currentModelStatus = payload;
  const config = payload.config || {};
  const status = payload.status || {};
  modelPreset.value = inferModelPreset(config);
  modelType.value = config.type || "mock";
  modelBaseUrl.value = config.baseUrl || "";
  modelName.value = config.model || "";
  if (config.apiKey !== "configured") modelApiKey.value = "";
  updateModelPresetUi();
  renderModelCostHint();
  modelState.textContent = status.configured ? `${status.type}:${status.model}` : t("model.state.unconfigured");
  modelOutput.textContent = [
    t("model.output.provider", { provider: status.type }),
    t("model.output.model", { model: status.model }),
    t("model.output.configured", { configured: status.configured ? t("model.output.yes") : t("model.output.no") }),
    "",
    modelUsageAdvice(modelPreset.value)
  ].join("\n");
}

function applyModelPreset() {
  const preset = MODEL_PRESETS[modelPreset.value] || MODEL_PRESETS.custom;
  modelType.value = preset.type;
  modelBaseUrl.value = preset.baseUrl;
  modelName.value = preset.model;
  modelApiKey.value = "";
  updateModelPresetUi();
  renderModelCostHint();
  renderWorkflow();
  updateControls();
}

function updateModelPresetUi() {
  const preset = MODEL_PRESETS[modelPreset.value] || MODEL_PRESETS.custom;
  modelType.disabled = modelPreset.value !== "custom" && modelPreset.value !== "mock";
  modelBaseUrl.disabled = modelPreset.value === "mock";
  modelApiKey.placeholder = t(preset.apiKeyPlaceholderKey);
  modelName.placeholder = modelPreset.value === "openai" ? t("model.name.placeholder.openai") : modelPreset.value === "custom" ? t("model.name.placeholder") : preset.model || t("model.name.placeholder");
}

function renderModelCostHint() {
  if (!modelCostHint) return;
  const costProfile = MODEL_COST_PROFILES[modelPreset.value] || MODEL_COST_PROFILES.custom;
  modelCostHint.className = `model-cost-hint ${costProfile.badge}`;
  modelCostHint.innerHTML = `
    <strong>${escapeHtml(t(costProfile.titleKey))}</strong>
    <span>${escapeHtml(t(costProfile.levelKey))}</span>
    <p>${escapeHtml(t(costProfile.detailKey))}</p>
  `;
}

function modelUsageAdvice(presetValue) {
  const costProfile = MODEL_COST_PROFILES[presetValue] || MODEL_COST_PROFILES.custom;
  if (presetValue === "deepseek-flash") return t("model.usage.flash");
  if (presetValue === "deepseek-pro") return t("model.usage.pro");
  return t("model.usage.default", { detail: t(costProfile.detailKey) });
}

function inferModelPreset(config = {}) {
  if (config.type === "mock") return "mock";
  const baseUrl = String(config.baseUrl || "");
  const model = String(config.model || "");
  const name = String(config.name || "");
  if (name === "dashscope" || baseUrl.includes("dashscope.aliyuncs.com")) return "dashscope";
  if (name === "deepseek-flash" || model === "deepseek-v4-flash") return "deepseek-flash";
  if (name === "deepseek-pro" || name === "deepseek" || baseUrl.includes("api.deepseek.com")) return "deepseek-pro";
  if (name === "openai" || baseUrl.includes("api.openai.com")) return "openai";
  return "custom";
}

function renderContextCandidates(files) {
  if (!files.length) {
    contextCandidates.innerHTML = "";
    return;
  }
  contextCandidates.innerHTML = files.map((file, index) => `
    <label>
      <input type="checkbox" data-context-index="${index}" checked />
      <span><strong>${escapeHtml(file.path)}</strong>${escapeHtml(file.reason || "")}</span>
    </label>`).join("");
}

function renderPatchProposal(proposal) {
  const files = patchProposalFiles(proposal);
  if (!files.length) {
    const reasonKey = patchFailureReasonKey(proposal?.reason);
    patchState.textContent = reasonKey ? t(`${reasonKey}.state`) : proposal?.reason || t("patch.state.none");
    patchOutput.textContent = reasonKey
      ? t(`${reasonKey}.body`)
      : [proposal?.summary || t("patch.output.noApplicableDraft"), proposal?.note ? `\n${proposal.note}` : ""].join("");
    return;
  }
  patchState.textContent = patchTargetLabel(proposal);
  patchOutput.innerHTML = `
    <div class="patch-review">${renderPatchReview(proposal, currentTask)}</div>
    ${files.map((file) => {
      const stats = diffStats(file.diff || "");
      return `
    <div class="patch-file">
      <div class="patch-file-head"><strong>${escapeHtml(file.path)}</strong><span>+${stats.added} -${stats.removed}</span></div>
      <p>${escapeHtml(file.summary || proposal.summary || "")}</p>
      <pre>${escapeHtml(file.diff || t("patch.diff.none"))}</pre>
    </div>`;
    }).join("")}
  `;
}

function patchFailureReasonKey(reason) {
  return {
    unsupported_goal: "patch.failure.unsupportedGoal",
    missing_test_context: "patch.failure.missingTestContext",
    missing_context_content: "patch.failure.missingContextContent"
  }[reason] || "";
}

function selectedContextFiles() {
  return [...contextCandidates.querySelectorAll("input[data-context-index]:checked")]
    .map((input) => suggestedContextFiles[Number.parseInt(input.dataset.contextIndex, 10)])
    .filter(Boolean);
}

async function refreshMemory() {
  if (!repoProfile) {
    renderMemory(null);
    return;
  }
  const target = captureWorkflowTarget(false);
  try {
    const payload = await request(`/api/memory?rootPath=${encodeURIComponent(repoProfile.rootPath)}`);
    if (!workflowTargetIsCurrent(target)) return;
    currentMemory = payload.memory;
    renderMemory(currentMemory);
  } catch (error) {
    if (!workflowTargetIsCurrent(target)) return;
    memoryState.textContent = t("memory.state.loadFailed");
    memoryOutput.textContent = friendlyErrorMessage(error);
  }
}

function renderMemory(memory) {
  if (!memory) {
    memoryState.textContent = t("memory.state.noProject");
    memoryOutput.textContent = t("memory.output.empty");
    memoryNotes.value = "";
    return;
  }

  const unknown = t("repo.unknown");
  const none = t("repo.none");
  const languages = memory.profile?.languages?.map((item) => `${item.name} (${item.count})`).join(", ") || unknown;
  const frameworks = memory.profile?.frameworks?.join(", ") || none;
  const packageManagers = memory.profile?.packageManagers?.join(", ") || none;
  const commands = memory.commands?.length ? memory.commands.map((item) => `- ${item.name || t("repo.output.commands")}: ${item.command}`).join("\n") : `- ${none}`;
  const tasks = memory.taskSummaries?.length
    ? memory.taskSummaries.slice(-6).reverse().map((item) => `- ${item.goal || item.taskId}: ${item.summary || item.status || t("workflow.state.done")}`).join("\n")
    : `- ${none}`;
  memoryState.textContent = memory.name || t("memory.state.loaded");
  memoryNotes.value = memory.notes || "";
  memoryOutput.textContent = [
    `${t("repo.output.project")}: ${memory.name}`,
    `${t("repo.output.path")}: ${memory.rootPath}`,
    `${t("repo.metric.files")}: ${memory.profile?.fileCount || 0} (${t("repo.metric.skipped")}: ${memory.profile?.skippedCount || 0})`,
    `${t("repo.output.languages")}: ${languages}`,
    `${t("repo.output.frameworks")}: ${frameworks}`,
    `${t("memory.output.packageManagers")}: ${packageManagers}`,
    `${t("memory.output.scannedAt")}: ${memory.profile?.scannedAt || unknown}`,
    "",
    `${t("repo.output.commands")}:`,
    commands,
    "",
    `${t("repo.output.keyFiles")}:`,
    (memory.profile?.keyFiles || []).slice(0, 12).map((file) => `- ${file}`).join("\n") || `- ${none}`,
    "",
    `${t("memory.output.recentTasks")}:`,
    tasks
  ].join("\n");
}

function renderTask(task) {
  if (!task) {
    taskState.textContent = t("task.state.none");
    taskSummary.textContent = t("task.summary.empty");
    reviewDraft.textContent = t("task.review.empty");
    patchState.textContent = t("patch.state.none");
    renderWorkflow();
    return;
  }

  taskState.textContent = task.status;
  if (task.patchProposal) renderPatchProposal(task.patchProposal);
  renderRevertPatchOptions(task);
  const planText = task.plan ? `${task.plan.title} (${t("task.summary.steps", { count: task.plan.steps.length })})` : t("task.plan.none");
  const verification = task.verification
    ? t("task.summary.verificationDetail", {
        exitCode: task.verification.exitCode,
        timedOut: task.verification.timedOut ? t("model.output.yes") : t("model.output.no")
      })
    : t("task.verification.notRun");
  const latestModelEvent = task.modelEvents?.at(-1);
  const latestModelEventText = latestModelEvent
    ? t("task.summary.modelEventDetail", {
        operation: latestModelEvent.operation || t("task.value.empty"),
        provider: latestModelEvent.provider || t("task.value.empty"),
        model: latestModelEvent.model || t("task.value.empty"),
        status: latestModelEvent.status || t("task.value.empty")
      })
    : t("task.value.empty");
  const activePatches = task.appliedPatches?.filter((patch) => !patch.revertedAt).length || 0;
  taskSummary.textContent = [
    `${t("task.summary.goal")}: ${task.goal}`,
    `${t("task.summary.task")}: ${task.id}`,
    `${t("task.summary.plan")}: ${planText}`,
    `${t("task.summary.toolCalls")}: ${task.toolCalls.length}`,
    `${t("task.summary.contextFiles")}: ${task.contextFiles?.length || 0}`,
    `${t("task.summary.modelEvents")}: ${task.modelEvents?.length || 0}`,
    `${t("task.summary.patchDraft")}: ${task.patchProposal ? patchTargetLabel(task.patchProposal) : t("task.patch.none")}`,
    `${t("task.summary.appliedPatches")}: ${activePatches}`,
    `${t("task.summary.verification")}: ${verification}`,
    `${t("task.summary.failure")}: ${task.failureSummary ? task.failureSummary.slice(0, 220) : t("task.failure.none")}`,
    `${t("task.summary.summary")}: ${task.summary || t("task.value.empty")}`,
    "",
    `${t("task.summary.latestModelEvent")}: ${latestModelEventText}`
  ].join("\n");
  reviewDraft.textContent = task.reviewDraft || t("task.review.empty");
  renderWorkflow();
}

function renderPatchReview(proposal, task) {
  const model = patchReviewModel(proposal, task);
  return model.chips.map((note) => `<span>${escapeHtml(note)}</span>`).join("");
}

function patchReviewModel(proposal, task) {
  const files = patchProposalFiles(proposal);
  const paths = files.map((file) => file.path);
  const total = files.reduce((sum, file) => {
    const stats = diffStats(file.diff || "");
    return { added: sum.added + stats.added, removed: sum.removed + stats.removed };
  }, { added: 0, removed: 0 });
  const activePatches = task?.appliedPatches?.filter((patch) => !patch.revertedAt).length || 0;
  const notes = [];
  const risks = [];
  notes.push(t("patch.review.chip.count", { count: files.length, added: total.added, removed: total.removed }));
  if (files.length > 1) notes.push(t("patch.review.chip.multi"));
  if (paths.some((item) => /test|spec/i.test(item))) {
    notes.push(t("patch.review.chip.tests"));
    risks.push(t("patch.risk.tests"));
  } else {
    notes.push(t("patch.review.chip.noTests"));
    risks.push(t("patch.risk.noTests"));
  }
  if (paths.some((item) => /package\.json|lock|config|\.env|settings/i.test(item))) {
    notes.push(t("patch.review.chip.config"));
    risks.push(t("patch.risk.config"));
  }
  if (files.length > 1) risks.push(t("patch.risk.multi"));
  if (total.removed > 0) risks.push(t("patch.risk.removed"));
  if (activePatches) {
    notes.push(t("patch.review.chip.active", { count: activePatches }));
    risks.push(t("patch.risk.active", { count: activePatches }));
  }
  if (!risks.length) risks.push(t("patch.risk.low"));
  return {
    files,
    paths,
    total,
    chips: notes,
    risks,
    summary: proposal?.summary || task?.goal || t("patch.summary.fallback")
  };
}

function diffStats(diff) {
  const stats = { added: 0, removed: 0 };
  for (const line of String(diff || "").split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) stats.added += 1;
    if (line.startsWith("-")) stats.removed += 1;
  }
  return stats;
}

function patchProposalFiles(proposal) {
  if (!proposal) return [];
  if (proposal.files?.length) return proposal.files;
  if (proposal.path && typeof proposal.content === "string") return [{ path: proposal.path, content: proposal.content, diff: proposal.diff, summary: proposal.summary }];
  return [];
}

function patchTargetLabel(proposal) {
  const files = patchProposalFiles(proposal);
  if (!files.length) return t("patch.target.none");
  if (files.length === 1) return files[0].path;
  return t("patch.target.files", { count: files.length });
}

function renderRevertPatchOptions(task) {
  const active = (task?.appliedPatches || [])
    .map((patch, index) => ({ ...patch, index }))
    .filter((patch) => !patch.revertedAt)
    .reverse();
  revertPatchSelect.innerHTML = active.length
    ? active.map((patch) => `<option value="${patch.index}">${escapeHtml(patch.path)}</option>`).join("")
    : `<option value="">${escapeHtml(t("patch.revert.none"))}</option>`;
}

function workflowPreflightDetail() {
  if (!currentPreflight) return t("workflow.step.preflight.todo");
  const blockers = currentPreflight.nextGate?.blockers?.length || 0;
  const warnings = currentPreflight.nextGate?.warnings?.length || 0;
  if (blockers) return t("workflow.step.preflight.blockers", { count: blockers });
  if (warnings) return t("workflow.step.preflight.warnings", { count: warnings });
  return t("workflow.step.preflight.done");
}

function buildWorkflowSteps() {
  const hasPath = Boolean(repoPath.value.trim() || repoProfile?.rootPath);
  const preflightBlockers = currentPreflight?.nextGate?.blockers?.length || 0;
  const preflightWarnings = currentPreflight?.nextGate?.warnings?.length || 0;
  const preflightReady = Boolean(currentPreflight) && preflightBlockers === 0 && preflightWarnings === 0;
  const activePatches = currentTask?.appliedPatches?.filter((patch) => !patch.revertedAt).length || 0;
  const verified = taskHasCurrentSuccessfulVerification(currentTask);
  const patchGateStatus = currentTask?.patchProposal ? applyPatchGateStatus() : preflightPatchGateStatus();
  const commandGateStatus = workspaceCommandGateStatus();
  const contextDetail = currentTask?.contextFiles?.length
    ? t("workflow.step.context.done", { count: currentTask.contextFiles.length })
    : suggestedContextFiles.length
      ? t("workflow.step.context.selected", { count: selectedContextFiles().length || suggestedContextFiles.length })
      : t("workflow.step.context.todo");
  const workspaceDetail = activePatches
    ? t("workflow.step.workspace.applied", { count: activePatches })
    : workspaceCanWrite()
      ? t("workflow.step.workspace.apply")
      : t("workflow.step.workspace.prepare");
  return [
    { id: "project", title: t("workflow.step.project.title"), detail: hasPath ? t("workflow.step.project.done") : t("workflow.step.project.todo"), blocked: false, done: hasPath },
    { id: "preflight", title: t("workflow.step.preflight.title"), detail: workflowPreflightDetail(), blocked: !hasPath || preflightBlockers > 0 || preflightWarnings > 0, done: preflightReady },
    { id: "plan", title: t("workflow.step.plan.title"), detail: currentTask?.plan ? t("workflow.step.plan.done") : t("workflow.step.plan.todo"), blocked: !preflightReady, done: Boolean(currentTask?.plan) },
    { id: "context", title: t("workflow.step.context.title"), detail: contextDetail, blocked: !currentTask?.plan, done: Boolean(currentTask?.contextFiles?.length) },
    { id: "patch", title: t("workflow.step.patch.title"), detail: patchGateStatus.blocksPatch ? patchGateStatus.title : currentTask?.patchProposal ? t("workflow.step.patch.done") : t("workflow.step.patch.todo"), blocked: patchGateStatus.blocksPatch, done: Boolean(currentTask?.patchProposal) },
    { id: "workspace", title: t("workflow.step.workspace.title"), detail: workspaceDetail, blocked: !currentTask?.patchProposal, done: activePatches > 0 },
    { id: "verify", title: t("workflow.step.verify.title"), detail: currentTask?.verification ? verified ? t("workflow.step.verify.done", { code: currentTask.verification.exitCode }) : t("verify.state.failed") : commandGateStatus.blocksCommand ? commandGateStatus.detail : t("workflow.step.verify.todo"), blocked: !activePatches || commandGateStatus.blocksCommand, done: verified },
    { id: "complete", title: t("workflow.step.complete.title"), detail: currentTask?.summary && verified ? t("workflow.step.complete.done") : t("workflow.step.complete.todo"), blocked: !verified, done: Boolean(currentTask?.summary) && verified }
  ];
}

function runWorkflowContextAction() {
  setActiveView("workspace");
  if (!currentTask) {
    planButton.click();
    return;
  }
  if (suggestedContextFiles.length) {
    readContextButton.click();
    return;
  }
  contextButton.click();
}

function runWorkflowPatchAction() {
  setActiveView("workspace");
  if (!currentTask?.patchProposal) {
    proposePatchButton.click();
    return;
  }
  applyPatchButton.click();
}

function renderWorkflowSteps(steps, currentStep) {
  const nodes = new Map([...workflowSteps.querySelectorAll("[data-workflow-step]")].map((node) => [node.dataset.workflowStep, node]));
  for (const [index, step] of steps.entries()) {
    const node = nodes.get(step.id);
    if (!node) continue;
    node.className = workflowStepClass(step, step.id === currentStep);
    node.querySelector("strong").textContent = `${index + 1}. ${step.title}`;
    node.querySelector("span").textContent = step.detail;
    if (step.id === currentStep) node.setAttribute("aria-current", "step");
    else node.removeAttribute("aria-current");
  }
}

function workflowStepClass(step, current) {
  if (step.done) return "done";
  if (current) return step.blocked ? "active blocked" : "active";
  return "pending";
}

async function refreshAudit() {
  const query = repoProfile ? `?rootPath=${encodeURIComponent(repoProfile.rootPath)}&limit=20` : "?limit=20";
  const payload = await request(`/api/audit/events${query}`);
  currentAuditEvents = payload.events || [];
  renderAudit(currentAuditEvents);
}

function renderAudit(events) {
  auditState.textContent = events.length ? t("audit.state.count", { count: events.length }) : t("audit.state.none");
  if (!events.length) {
    auditList.innerHTML = `<li class="empty">${escapeHtml(t("audit.empty"))}</li>`;
    return;
  }

  auditList.innerHTML = events.map((event) => `
    <li class="${escapeHtml(event.status)}">
      <div><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(event.status)}</span></div>
      <p>${escapeHtml(event.detail || event.type)}</p>
      <time>${escapeHtml(formatTime(event.time))}</time>
    </li>`).join("");
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
}

function formatToolPayload(payload) {
  if (typeof payload.result === "string") return `${payload.tool} (${payload.permission.level})\n\n${payload.result}`;
  return JSON.stringify(payload, null, 2);
}

async function requestManagedOperation(kind, url, body) {
  if (activeOperations.has(kind)) {
    const error = new Error(t("operation.error.busy"));
    error.code = "OPERATION_CLIENT_BUSY";
    throw error;
  }
  const operation = {
    id: createOperationId(kind),
    kind,
    cancelling: false
  };
  activeOperations.set(kind, operation);
  renderActiveOperationControls();
  try {
    return await request(url, { ...body, operationId: operation.id });
  } finally {
    if (activeOperations.get(kind) === operation) activeOperations.delete(kind);
    renderActiveOperationControls();
  }
}

async function cancelActiveOperation(kind, stateElement) {
  const operation = activeOperations.get(kind);
  if (!operation || operation.cancelling) return;
  operation.cancelling = true;
  if (stateElement) stateElement.textContent = t("operation.state.cancelling");
  renderActiveOperationControls();
  try {
    await request("/api/operations/cancel", { operationId: operation.id });
  } catch (error) {
    operation.cancelling = false;
    if (stateElement) stateElement.textContent = friendlyErrorMessage(error);
    renderActiveOperationControls();
  }
}

function renderActiveOperationControls() {
  for (const [kind, button] of [
    ["scan", cancelScanButton],
    ["preflight", cancelPreflightButton],
    ["model-send", cancelModelOperationButton],
    ["verify", cancelVerifyButton]
  ]) {
    const operation = activeOperations.get(kind);
    button.hidden = !operation;
    button.disabled = !operation || operation.cancelling;
  }
}

function createOperationId(kind) {
  if (globalThis.crypto?.randomUUID) return `${kind}-${globalThis.crypto.randomUUID()}`;
  const values = new Uint32Array(2);
  globalThis.crypto?.getRandomValues?.(values);
  return `${kind}-${Date.now().toString(36)}-${values[0].toString(36)}${values[1].toString(36)}`;
}

function operationWasCancelled(error) {
  return error?.code === "OPERATION_CANCELLED" || error?.code === "request_cancelled";
}

async function request(url, body) {
  const headers = body ? { "content-type": "application/json" } : {};
  if (launcherPageIdentity.candidateId && launcherPageIdentity.instanceId) {
    headers["x-codeclaw-candidate-id"] = launcherPageIdentity.candidateId;
    headers["x-codeclaw-instance-id"] = launcherPageIdentity.instanceId;
  }
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (!response.ok || (payload.ok === false && !payload.blocked)) {
    const error = new Error(payload.error || payload.message || "Request failed");
    error.code = payload.code;
    error.status = response.status;
    if (error.code === "LAUNCHER_PAGE_IDENTITY_MISMATCH") lockInterfaceForLauncherMismatch();
    throw error;
  }
  return payload;
}

function friendlyErrorMessage(error) {
  const message = String(error?.message || error || t("error.unknown"));
  const codeMessage = `${error?.code || ""} ${message}`;
  const structuredRules = [
    [/OPERATION_CANCELLED|request_cancelled/, t("error.operationCancelled")],
    [/OPERATION_(?:COMMIT_)?TIMEOUT|request_timeout/, t("error.operationTimeout")],
    [/OPERATION_(?:LIMIT_REACHED|KIND_LIMIT_REACHED|ID_CONFLICT|CLIENT_BUSY)/, t("error.operationBusy")],
    [/OPERATION_(?:COMMITTING|NOT_CANCELLABLE)/, t("error.operationCommitting")],
    [/WORKSPACE_ORIGINAL_READ_?ONLY|WORKSPACE_WRITE_FORBIDDEN/, t("error.workspaceOriginalReadonly")],
    [/WORKSPACE_COMMAND_FORBIDDEN|WORKSPACE_TOOL_NOT_ALLOWED/, t("error.workspaceCommandForbidden")],
    [/WORKSPACE_CLEANUP_ACTIVE/, t("workspace.cleanup.activeBlocked")],
    [/WORKSPACE_COPY_PREVIEW_STALE|WORKSPACE_COPY_SOURCE_CHANGED|DATA_BOUNDARY_SOURCE_CHANGED/, t("error.copyPreviewStale")],
    [/WORKSPACE_COPY_BLOCKED|COPY_POLICY_BLOCKED|DATA_BOUNDARY_(?:BYTE|FILE)_LIMIT/, t("error.copyPreviewBlocked")],
    [/WORKSPACE_COPY_(?:MANIFEST_CHANGED|MARKER_INVALID|RECORD_INVALID|VERIFY_FAILED)|DATA_BOUNDARY_(?:MANIFEST_INVALID|COPY_VERIFY_FAILED)/, t("error.copyManifestMismatch")],
    [/WORKSPACE_(?:COPY|CLEANUP)_OWNERSHIP_CHANGED|WORKSPACE_CLEANUP_(?:PENDING|ENTRY_UNSAFE)|WORKSPACE_OWNERSHIP_STATE_MISSING/, t("error.copyOwnership")],
    [/WORKSPACE_COPY_(?:PATH_INVALID|SOURCE_UNSAFE|ROOT_CHANGED|IDENTITY_CHANGED)|WORKSPACE_CLEANUP_LINK_FOUND|DATA_BOUNDARY_(?:PATH_CHANGED|ROOT_MISSING|ROOT_UNSAFE|IGNORE_UNREADABLE|IGNORE_UNSAFE)/, t("error.copyBoundary")],
    [/WORKSPACE_(?:CAPABILITY_MISMATCH|ACTIVATION_REQUIRED|APPROVAL_STALE|CONTEXT_MISSING|TASK_RESCAN_REQUIRED|UNKNOWN|IDENTITY_CHANGED|ORIGINAL_CHANGED|DEMO_CHANGED|OWNER_INVALID|STATE_INTEGRITY_FAILED|STATE_MISSING)/, t("error.workspaceInvalid")],
    [/MODEL_PREVIEW_(?:UNKNOWN|APPROVAL_MISMATCH|INTEGRITY_FAILED)|MODEL_(?:CONFIG|TASK|WORKSPACE|SOURCE)_CHANGED(?:_AFTER_SEND)?/, t("error.modelReviewStale")],
    [/MODEL_(?:REQUEST_TOO_LARGE|DISCLOSURE_PATH_BLOCKED|MANIFEST_INELIGIBLE|REQUEST_INVALID|OPERATION_INVALID)/, t("error.modelReviewBlocked")],
    [/MODEL_SEND_APPROVAL_REQUIRED/, t("error.modelReviewApproval")],
    [/PATCH_APPROVAL_STALE/, t("error.patchApprovalStale")],
    [/PROJECT_WRITE_LOCKED/, t("error.projectWriteLocked")],
    [/TASK_STORE_LOCKED/, t("error.taskStoreLocked")],
    [/PATCH_RECOVERY_REQUIRED/, t("error.patchRecoveryRequired")],
    [/PATCH_TRANSACTION_REQUIRED/, t("error.patchTransactionRequired")],
    [/PATCH_TRANSACTION_STATE_ERROR/, t("error.patchTransactionState")],
    [/PATCH_WRITE_VERIFY_FAILED/, t("error.patchWriteVerify")],
    [/PATCH_NON_UTF8_REFUSED/, t("error.patchNonUtf8")],
    [/PATCH_BASELINE_CONFLICT/, t("error.patchBaselineConflict")],
    [/PATCH_BASELINE_MISSING/, t("error.patchBaselineMissing")],
    [/PATCH_DUPLICATE_PATH/, t("error.patchDuplicatePath")],
    [/PATCH_APPLY_ROLLBACK_INCOMPLETE/, t("error.patchRollbackIncomplete")],
    [/PATCH_APPLY_FAILED/, t("error.patchApplyFailed")],
    [/PATCH_REVERT_CONFLICT/, t("error.patchRevertConflict")],
    [/PATCH_REVERT_BASELINE_MISSING|PATCH_REVERT_STATE_ERROR/, t("error.patchRevertState")],
    [/PATH_SYMLINK_REFUSED/, t("error.pathSymlink")],
    [/PATH_HARDLINK_REFUSED/, t("error.pathHardlink")]
  ];
  const structured = structuredRules.find(([pattern]) => pattern.test(codeMessage));
  if (structured) return structured[1];
  const rules = [
    [/PATH_EMPTY|Missing repository path|Enter a path|repository path/i, t("error.path.empty")],
    [/PATH_NOT_FOUND|ENOENT|no such file|cannot find|找不到/i, t("error.path.notFound")],
    [/PATH_IS_FILE|not a directory|ENOTDIR/i, t("error.path.file")],
    [/PATH_PERMISSION_DENIED|EACCES|EPERM|permission denied|access is denied|拒绝访问/i, t("error.path.permission")],
    [/Scan a repository before/i, t("error.scanFirst")],
    [/Create a task before/i, t("error.taskFirst")],
    [/No applicable patch proposal/i, t("error.patchMissing")],
    [/No applied patch to revert/i, t("error.revertMissing")],
    [/No detected verification command|No runnable command/i, t("error.verifyMissing")],
    [/fetch|Failed to fetch|NetworkError/i, t("error.fetch")],
    [/API key|401|403|unauthorized|forbidden/i, t("error.auth")],
    [/timeout|timed out/i, t("error.timeout")],
    [/Request failed/i, t("error.request")]
  ];
  const matched = rules.find(([pattern]) => pattern.test(codeMessage));
  return matched ? `${matched[1]}\n\n${t("error.original", { message })}` : t("error.generic", { message });
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
