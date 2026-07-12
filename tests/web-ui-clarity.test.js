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
  assert.match(app, /sessionRestoreSuperseded = true;[\s\S]*toolOutput\.textContent = t\("tool\.output\.scanFirst"\);/);
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
