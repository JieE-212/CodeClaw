import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestResources } from "./helpers/test-resources.js";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootPath, "scripts", "session-completion-check.js");

test("complete-session passes filled anonymous session records", async (t) => {
  const { rootPath: tempRoot } = await createTestResources(t, "codeclaw-complete-ok-");
  const sessionPath = path.join(tempRoot, "tester-1");
  const jsonPath = path.join(tempRoot, "completion.json");
  const markdownPath = path.join(tempRoot, "completion.md");

  await writeCompleteSession(sessionPath);

  const result = await runCompletion(["--session", sessionPath, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));
  const checklist = await fs.readFile(path.join(sessionPath, "HOST_COMPLETION_CHECKLIST.md"), "utf8");

  assert.equal(result.code, 0);
  assert.equal(report.decision, "SESSION_COMPLETION_READY");
  assert.equal(report.blockers.length, 0);
  assert.match(checklist, /No completion blockers found/);
});

test("complete-session blocks empty placeholders and personal contact data", async (t) => {
  const { rootPath: tempRoot } = await createTestResources(t, "codeclaw-complete-hold-");
  const sessionPath = path.join(tempRoot, "tester-1");
  const jsonPath = path.join(tempRoot, "completion.json");
  const markdownPath = path.join(tempRoot, "completion.md");

  await fs.mkdir(sessionPath, { recursive: true });
  await fs.writeFile(path.join(sessionPath, "HUMAN_TRIAL_OBSERVATION.md"), "# Observation\n\n- Safe to continue to tester 2: Yes / No\n", "utf8");
  await fs.writeFile(path.join(sessionPath, "TRIAL_FEEDBACK_TEMPLATE.md"), [
    "# Feedback",
    "",
    "- Name: Ada Lovelace",
    "- Observed live: Yes / No",
    "- Goal:",
    "- Should this build go to tester 2? Yes / No",
    "- Contact: ada@example.com",
    ""
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(sessionPath, "TRIAL_RESULT_RECORD.md"), "# Result\n\n- Decision after trial: Continue / Fix first / Stop\n", "utf8");

  const result = await runCompletion(["--session", sessionPath, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "SESSION_COMPLETION_HOLD");
  assert.ok(report.blockers.some((item) => item.includes("Observation is missing")));
  assert.ok(report.blockers.some((item) => item.includes("Personal email")));
  assert.ok(report.blockers.some((item) => item.includes("Personal Name field")));
});

async function writeCompleteSession(sessionPath) {
  await fs.mkdir(sessionPath, { recursive: true });
  await fs.writeFile(path.join(sessionPath, "HUMAN_TRIAL_OBSERVATION.md"), [
    "# Observation",
    "",
    "| Moment | Observe | Result | Notes |",
    "| --- | --- | --- | --- |",
    "| Startup | Running? | Pass | Launcher opened. |",
    "| Language | Switcher? | Pass | Chinese UI selected. |",
    "| Demo vs real project | Mode clear? | Pass | Tester explained it. |",
    "| Path entry | Folder? | Pass | Used demo path. |",
    "| Read-only preflight | No writes? | Pass | Audit showed reads only. |",
    "| Patch gate | Makes sense? | Pass | Trusted boundary. |",
    "| Verify confirm | Commands clear? | Pass | Tester explained it. |",
    "",
    "## Host Summary",
    "",
    "- Biggest friction: Mode label took a moment to notice.",
    "- Biggest trust concern: None.",
    "- First point where host helped: Asked tester to read the mode label.",
    "- Recommended product fix: Make mode label more prominent.",
    "- Safe to continue to the next tester: Yes",
    ""
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(sessionPath, "TRIAL_FEEDBACK_TEMPLATE.md"), [
    "# Feedback",
    "",
    "- Name: tester-1",
    "- Date: 2026-07-09",
    "- OS: Windows 11",
    "- Node version: 22",
    "- CodeClaw package/version: CodeClaw-local-trial",
    "- Trial host: host-1",
    "- Observed live: Yes",
    "- Goal: Understand Demo and read-only preflight.",
    "",
    "| Check | Result | Notes |",
    "| --- | --- | --- |",
    "| start-codeclaw.cmd worked | Yes | Opened. |",
    "| Browser opened automatically | Yes | Opened. |",
    "| Quick Start made the next step clear | Yes | Clear. |",
    "| Task Guide was understandable | Yes | Clear. |",
    "| Demo path was easy to find | Yes | Found. |",
    "| Demo vs real project mode was clear | Yes | Explained. |",
    "| Preflight completed | Yes | Completed. |",
    "| No writes occurred | Yes | Read-only. |",
    "| Patch gate felt trustworthy | Yes | Trusted. |",
    "",
    "## Issues",
    "",
    "1. Mode label could be larger.",
    "",
    "## Overall",
    "",
    "- Would you use CodeClaw again on a real project? Maybe",
    "- Would you try one disposable patch next? Yes",
    "- Most useful part: Read-only preflight.",
    "- Most confusing part: Mode label.",
    "- Should this build continue to the next tester? Yes",
    ""
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(sessionPath, "TRIAL_RESULT_RECORD.md"), [
    "# Result",
    "",
    "- Tester: tester-1",
    "- Host: host-1",
    "- Decision after trial: Continue",
    "",
    "| Outcome | Result | Evidence |",
    "| --- | --- | --- |",
    "| App launched | Pass | Launcher opened. |",
    "| Demo reached patch proposal or patch gate | Pass | Patch gate visible. |",
    "| Tester understood Demo vs real project mode | Pass | Explained. |",
    "| Real-project read-only preflight completed | Pass | Completed. |",
    "| No unexpected writes occurred | Pass | Read-only audit. |",
    "| Tester understood Apply writes files | Pass | Explained. |",
    "| Feedback template completed | Pass | Completed. |",
    "",
    "## Friction",
    "",
    "- First stuck moment: Mode label.",
    "- Host intervention needed: Yes",
    "- Severity: Medium",
    "",
    "## Trust",
    "",
    "- Strongest trust-building moment: Read-only preflight.",
    "- Strongest trust concern: None.",
    "",
    "## Go/No-Go For The Next Tester",
    "",
    "- Proceed to the next tester: Yes",
    "- Required fix before the next tester: None.",
    ""
  ].join("\n"), "utf8");
}

function runCompletion(args) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [scriptPath, ...args], { cwd: rootPath }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") {
        reject(error);
        return;
      }
      resolve({
        code: typeof error?.code === "number" ? error.code : 0,
        stdout,
        stderr
      });
    });
  });
}
