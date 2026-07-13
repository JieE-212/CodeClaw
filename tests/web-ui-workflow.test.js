import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { DICTIONARIES, SUPPORTED_LANGUAGES } from "../apps/web/public/i18n.js";

const [html, app, css] = await Promise.all([
  fs.readFile(new URL("../apps/web/public/index.html", import.meta.url), "utf8"),
  fs.readFile(new URL("../apps/web/public/app.js", import.meta.url), "utf8"),
  fs.readFile(new URL("../apps/web/public/styles.css", import.meta.url), "utf8")
]);

const WORKFLOW_STEPS = [
  "project",
  "preflight",
  "plan",
  "context",
  "patch",
  "workspace",
  "verify",
  "complete"
];
const BOUNDARIES = ["read", "project-write", "network", "command", "local-state"];
const REMOVED_UI_PREFIXES = ["quick.", "guide.", "trialHost."];

test("the workspace exposes exactly one authoritative eight-step workflow", () => {
  assert.equal(countMatches(html, /id="workflowSteps"/g), 1);
  assert.equal(countMatches(app, /\bconst workflowModel\b/g), 1);
  assert.equal(countMatches(app, /\bfunction syncVisibility\s*\(/g), 1);

  assert.deepEqual(attributeValues(html, "data-workflow-step"), WORKFLOW_STEPS);
  assert.deepEqual(attributeValues(html, "data-workflow-section"), WORKFLOW_STEPS);

  for (const removed of [
    /\bquickStart(?:State|Copy|List|Primary|Secondary)\b/,
    /\bguide(?:State|Steps|NextButton)\b/,
    /\btrialHost\b/,
    /quick-start-panel/,
    /guide-panel/,
    /trial-host-panel/,
    /data-ui-marker="trial-operator-guide"/
  ]) {
    assert.doesNotMatch(`${html}\n${app}\n${css}`, removed);
  }
});

test("experience mode is beginner by default, whitelist-only, and presentation-only", () => {
  const controls = [...html.matchAll(/<input\b[^>]*name="experienceMode"[^>]*>/g)].map((match) => match[0]);
  assert.equal(controls.length, 2);
  assert.match(controls.find((control) => /id="modeBeginner"/.test(control)) || "", /value="beginner"[^>]*checked|checked[^>]*value="beginner"/);
  assert.match(controls.find((control) => /id="modeAdvanced"/.test(control)) || "", /value="advanced"/);
  assert.match(html, /data-ui-marker="workflow-mode"/);

  assert.match(app, /(?:Set|Array)\(\[?\s*["']beginner["']\s*,\s*["']advanced["']/);
  assert.match(app, /mode\s*:\s*["']beginner["']/);
  assert.match(app, /EXPERIENCE_MODES\.has\(/);
  assert.match(app, /workflowModel\.mode\s*=/);

  for (const call of extractCalls(app, "request")) {
    assert.doesNotMatch(call, /\b(?:experienceMode|workflowModel\.mode|modeBeginner|modeAdvanced)\b/, `mode leaked into request call: ${call.slice(0, 120)}`);
  }
  assert.doesNotMatch(app, /\b(?:approved|canWrite|permission|workspaceId|workspaceDigest)\s*:\s*workflowModel\.mode\b/);
});

test("preflight workflow state comes from currentPreflight while repoProfile only identifies the project", () => {
  const snapshot = functionBody(app, "buildWorkflowSnapshot");
  const receipt = functionBody(app, "renderPreflightReceipt");
  const stepRenderer = functionBody(app, "renderWorkflowSteps");
  assert.match(snapshot, /const hasPath\s*=\s*Boolean\([^;]*repoProfile\?\.rootPath/);
  assert.match(snapshot, /const preflightWarnings\s*=\s*currentPreflight\?/);
  assert.match(snapshot, /const preflightBlockers\s*=\s*currentPreflight\?/);
  assert.match(snapshot, /if \(!currentPreflight\)/);
  assert.doesNotMatch(snapshot, /(?:preflightWarnings|preflightBlockers)\s*=\s*repoProfile/);
  assert.match(receipt, /currentPreflight/);
  assert.doesNotMatch(receipt, /repoProfile/);

  assert.match(stepRenderer, /data-workflow-step/);
  assert.match(stepRenderer, /setAttribute\(["']aria-current["']\s*,\s*["']step["']\)/);
  assert.match(stepRenderer, /removeAttribute\(["']aria-current["']\)/);
});

test("workflow controls cannot skip Apply or silently switch the bound workspace", () => {
  const controls = functionBody(app, "updateControls");
  const snapshot = functionBody(app, "buildWorkflowSnapshot");
  const verification = functionBody(app, "taskHasCurrentSuccessfulVerification");
  const adoption = functionBody(app, "adoptTaskResponse");
  assert.match(app, /function taskHasCurrentSuccessfulVerification\s*\(/);
  assert.match(controls, /setControlState\(runVerifyButton,[^;]+!hasActivePatch/);
  assert.match(controls, /setControlState\(completeTaskButton,[^;]+!hasActivePatch[^;]+!hasSuccessfulVerification/);
  for (const control of ["proposePatchButton", "applyPatchButton", "runVerifyButton", "fixFailureButton"]) {
    assert.match(controls, new RegExp(`setControlState\\(${control},[^;]+taskComplete`), `${control} must stop completed-task mutations`);
  }
  assert.match(controls, /setControlState\(planButton,[^;]+taskComplete[^;]+startsNewTask/);
  assert.match(snapshot, /const verified\s*=\s*taskHasCurrentSuccessfulVerification\(currentTask\)/);
  assert.match(verification, /verification\.patchSetDigest/);
  assert.match(adoption, /task\.id\s*!==\s*currentTask\.id/);
  assert.match(adoption, /incomingRevision\s*<\s*currentRevision/);
  assert.equal(countMatches(app, /currentTask\s*=\s*task;/g), 2, "only the task response adopter may assign a response task");
  assert.doesNotMatch(app, /currentTask\s*=\s*(?:result|payload|created)\.task/);
  assert.ok(countMatches(app, /if \((?:result|payload)\.task && !adoptTaskResponse\((?:result|payload)\.task\)\) return;/g) >= 10, "stale task responses must not update success UI");
  assert.match(app, /refreshWorkspacesButton\?\.addEventListener\([\s\S]{0,180}adoptActive:\s*false/);

  const completeHandler = between(app, "completeTaskButton.addEventListener", "saveMemoryButton.addEventListener");
  assert.match(completeHandler, /try\s*\{/);
  assert.match(completeHandler, /catch \(error\)/);
  assert.match(completeHandler, /friendlyErrorMessage\(error\)/);
  assert.match(completeHandler, /finally\s*\{[\s\S]*updateControls\(\)/);
});

test("stateful async UI responses are bound to one workflow generation and target", () => {
  assert.match(app, /let workflowGeneration\s*=\s*0/);
  const targetCapture = functionBody(app, "captureWorkflowTarget");
  const targetCheck = functionBody(app, "workflowTargetIsCurrent");
  for (const field of ["generation", "path", "taskId", "workspaceId", "workspaceRoot"]) assert.match(targetCapture, new RegExp(`\\b${field}\\b`));
  assert.match(targetCheck, /target\.generation !== workflowGeneration/);
  assert.match(targetCheck, /target\.path !==/);
  assert.match(targetCheck, /target\.workspaceId !==/);
  assert.match(targetCheck, /target\.taskId === currentTask\?\.id/);

  const protectedListeners = [
    ["scanButton.addEventListener", "preflightButton.addEventListener"],
    ["preflightButton.addEventListener", "planButton.addEventListener"],
    ["planButton.addEventListener", "clearButton.addEventListener"],
    ["completeTaskButton.addEventListener", "saveMemoryButton.addEventListener"],
    ["saveMemoryButton.addEventListener", "refreshMemoryButton.addEventListener"],
    ["suggestButton.addEventListener", "contextButton.addEventListener"],
    ["contextButton.addEventListener", "readContextButton.addEventListener"],
    ["readContextButton.addEventListener", "proposePatchButton.addEventListener"],
    ["proposePatchButton.addEventListener", "applyPatchButton.addEventListener"],
    ["applyPatchButton.addEventListener", "revertPatchButton.addEventListener"],
    ["revertPatchButton.addEventListener", "callToolButton.addEventListener"],
    ["callToolButton.addEventListener", "toolSelect.addEventListener"],
    ["runVerifyButton.addEventListener", "fixFailureButton.addEventListener"],
    ["fixFailureButton.addEventListener", "function syncToolInputs"]
  ];
  for (const [start, end] of protectedListeners) {
    const section = between(app, start, end);
    assert.match(section, /captureWorkflowTarget\(/, `${start} must capture its target`);
    assert.match(section, /workflowTargetIsCurrent\(/, `${start} must reject a stale response`);
  }

  for (const name of ["previewDisposableCopy", "createDisposableCopy", "activateWorkspace", "refreshMemory"]) {
    const body = functionBody(app, name);
    assert.match(body, /captureWorkflowTarget\(/, `${name} must capture its target`);
    assert.match(body, /workflowTargetIsCurrent\(/, `${name} must reject a stale response`);
  }
});

test("every workflow module has localized semantics and all data boundaries are explicit", () => {
  for (const step of WORKFLOW_STEPS) {
    const section = workflowSection(html, step);
    const labelledBy = requiredAttribute(section.opening, "aria-labelledby");
    const describedBy = requiredAttribute(section.opening, "aria-describedby");
    const heading = tagById(section.content, labelledBy, "h[2-4]");
    const purpose = tagById(section.content, describedBy, "p");
    assert.ok(requiredAttribute(heading, "data-i18n"));
    assert.match(requiredAttribute(purpose, "class"), /(?:^|\s)panel-purpose(?:\s|$)/);
    assert.ok(requiredAttribute(purpose, "data-i18n"));
    for (const boundary of BOUNDARIES) {
      const tag = section.content.match(new RegExp(`<[^>]+data-boundary="${escapeRegExp(boundary)}"[^>]*>`))?.[0] || "";
      assert.match(tag, /data-i18n="[^"]+"/, `${step}.${boundary} boundary must be explicit and localized`);
    }
  }

  assert.deepEqual([...new Set(attributeValues(html, "data-boundary"))].sort(), [...BOUNDARIES].sort());
});

test("removed workflow keys are absent from markup, app code, and all dictionaries", () => {
  for (const prefix of REMOVED_UI_PREFIXES) {
    assert.doesNotMatch(`${html}\n${app}`, new RegExp(`["']${escapeRegExp(prefix)}`));
    for (const language of SUPPORTED_LANGUAGES) {
      assert.equal(Object.keys(DICTIONARIES[language]).filter((key) => key.startsWith(prefix)).length, 0, `${language} still contains ${prefix} keys`);
    }
  }
});

function workflowSection(source, step) {
  const match = source.match(new RegExp(`<section\\b([^>]*)data-workflow-section="${escapeRegExp(step)}"([^>]*)>([\\s\\S]*?)<\\/section>`));
  assert.ok(match, `missing semantic workflow section: ${step}`);
  return { opening: `${match[1]} data-workflow-section="${step}" ${match[2]}`, content: match[3] };
}

function requiredAttribute(source, name) {
  const value = source.match(new RegExp(`${escapeRegExp(name)}="([^"]+)"`))?.[1];
  assert.ok(value, `missing ${name}`);
  return value;
}

function tagById(source, id, tagName) {
  const tags = source.match(new RegExp(`<${tagName}\\b[^>]*>`, "g")) || [];
  const tag = tags.find((candidate) => candidate.match(/\bid="([^"]+)"/)?.[1] === id);
  assert.ok(tag, `missing ${tagName}#${id}`);
  return tag;
}

function attributeValues(source, name) {
  return [...source.matchAll(new RegExp(`${escapeRegExp(name)}="([^"]+)"`, "g"))].map((match) => match[1]);
}

function functionBody(source, name) {
  const start = source.search(new RegExp(`function\\s+${escapeRegExp(name)}\\s*\\(`));
  assert.notEqual(start, -1, `missing function ${name}`);
  const brace = source.indexOf("{", start);
  return source.slice(start, matchingDelimiter(source, brace, "{", "}") + 1);
}

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `missing section ${start} -> ${end}`);
  return source.slice(startIndex, endIndex);
}

function extractCalls(source, name) {
  const calls = [];
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`, "g");
  for (const match of source.matchAll(pattern)) {
    const open = source.indexOf("(", match.index);
    calls.push(source.slice(match.index, matchingDelimiter(source, open, "(", ")") + 1));
  }
  return calls;
}

function matchingDelimiter(source, start, open, close) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close && --depth === 0) return index;
  }
  assert.fail(`unclosed ${open} starting at ${start}`);
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
