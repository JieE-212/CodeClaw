import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_BUDGETS, boundedBudgetValue, readFileHandleBounded, runtimeBudgetError } from "./runtime-budget.js";
import { throwIfAborted } from "./operation-manager.js";

export function createIgnoreDecisionMatcher(content = "", hooks = {}) {
  const rules = [];
  for (const line of String(content).split(/\r?\n/)) {
    const rule = parseRule(line);
    if (!rule) continue;
    hooks.onRuleParsed?.();
    hooks.onPatternParsed?.(rule.pattern.length);
    rules.push({ ...rule, tokens: tokenizeGlob(rule.pattern), hooks });
  }

  return (relativePath, isDirectory = false) => {
    const normalized = normalizePath(relativePath);
    let ignored = null;
    for (const rule of rules) {
      hooks.onRuleEvaluation?.();
      if (matchesRule(rule, normalized, isDirectory)) ignored = !rule.negated;
    }
    return ignored;
  };
}

export async function isPathIgnoredStrict(rootPath, relativePath, isDirectory = false, signal = null) {
  throwIfAborted(signal);
  const matcher = createStrictIgnoreMatcher(rootPath, { signal });
  const ignored = await matcher.isIgnored(relativePath, isDirectory);
  throwIfAborted(signal);
  await matcher.verify();
  throwIfAborted(signal);
  return ignored;
}

export function createStrictIgnoreMatcher(rootPath, options = {}) {
  throwIfAborted(options.signal);
  const resolvedRoot = path.resolve(rootPath);
  const hard = options.profile === "dataBoundary"
    ? RUNTIME_BUDGETS.dataBoundary
    : RUNTIME_BUDGETS.toolRegistry;
  const limits = {
    maxFiles: boundedBudgetValue(options.maxFiles, hard.maxIgnoreFiles),
    maxFileBytes: boundedBudgetValue(options.maxFileBytes, hard.maxIgnoreFileBytes),
    maxTotalBytes: boundedBudgetValue(options.maxTotalBytes, hard.maxIgnoreTotalBytes),
    maxRules: boundedBudgetValue(options.maxRules, hard.maxIgnoreRules),
    maxRuleEvaluations: boundedBudgetValue(options.maxRuleEvaluations, hard.maxIgnoreRuleEvaluations),
    maxPatternChars: boundedBudgetValue(options.maxPatternChars, hard.maxIgnorePatternChars),
    maxMatchSteps: boundedBudgetValue(options.maxMatchSteps, hard.maxIgnoreMatchSteps)
  };
  const session = {
    rootPath: resolvedRoot,
    limits,
    signal: options.signal || null,
    cache: new Map(),
    used: {
      filesRead: 0,
      bytesRead: 0,
      identityChecks: 0,
      rulesLoaded: 0,
      ruleEvaluations: 0,
      maxPatternCharsObserved: 0,
      matchSteps: 0
    }
  };
  return {
    isIgnored: (relativePath, isDirectory = false) => isPathIgnoredWithSession(session, relativePath, isDirectory),
    isIgnoredTraversed: (relativePath, isDirectory = false) => ignoreDecisionStrict(session, normalizePath(relativePath), isDirectory).then((decision) => decision === true),
    verify: () => verifyIgnoreSession(session),
    evidence: () => ({
      limits: { ...limits },
      used: { ...session.used, cacheEntries: session.cache.size }
    })
  };
}

async function isPathIgnoredWithSession(session, relativePath, isDirectory = false) {
  throwIfAborted(session.signal);
  const normalized = normalizePath(relativePath);
  const segments = normalized.split("/").filter(Boolean);
  for (let depth = 1; depth < segments.length; depth += 1) {
    throwIfAborted(session.signal);
    const parentPath = segments.slice(0, depth).join("/");
    if (await ignoreDecisionStrict(session, parentPath, true) === true) return true;
  }
  return await ignoreDecisionStrict(session, normalized, isDirectory) === true;
}

