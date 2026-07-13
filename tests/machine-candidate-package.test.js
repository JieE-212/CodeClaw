import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { verifyCandidateIntegrity } from "../packages/local-launcher/src/candidate-integrity.js";
import { prepareMachineCandidate } from "../scripts/prepare-machine-candidate.js";
import { createTestResources } from "./helpers/test-resources.js";

test("machine candidate packaging is path-private, exact, externally stateful, and independently verifiable", async (t) => {
  const resources = await createTestResources(t, "codeclaw-machine-package-");
  const source = resources.path("source");
  const outputRoot = path.join(source, "dist");
  const commit = await createMinimalSource(source);
  await fs.writeFile(path.join(source, "apps", "ignored-secret.txt"), "must not be packaged\n", "utf8");

  const result = await prepareMachineCandidate({
    rootPath: source,
    outputRoot
  });

  assert.equal(result.status, "MACHINE_CANDIDATE_PACKAGED");
  assert.match(result.outputName, new RegExp(`^CodeClaw-machine-candidate-v0\\.1\\.0-${commit.slice(0, 12)}-[0-9a-f]{12}$`));
  const verified = await verifyCandidateIntegrity(result.outputPath);
  assert.equal(verified.candidateId, result.candidateId);
  assert.equal(verified.sourceCommit, commit);
  assert.equal(verified.sourceDirty, false);
  const humanManifest = await fs.readFile(path.join(result.outputPath, "PACKAGE_MANIFEST.md"), "utf8");
  assert.doesNotMatch(humanManifest, new RegExp(escapeRegExp(source), "i"));
  assert.match(humanManifest, /not a publisher signature/i);
  assert.equal(await exists(path.join(result.outputPath, ".codeclaw")), false);
  assert.equal(await exists(path.join(result.outputPath, "run-dev.cmd")), false);
  assert.equal(await exists(path.join(result.outputPath, "apps", "ignored-secret.txt")), false);
  assert.equal(await exists(path.join(result.outputPath, "stop-codeclaw.cmd")), true);
});

test("machine candidate exclusion is Unicode-normalized and Windows-case-insensitive", async (t) => {
  const resources = await createTestResources(t, "codeclaw-machine-package-case-escape-");
  const source = resources.path("source");
  await createMinimalSource(source);
  await fs.mkdir(path.join(source, "apps", "Node_Modules"), { recursive: true });
  await fs.writeFile(path.join(source, "apps", ".ENV.production"), "secret env\n", "utf8");
  await fs.writeFile(path.join(source, "apps", "TRACE.LOG"), "secret trace\n", "utf8");
  await fs.writeFile(path.join(source, "apps", "CodeClaw_Candidate_Authority.JSON"), "nested fake Authority\n", "utf8");
  await fs.writeFile(path.join(source, "apps", "CODECLAW_CANDIDATE_AUTHORITY.JSON.SHA256"), "nested fake sidecar\n", "utf8");
  await fs.writeFile(path.join(source, "apps", "Node_Modules", "private.txt"), "private dependency\n", "utf8");
  await runGit(source, [
    "add", "-f", "apps/.ENV.production", "apps/TRACE.LOG",
    "apps/CodeClaw_Candidate_Authority.JSON", "apps/CODECLAW_CANDIDATE_AUTHORITY.JSON.SHA256",
    "apps/Node_Modules/private.txt"
  ]);
  await runGit(source, ["commit", "-m", "case-escape fixtures"]);

  const result = await prepareMachineCandidate({
    rootPath: source,
    outputRoot: path.join(source, "dist")
  });

  assert.equal(await exists(path.join(result.outputPath, "apps", ".ENV.production")), false);
  assert.equal(await exists(path.join(result.outputPath, "apps", "TRACE.LOG")), false);
  assert.equal(await exists(path.join(result.outputPath, "apps", "CodeClaw_Candidate_Authority.JSON")), false);
  assert.equal(await exists(path.join(result.outputPath, "apps", "CODECLAW_CANDIDATE_AUTHORITY.JSON.SHA256")), false);
  assert.equal(await exists(path.join(result.outputPath, "apps", "Node_Modules")), false);
});

