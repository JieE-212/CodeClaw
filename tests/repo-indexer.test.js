import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanRepository } from "../packages/repo-indexer/src/index.js";

async function makeFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-indexer-"));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await fs.mkdir(path.join(root, "cache"));
  await fs.mkdir(path.join(root, ".codeclaw"));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, ".gitignore"), "ignored.log\ncache/\n");
  await fs.writeFile(path.join(root, "ignored.log"), "ignored\n");
  await fs.writeFile(path.join(root, "cache", "generated.js"), "export const ignored = true;\n");
  await fs.writeFile(path.join(root, ".codeclaw", "memory.json"), "[]\n");
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" }, dependencies: { react: "latest" } }));
  await fs.writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\nexport function calculateTotal() {\n  return value;\n}\n");
  await fs.writeFile(path.join(root, ".env"), "SECRET=hidden\n");
  return root;
}

test("scanRepository detects language, commands, and skips sensitive files", async (t) => {
  const root = await makeFixture(t);
  const profile = await scanRepository(root);
  assert.equal(profile.name, path.basename(root));
  assert.ok(profile.languages.some((item) => item.name === "TypeScript"));
  assert.ok(profile.frameworks.includes("React"));
  assert.ok(profile.commands.some((item) => item.command === "npm run test"));
  assert.ok(profile.skipped.some((item) => item.path === ".env"));
  const source = profile.files.find((item) => item.path === "src/index.ts");
  assert.ok(source.symbols.some((symbol) => symbol.name === "value" && symbol.kind === "variable"));
  assert.ok(source.symbols.some((symbol) => symbol.name === "calculateTotal" && symbol.kind === "function"));
});

test("scanRepository follows root .gitignore rules", async (t) => {
  const root = await makeFixture(t);
  const profile = await scanRepository(root);
  assert.ok(!profile.files.some((item) => item.path === "ignored.log"));
  assert.ok(!profile.files.some((item) => item.path === "cache/generated.js"));
  assert.ok(!profile.files.some((item) => item.path === ".codeclaw/memory.json"));
  assert.ok(profile.skipped.some((item) => item.path === "ignored.log" && item.reason === "gitignore"));
  assert.ok(profile.skipped.some((item) => item.path === "cache" && item.reason === "gitignore"));
  assert.ok(profile.skipped.some((item) => item.path === ".codeclaw" && item.reason === "skipped-directory"));
});

test("ignored manifests cannot contribute commands or framework metadata", async (t) => {
  const root = await makeFixture(t);
  await fs.writeFile(path.join(root, ".gitignore"), "package.json\nignored.log\ncache/\n", "utf8");
  const profile = await scanRepository(root);
  assert.ok(profile.skipped.some((item) => item.path === "package.json" && item.reason === "gitignore"));
  assert.equal(profile.commands.length, 0);
  assert.equal(profile.frameworks.includes("React"), false);
  assert.equal(profile.packageManagers.includes("npm"), false);
});

test("scanRepository skips protected directories case-insensitively and follows nested ignore rules", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-indexer-boundary-"));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await fs.mkdir(path.join(root, ".CODECLAW"));
  await fs.mkdir(path.join(root, ".Git"));
  await fs.mkdir(path.join(root, ".AWS"));
  await fs.mkdir(path.join(root, "nested"));
  await fs.writeFile(path.join(root, ".CODECLAW", "owner.json"), "private\n", "utf8");
  await fs.writeFile(path.join(root, ".Git", "config"), "private\n", "utf8");
  await fs.writeFile(path.join(root, ".AWS", "credentials"), "not-real\n", "utf8");
  await fs.writeFile(path.join(root, ".npmrc"), "not-real\n", "utf8");
  await fs.writeFile(path.join(root, "credentials.json"), "{}\n", "utf8");
  await fs.writeFile(path.join(root, "private.key"), "not-real\n", "utf8");
  await fs.writeFile(path.join(root, "token.js"), "export const token = 'ordinary-source';\n", "utf8");
  await fs.writeFile(path.join(root, "tokenizer.js"), "export const tokenizer = true;\n", "utf8");
  await fs.writeFile(path.join(root, "secretary.js"), "export const secretary = true;\n", "utf8");
  await fs.writeFile(path.join(root, "nested", ".gitignore"), "*.tmp\n!keep.tmp\n", "utf8");
  await fs.writeFile(path.join(root, "nested", "drop.tmp"), "drop\n", "utf8");
  await fs.writeFile(path.join(root, "nested", "keep.tmp"), "keep\n", "utf8");

  const profile = await scanRepository(root);
  assert.ok(profile.skipped.some((item) => item.path === ".CODECLAW" && item.reason === "skipped-directory"));
  assert.ok(profile.skipped.some((item) => item.path === ".Git" && item.reason === "skipped-directory"));
  assert.ok(profile.skipped.some((item) => item.path === ".AWS" && item.reason === "sensitive-directory"));
  for (const relative of [".npmrc", "credentials.json", "private.key"]) {
    assert.ok(profile.skipped.some((item) => item.path === relative && item.reason === "sensitive-file"), relative);
  }
  assert.ok(profile.skipped.some((item) => item.path === "nested/drop.tmp" && item.reason === "gitignore"));
  assert.ok(profile.files.some((item) => item.path === "nested/keep.tmp"));
  for (const relative of ["token.js", "tokenizer.js", "secretary.js"]) {
    assert.ok(profile.files.some((item) => item.path === relative), relative);
  }
  assert.ok(!profile.files.some((item) => item.path.includes("owner.json") || item.path.endsWith("/.Git/config")));
});