async function ignoreDecisionStrict(session, normalized, isDirectory) {
  throwIfAborted(session.signal);
  const segments = normalized.split("/").filter(Boolean);
  let decision = null;
  for (let depth = 0; depth < Math.max(1, segments.length); depth += 1) {
    throwIfAborted(session.signal);
    const baseSegments = segments.slice(0, depth);
    const scoped = segments.slice(depth).join("/");
    if (!scoped) break;
    const ignorePath = path.join(session.rootPath, ...baseSegments, ".gitignore");
    const matcher = await readIgnoreMatcherStrict(ignorePath, session);
    throwIfAborted(session.signal);
    if (matcher === null) continue;
    const next = matcher(scoped, isDirectory);
    if (next !== null) decision = next;
  }
  return decision;
}

async function readIgnoreMatcherStrict(filePath, session) {
  throwIfAborted(session.signal);
  const cached = session.cache.get(filePath);
  if (cached) return cached.exists ? cached.matcher : null;

  let before;
  let handle;
  try {
    before = await fs.lstat(filePath, { bigint: true });
    throwIfAborted(session.signal);
  } catch (error) {
    throwIfAborted(session.signal);
    if (error.code === "ENOENT") {
      session.cache.set(filePath, { exists: false });
      return null;
    }
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
    const error = new Error("Refusing to trust a linked or non-file .gitignore.");
    error.code = "GITIGNORE_UNSAFE";
    throw error;
  }
  assertIgnoreFileBudget(before.size, session);
  try {
    handle = await fs.open(filePath, "r");
    throwIfAborted(session.signal);
    const opened = await handle.stat({ bigint: true });
    throwIfAborted(session.signal);
    if (!sameStableFileStat(before, opened) || !opened.isFile() || opened.nlink !== 1n) {
      throw ignoreError("GITIGNORE_CHANGED", "The .gitignore changed before it was read.");
    }
    assertIgnoreFileBudget(opened.size, session);
    const remainingTotal = session.limits.maxTotalBytes - session.used.bytesRead;
    const readLimit = Math.min(session.limits.maxFileBytes, remainingTotal);
    const bounded = await readFileHandleBounded(handle, readLimit);
    throwIfAborted(session.signal);
    if (bounded.exceeded) throw ignoreReadGrowthBudgetError(session, bounded.byteLength, readLimit);
    const after = await handle.stat({ bigint: true });
    const pathAfter = await fs.lstat(filePath, { bigint: true });
    throwIfAborted(session.signal);
    if (!sameStableFileStat(opened, after) || !sameStableFileStat(opened, pathAfter)) {
      throw ignoreError("GITIGNORE_CHANGED", "The .gitignore changed while it was read.");
    }
    let content;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bounded.buffer);
    } catch {
      throw ignoreError("GITIGNORE_INVALID_UTF8", "Refusing to trust a .gitignore that is not valid UTF-8.");
    }
    session.used.filesRead += 1;
    session.used.bytesRead += bounded.byteLength;
    const record = {
      exists: true,
      stat: pathAfter,
      matcher: createIgnoreDecisionMatcher(content, {
        onRuleParsed: () => recordIgnoreRule(session),
        onRuleEvaluation: () => recordIgnoreRuleEvaluation(session),
        onPatternParsed: (length) => recordIgnorePattern(session, length),
        onMatchStep: (count) => recordIgnoreMatchSteps(session, count)
      })
    };
    session.cache.set(filePath, record);
    return record.matcher;
  } catch (error) {
    throwIfAborted(session.signal);
    if (["GITIGNORE_CHANGED", "GITIGNORE_INVALID_UTF8", "GITIGNORE_RUNTIME_BUDGET_EXCEEDED"].includes(error.code)) throw error;
    if (error.code === "ENOENT") throw ignoreError("GITIGNORE_CHANGED", "The .gitignore disappeared while it was read.");
    throw ignoreError("GITIGNORE_UNREADABLE", "CodeClaw could not safely read .gitignore.");
  } finally {
    try {
      await handle?.close();
    } catch (error) {
      throwIfAborted(session.signal);
      throw error;
    }
  }
}

