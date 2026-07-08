import test from "node:test";
import assert from "node:assert/strict";
import {
  decidePreflightGate,
  isDocsOrMetadataPath,
  isSourcePath,
  isTestPath,
  pickSearchQuery,
  summarizeContextCoverage
} from "../packages/preflight/src/index.js";

test("preflight path classifiers handle Chinese folders and metadata", () => {
  assert.equal(isSourcePath("平台版本/01-电脑网页端/app.js"), true);
  assert.equal(isSourcePath("server/validation.js"), true);
  assert.equal(isSourcePath("test/server.test.js"), false);
  assert.equal(isSourcePath("README.md"), false);
  assert.equal(isTestPath("test/server.test.js"), true);
  assert.equal(isDocsOrMetadataPath("平台版本/01-电脑网页端/README.md"), true);
  assert.equal(isDocsOrMetadataPath("package.json"), true);
});

test("summarizeContextCoverage counts source, tests, and docs", () => {
  const coverage = summarizeContextCoverage([
    { path: "README.md" },
    { path: "平台版本/01-电脑网页端/app.js" },
    { path: "server/validation.js" },
    { path: "test/server.test.js" },
    { path: "package.json" }
  ]);
  assert.deepEqual(coverage, { sourceFiles: 2, testFiles: 1, docsOrMetadata: 2 });
});

test("decidePreflightGate warns when implementation context is mostly docs", () => {
  const gate = decidePreflightGate({
    goal: "prepare CodeClaw for a small real feature change with tests",
    scan: { fileCount: 58, commands: [{ command: "npm run test" }] },
    selected: [
      { path: "docs/REAL_REPO_TRIAL.md" },
      { path: "docs/DEMOS.md" },
      { path: "package.json" },
      { path: "tests/audit-log.test.js" }
    ],
    searchHits: [{ path: "apps/web/server.js" }]
  });
  assert.equal(gate.proceedToModelSuggestion, true);
  assert.equal(gate.proceedToPatch, false);
  assert.match(gate.warnings.join("\n"), /no source files/);
  assert.match(gate.warnings.join("\n"), /weighted toward docs/);
});

test("decidePreflightGate passes concrete source and test context", () => {
  const gate = decidePreflightGate({
    goal: "improve game data validation error messages with tests",
    scan: { fileCount: 21, commands: [{ command: "npm run test" }] },
    selected: [
      { path: "server/validateGameData.js" },
      { path: "test/server.test.js" },
      { path: "server/validation.js" },
      { path: "package.json" },
      { path: "server/gameData.base.js" }
    ],
    searchHits: [{ path: "server/validateGameData.js" }]
  });
  assert.equal(gate.proceedToModelSuggestion, true);
  assert.equal(gate.proceedToPatch, false);
  assert.deepEqual(gate.blockers, []);
  assert.deepEqual(gate.warnings, []);
});

test("decidePreflightGate treats empty search as warning, not blocker", () => {
  const gate = decidePreflightGate({
    goal: "improve game data validation error messages with tests",
    scan: { fileCount: 21, commands: [{ command: "npm run test" }] },
    selected: [
      { path: "server/validation.js" },
      { path: "test/server.test.js" }
    ],
    searchHits: []
  });
  assert.deepEqual(gate.blockers, []);
  assert.match(gate.warnings.join("\n"), /Search returned no hits/);
});

test("pickSearchQuery skips generic words and falls back to symbols", () => {
  assert.equal(pickSearchQuery("improve game data validation error messages with tests", [], {}), "game");
  assert.equal(pickSearchQuery("prepare small feature change", [], { files: [{ symbols: [{ name: "validateGameData" }] }] }), "validateGameData");
});
