import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createIsolatedProject } from "./helpers/test-resources.js";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("archive-session creates a local evidence package after privacy passes", async (t) => {
  const isolated = await createIsolatedProject(t, rootPath, "codeclaw-archive-ok-");
  const tempRoot = isolated.path("inputs");
  const sessionPath = path.join(tempRoot, "tester-1");
  const reportsPath = path.join(tempRoot, "reports");
  const archivePath = path.join(isolated.projectRoot, "dist", "test-archives", "archive-ok");
  const jsonPath = path.join(tempRoot, "archive-report.json");
  const markdownPath = path.join(tempRoot, "archive-report.md");

  await fs.mkdir(sessionPath, { recursive: true });
  await fs.mkdir(reportsPath, { recursive: true });
  await fs.writeFile(path.join(sessionPath, "SESSION_PACK_MANIFEST.json"), JSON.stringify({ ok: true, testerId: "tester-1" }, null, 2), "utf8");
  await fs.writeFile(path.join(sessionPath, "SESSION_BRIEF.md"), "# Session Brief\n", "utf8");
  await fs.writeFile(path.join(sessionPath, "TRIAL_FEEDBACK_TEMPLATE.md"), "Raw tester feedback stays local.\n", "utf8");
  await fs.writeFile(path.join(reportsPath, "TRIAL_PRIVACY_REPORT.json"), JSON.stringify({
    ok: true,
    decision: "PRIVACY_OK",
    blockers: [],
    warnings: []
  }, null, 2), "utf8");
  await fs.writeFile(path.join(reportsPath, "TRIAL_POST_SESSION_REPORT.json"), JSON.stringify({
    ok: true,
    decision: "READY_FOR_NEXT_TESTER"
  }, null, 2), "utf8");

  const result = await runArchive(isolated, [
    "--session", sessionPath,
    "--reports", reportsPath,
    "--tester", "tester-1",
    "--out", archivePath,
    "--json", jsonPath,
    "--markdown", markdownPath
  ]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.ok, true);
  assert.equal(report.decision, "ARCHIVE_READY_LOCAL");
  assert.equal(report.privacyDecision, "PRIVACY_OK");
  assert.ok(await exists(path.join(archivePath, "ARCHIVE_MANIFEST.json")));
  assert.ok(await exists(path.join(archivePath, "SHARING_CHECKLIST.md")));
  assert.ok(await exists(path.join(archivePath, "reports", "TRIAL_PRIVACY_REPORT.json")));
  assert.ok(await exists(path.join(archivePath, "session-context", "SESSION_BRIEF.md")));
  assert.equal(await exists(path.join(archivePath, "TRIAL_FEEDBACK_TEMPLATE.md")), false);
  assert.equal(report.sharing.archiveIsLocalOnly, true);
  assert.equal(report.sharing.publicShareAllowed, false);
});

test("archive-session blocks privacy-hold records", async (t) => {
  const isolated = await createIsolatedProject(t, rootPath, "codeclaw-archive-hold-");
  const tempRoot = isolated.path("inputs");
  const sessionPath = path.join(tempRoot, "tester-1");
  const reportsPath = path.join(tempRoot, "reports");
  const archivePath = path.join(isolated.projectRoot, "dist", "test-archives", "archive-hold");
  const jsonPath = path.join(tempRoot, "archive-report.json");
  const markdownPath = path.join(tempRoot, "archive-report.md");

  await fs.mkdir(sessionPath, { recursive: true });
  await fs.mkdir(reportsPath, { recursive: true });
  await fs.writeFile(path.join(reportsPath, "TRIAL_PRIVACY_REPORT.json"), JSON.stringify({
    ok: false,
    decision: "PRIVACY_HOLD",
    blockers: [{ rule: "openai-key" }]
  }, null, 2), "utf8");

  const result = await runArchive(isolated, [
    "--session", sessionPath,
    "--reports", reportsPath,
    "--tester", "tester-1",
    "--out", archivePath,
    "--json", jsonPath,
    "--markdown", markdownPath
  ]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.ok, false);
  assert.equal(report.decision, "ARCHIVE_HOLD");
  assert.equal(report.privacyDecision, "PRIVACY_HOLD");
  assert.ok(report.blockers.some((item) => item.includes("Privacy report is not safe")));
  assert.equal(await exists(path.join(archivePath, "ARCHIVE_MANIFEST.json")), false);
});

function runArchive(isolated, args) {
  return isolated.execNodeScript("archive-session.js", args, { label: "isolated archive-session" });
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
