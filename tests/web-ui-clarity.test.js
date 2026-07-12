import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DICTIONARIES, SUPPORTED_LANGUAGES } from "../apps/web/public/i18n.js";

const root = process.cwd();
const [html, app, styles] = await Promise.all([
  fs.readFile(path.join(root, "apps/web/public/index.html"), "utf8"),
  fs.readFile(path.join(root, "apps/web/public/app.js"), "utf8"),
  fs.readFile(path.join(root, "apps/web/public/styles.css"), "utf8")
]);

test("navigation stays visible on desktop and becomes a compact sticky bar on narrow screens", () => {
  assert.match(styles, /\.sidebar \{ position:sticky; top:0;[^}]*height:100vh;[^}]*overflow-y:auto;/);
  assert.match(styles, /@media \(max-width:900px\)[^{]*\{[^}]*\.app-shell \{ display:block;[^}]*\} \.sidebar \{ position:sticky; top:0;[^}]*z-index:30;[^}]*height:auto;[^}]*overflow:visible;/);
  const narrow = styles.slice(styles.indexOf("@media (max-width:900px)"));
  assert.match(narrow, /\.nav-list \{ display:flex;[^}]*overflow-x:auto;/);
  assert.match(narrow, /\.nav-item \{ flex:0 0 auto;[^}]*white-space:nowrap;/);
  const compact = styles.slice(styles.indexOf("@media (max-width:620px)"));
  assert.match(compact, /\.sidebar \{ gap:8px; padding:8px 10px;/);
});

