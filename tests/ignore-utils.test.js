import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createIgnoreDecisionMatcher, createStrictIgnoreMatcher, isPathIgnoredStrict } from "../packages/shared/src/ignore-utils.js";

test("gitignore matcher supports double-star roots, escaped markers, and character classes", () => {
  const decide = createIgnoreDecisionMatcher([
    "**/private.json",
    String.raw`\#notes.txt`,
    String.raw`\!important.txt`,
    "[ab].txt",
    "src/**/generated?.js"
  ].join("\n"));

  assert.equal(decide("private.json", false), true);
  assert.equal(decide("nested/private.json", false), true);
  assert.equal(decide("#notes.txt", false), true);
  assert.equal(decide("!important.txt", false), true);
  assert.equal(decide("a.txt", false), true);
  assert.equal(decide("c.txt", false), null);
  assert.equal(decide("src/generated1.js", false), true);
  assert.equal(decide("src/deep/generated2.js", false), true);
});

test("strict ignore decisions do not re-include a child of an excluded parent", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-ignore-parent-"));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await fs.mkdir(path.join(root, "ignored"));
  await fs.writeFile(path.join(root, ".gitignore"), "ignored/\n!ignored/file.txt\n", "utf8");
  await fs.writeFile(path.join(root, "ignored", "file.txt"), "still ignored\n", "utf8");

  assert.equal(await isPathIgnoredStrict(root, "ignored", true), true);
  assert.equal(await isPathIgnoredStrict(root, "ignored/file.txt", false), true);
});

test("strict ignore decisions apply nested gitignore rules and their negations", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-ignore-nested-"));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await fs.mkdir(path.join(root, "nested"));
  await fs.writeFile(path.join(root, "nested", ".gitignore"), "*.tmp\n!keep.tmp\n", "utf8");
  await fs.writeFile(path.join(root, "nested", "drop.tmp"), "drop\n", "utf8");
  await fs.writeFile(path.join(root, "nested", "keep.tmp"), "keep\n", "utf8");

  assert.equal(await isPathIgnoredStrict(root, "nested/drop.tmp", false), true);
  assert.equal(await isPathIgnoredStrict(root, "nested/keep.tmp", false), false);
});

test("gitignore matching is non-backtracking and enforces pattern and match-step budgets", async (t) => {
  let steps = 0;
  const decide = createIgnoreDecisionMatcher(`${"*a".repeat(40)}b`, {
    onMatchStep: (count) => { steps += count; }
  });
  assert.equal(decide("a".repeat(200), false), null);
  assert.ok(steps < 100_000);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-ignore-budget-"));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await fs.writeFile(path.join(root, ".gitignore"), `${"*a".repeat(20)}b\n`, "utf8");

  const patternSession = createStrictIgnoreMatcher(root, { maxPatternChars: 8 });
  await assert.rejects(
    () => patternSession.isIgnoredTraversed("source.txt", false),
    (error) => error.code === "GITIGNORE_RUNTIME_BUDGET_EXCEEDED"
      && error.runtimeBudget.operation === "gitignore-pattern-chars"
  );

  const matchSession = createStrictIgnoreMatcher(root, { maxMatchSteps: 100 });
  await assert.rejects(
    () => matchSession.isIgnoredTraversed("a".repeat(100), false),
    (error) => error.code === "GITIGNORE_RUNTIME_BUDGET_EXCEEDED"
      && error.runtimeBudget.operation === "gitignore-match-steps"
  );
});
