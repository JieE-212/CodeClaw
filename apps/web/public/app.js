import { initI18n, t } from "./i18n.js";

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
const examplePathButton = document.querySelector("#examplePathButton");
const demoButton = document.querySelector("#demoButton");
const preflightButton = document.querySelector("#preflightButton");
const preflightState = document.querySelector("#preflightState");
const preflightOutput = document.querySelector("#preflightOutput");
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
const patchContent = document.querySelector("#patchContent");
const callToolButton = document.querySelector("#callToolButton");
const toolOutput = document.querySelector("#toolOutput");
const toolState = document.querySelector("#toolState");
const verifyCommandSelect = document.querySelector("#verifyCommandSelect");
const runVerifyButton = document.querySelector("#runVerifyButton");
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
const proposePatchButton = document.querySelector("#proposePatchButton");
const applyPatchButton = document.querySelector("#applyPatchButton");
const revertPatchButton = document.querySelector("#revertPatchButton");
const revertPatchSelect = document.querySelector("#revertPatchSelect");
const patchOutput = document.querySelector("#patchOutput");
const patchState = document.querySelector("#patchState");
const patchGate = document.querySelector("#patchGate");
const applyReview = document.querySelector("#applyReview");
const guideSteps = document.querySelector("#guideSteps");
const guideState = document.querySelector("#guideState");
const guideNextButton = document.querySelector("#guideNextButton");
const nextStepHint = document.querySelector("#nextStepHint");
const quickStartState = document.querySelector("#quickStartState");
const quickStartCopy = document.querySelector("#quickStartCopy");
const quickStartList = document.querySelector("#quickStartList");
const quickStartPrimary = document.querySelector("#quickStartPrimary");
const quickStartSecondary = document.querySelector("#quickStartSecondary");
let repoProfile = null;
let currentTask = null;
let currentMemory = null;
let currentPreflight = null;
let currentAuditEvents = [];
let currentModelStatus = null;
let suggestedContextFiles = [];
let systemInfo = null;
let activeView = "workspace";
const RECENT_REPOS_KEY = "codeclaw.recentRepos.v1";
const MODEL_PRESETS = {
  mock: { type: "mock", baseUrl: "", model: "mock-codeclaw", apiKeyPlaceholder: "API key" },
  dashscope: { type: "openai-compatible", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", apiKeyPlaceholder: "DashScope API key" },
  "deepseek-pro": { type: "openai-compatible", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro", apiKeyPlaceholder: "DeepSeek API key" },
  "deepseek-flash": { type: "openai-compatible", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", apiKeyPlaceholder: "DeepSeek API key" },
  openai: { type: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "", apiKeyPlaceholder: "OpenAI API key" },
  custom: { type: "openai-compatible", baseUrl: "", model: "", apiKeyPlaceholder: "API key or local dummy value" }
};
const MODEL_COST_GUIDE = {
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

initI18n({ select: languageSelect });
boot();
syncToolInputs();
bindNavigation();
bindI18n();
setActiveView(activeView);
renderRecentRepos();
renderPathHelperForInput(repoPath?.value || "");
renderPathModeForInput(repoPath?.value || "");
renderGuide();
updateControls();

async function boot() {
  try {
    const health = await request("/api/health");
    healthStatus.textContent = health.ok ? t("health.online") : t("health.error");
    healthStatus.classList.toggle("ok", Boolean(health.ok));
    systemInfo = await request("/api/system/check");
    renderSystemCheck(systemInfo);
    renderPathModeForInput(repoPath?.value || "");
    await refreshModelStatus();
    await restoreLastSession();
    await refreshAudit();
  } catch {
    healthStatus.textContent = t("health.offline");
    renderSystemCheck(null, t("system.offline.detail"));
  }
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
  systemCheck.className = `system-check ${info.demoExists ? "ok" : "warn"}`;
  systemCheck.textContent = `${info.node} / ${demoState} / ${model}`;
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
    renderGuide();
    syncToolInputs();
    updateControls();
  });
}

function setActiveView(view) {
  activeView = view || "workspace";
  document.body.dataset.activeView = activeView;
  for (const item of navItems) {
    item.classList.toggle("active", item.dataset.navView === activeView);
  }
  for (const panel of viewPanels) {
    const views = String(panel.dataset.view || "").split(/\s+/);
    panel.classList.toggle("hidden", !views.includes(activeView));
  }
  const copy = {
    workspace: [t("view.workspace.eyebrow"), t("view.workspace.title")],
    memory: [t("view.memory.eyebrow"), t("view.memory.title")],
    audit: [t("view.audit.eyebrow"), t("view.audit.title")],
    settings: [t("view.settings.eyebrow"), t("view.settings.title")]
  }[activeView] || ["CodeClaw", t("view.workspace.title")];
  if (viewEyebrow) viewEyebrow.textContent = copy[0];
  if (viewTitle) viewTitle.textContent = copy[1];
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
  if (!payload.session || !payload.profile) {
    await refreshTask();
    return;
  }

  repoProfile = payload.profile;
  currentTask = payload.task || currentTask;
  currentMemory = payload.memory || currentMemory;
  currentPreflight = null;
  repoPath.value = repoProfile.rootPath;
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
  updateControls();
}

demoButton.addEventListener("click", () => {
  setActiveView("workspace");
  if (systemInfo?.demoPath) repoPath.value = systemInfo.demoPath;
  if (!goalInput.value.trim()) goalInput.value = t("demo.goal.default");
  renderPathHelper("ok", t("path.demo"));
  renderPathModeForInput(repoPath.value);
  updateControls();
  if (repoPath.value.trim()) preflightButton.click();
});

examplePathButton?.addEventListener("click", () => {
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
  currentPreflight = null;
  renderPreflightReport(null);
  renderPathHelperForInput(repoPath.value);
  renderPathModeForInput(repoPath.value);
  updateControls();
});
goalInput.addEventListener("input", () => {
  currentPreflight = null;
  renderPreflightReport(null);
  renderGuide();
  updateControls();
});
contextCandidates.addEventListener("change", () => {
  renderGuide();
  updateControls();
});

scanButton.addEventListener("click", async () => {
  const path = repoPath.value.trim();
  if (!path) {
    scanState.textContent = t("scan.state.enterPath");
    renderPathHelper("error", t("path.empty"));
    return;
  }
  scanButton.disabled = true;
  scanState.textContent = t("scan.state.scanning");
  renderPathHelper("warn", t("path.checking"));
  try {
    const result = await request("/api/repo/scan", { path });
    repoProfile = result.profile;
    currentPreflight = null;
    renderPreflightReport(null);
    rememberRepo(repoProfile);
    renderPathHelper("ok", t("path.scanOk"));
    renderPathModeForInput(repoPath.value);
    scanState.textContent = t("scan.state.scanned");
    toolState.textContent = t("tool.state.ready");
    renderRepoSummary(repoProfile);
    renderVerifyCommands(repoProfile.commands || []);
    await refreshTask();
    await refreshMemory();
    renderGuide();
    await refreshAudit();
  } catch (error) {
    scanState.textContent = t("scan.state.failed");
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
  preflightButton.disabled = true;
  preflightState.textContent = t("preflight.state.running");
  renderPathHelper("warn", t("path.preflightRunning"));
  renderPreflightReport({ pending: true });
  try {
    const payload = await request("/api/preflight/run", {
      path,
      goal: goalInput.value.trim() || t("preflight.goal.default")
    });
    currentPreflight = payload.report;
    repoProfile = payload.profile;
    currentTask = payload.task || currentTask;
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
    currentPreflight = null;
    preflightState.textContent = t("preflight.state.failed");
    renderPathHelper("error", friendlyErrorMessage(error).split("\n\n")[0]);
    preflightOutput.textContent = friendlyErrorMessage(error);
  } finally {
    renderGuide();
    updateControls();
  }
});

planButton.addEventListener("click", async () => {
  const goal = goalInput.value.trim();
  if (!goal) return;
  planButton.disabled = true;
  planIntent.textContent = t("plan.state.generating");
  try {
    if (!currentTask || currentTask.goal !== goal || currentTask.rootPath !== repoProfile?.rootPath) {
      const created = await request("/api/tasks/create", { goal, rootPath: repoProfile?.rootPath });
      currentTask = created.task;
    }
    const result = await request("/api/agent/plan", { goal, repoProfile, taskId: currentTask.id });
    if (result.task) currentTask = result.task;
    renderPlan(result.plan);
    renderTask(currentTask);
    planIntent.textContent = result.plan.intent;
    await refreshAudit();
  } catch (error) {
    timeline.innerHTML = `<li><h4>${escapeHtml(t("plan.state.failed"))}</h4><p>${escapeHtml(friendlyErrorMessage(error))}</p></li>`;
  } finally {
    updateControls();
  }
});

clearButton.addEventListener("click", () => {
  goalInput.value = "";
  timeline.innerHTML = "";
  planIntent.textContent = t("state.waiting");
  updateControls();
});

completeTaskButton.addEventListener("click", async () => {
  if (!currentTask) {
    taskState.textContent = t("task.state.none");
    return;
  }
  const result = await request("/api/tasks/complete", { taskId: currentTask.id });
  currentTask = result.task;
  if (result.memory) currentMemory = result.memory;
  renderTask(currentTask);
  renderMemory(currentMemory);
  await refreshAudit();
});

saveMemoryButton.addEventListener("click", async () => {
  if (!repoProfile) {
    memoryState.textContent = t("tool.state.scanFirst");
    return;
  }
  saveMemoryButton.disabled = true;
  memoryState.textContent = t("memory.state.saving");
  try {
    const result = await request("/api/memory/notes", { rootPath: repoProfile.rootPath, notes: memoryNotes.value });
    currentMemory = result.memory;
    renderMemory(currentMemory);
    await refreshAudit();
  } catch (error) {
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
    updateControls();
  }
});

suggestButton.addEventListener("click", async () => {
  suggestButton.disabled = true;
  modelState.textContent = t("model.state.thinking");
  try {
    const payload = await request("/api/model/suggest", {
      goal: goalInput.value.trim() || currentTask?.goal,
      repoProfile,
      rootPath: repoProfile?.rootPath,
      taskId: currentTask?.id
    });
    if (payload.task) currentTask = payload.task;
    modelState.textContent = payload.suggestion.provider;
    modelOutput.textContent = payload.suggestion.content;
    renderTask(currentTask);
    await refreshAudit();
  } catch (error) {
    modelState.textContent = t("model.state.suggestFailed");
    modelOutput.textContent = friendlyErrorMessage(error);
  } finally {
    updateControls();
  }
});

contextButton.addEventListener("click", async () => {
  contextButton.disabled = true;
  modelState.textContent = t("model.state.chooseContext");
  try {
    const payload = await request("/api/model/context-files", {
      goal: goalInput.value.trim() || currentTask?.goal,
      repoProfile,
      rootPath: repoProfile?.rootPath,
      taskId: currentTask?.id
    });
    suggestedContextFiles = payload.suggestion.files || [];
    modelState.textContent = t("model.state.contextCandidates", { count: suggestedContextFiles.length });
    renderContextCandidates(suggestedContextFiles);
    modelOutput.textContent = (payload.suggestion.note || t("model.context.noteFallback")).trim();
    renderGuide();
    await refreshAudit();
  } catch (error) {
    modelState.textContent = t("model.state.contextFailed");
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

  readContextButton.disabled = true;
  modelState.textContent = t("model.state.readingContext");
  try {
    const outputs = [];
    for (const file of selected) {
      const result = await request("/api/tools/call", { tool: "read_file", args: { path: file.path }, rootPath: repoProfile.rootPath, taskId: currentTask?.id });
      if (result.task) currentTask = result.task;
      outputs.push(`${file.path}: ${typeof result.result === "string" ? result.result.length : 0} chars`);
    }
    renderTask(currentTask);
    modelState.textContent = t("model.state.readContextDone");
    modelOutput.textContent = outputs.join("\n");
    await refreshAudit();
  } catch (error) {
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
  proposePatchButton.disabled = true;
  patchState.textContent = t("patch.state.generating");
  try {
    const payload = await request("/api/model/patch-proposal", {
      goal: currentTask.goal,
      repoProfile,
      rootPath: repoProfile?.rootPath,
      taskId: currentTask.id
    });
    currentTask = payload.task;
    renderPatchProposal(payload.proposal);
    renderTask(currentTask);
    await refreshAudit();
  } catch (error) {
    patchState.textContent = t("patch.state.draftFailed");
    patchOutput.textContent = friendlyErrorMessage(error);
  } finally {
    updateControls();
  }
});

applyPatchButton.addEventListener("click", async () => {
  const files = patchProposalFiles(currentTask?.patchProposal);
  if (!files.length) {
    patchState.textContent = t("patch.state.noAvailable");
    return;
  }
  const gate = preflightPatchGateStatus();
  if (gate.blocksPatch) {
    patchState.textContent = gate.title;
    patchOutput.textContent = gate.detail;
    return;
  }
  const review = patchReviewModel(currentTask.patchProposal, currentTask);
  const approved = window.confirm([
    t("confirm.apply.title", { target: patchTargetLabel(currentTask.patchProposal) }),
    "",
    t("confirm.apply.review", { count: review.files.length, added: review.total.added, removed: review.total.removed }),
    t("confirm.apply.risks", { risks: review.risks.slice(0, 2).join("; ") }),
    "",
    t("confirm.apply.write"),
    t("confirm.apply.branch"),
    t("confirm.apply.rollback")
  ].join("\n"));
  if (!approved) return;
  applyPatchButton.disabled = true;
  patchState.textContent = t("patch.state.applying");
  try {
    const result = await request("/api/tasks/apply-patch", { taskId: currentTask.id, approved: true });
    if (result.task) currentTask = result.task;
    patchState.textContent = t("patch.state.applied");
    patchOutput.textContent = result.result?.diff || currentTask.patchProposal.diff || t("patch.output.appliedFallback");
    renderTask(currentTask);
    await refreshAudit();
  } catch (error) {
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
  const selectedIndex = Number.parseInt(revertPatchSelect.value, 10);
  const selectedPatch = currentTask.appliedPatches?.[selectedIndex];
  const approved = window.confirm([
    t("confirm.revert.title", { target: selectedPatch?.path || t("confirm.revert.targetFallback") }),
    "",
    t("confirm.revert.write"),
    t("confirm.revert.review")
  ].join("\n"));
  if (!approved) return;
  revertPatchButton.disabled = true;
  patchState.textContent = t("patch.state.reverting");
  try {
    const result = await request("/api/tasks/revert-patch", { taskId: currentTask.id, patchIndex: Number.isNaN(selectedIndex) ? undefined : selectedIndex, approved: true });
    if (result.task) currentTask = result.task;
    patchState.textContent = t("patch.state.reverted");
    patchOutput.textContent = result.result?.diff || t("patch.output.revertedFallback");
    renderTask(currentTask);
    await refreshAudit();
  } catch (error) {
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
  callToolButton.disabled = true;
  toolState.textContent = t("tool.state.calling");
  try {
    let result = await callTool(tool, false);
    if (result.blocked) {
      const approved = window.confirm([
        t("confirm.tool.title", { tool }),
        "",
        t("confirm.tool.riskPrefix", { risk: result.permission.risk }),
        t("confirm.tool.cancel")
      ].join("\n"));
      if (approved) result = await callTool(tool, true);
    }
    if (result.task) currentTask = result.task;
    toolState.textContent = result.blocked ? t("tool.state.blocked") : result.permission.level;
    renderToolResult(tool, result);
    renderTask(currentTask);
    await refreshAudit();
  } catch (error) {
    toolState.textContent = t("tool.state.failed");
    toolOutput.textContent = friendlyErrorMessage(error);
  } finally {
    updateControls();
  }
});

toolSelect.addEventListener("change", syncToolInputs);
guideNextButton.addEventListener("click", runGuideNextStep);
quickStartPrimary?.addEventListener("click", runQuickStartPrimary);
quickStartSecondary?.addEventListener("click", () => {
  setActiveView("workspace");
  preflightButton.click();
});

runVerifyButton.addEventListener("click", async () => {
  if (!repoProfile) {
    verifyState.textContent = t("verify.state.scanFirst");
    return;
  }

  const command = selectedVerifyCommand();
  if (!command) {
    verifyState.textContent = t("verify.state.noCommand");
    return;
  }

  runVerifyButton.disabled = true;
  verifyState.textContent = t("verify.state.waitingConfirm");
  try {
    let result = await request("/api/tools/call", { tool: "run_command", args: { command: command.command }, rootPath: repoProfile.rootPath, taskId: currentTask?.id });
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
        result = await request("/api/tools/call", { tool: "run_command", args: { command: command.command }, rootPath: repoProfile.rootPath, taskId: currentTask?.id, approved: true });
      }
    }
    if (result.task) currentTask = result.task;
    verifyState.textContent = result.result?.timedOut ? t("verify.state.timeout") : result.result?.exitCode === 0 ? t("verify.state.passed") : t("verify.state.failed");
    renderVerifyResult(command, result);
    renderTask(currentTask);
    await refreshAudit();
  } catch (error) {
    verifyState.textContent = t("verify.state.runFailed");
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
  fixFailureButton.disabled = true;
  verifyState.textContent = t("verify.state.fixing");
  try {
    const payload = await request("/api/model/fix-from-failure", { taskId: currentTask.id, rootPath: repoProfile?.rootPath });
    if (payload.task) currentTask = payload.task;
    modelOutput.textContent = payload.suggestion.content;
    renderTask(currentTask);
    await refreshAudit();
  } catch (error) {
    verifyState.textContent = t("verify.state.fixFailed");
    verifyOutput.textContent = friendlyErrorMessage(error);
  } finally {
    updateControls();
  }
});

function syncToolInputs() {
  const tool = toolSelect.value;
  const usesArg = tool === "read_file" || tool === "search_code" || tool === "write_patch";
  toolArg.disabled = !usesArg;
  toolArg.placeholder = tool === "read_file" ? "README.md" : tool === "search_code" ? "createTaskPlan" : tool === "write_patch" ? "src/example.js" : t("tool.arg.noArgs");
  patchContent.classList.toggle("visible", tool === "write_patch");
  if (!usesArg) toolArg.value = "";
  updateControls();
}

function updateControls() {
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
  const patchGateStatus = preflightPatchGateStatus();

  setControlState(scanButton, !hasRepoPath, hasRepoPath ? "" : t("control.needProjectPathDemo"));
  setControlState(preflightButton, !hasRepoPath, hasRepoPath ? "" : t("control.needProjectPath"));
  setControlState(planButton, !hasGoal, hasGoal ? "" : t("control.needGoal"));
  setControlState(completeTaskButton, !hasTask || taskComplete, !hasTask ? t("control.needTask") : taskComplete ? t("control.taskComplete") : "");
  setControlState(saveMemoryButton, !hasRepo, hasRepo ? "" : t("control.needScan"));
  setControlState(refreshMemoryButton, !hasRepo, hasRepo ? "" : t("control.needScan"));
  setControlState(saveModelButton, false);
  setControlState(suggestButton, !hasGoal, hasGoal ? "" : t("control.needGoalOrTask"));
  setControlState(contextButton, !hasTask || !hasRepo, !hasTask ? t("control.needPlan") : !hasRepo ? t("control.needScan") : "");
  setControlState(readContextButton, !hasTask || !hasContextCandidates || selectedContextCount === 0, !hasTask ? t("control.needPlan") : !hasContextCandidates ? t("control.needContextCandidates") : selectedContextCount === 0 ? t("control.needContextSelection") : "");
  setControlState(proposePatchButton, !hasTask || !hasContext || patchGateStatus.blocksPatch, !hasTask ? t("control.needPlan") : !hasContext ? t("control.needReadContext") : patchGateStatus.detail);
  setControlState(applyPatchButton, !proposalFiles.length || activePatches > 0 || patchGateStatus.blocksPatch, !proposalFiles.length ? t("control.needApplicablePatch") : activePatches > 0 ? t("control.hasActivePatch") : patchGateStatus.detail);
  setControlState(revertPatchButton, activePatches === 0, activePatches ? "" : t("control.noRevertPatch"));
  setControlState(callToolButton, !hasRepo, hasRepo ? "" : t("control.needScan"));
  setControlState(runVerifyButton, !hasRepo || !verificationCommand, !hasRepo ? t("control.needScan") : !verificationCommand ? t("control.noVerifyCommand") : "");
  setControlState(fixFailureButton, !currentTask?.failureSummary, currentTask?.failureSummary ? "" : t("control.needFailedVerify"));
  setControlState(guideNextButton, !canRunGuideNextStep(), t("guide.disabled.currentInfo"));
  renderPatchGate(patchGateStatus);
  renderApplyReview(currentTask?.patchProposal, currentTask, patchGateStatus);
  renderQuickStart();

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

function renderPatchGate(gate) {
  if (!patchGate || !gate) return;
  patchGate.className = `patch-gate ${gate.severity}`;
  patchGate.innerHTML = `<strong>${escapeHtml(gate.title)}</strong><span>${escapeHtml(gate.detail)}</span>`;
}

function renderApplyReview(proposal, task, gate = preflightPatchGateStatus()) {
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

function quickStartModel() {
  const hasPath = Boolean(repoPath.value.trim() || repoProfile?.rootPath);
  const hasGoal = Boolean(goalInput.value.trim() || currentTask?.goal);
  const preflightWarnings = currentPreflight?.nextGate?.warnings?.length || 0;
  const preflightBlockers = currentPreflight?.nextGate?.blockers?.length || 0;
  const hasPlan = Boolean(currentTask?.plan);
  const hasContext = Boolean(currentTask?.contextFiles?.length);
  const hasPatch = Boolean(currentTask?.patchProposal);
  const hasActivePatch = Boolean(currentTask?.appliedPatches?.some((patch) => !patch.revertedAt));
  const verified = Boolean(currentTask?.verification);
  const completed = Boolean(currentTask?.summary);
  const steps = [
    { label: t("quick.step.project"), done: hasPath, detail: hasPath ? t("quick.step.project.ready") : t("quick.step.project.choose") },
    { label: t("quick.step.preflight"), done: Boolean(currentPreflight), detail: currentPreflight ? preflightWarnings || preflightBlockers ? t("quick.step.preflight.needsHandling") : t("quick.step.preflight.done") : t("quick.step.preflight.todo") },
    { label: t("quick.step.plan"), done: hasPlan, detail: hasPlan ? t("quick.step.plan.done") : hasGoal ? t("quick.step.plan.goalReady") : t("quick.step.plan.todo") },
    { label: t("quick.step.context"), done: hasContext, detail: hasContext ? t("quick.step.context.done") : t("quick.step.context.todo") },
    { label: t("quick.step.patchVerify"), done: hasActivePatch && verified, detail: verified ? t("quick.step.patchVerify.verified") : hasActivePatch ? t("quick.step.patchVerify.applied") : hasPatch ? t("quick.step.patchVerify.patchReady") : t("quick.step.patchVerify.todo") },
    { label: t("quick.step.finish"), done: completed, detail: completed ? t("quick.step.finish.done") : t("quick.step.finish.todo") }
  ];

  if (!hasPath) return {
    state: t("quick.state.waiting"),
    copy: t("quick.copy.waiting"),
    primary: t("quick.primary.demo"),
    secondary: t("quick.secondary.runPreflight"),
    secondaryDisabled: true,
    action: () => demoButton.click(),
    steps
  };
  if (!currentPreflight) return {
    state: t("quick.state.needsPreflight"),
    copy: t("quick.copy.needsPreflight"),
    primary: t("quick.primary.runPreflight"),
    secondary: t("quick.secondary.refreshPreflight"),
    secondaryDisabled: false,
    action: () => preflightButton.click(),
    steps
  };
  if (preflightBlockers || preflightWarnings) return {
    state: preflightBlockers ? t("quick.state.blockers") : t("quick.state.warnings"),
    copy: preflightBlockers ? t("quick.copy.blockers") : t("quick.copy.warnings"),
    primary: t("quick.primary.rerunPreflight"),
    secondary: t("quick.secondary.refreshPreflight"),
    secondaryDisabled: false,
    action: () => preflightButton.click(),
    steps
  };
  if (!hasPlan) return {
    state: t("quick.state.canPlan"),
    copy: t("quick.copy.canPlan"),
    primary: t("quick.primary.generatePlan"),
    secondary: t("quick.secondary.refreshPreflight"),
    secondaryDisabled: false,
    action: () => {
      if (!goalInput.value.trim()) goalInput.value = currentTask?.goal || t("quick.defaultGoal");
      planButton.click();
    },
    steps
  };
  if (!hasContext) return {
    state: t("quick.state.readContext"),
    copy: t("quick.copy.readContext"),
    primary: suggestedContextFiles.length ? t("quick.primary.readSelectedContext") : t("quick.primary.chooseContext"),
    secondary: t("quick.secondary.refreshPreflight"),
    secondaryDisabled: false,
    action: () => runContextGuideStep(),
    steps
  };
  if (!hasPatch) return {
    state: t("quick.state.canPatch"),
    copy: t("quick.copy.canPatch"),
    primary: t("quick.primary.generatePatch"),
    secondary: t("quick.secondary.refreshPreflight"),
    secondaryDisabled: false,
    action: () => proposePatchButton.click(),
    steps
  };
  if (!hasActivePatch) return {
    state: t("quick.state.waitingApply"),
    copy: t("quick.copy.waitingApply"),
    primary: t("quick.primary.applyPatch"),
    secondary: t("quick.secondary.refreshPreflight"),
    secondaryDisabled: false,
    action: () => applyPatchButton.click(),
    steps
  };
  if (!verified) return {
    state: t("quick.state.waitingVerify"),
    copy: t("quick.copy.waitingVerify"),
    primary: t("quick.primary.runVerify"),
    secondary: t("quick.secondary.refreshPreflight"),
    secondaryDisabled: false,
    action: () => runVerifyButton.click(),
    steps
  };
  if (!completed) return {
    state: t("quick.state.readyFinish"),
    copy: t("quick.copy.readyFinish"),
    primary: t("quick.primary.completeTask"),
    secondary: t("quick.secondary.refreshPreflight"),
    secondaryDisabled: false,
    action: () => completeTaskButton.click(),
    steps
  };
  return {
    state: t("quick.state.done"),
    copy: t("quick.copy.done"),
    primary: t("quick.primary.viewAudit"),
    secondary: t("quick.secondary.refreshPreflight"),
    secondaryDisabled: false,
    action: () => setActiveView("audit"),
    steps
  };
}

function renderQuickStart() {
  if (!quickStartState || !quickStartCopy || !quickStartList || !quickStartPrimary || !quickStartSecondary) return;
  const model = quickStartModel();
  quickStartState.textContent = model.state;
  quickStartCopy.textContent = model.copy;
  quickStartPrimary.textContent = model.primary;
  quickStartSecondary.textContent = model.secondary;
  quickStartSecondary.disabled = Boolean(model.secondaryDisabled);
  quickStartList.innerHTML = model.steps.map((step, index) => `
    <li class="${step.done ? "done" : "pending"}">
      <strong>${index + 1}. ${escapeHtml(step.label)}</strong>
      <span>${escapeHtml(step.detail)}</span>
    </li>`).join("");
}

function runQuickStartPrimary() {
  quickStartModel().action();
}

function setControlState(control, disabled, title = "") {
  if (!control) return;
  control.disabled = Boolean(disabled);
  control.title = disabled ? title : "";
}

function canRunGuideNextStep() {
  const step = guideModel().find((item) => !item.done);
  if (!step) return false;
  if (step.id === "preflight") return Boolean(repoPath.value.trim() || repoProfile?.rootPath);
  if (step.id === "plan") return Boolean(goalInput.value.trim() || currentTask?.goal);
  if (step.id === "context") return Boolean(currentTask?.id && repoProfile?.rootPath);
  if (step.id === "patch") return Boolean((currentTask?.contextFiles?.length || currentTask?.patchProposal) && !preflightPatchGateStatus().blocksPatch);
  if (step.id === "verify") return Boolean(repoProfile?.rootPath && selectedVerifyCommand());
  if (step.id === "complete") return Boolean(currentTask?.id);
  return true;
}

function renderRepoSummary(profile) {
  const languages = profile.languages?.map((item) => item.name).join(", ") || t("repo.unknown");
  const frameworks = profile.frameworks?.join(", ") || t("repo.none");
  const commands = profile.commands?.map((item) => item.command).join("\n") || t("repo.none");
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
    <div class="preflight-next"><strong>${escapeHtml(t("preflight.next"))}</strong><span>${escapeHtml(preflightNextAction(report))}</span></div>
    ${blockers.length ? `<div class="preflight-list"><strong>${escapeHtml(t("preflight.blockers"))}</strong>${blockers.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</div>` : ""}
    ${warnings.length ? `<div class="preflight-list"><strong>${escapeHtml(t("preflight.warnings"))}</strong>${warnings.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</div>` : ""}
    <div class="preflight-list"><strong>${escapeHtml(t("preflight.context"))}</strong>${(report.contextFiles || []).map((item) => `<p>${escapeHtml(item.path)} <span>${escapeHtml(item.reason || "")}</span></p>`).join("") || `<p>${escapeHtml(t("preflight.noContext"))}</p>`}</div>
  `;
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
  if (tool === "write_patch") return { path: value, content: patchContent.value };
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
  } else if (systemInfo?.demoPath && pathValue && normalizePathForCompare(pathValue) === normalizePathForCompare(systemInfo.demoPath)) {
    titleKey = "path.mode.demo.title";
    bodyKey = "path.mode.demo.body";
    modeClass = "demo";
  } else if (pathValue) {
    titleKey = "path.mode.real.title";
    bodyKey = "path.mode.real.body";
    modeClass = "real";
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

function normalizePathForCompare(value) {
  return String(value || "").replace(/[\\/]+/g, "\\").replace(/\\$/, "").toLowerCase();
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
  renderGuide();
  updateControls();
}

function updateModelPresetUi() {
  const preset = MODEL_PRESETS[modelPreset.value] || MODEL_PRESETS.custom;
  modelType.disabled = modelPreset.value !== "custom" && modelPreset.value !== "mock";
  modelBaseUrl.disabled = modelPreset.value === "mock";
  modelApiKey.placeholder = preset.apiKeyPlaceholder;
  modelName.placeholder = modelPreset.value === "openai" ? t("model.name.placeholder.openai") : modelPreset.value === "custom" ? t("model.name.placeholder") : preset.model || t("model.name.placeholder");
}

function renderModelCostHint() {
  if (!modelCostHint) return;
  const guide = MODEL_COST_GUIDE[modelPreset.value] || MODEL_COST_GUIDE.custom;
  modelCostHint.className = `model-cost-hint ${guide.badge}`;
  modelCostHint.innerHTML = `
    <strong>${escapeHtml(t(guide.titleKey))}</strong>
    <span>${escapeHtml(t(guide.levelKey))}</span>
    <p>${escapeHtml(t(guide.detailKey))}</p>
  `;
}

function modelUsageAdvice(presetValue) {
  const guide = MODEL_COST_GUIDE[presetValue] || MODEL_COST_GUIDE.custom;
  if (presetValue === "deepseek-flash") return t("model.usage.flash");
  if (presetValue === "deepseek-pro") return t("model.usage.pro");
  return t("model.usage.default", { detail: t(guide.detailKey) });
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
    patchState.textContent = proposal?.reason || t("patch.state.none");
    patchOutput.textContent = [
      proposal?.summary || t("patch.output.noApplicableDraft"),
      proposal?.note ? `\n${proposal.note}` : ""
    ].join("");
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

function selectedContextFiles() {
  return [...contextCandidates.querySelectorAll("input[data-context-index]:checked")]
    .map((input) => suggestedContextFiles[Number.parseInt(input.dataset.contextIndex, 10)])
    .filter(Boolean);
}

async function refreshTask() {
  const query = repoProfile ? `?rootPath=${encodeURIComponent(repoProfile.rootPath)}` : "";
  const payload = await request(`/api/tasks/latest${query}`);
  currentTask = payload.task || currentTask;
  renderTask(currentTask);
}

async function refreshMemory() {
  if (!repoProfile) {
    renderMemory(null);
    return;
  }
  try {
    const payload = await request(`/api/memory?rootPath=${encodeURIComponent(repoProfile.rootPath)}`);
    currentMemory = payload.memory;
    renderMemory(currentMemory);
  } catch (error) {
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

  const languages = memory.profile?.languages?.map((item) => `${item.name} (${item.count})`).join(", ") || "未知";
  const frameworks = memory.profile?.frameworks?.join(", ") || "无";
  const packageManagers = memory.profile?.packageManagers?.join(", ") || "无";
  const commands = memory.commands?.length ? memory.commands.map((item) => `- ${item.name || "命令"}: ${item.command}`).join("\n") : "- 无";
  const tasks = memory.taskSummaries?.length
    ? memory.taskSummaries.slice(-6).reverse().map((item) => `- ${item.goal || item.taskId}: ${item.summary || item.status || "已完成"}`).join("\n")
    : "- 无";
  memoryState.textContent = memory.name || t("memory.state.loaded");
  memoryNotes.value = memory.notes || "";
  memoryOutput.textContent = [
    `项目：${memory.name}`,
    `路径：${memory.rootPath}`,
    `文件：${memory.profile?.fileCount || 0}（跳过 ${memory.profile?.skippedCount || 0}）`,
    `语言：${languages}`,
    `框架：${frameworks}`,
    `包管理器：${packageManagers}`,
    `扫描时间：${memory.profile?.scannedAt || "未知"}`,
    "",
    "命令：",
    commands,
    "",
    "关键文件：",
    (memory.profile?.keyFiles || []).slice(0, 12).map((file) => `- ${file}`).join("\n") || "- 无",
    "",
    "最近任务总结：",
    tasks
  ].join("\n");
}

function renderTask(task) {
  if (!task) {
    taskState.textContent = t("task.state.none");
    taskSummary.textContent = t("task.summary.empty");
    reviewDraft.textContent = t("task.review.empty");
    patchState.textContent = t("patch.state.none");
    renderGuide();
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
  const latestSuggestion = task.suggestions?.at(-1)?.content || t("task.suggestion.empty");
  const activePatches = task.appliedPatches?.filter((patch) => !patch.revertedAt).length || 0;
  taskSummary.textContent = [
    `${t("task.summary.goal")}: ${task.goal}`,
    `${t("task.summary.task")}: ${task.id}`,
    `${t("task.summary.plan")}: ${planText}`,
    `${t("task.summary.toolCalls")}: ${task.toolCalls.length}`,
    `${t("task.summary.contextFiles")}: ${task.contextFiles?.length || 0}`,
    `${t("task.summary.suggestions")}: ${task.suggestions?.length || 0}`,
    `${t("task.summary.patchDraft")}: ${task.patchProposal ? patchTargetLabel(task.patchProposal) : t("task.patch.none")}`,
    `${t("task.summary.appliedPatches")}: ${activePatches}`,
    `${t("task.summary.verification")}: ${verification}`,
    `${t("task.summary.failure")}: ${task.failureSummary ? task.failureSummary.slice(0, 220) : t("task.failure.none")}`,
    `${t("task.summary.summary")}: ${task.summary || t("task.suggestion.empty")}`,
    "",
    `${t("task.summary.latestSuggestion")}: ${latestSuggestion.slice(0, 400)}`
  ].join("\n");
  reviewDraft.textContent = task.reviewDraft || t("task.review.empty");
  renderGuide();
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
  const active = (task?.appliedPatches || []).map((patch, index) => ({ ...patch, index })).filter((patch) => !patch.revertedAt);
  revertPatchSelect.innerHTML = active.length
    ? active.map((patch) => `<option value="${patch.index}">${escapeHtml(patch.path)}</option>`).join("")
    : `<option value="">${escapeHtml(t("patch.revert.none"))}</option>`;
}

function preflightGuideDetail() {
  if (!currentPreflight) return repoProfile ? t("guide.preflight.detail.scanned") : t("guide.preflight.detail.runSafety");
  const blockers = currentPreflight.nextGate?.blockers?.length || 0;
  const warnings = currentPreflight.nextGate?.warnings?.length || 0;
  if (blockers) return t("guide.preflight.detail.blockers", { count: blockers });
  if (warnings) return t("guide.preflight.detail.warnings", { count: warnings });
  return t("guide.preflight.detail.passed");
}

function guideModel() {
  const activePatches = currentTask?.appliedPatches?.filter((patch) => !patch.revertedAt).length || 0;
  const patchGateStatus = preflightPatchGateStatus();
  const contextDetail = currentTask?.contextFiles?.length
    ? t("guide.context.detail.read", { count: currentTask.contextFiles.length })
    : suggestedContextFiles.length
      ? t("guide.context.detail.selected", { count: selectedContextFiles().length || suggestedContextFiles.length })
      : t("guide.context.detail.choose");
  const patchDone = activePatches > 0;
  const patchDetail = patchDone
    ? t("guide.patch.detail.applied", { count: activePatches })
    : currentTask?.patchProposal
      ? t("guide.patch.detail.reviewApply")
      : t("guide.patch.detail.generate");
  return [
    { id: "preflight", title: t("guide.preflight.title"), detail: preflightGuideDetail(), hint: t("guide.preflight.hint"), blocked: !repoProfile && !repoPath.value.trim(), done: Boolean(currentPreflight || repoProfile), action: () => { setActiveView("workspace"); preflightButton.click(); } },
    { id: "plan", title: t("guide.plan.title"), detail: currentTask?.plan ? t("guide.plan.detail.ready") : t("guide.plan.detail.generate"), hint: t("guide.plan.hint"), blocked: !currentTask?.plan && !goalInput.value.trim(), done: Boolean(currentTask?.plan), action: () => { setActiveView("workspace"); planButton.click(); } },
    { id: "context", title: t("guide.context.title"), detail: contextDetail, hint: suggestedContextFiles.length ? t("guide.context.hint.readSelected", { count: selectedContextFiles().length || suggestedContextFiles.length }) : t("guide.context.hint.rank"), blocked: !currentTask?.id || !repoProfile?.rootPath, done: Boolean(currentTask?.contextFiles?.length), action: runContextGuideStep },
    { id: "patch", title: t("guide.patch.title"), detail: patchGateStatus.blocksPatch ? patchGateStatus.title : patchDetail, hint: patchGateStatus.blocksPatch ? patchGateStatus.detail : currentTask?.patchProposal ? t("guide.patch.hint.reviewApply") : t("guide.patch.hint.generate"), blocked: patchGateStatus.blocksPatch || (!currentTask?.contextFiles?.length && !currentTask?.patchProposal), done: patchDone, action: runPatchGuideStep },
    { id: "verify", title: t("guide.verify.title"), detail: currentTask?.verification ? t("guide.verify.detail.exit", { code: currentTask.verification.exitCode }) : t("guide.verify.detail.runTests"), hint: t("guide.verify.hint"), blocked: !repoProfile?.rootPath || !selectedVerifyCommand(), done: Boolean(currentTask?.verification), action: () => runVerifyButton.click() },
    { id: "complete", title: t("guide.complete.title"), detail: currentTask?.summary ? t("guide.complete.detail.done") : t("guide.complete.detail.summary"), hint: t("guide.complete.hint"), blocked: !currentTask?.id, done: Boolean(currentTask?.summary), action: () => completeTaskButton.click() }
  ];
}

function runContextGuideStep() {
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

function runPatchGuideStep() {
  setActiveView("workspace");
  if (!currentTask?.patchProposal) {
    proposePatchButton.click();
    return;
  }
  applyPatchButton.click();
}

function renderGuide() {
  if (!guideSteps) return;
  const steps = guideModel();
  const activeIndex = steps.findIndex((step) => !step.done);
  const nextIndex = activeIndex === -1 ? steps.length - 1 : activeIndex;
  const activeStep = steps[nextIndex];
  guideState.textContent = activeIndex === -1 ? t("guide.state.complete") : activeStep.title;
  guideSteps.innerHTML = steps.map((step, index) => `
    <li class="${guideStepClass(step, index, nextIndex)}">
      <strong>${index + 1}. ${escapeHtml(step.title)}</strong>
      <span>${escapeHtml(step.detail)}</span>
    </li>`).join("");
  guideNextButton.textContent = activeIndex === -1 ? t("guide.button.complete") : t("guide.button.next", { title: steps[nextIndex].title });
  if (nextStepHint) nextStepHint.textContent = activeIndex === -1 ? t("guide.next.complete") : activeStep.hint;
  updateControls();
}

function guideStepClass(step, index, nextIndex) {
  if (step.done) return "done";
  if (index === nextIndex) return step.blocked ? "active blocked" : "active";
  return "pending";
}

function runGuideNextStep() {
  const step = guideModel().find((item) => !item.done);
  if (step) step.action();
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

async function request(url, body) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (!response.ok || (payload.ok === false && !payload.blocked)) {
    const error = new Error(payload.error || payload.message || "Request failed");
    error.code = payload.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function friendlyErrorMessage(error) {
  const message = String(error?.message || error || "未知错误");
  const codeMessage = `${error?.code || ""} ${message}`;
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