async function verifyIgnoreSession(session) {
  throwIfAborted(session.signal);
  for (const [filePath, cached] of session.cache) {
    throwIfAborted(session.signal);
    await verifyCachedIgnoreFile(filePath, cached, session);
  }
}

async function verifyCachedIgnoreFile(filePath, cached, session) {
  throwIfAborted(session.signal);
  session.used.identityChecks += 1;
  let current;
  try {
    current = await fs.lstat(filePath, { bigint: true });
    throwIfAborted(session.signal);
  } catch (error) {
    throwIfAborted(session.signal);
    if (error.code === "ENOENT" && !cached.exists) return null;
    if (error.code === "ENOENT") throw ignoreError("GITIGNORE_CHANGED", "The .gitignore disappeared after it was read.");
    throw error;
  }
  if (!cached.exists || !sameStableFileStat(cached.stat, current)) {
    throw ignoreError("GITIGNORE_CHANGED", "The .gitignore changed while the workspace was being inspected.");
  }
  return cached.matcher;
}

function assertIgnoreFileBudget(size, session) {
  if (session.used.filesRead >= session.limits.maxFiles) {
    throw runtimeBudgetError(
      "GITIGNORE_RUNTIME_BUDGET_EXCEEDED",
      `CodeClaw stopped after reaching the ${session.limits.maxFiles}-file .gitignore budget.`,
      { operation: "gitignore-files", limit: session.limits.maxFiles, observed: session.used.filesRead + 1 }
    );
  }
  if (size > BigInt(session.limits.maxFileBytes)) {
    throw runtimeBudgetError(
      "GITIGNORE_RUNTIME_BUDGET_EXCEEDED",
      `CodeClaw refused to read a .gitignore larger than ${session.limits.maxFileBytes} bytes.`,
      { operation: "gitignore-file-bytes", limit: session.limits.maxFileBytes, observed: safeBigIntNumber(size) }
    );
  }
  const projected = BigInt(session.used.bytesRead) + size;
  if (projected > BigInt(session.limits.maxTotalBytes)) {
    throw runtimeBudgetError(
      "GITIGNORE_RUNTIME_BUDGET_EXCEEDED",
      `CodeClaw stopped after reaching the ${session.limits.maxTotalBytes}-byte aggregate .gitignore budget.`,
      { operation: "gitignore-total-bytes", limit: session.limits.maxTotalBytes, observed: safeBigIntNumber(projected) }
    );
  }
}

function ignoreReadGrowthBudgetError(session, observed, readLimit) {
  const totalLimited = readLimit < session.limits.maxFileBytes;
  const operation = totalLimited ? "gitignore-total-bytes" : "gitignore-file-bytes";
  const limit = totalLimited ? session.limits.maxTotalBytes : session.limits.maxFileBytes;
  const totalObserved = totalLimited ? session.used.bytesRead + observed : observed;
  return runtimeBudgetError(
    "GITIGNORE_RUNTIME_BUDGET_EXCEEDED",
    "CodeClaw stopped because a .gitignore grew beyond its runtime read budget.",
    { operation, limit, observed: totalObserved }
  );
}

function recordIgnoreRule(session) {
  throwIfAborted(session.signal);
  const observed = session.used.rulesLoaded + 1;
  if (observed > session.limits.maxRules) {
    throw runtimeBudgetError(
      "GITIGNORE_RUNTIME_BUDGET_EXCEEDED",
      `CodeClaw stopped after reaching the ${session.limits.maxRules}-rule .gitignore budget.`,
      { operation: "gitignore-rules", limit: session.limits.maxRules, observed }
    );
  }
  session.used.rulesLoaded = observed;
}