test("machine candidate provenance ignores inherited Git repository redirection", async (t) => {
  const resources = await createTestResources(t, "codeclaw-machine-package-git-env-");
  const source = resources.path("source");
  const redirected = resources.path("redirected");
  const sourceCommit = await createMinimalSource(source);
  await createMinimalSource(redirected);
  await fs.writeFile(path.join(redirected, "README.md"), "different repository\n", "utf8");
  await runGit(redirected, ["add", "README.md"]);
  await runGit(redirected, ["commit", "-m", "different fixture"]);
  const redirectedCommit = (await runGit(redirected, ["rev-parse", "HEAD"])).trim();
  assert.notEqual(sourceCommit, redirectedCommit);

  const names = ["GIT_DIR", "GIT_WORK_TREE", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"];
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.GIT_DIR = path.join(redirected, ".git");
    process.env.GIT_WORK_TREE = redirected;
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "core.fsmonitor";
    process.env.GIT_CONFIG_VALUE_0 = "hostile-monitor";
    const result = await prepareMachineCandidate({
      rootPath: source,
      outputRoot: path.join(source, "dist")
    });
    assert.equal(result.sourceCommit, sourceCommit);
    assert.notEqual(result.sourceCommit, redirectedCommit);
  } finally {
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  }
});

test("machine candidate accepts exactly one package.json BOM and rejects two", async (t) => {
  const resources = await createTestResources(t, "codeclaw-machine-package-double-bom-");
  const source = resources.path("source");
  await createMinimalSource(source);
  const packageDocument = JSON.stringify({ name: "codeclaw", version: "0.1.0", type: "module" });
  await fs.writeFile(path.join(source, "package.json"), `\ufeff\ufeff${packageDocument}`, "utf8");
  await runGit(source, ["add", "package.json"]);
  await runGit(source, ["commit", "-m", "double BOM fixture"]);

  await assert.rejects(
    () => prepareMachineCandidate({ rootPath: source, outputRoot: path.join(source, "dist") }),
    { code: "MACHINE_CANDIDATE_PACKAGE_JSON_INVALID" }
  );
});

test("machine candidate rejects a tracked pathname beginning with a BOM instead of renaming it", async (t) => {
  const resources = await createTestResources(t, "codeclaw-machine-package-path-bom-");
  const source = resources.path("source");
  await createMinimalSource(source);
  const bomName = "\ufeffvisible.txt";
  await fs.writeFile(path.join(source, "apps", bomName), "must never be renamed\n", "utf8");
  await runGit(source, ["add", "-f", `apps/${bomName}`]);
  await runGit(source, ["commit", "-m", "pathname BOM fixture"]);

  await assert.rejects(
    () => prepareMachineCandidate({ rootPath: source, outputRoot: path.join(source, "dist") }),
    { code: "MACHINE_CANDIDATE_PATH_INVALID" }
  );
  assert.equal(await exists(path.join(source, "dist", "apps", "visible.txt")), false);
});

test("machine candidate packaging refuses dirty or unavailable source identity before copying", async (t) => {
  const resources = await createTestResources(t, "codeclaw-machine-package-dirty-");
  const source = resources.path("source");
  await createMinimalSource(source);
  await fs.writeFile(path.join(source, "README.md"), "dirty tracked change\n", "utf8");
  await assert.rejects(
    () => prepareMachineCandidate({
      rootPath: source,
      outputRoot: path.join(source, "dist")
    }),
    { code: "MACHINE_CANDIDATE_SOURCE_NOT_CLEAN" }
  );
  assert.equal(await exists(path.join(source, "dist")), false);
});

async function createMinimalSource(root) {
  await fs.mkdir(root, { recursive: true });
  const directories = ["apps", "docs", "examples", "packages", "scripts", "tests"];
  for (const directory of directories) {
    await fs.mkdir(path.join(root, directory), { recursive: true });
    await fs.writeFile(path.join(root, directory, "placeholder.txt"), `${directory}\n`, "utf8");
  }
  await fs.writeFile(path.join(root, "package.json"), `\ufeff${JSON.stringify({ name: "codeclaw", version: "0.1.0", type: "module" })}`, "utf8");
  await fs.writeFile(path.join(root, ".gitignore"), "dist/\napps/ignored-secret.txt\n", "utf8");
  for (const file of ["README.md", "start-codeclaw.cmd", "start-codeclaw.ps1", "stop-codeclaw.cmd", "stop-codeclaw.ps1"]) {
    await fs.writeFile(path.join(root, file), `${file}\n`, "utf8");
  }
  await fs.writeFile(path.join(root, "run-dev.cmd"), "private dev path\n", "utf8");
  await runGit(root, ["init"]);
  await runGit(root, ["config", "user.email", "codeclaw-tests@example.invalid"]);
  await runGit(root, ["config", "user.name", "CodeClaw Tests"]);
  await runGit(root, ["add", "."]);
  await runGit(root, ["commit", "-m", "fixture"]);
  return (await runGit(root, ["rev-parse", "HEAD"])).trim();
}

function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, windowsHide: true, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout || ""));
    });
  });
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
