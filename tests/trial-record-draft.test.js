import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootPath, "scripts", "trial-record-draft.js");

test("record-draft extracts only explicit tester notes and leaves gaps", async () => {
  const fixture = await makeFixture("record-draft-ok");
  const notesPath = path.join(fixture.tempRoot, "notes.md");
  await fs.writeFile(notesPath, [
    "- Goal: Try Demo and one real-project read-only preflight.",
    "- First stuck moment: The tester hesitated at the Demo versus real project mode.",
    "- Host intervention needed: Yes",
    "- Severity: Medium",
    "- Most useful part: Read-only preflight.",
    "- Main trust concern: Apply sounded risky on a real project.",
    "- Proceed to tester 2: Yes",
    "- Required fix before tester 2: None",
    ""
  ].join("\n"), "utf8");

  const result = await runDraft(fixture, notesPath);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "RECORD_DRAFT_READY_WITH_GAPS");
  assert.ok(report.suggestions.some((item) => item.field === "Goal" && item.value.includes("Demo")));
  assert.ok(report.suggestions.some((item) => item.field === "First stuck moment"));
  assert.ok(report.missing.some((item) => item.field === "Would you use CodeClaw again on a real project?"));
  assert.equal(report.privacyFindings.blockers.length, 0);
});

test("record-draft blocks personal contact data", async () => {
  const fixture = await makeFixture("record-draft-privacy");
  const notesPath = path.join(fixture.tempRoot, "unsafe-notes.md");
  await fs.writeFile(notesPath, [
    "- Goal: Try Demo.",
    "- Tester contact: tester@example.com",
    "- First stuck moment: Startup.",
    ""
  ].join("\n"), "utf8");

  const result = await runDraft(fixture, notesPath);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "RECORD_DRAFT_HOLD");
  assert.ok(report.blockers.some((item) => item.includes("Personal email")));
});

test("record-draft accepts zh-CN labels and does not treat tester wording as instructions", async () => {
  const fixture = await makeFixture("record-draft-zh");
  const notesPath = path.join(fixture.tempRoot, "zh-notes.md");
  await fs.writeFile(notesPath, [
    "- \u76ee\u6807: Try the Demo first.",
    "- Most confusing part: I don't know whether Apply is safe.",
    "- \u4e3b\u8981\u4fe1\u4efb\u987e\u8651: Unsure when files are written.",
    "- \u622a\u56fe: local screenshot mentioned but not attached.",
    ""
  ].join("\n"), "utf8");

  const result = await runDraft(fixture, notesPath);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.ok(report.suggestions.some((item) => item.field === "Goal"));
  assert.ok(report.suggestions.some((item) => item.field === "Most confusing part" && item.value.includes("don't know")));
  assert.ok(report.warnings.some((item) => item.includes("Sensitive artifact reference")));
});

async function makeFixture(name) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `codeclaw-${name}-`));
  const sessionPath = path.join(tempRoot, "session");
  const jsonPath = path.join(tempRoot, "TRIAL_RECORD_DRAFT.json");
  const markdownPath = path.join(tempRoot, "TRIAL_RECORD_DRAFT.md");
  await fs.mkdir(sessionPath, { recursive: true });
  return { tempRoot, sessionPath, jsonPath, markdownPath };
}

function runDraft(fixture, notesPath) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [
      scriptPath,
      "--session", path.relative(rootPath, fixture.sessionPath),
      "--notes", path.relative(rootPath, notesPath),
      "--json", path.relative(rootPath, fixture.jsonPath),
      "--markdown", path.relative(rootPath, fixture.markdownPath)
    ], { cwd: rootPath }, (error, stdout, stderr) => {
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