test("saved sessions require an explicit restore decision and Demo starts clean", () => {
  for (const id of ["sessionRecovery", "continueSessionButton", "startFreshButton"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /pendingSessionPayload = payload;\s*sessionRecoveryMode = "pending";/);
  assert.match(app, /if \(sessionRestoreSuperseded\) return;/);
  assert.match(app, /continueSessionButton\?\.addEventListener[\s\S]*hydrateRestoredSession\(payload\)/);
  assert.match(app, /demoButton\.addEventListener\("click", \(\) => \{\s*setActiveView\("workspace"\);\s*startFreshClientWorkflow\(\);/);
  assert.match(app, /function resetWorkspaceBoundState\(\)[\s\S]*toolOutput\.textContent = t\("tool\.output\.scanFirst"\);/);
  assert.match(app, /function startFreshClientWorkflow\(\)[\s\S]*sessionRestoreSuperseded = true;[\s\S]*resetWorkspaceBoundState\(\);/);
  assert.doesNotMatch(app, /async function refreshTask\(/);
  assert.match(app, /preflight\.autoProgress\.body/);
});

test("write and command execution boundaries are visible before confirmation", () => {
  assert.match(html, /id="applyPatchButton"[^>]*data-i18n="button\.apply"/);
  assert.match(html, /class="boundary-note write-boundary"/);
  assert.match(html, /id="verifyBoundary"/);
  assert.match(app, /function renderVerifyBoundary\(\)/);
  for (const language of SUPPORTED_LANGUAGES) {
    assert.match(DICTIONARIES[language]["button.apply"], /Apply|写入|запис/i);
    assert.ok(DICTIONARIES[language]["verifyBoundary.reason"].includes("{name}"));
  }
});

test("structured patch failure reasons have localized actionable messages", () => {
  for (const reason of ["unsupported_goal", "missing_test_context", "missing_context_content"]) {
    assert.match(app, new RegExp(`${reason}: "patch\\.failure\\.`));
  }
  assert.doesNotMatch(app, /reasonKey && proposal\?\.summary/);
  for (const language of SUPPORTED_LANGUAGES) {
    for (const key of [
      "patch.failure.unsupportedGoal.body",
      "patch.failure.missingTestContext.body",
      "patch.failure.missingContextContent.body"
    ]) assert.ok(DICTIONARIES[language][key]?.length > 30, `${language}.${key} should be actionable`);
  }
});

test("write-safety conflicts use localized guidance without exposing raw file content", () => {
  for (const code of [
    "PATCH_BASELINE_CONFLICT",
    "PATCH_APPLY_ROLLBACK_INCOMPLETE",
    "PATCH_REVERT_CONFLICT",
    "PATH_SYMLINK_REFUSED",
    "PATH_HARDLINK_REFUSED"
  ]) assert.match(app, new RegExp(`/${code}/`));

  for (const language of SUPPORTED_LANGUAGES) {
    for (const key of [
      "error.pathSymlink",
      "error.pathHardlink",
      "error.patchBaselineConflict",
      "error.patchBaselineMissing",
      "error.patchApplyFailed",
      "error.patchRollbackIncomplete",
      "error.patchRevertConflict",
      "error.patchRevertState"
    ]) assert.ok(DICTIONARIES[language][key]?.length > 20, `${language}.${key} should be actionable`);
  }
});

test("disposable-copy controls expose one server-authoritative workspace surface", () => {
  assert.match(html, /data-ui-marker="server-authoritative-workspace"/);
  for (const id of [
    "workspaceState",
    "workspaceCapability",
    "previewCopyButton",
    "createCopyButton",
    "refreshWorkspacesButton",
    "copyPreview",
    "workspaceList"
  ]) assert.match(html, new RegExp(`id="${id}"`));

  assert.match(styles, /\.workspace-safety-panel \{ grid-column:1 \/ -1; \}/);
  assert.match(styles, /\.workspace-capability\.readonly/);
  assert.match(styles, /\.workspace-capability\.copy/);
  assert.match(styles, /\.copy-preview-metrics/);
  assert.match(styles, /\.workspace-list-item/);
});

test("copy lifecycle uses opaque server records and never auto-activates a created copy", () => {
  for (const endpoint of [
    "/api/workspaces",
    "/api/workspaces/copy/preview",
    "/api/workspaces/copy/create",
    "/api/workspaces/activate",
    "/api/workspaces/cleanup"
  ]) assert.ok(app.includes(endpoint), `missing ${endpoint}`);

  assert.match(app, /request\("\/api\/workspaces\/copy\/create", \{\s*previewId: preview\.previewId,\s*previewDigest: preview\.previewDigest\s*\}\)/);
  assert.match(app, /request\("\/api\/workspaces\/activate", \{\s*workspaceId,\s*workspaceDigest: workspace\.workspaceDigest\s*\}\)/);
  assert.match(app, /request\("\/api\/workspaces\/cleanup", \{\s*workspaceId,\s*workspaceDigest: workspace\.workspaceDigest,\s*approved: true\s*\}\)/);
  assert.doesNotMatch(app, /\bmode\s*:\s*["'](?:disposable-copy|original-readonly|built-in-demo)["']/);

  const createFlow = section(app, "async function createDisposableCopy()", "async function refreshWorkspaces");
  assert.doesNotMatch(createFlow, /activateWorkspace|\/api\/workspaces\/activate|preflightButton\.click/);
  assert.match(createFlow, /workspace\.notice\.created/);

  const activateFlow = section(app, "async function activateWorkspace(workspace)", "async function cleanupWorkspace");
  assert.match(activateFlow, /resetWorkspaceBoundState\(\);[\s\S]*adoptServerWorkspace\(payload\.workspace, \{ syncPath: true \}\)/);
  assert.match(activateFlow, /workspace\.notice\.activated/);
  assert.doesNotMatch(activateFlow, /preflightButton\.click/);
});

test("client path text cannot infer write authority and changing it clears bound state", () => {
  const pathMode = section(app, "function renderPathModeForInput(value)", "function renderPathHelperForInput");
  assert.match(pathMode, /currentWorkspace\?\.kind === "built-in-demo"/);
  assert.match(pathMode, /currentWorkspace\?\.kind === "disposable-copy"/);
  assert.match(pathMode, /currentWorkspace\?\.kind === "original-readonly"/);
  assert.doesNotMatch(pathMode, /systemInfo\?\.demoPath|normalizePathForCompare/);

  const inputFlow = section(app, 'repoPath.addEventListener("input"', 'goalInput.addEventListener("input"');
  assert.match(inputFlow, /resetWorkspaceBoundState\(\)/);
  assert.match(inputFlow, /clearWorkspaceAuthority\(\)/);

  const demoFlow = section(app, 'demoButton.addEventListener("click"', "examplePathButton?.addEventListener");
  assert.match(demoFlow, /preflightButton\.click\(\)/);
  assert.doesNotMatch(demoFlow, /currentWorkspace\s*=|canWrite\s*=/);
  const preflightFlow = section(app, 'preflightButton.addEventListener("click"', 'planButton.addEventListener("click"');
  assert.match(preflightFlow, /adoptServerWorkspace\(payload\.workspace\)/);
});

test("original projects are gated from Apply, Revert, and project commands", () => {
  assert.match(app, /function workspaceCanWrite\(\)[\s\S]*\["built-in-demo", "disposable-copy"\]\.includes\(currentWorkspace\.kind\)/);
  assert.match(app, /function workspaceWriteGateStatus\(\)[\s\S]*currentWorkspace\.kind === "original-readonly"/);
  assert.match(app, /applyPatchButton\.addEventListener[\s\S]*const gate = applyPatchGateStatus\(\)/);
  assert.match(app, /revertPatchButton\.addEventListener[\s\S]*const gate = workspaceWriteGateStatus\(\)/);
  assert.match(app, /runVerifyButton\.addEventListener[\s\S]*const workspaceGate = workspaceCommandGateStatus\(\)/);
  assert.match(app, /setControlState\(runVerifyButton,[^\n]*commandGateStatus\.blocksCommand/);
});

test("all languages state that disposable copies still contain source and are not anonymized", () => {
  const disclosurePatterns = {
    en: /not anonymized[\s\S]*upload or share/i,
    "zh-CN": /不是匿名化副本[\s\S]*上传或分享/,
    ru: /не анонимизирована[\s\S]*загрузки или передачи/i
  };
  for (const language of SUPPORTED_LANGUAGES) {
    assert.match(DICTIONARIES[language]["workspace.disclosure.body"], disclosurePatterns[language]);
    assert.ok(DICTIONARIES[language]["workspace.capability.original.body"].length > 30);
    assert.ok(DICTIONARIES[language]["workspace.cleanup.confirm.ownership"].length > 25);
  }
});

function section(content, start, end) {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return content.slice(startIndex, endIndex);
}