function recordIgnoreRuleEvaluation(session) {
  throwIfAborted(session.signal);
  session.used.ruleEvaluations += 1;
  if (session.used.ruleEvaluations > session.limits.maxRuleEvaluations) {
    throw runtimeBudgetError(
      "GITIGNORE_RUNTIME_BUDGET_EXCEEDED",
      `CodeClaw stopped after reaching the ${session.limits.maxRuleEvaluations}-evaluation .gitignore budget.`,
      { operation: "gitignore-rule-evaluations", limit: session.limits.maxRuleEvaluations, observed: session.used.ruleEvaluations }
    );
  }
}

function recordIgnorePattern(session, length) {
  throwIfAborted(session.signal);
  session.used.maxPatternCharsObserved = Math.max(session.used.maxPatternCharsObserved, length);
  if (length > session.limits.maxPatternChars) {
    throw runtimeBudgetError(
      "GITIGNORE_RUNTIME_BUDGET_EXCEEDED",
      `CodeClaw refused to compile a .gitignore pattern longer than ${session.limits.maxPatternChars} characters.`,
      { operation: "gitignore-pattern-chars", limit: session.limits.maxPatternChars, observed: length }
    );
  }
}

function recordIgnoreMatchSteps(session, count) {
  session.used.matchSteps += count;
  throwIfAborted(session.signal);
  if (session.used.matchSteps > session.limits.maxMatchSteps) {
    throw runtimeBudgetError(
      "GITIGNORE_RUNTIME_BUDGET_EXCEEDED",
      `CodeClaw stopped after reaching the ${session.limits.maxMatchSteps}-step .gitignore matching budget.`,
      { operation: "gitignore-match-steps", limit: session.limits.maxMatchSteps, observed: session.used.matchSteps }
    );
  }
}

function safeBigIntNumber(value) {
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
}

function sameStableFileStat(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.birthtimeNs === right.birthtimeNs
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function ignoreError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseRule(line) {
  const normalizedLine = stripUnescapedTrailingSpaces(String(line || ""));
  if (!normalizedLine || normalizedLine.startsWith("#")) return null;

  const negated = normalizedLine.startsWith("!");
  const rawPattern = negated ? normalizedLine.slice(1) : normalizedLine;
  const directoryOnly = rawPattern.endsWith("/");
  const anchored = rawPattern.startsWith("/");
  const pattern = rawPattern.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!pattern) return null;

  return { pattern, negated, directoryOnly, anchored, hasSlash: pattern.includes("/") };
}

function matchesRule(rule, relativePath, isDirectory) {
  if (rule.directoryOnly) {
    const segments = relativePath.split("/");
    const directoryCount = isDirectory ? segments.length : Math.max(0, segments.length - 1);
    for (let count = 1; count <= directoryCount; count += 1) {
      if (matchesRulePath(rule, segments.slice(0, count).join("/"))) return true;
    }
    return false;
  }

  return matchesRulePath(rule, relativePath);
}

function matchesRulePath(rule, relativePath) {
  if (rule.anchored || rule.hasSlash) return matchGlob(rule.tokens, relativePath, rule.hooks);

  const segments = relativePath.split("/");
  return segments.some((segment) => matchGlob(rule.tokens, segment, rule.hooks));
}

function tokenizeGlob(pattern) {
  const tokens = [];
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "\\" && index + 1 < pattern.length) {
      tokens.push({ type: "literal", value: pattern[index + 1] });
      index += 1;
      continue;
    }
    if (character === "*") {
      let end = index;
      while (pattern[end + 1] === "*") end += 1;
      const count = end - index + 1;
      const followedBySlash = pattern[end + 1] === "/";
      if (count >= 2 && followedBySlash) {
        tokens.push({ type: "globstar-slash" });
        index = end + 1;
      } else {
        tokens.push({ type: count >= 2 ? "globstar" : "star" });
        index = end;
      }
      continue;
    }
    if (character === "?") {
      tokens.push({ type: "any" });
      continue;
    }
    if (character === "[") {
      const characterClass = parseCharacterClass(pattern, index);
      if (characterClass) {
        tokens.push(characterClass.token);
        index = characterClass.end;
        continue;
      }
    }
    tokens.push({ type: "literal", value: character });
  }
  return tokens;
}