test("scanRepository reports bounded traversal evidence without treating optional summaries as structural truncation", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-indexer-budget-"));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await fs.mkdir(path.join(root, "nested"));
  await fs.writeFile(path.join(root, "a.js"), "export const a = 1;\n", "utf8");
  await fs.writeFile(path.join(root, "b.js"), "export const b = 2;\n", "utf8");
  await fs.writeFile(path.join(root, "large.js"), "x".repeat(32), "utf8");
  await fs.writeFile(path.join(root, "nested", "c.js"), "export const c = 3;\n", "utf8");

  const fileLimited = await scanRepository(root, { maxFiles: 1 });
  assert.equal(fileLimited.fileCount, 1);
  assert.equal(fileLimited.truncated, true);
  assert.ok(fileLimited.truncationReasons.includes("max-files"));
  assert.equal(fileLimited.budget.limits.maxFiles, 1);
  assert.equal(fileLimited.budget.used.filesCollected, 1);

  const depthLimited = await scanRepository(root, { maxDepth: 0 });
  assert.equal(depthLimited.truncated, true);
  assert.ok(depthLimited.truncationReasons.includes("max-depth"));
  assert.ok(depthLimited.skipped.some((item) => item.path === "nested" && item.reason === "runtime-budget-depth"));

  const summaryLimited = await scanRepository(root, { maxSummaryFileBytes: 24 });
  assert.equal(summaryLimited.truncated, false);
  assert.deepEqual(summaryLimited.detailOmissions, ["max-summary-file-bytes"]);
  assert.equal(summaryLimited.budget.used.summaryFilesSkippedByBudget, 1);

  const hardCapped = await scanRepository(root, { maxFiles: Number.MAX_SAFE_INTEGER });
  assert.equal(hardCapped.budget.limits.maxFiles, 800);
});

test("scanRepository bounds manifest and ignore metadata", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-indexer-metadata-budget-"));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");
  await fs.writeFile(path.join(root, ".gitignore"), "first.tmp\nsecond.tmp\n", "utf8");

  const manifestLimited = await scanRepository(root, { maxManifestFileBytes: 8 });
  assert.equal(manifestLimited.truncated, true);
  assert.ok(manifestLimited.truncationReasons.includes("max-manifest-file-bytes"));
  assert.equal(manifestLimited.budget.used.manifestFilesSkippedByBudget, 1);
  assert.deepEqual(manifestLimited.commands, []);

  await assert.rejects(
    () => scanRepository(root, { maxIgnoreRules: 1 }),
    (error) => error.code === "GITIGNORE_RUNTIME_BUDGET_EXCEEDED"
      && error.runtimeBudget.operation === "gitignore-rules"
      && error.runtimeBudget.limit === 1
      && error.runtimeBudget.observed === 2
  );
});

test("scanRepository rejects cancellation during summary and manifest reads", async (t) => {
  for (const scenario of ["summary", "manifest"]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `codeclaw-indexer-signal-${scenario}-`));
    t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
    const target = scenario === "summary" ? path.join(root, "source.js") : path.join(root, "package.json");
    await fs.writeFile(target, scenario === "summary"
      ? "export const signalMarker = true;\n"
      : JSON.stringify({ padding: "x".repeat(7000), scripts: { test: "node --test" } }), "utf8");
    const controller = new AbortController();
    const reason = Object.assign(new Error(`${scenario} cancelled`), { code: "OPERATION_CANCELLED", status: 409 });
    const originalOpen = fs.open.bind(fs);
    t.mock.method(fs, "open", async (filePath, ...args) => {
      const handle = await originalOpen(filePath, ...args);
      if (path.resolve(filePath) === path.resolve(target)) controller.abort(reason);
      return handle;
    });

    await assert.rejects(() => scanRepository(root, { signal: controller.signal }), (error) => error === reason);
    t.mock.restoreAll();
  }
});

test("scanRepository rejects an already-cancelled operation before filesystem work", async () => {
  const controller = new AbortController();
  const reason = Object.assign(new Error("scan cancelled"), { code: "OPERATION_CANCELLED", status: 409 });
  controller.abort(reason);
  await assert.rejects(() => scanRepository(process.cwd(), { signal: controller.signal }), (error) => error === reason);
});
