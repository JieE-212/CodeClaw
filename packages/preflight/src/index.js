const STOP_WORDS = new Set(["project", "context", "files", "first", "safe", "trial", "repo", "repository", "understand", "identify", "prepare", "small", "feature", "change", "tests", "improve"]);

export function pickSearchQuery(goalText, selected = [], repoProfile = {}) {
  const goalTokens = String(goalText || "").toLowerCase().match(/[a-z0-9_]{4,}/g) || [];
  const usefulGoalToken = goalTokens.find((token) => !STOP_WORDS.has(token));
  if (usefulGoalToken) return usefulGoalToken;
  const firstSymbol = (repoProfile.files || []).flatMap((file) => file.symbols || []).find((symbol) => symbol.name?.length > 3);
  if (firstSymbol) return firstSymbol.name;
  const firstContextName = selected[0]?.path?.split(/[\\/]/).pop()?.split(".")[0];
  return firstContextName || "test";
}

export function summarizeContextCoverage(selected = []) {
  return {
    sourceFiles: selected.filter((item) => isSourcePath(item.path)).length,
    testFiles: selected.filter((item) => isTestPath(item.path)).length,
    docsOrMetadata: selected.filter((item) => isDocsOrMetadataPath(item.path)).length
  };
}

export function decidePreflightGate({ goal = "", scan = {}, selected = [], searchHits = [] } = {}) {
  const blockers = [];
  const warnings = [];
  const coverage = summarizeContextCoverage(selected);
  if (!scan.fileCount) blockers.push("No files were scanned.");
  if (!selected.length) blockers.push("No context candidates were selected.");
  if (!searchHits.length) warnings.push("Search returned no hits for the selected query; context candidates may still be usable if they include the relevant source and tests.");
  if (!scan.commands?.length) blockers.push("No project commands were detected.");
  if (looksLikeImplementationGoal(goal) && coverage.sourceFiles === 0) {
    warnings.push("Goal looks like an implementation task, but no source files were selected. Make the goal more concrete or inspect context ranking before patching.");
  }
  if (looksLikeTestGoal(goal) && coverage.testFiles === 0) {
    warnings.push("Goal mentions tests, but no test files were selected.");
  }
  if (coverage.docsOrMetadata > coverage.sourceFiles + coverage.testFiles && looksLikeImplementationGoal(goal)) {
    warnings.push("Context is weighted toward docs/metadata for an implementation-looking goal.");
  }
  return {
    proceedToModelSuggestion: blockers.length === 0,
    proceedToPatch: false,
    blockers,
    warnings,
    note: blockers.length ? "Resolve blockers before using a real model or applying patches." : "Read-only preflight passed. Next step is model suggestion only; keep writes disabled until a disposable branch or copy is ready."
  };
}

export const decideNextGate = decidePreflightGate;

export function looksLikeImplementationGoal(goalText) {
  return /\b(add|build|change|update|fix|implement|feature|refactor|support|enable|wire|create)\b/i.test(goalText);
}

export function looksLikeTestGoal(goalText) {
  return /\b(test|tests|spec)\b/i.test(goalText) || /\btest\s+coverage\b/i.test(goalText);
}

export function isSourcePath(filePath) {
  const normalized = normalizePath(filePath);
  if (isTestPath(normalized) || isDocsOrMetadataPath(normalized)) return false;
  return /(^|\/)(src|app|lib|packages|server|client)\//i.test(normalized) || /\.(js|jsx|ts|tsx|mjs|cjs|css|html|vue|svelte|py|go|rs|java|kt|cs|php|rb)$/i.test(normalized);
}

export function isTestPath(filePath) {
  return /(^|\/)(test|tests|__tests__)\/|\.test\.|\.spec\./i.test(normalizePath(filePath));
}

export function isDocsOrMetadataPath(filePath) {
  const normalized = normalizePath(filePath);
  return /(^|\/)(docs?|README)|package\.json$|pyproject\.toml$|requirements\.txt$|tsconfig\.json$/i.test(normalized);
}

function normalizePath(filePath) {
  return String(filePath || "").replace(/\\/g, "/");
}