function parseCharacterClass(pattern, start) {
  let end = start + 1;
  if (pattern[end] === "!" || pattern[end] === "^") end += 1;
  if (pattern[end] === "]") end += 1;
  while (end < pattern.length && pattern[end] !== "]") end += 1;
  if (end >= pattern.length) return null;

  let content = pattern.slice(start + 1, end);
  let negated = false;
  if (content.startsWith("!") || content.startsWith("^")) {
    negated = true;
    content = content.slice(1);
  }
  const members = [];
  for (let index = 0; index < content.length; index += 1) {
    let first = content[index];
    if (first === "\\" && index + 1 < content.length) first = content[++index];
    if (content[index + 1] === "-" && index + 2 < content.length) {
      index += 2;
      let last = content[index];
      if (last === "\\" && index + 1 < content.length) last = content[++index];
      members.push({ first, last });
    } else {
      members.push({ first, last: first });
    }
  }
  return { token: { type: "class", negated, members }, end };
}

function matchGlob(tokens, value, hooks) {
  let pendingSteps = 0;
  const countStep = () => {
    pendingSteps += 1;
    if (pendingSteps >= 256) {
      hooks.onMatchStep?.(pendingSteps);
      pendingSteps = 0;
    }
  };
  const flushSteps = () => {
    if (pendingSteps) hooks.onMatchStep?.(pendingSteps);
    pendingSteps = 0;
  };
  let states = epsilonClosure(tokens, new Set([0]), countStep);
  for (let characterIndex = 0; characterIndex < value.length; characterIndex += 1) {
    const character = value[characterIndex];
    const next = new Set();
    for (const position of states) {
      countStep();
      const token = tokens[position];
      if (!token) continue;
      if (token.type === "literal" && character === token.value) next.add(position + 1);
      else if (token.type === "any" && character !== "/") next.add(position + 1);
      else if (token.type === "class" && characterClassMatches(token, character)) next.add(position + 1);
      else if (token.type === "star" && character !== "/") next.add(position);
      else if (token.type === "globstar") next.add(position);
      else if (token.type === "globstar-slash") {
        next.add(position);
        if (character === "/") next.add(position + 1);
      }
    }
    states = epsilonClosure(tokens, next, countStep);
    if (states.size === 0) {
      flushSteps();
      return false;
    }
  }
  states = epsilonClosure(tokens, states, countStep);
  const matched = states.has(tokens.length);
  flushSteps();
  return matched;
}

function epsilonClosure(tokens, initial, countStep) {
  const states = new Set(initial);
  const pending = [...initial];
  while (pending.length) {
    const position = pending.pop();
    countStep();
    const type = tokens[position]?.type;
    if (!["star", "globstar", "globstar-slash"].includes(type) || states.has(position + 1)) continue;
    states.add(position + 1);
    pending.push(position + 1);
  }
  return states;
}

function characterClassMatches(token, character) {
  if (character === "/") return false;
  const found = token.members.some(({ first, last }) => first <= character && character <= last);
  return token.negated ? !found : found;
}

function stripUnescapedTrailingSpaces(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === " ") {
    let backslashes = 0;
    for (let index = end - 2; index >= 0 && value[index] === "\\"; index -= 1) backslashes += 1;
    if (backslashes % 2 === 1) break;
    end -= 1;
  }
  return value.slice(0, end);
}

function normalizePath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\/+/, "");
}
