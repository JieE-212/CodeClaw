import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootPath, "scripts", "tester-intake.js");

test("tester-intake creates a local empty roster template", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-intake-init-"));
  const rosterPath = path.join(tempRoot, "TESTER_ROSTER.json");
  const jsonPath = path.join(tempRoot, "intake-report.json");
  const markdownPath = path.join(tempRoot, "intake-report.md");

  const result = await runIntake(["--init", "--roster", rosterPath, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));
  const roster = JSON.parse(await fs.readFile(rosterPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "WAITING_FOR_TESTER_INTAKE");
  assert.equal(report.counts.testers, 0);
  assert.ok(roster.exampleTester);
  assert.deepEqual(roster.testers, []);
});

test("tester-intake accepts an anonymous ready tester", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-intake-ready-"));
  const rosterPath = path.join(tempRoot, "TESTER_ROSTER.json");
  const jsonPath = path.join(tempRoot, "intake-report.json");
  const markdownPath = path.join(tempRoot, "intake-report.md");

  await writeRoster(rosterPath, [{
    id: "tester-1",
    language: "zh-CN",
    hostLanguage: "zh-CN",
    consent: true,
    privacyAccepted: true,
    allowedScope: ["demo", "real-read-only"],
    projectPermission: "Tester confirmed they may inspect the selected local project.",
    status: "ready"
  }]);

  const result = await runIntake(["--roster", rosterPath, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "READY_FOR_SESSION");
  assert.equal(report.counts.ready, 1);
  assert.equal(report.nextTester.id, "tester-1");
  assert.match(report.nextCommands[0], /trial:session-pack/);
});

test("tester-intake blocks missing consent and privacy acceptance", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-intake-hold-"));
  const rosterPath = path.join(tempRoot, "TESTER_ROSTER.json");
  const jsonPath = path.join(tempRoot, "intake-report.json");
  const markdownPath = path.join(tempRoot, "intake-report.md");

  await writeRoster(rosterPath, [{
    id: "tester-1",
    language: "en",
    consent: false,
    privacyAccepted: false,
    allowedScope: ["demo"],
    projectPermission: ""
  }]);

  const result = await runIntake(["--roster", rosterPath, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "INTAKE_HOLD");
  assert.ok(report.blockers.some((item) => item.includes("consent must be true")));
  assert.ok(report.blockers.some((item) => item.includes("privacyAccepted must be true")));
});

test("tester-intake blocks personal fields in roster", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-intake-pii-"));
  const rosterPath = path.join(tempRoot, "TESTER_ROSTER.json");
  const jsonPath = path.join(tempRoot, "intake-report.json");
  const markdownPath = path.join(tempRoot, "intake-report.md");

  await writeRoster(rosterPath, [{
    id: "tester-1",
    name: "Real Person",
    email: "person@example.com",
    language: "ru",
    consent: true,
    privacyAccepted: true,
    allowedScope: ["demo", "real-read-only"],
    projectPermission: "Allowed"
  }]);

  const result = await runIntake(["--roster", rosterPath, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "INTAKE_HOLD");
  assert.ok(report.blockers.some((item) => item.includes("remove personal field \"name\"")));
  assert.ok(report.blockers.some((item) => item.includes("remove personal field \"email\"")));
});

async function writeRoster(rosterPath, testers) {
  await fs.writeFile(rosterPath, `${JSON.stringify({ localOnly: true, testers }, null, 2)}\n`, "utf8");
}

function runIntake(args) {
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
