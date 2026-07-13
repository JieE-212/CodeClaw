import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestResources } from "./helpers/test-resources.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsRoot = path.join(projectRoot, "tests");

test("test sources cannot use repository-local runtime state, fixed ports, or mutable source fixtures", async () => {
  const files = await collectJavaScriptFiles(testsRoot);
  const violations = [];

  for (const filePath of files) {
    const source = await fs.readFile(filePath, "utf8");
    const relative = path.relative(projectRoot, filePath).replaceAll("\\", "/");
    checkPattern(relative, source, /path\.join\(\s*rootPath\s*,\s*["'](?:\.codeclaw|dist)["']/g, "repository-local runtime output", violations);
    checkPattern(relative, source, /\bCODECLAW_PORT\s*:\s*["'`]?[1-9]\d{3,4}["'`]?/g, "fixed CodeClaw port", violations);
    checkPattern(relative, source, /\.listen\(\s*4173\b/g, "fixed CodeClaw listener", violations);
    checkPattern(
      relative,
      source,
      /\bfs\.(?:appendFile|copyFile|cp|mkdir|rename|rm|unlink|writeFile)\s*\([^;\n]*(?:rootPath|projectRoot)[^;\n]*["']examples["']/g,
      "source example mutation",
      violations
    );

    if (/\b(?:fs\.)?mkdtemp\s*\(/.test(source)) {
      const registeredCleanup = /\b(?:t|testContext|context)\.after\s*\(/.test(source)
        || /\bfinally\s*\{[\s\S]*?\bfs\.rm\s*\(/.test(source)
        || /\bcreate(?:TestResources|IsolatedProject)\s*\(/.test(source);
      if (!registeredCleanup) violations.push(`${relative}: temporary directory has no registered or finally-guarded cleanup`);
    }

    const spawnsCodeClaw = source.includes("spawn(") && /["']apps[\\/]web[\\/]server\.js["']/.test(source);
    if (spawnsCodeClaw) {
      for (const variable of ["CODECLAW_PORT", "CODECLAW_STATE_DIR", "CODECLAW_PROJECT_LOCK_DIR", "CODECLAW_DISPOSABLE_ROOT"]) {
        if (!source.includes(variable)) violations.push(`${relative}: spawned CodeClaw server is missing ${variable}`);
      }
      const cleanupRegistered = /\b(?:t|test)\.after\(/.test(source) || /\bfinally\s*\{/.test(source);
      if (!source.includes(".kill(") || !cleanupRegistered) {
        violations.push(`${relative}: spawned CodeClaw server is not paired with registered process cleanup`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("test resource helper copies mutable fixtures without local state or generated artifacts", async (t) => {
  const resources = await createTestResources(t, "codeclaw-test-isolation-");
  const source = resources.path("source");
  await fs.mkdir(path.join(source, "src"), { recursive: true });
  await fs.mkdir(path.join(source, ".git"), { recursive: true });
  await fs.mkdir(path.join(source, ".codeclaw"), { recursive: true });
  await fs.mkdir(path.join(source, "dist"), { recursive: true });
  await fs.writeFile(path.join(source, "src", "index.js"), "export const isolated = true;\n", "utf8");
  await fs.writeFile(path.join(source, ".git", "config"), "[core]\n", "utf8");
  await fs.writeFile(path.join(source, ".codeclaw", "tasks.json"), "[]\n", "utf8");
  await fs.writeFile(path.join(source, "dist", "artifact.txt"), "generated\n", "utf8");

  const copied = await resources.copyProject(source, "copy");
  assert.equal(await fs.readFile(path.join(copied, "src", "index.js"), "utf8"), "export const isolated = true;\n");
  await assert.rejects(fs.stat(path.join(copied, ".git")), { code: "ENOENT" });
  await assert.rejects(fs.stat(path.join(copied, ".codeclaw")), { code: "ENOENT" });
  await assert.rejects(fs.stat(path.join(copied, "dist")), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(source, "dist", "artifact.txt"), "utf8"), "generated\n");
});

async function collectJavaScriptFiles(directoryPath) {
  const output = [];
  for (const entry of await fs.readdir(directoryPath, { withFileTypes: true })) {
    const target = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) output.push(...await collectJavaScriptFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".js")) output.push(target);
  }
  return output.sort((left, right) => left.localeCompare(right));
}

function checkPattern(filePath, source, pattern, label, violations) {
  for (const match of source.matchAll(pattern)) {
    const line = source.slice(0, match.index).split(/\r?\n/).length;
    violations.push(`${filePath}:${line}: ${label}`);
  }
}
