import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanRepository } from "../packages/repo-indexer/src/index.js";

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-indexer-"));
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

test("scanRepository detects language, commands, and skips sensitive files", async () => {
  const root = await makeFixture();
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

test("scanRepository follows root .gitignore rules", async () => {
  const root = await makeFixture();
  const profile = await scanRepository(root);
  assert.ok(!profile.files.some((item) => item.path === "ignored.log"));
  assert.ok(!profile.files.some((item) => item.path === "cache/generated.js"));
  assert.ok(!profile.files.some((item) => item.path === ".codeclaw/memory.json"));
  assert.ok(profile.skipped.some((item) => item.path === "ignored.log" && item.reason === "gitignore"));
  assert.ok(profile.skipped.some((item) => item.path === "cache" && item.reason === "gitignore"));
  assert.ok(profile.skipped.some((item) => item.path === ".codeclaw" && item.reason === "skipped-directory"));
});
