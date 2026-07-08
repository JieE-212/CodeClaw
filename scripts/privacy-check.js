import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const distPath = path.join(rootPath, "dist");
const args = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(rootPath, args.input || path.join("dist", "trial-session-packs", "tester-1"));
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_PRIVACY_REPORT.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_PRIVACY_REPORT.md"));

const report = await buildReport(inputPath);

await fs.mkdir(distPath, { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  inputPath,
  files: report.files.length,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  jsonPath,
  markdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function buildReport(targetPath) {
  const files = await collectFiles(targetPath);
  const findings = [];
  if (!(await exists(targetPath))) {
    findings.push(finding({
      severity: "blocker",
      rule: "missing-input",
      file: targetPath,
      line: 1,
      message: "Privacy-check input path does not exist.",
      excerpt: ""
    }));
  }
  for (const file of files) {
    findings.push(...await scanFile(file, targetPath));
  }
  const blockers = findings.filter((item) => item.severity === "blocker");
  const warnings = findings.filter((item) => item.severity === "warning");
  const decision = blockers.length ? "PRIVACY_HOLD" : warnings.length ? "PRIVACY_REVIEW" : "PRIVACY_OK";
  return {
    ok: blockers.length === 0,
    mode: "trial-privacy-check",
    createdAt: new Date().toISOString(),
    inputPath: targetPath,
    inputRelativePath: relative(targetPath),
    decision,
    files: files.map((file) => ({
      path: file,
      relativePath: relative(file)
    })),
    blockers,
    warnings,
    nextSteps: nextSteps(decision)
  };
}

async function collectFiles(targetPath) {
  if (!(await exists(targetPath))) return [];
  const stat = await fs.stat(targetPath);
  if (stat.isFile()) return [targetPath];
  const files = [];
  await walk(targetPath, async (entryPath, dirent) => {
    if (dirent.isFile()) files.push(entryPath);
  });
  return files.sort((a, b) => a.localeCompare(b));
}

async function walk(directory, visitor) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(entryPath, visitor);
      continue;
    }
    await visitor(entryPath, entry);
  }
}

async function scanFile(filePath, rootForRelative) {
  const findings = [];
  const base = path.basename(filePath);
  const relativeFile = path.relative(rootForRelative, filePath).split(path.sep).join("/");
  const stat = await fs.stat(filePath);

  if (isDisallowedFileName(base)) {
    findings.push(finding({
      severity: "blocker",
      rule: "disallowed-file",
      file: filePath,
      line: 1,
      message: "Session feedback must not contain env, key, log, or certificate files.",
      excerpt: relativeFile
    }));
  }
  if (isSourceLikeFile(base)) {
    findings.push(finding({
      severity: "blocker",
      rule: "source-file",
      file: filePath,
      line: 1,
      message: "Session feedback must not include real project source files.",
      excerpt: relativeFile
    }));
  }
  if (stat.size > 500_000) {
    findings.push(finding({
      severity: "blocker",
      rule: "large-file",
      file: filePath,
      line: 1,
      message: "Session feedback file is too large and may contain logs or source dumps.",
      excerpt: `${stat.size} bytes`
    }));
    return findings;
  }
  const text = await fs.readFile(filePath, "utf8").catch(() => "");
  if (!text) return findings;
  const lines = text.split(/\r?\n/);
  findings.push(...scanLines(filePath, lines));
  findings.push(...scanCodeFences(filePath, lines));
  return findings;
}

function scanLines(filePath, lines) {
  const findings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNo = index + 1;
    for (const rule of secretRules()) {
      if (rule.pattern.test(line) && !isClearlyRedacted(line)) {
        findings.push(finding({
          severity: "blocker",
          rule: rule.name,
          file: filePath,
          line: lineNo,
          message: rule.message,
          excerpt: redact(line)
        }));
      }
    }
    if (looksLikeEnvAssignment(line) && !isClearlyRedacted(line)) {
      findings.push(finding({
        severity: "blocker",
        rule: "env-assignment",
        file: filePath,
        line: lineNo,
        message: "Session feedback appears to include env-style secret configuration.",
        excerpt: redact(line)
      }));
    }
    if (looksLikePrivatePath(line)) {
      findings.push(finding({
        severity: "warning",
        rule: "absolute-path",
        file: filePath,
        line: lineNo,
        message: "Session feedback includes an absolute path; consider replacing personal path segments.",
        excerpt: redactPath(line)
      }));
    }
    if (looksLikeStackTrace(line)) {
      findings.push(finding({
        severity: "warning",
        rule: "stack-trace",
        file: filePath,
        line: lineNo,
        message: "Session feedback includes a stack trace line; keep only the minimum needed error context.",
        excerpt: redact(line)
      }));
    }
  }
  return dedupeFindings(findings);
}

function scanCodeFences(filePath, lines) {
  const findings = [];
  let inFence = false;
  let start = 0;
  let contentLines = 0;
  let sourceLikeLines = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      if (!inFence) {
        inFence = true;
        start = index + 1;
        contentLines = 0;
        sourceLikeLines = 0;
      } else {
        if (contentLines > 35 || sourceLikeLines > 12) {
          findings.push(finding({
            severity: "blocker",
            rule: "long-code-block",
            file: filePath,
            line: start,
            message: "Session feedback includes a long or source-like code block.",
            excerpt: `${contentLines} fenced lines`
          }));
        } else if (contentLines > 15 || sourceLikeLines > 5) {
          findings.push(finding({
            severity: "warning",
            rule: "code-block",
            file: filePath,
            line: start,
            message: "Session feedback includes a code block; confirm it does not contain proprietary source.",
            excerpt: `${contentLines} fenced lines`
          }));
        }
        inFence = false;
      }
      continue;
    }
    if (inFence) {
      contentLines += 1;
      if (looksLikeSourceLine(line)) sourceLikeLines += 1;
    }
  }
  return findings;
}

function secretRules() {
  return [
    {
      name: "openai-key",
      pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/,
      message: "Session feedback appears to include an OpenAI-style API key."
    },
    {
      name: "github-token",
      pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
      message: "Session feedback appears to include a GitHub token."
    },
    {
      name: "aws-access-key",
      pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
      message: "Session feedback appears to include an AWS access key id."
    },
    {
      name: "private-key",
      pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |)PRIVATE KEY-----/,
      message: "Session feedback appears to include a private key."
    }
  ];
}

function looksLikeEnvAssignment(line) {
  return /^\s*(?:export\s+)?[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL|AUTH)[A-Z0-9_]*\s*=\s*["']?[^"'\s]{10,}/.test(line);
}

function looksLikePrivatePath(line) {
  return /(?:[A-Za-z]:\\Users\\[^\\\s]+\\|\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/)/.test(line);
}

function looksLikeStackTrace(line) {
  return /^\s*at\s+.+\(.+:\d+:\d+\)/.test(line) || /^\s*File ".+", line \d+/.test(line);
}

function looksLikeSourceLine(line) {
  return /\b(function|class|const|let|var|import|export|return|if|for|while|try|catch)\b/.test(line)
    || /[{};]\s*$/.test(line)
    || /^\s*(def|public|private|protected|package|using|namespace)\s+/.test(line);
}

function isClearlyRedacted(line) {
  return /\b(REDACTED|redacted|example|placeholder|xxxx|xxxxx|dummy|fake|sample)\b/.test(line);
}

function isDisallowedFileName(base) {
  const lower = base.toLowerCase();
  return lower === ".env"
    || lower.startsWith(".env.")
    || lower.endsWith(".log")
    || lower.endsWith(".pem")
    || lower.endsWith(".key")
    || lower.endsWith(".crt")
    || lower === "id_rsa"
    || lower === "id_ed25519";
}

function isSourceLikeFile(base) {
  return /\.(js|jsx|ts|tsx|py|java|go|rs|cs|cpp|c|h|hpp|php|rb|swift|kt|mjs|cjs)$/.test(base.toLowerCase());
}

function finding({ severity, rule, file, line, message, excerpt }) {
  return {
    severity,
    rule,
    file,
    relativePath: relative(file),
    line,
    message,
    excerpt: excerpt ? redact(excerpt).slice(0, 180) : ""
  };
}

function redact(value) {
  return String(value || "")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}\b/g, "sk-...REDACTED")
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{8,}\b/g, "gh...REDACTED")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{8,}\b/g, "github_pat_...REDACTED")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{12,}\b/g, "AWS...REDACTED");
}

function redactPath(value) {
  return redact(String(value || "")
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+\\/g, "C:\\Users\\...\\\\")
    .replace(/\/Users\/[^/\s]+\//g, "/Users/.../")
    .replace(/\/home\/[^/\s]+\//g, "/home/.../"));
}

function dedupeFindings(findings) {
  const seen = new Set();
  const unique = [];
  for (const item of findings) {
    const key = [item.rule, item.relativePath, item.line, item.excerpt].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function nextSteps(decision) {
  if (decision === "PRIVACY_HOLD") {
    return [
      "Remove or redact every blocker before running trial:post-session.",
      "Do not share session files until privacy-check passes.",
      "Rerun npm.cmd run trial:privacy-check -- <session-folder>."
    ];
  }
  if (decision === "PRIVACY_REVIEW") {
    return [
      "Review warnings and redact personal paths or unnecessary stack traces.",
      "Proceed only if the host accepts the remaining warnings."
    ];
  }
  return [
    "Proceed with trial:post-session or archive the session folder locally."
  ];
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial Privacy Report",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Input: ${report.inputRelativePath}`,
    "",
    "## Blockers",
    "",
    ...renderFindings(report.blockers),
    "",
    "## Warnings",
    "",
    ...renderFindings(report.warnings),
    "",
    "## Files",
    "",
    ...(report.files.length ? report.files.map((file) => `- ${file.relativePath}`) : ["- None"]),
    "",
    "## Next Steps",
    "",
    ...report.nextSteps.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function renderFindings(findings) {
  if (!findings.length) return ["- None"];
  return findings.map((item) => `- ${item.rule} at ${item.relativePath}:${item.line} - ${item.message}${item.excerpt ? ` (${item.excerpt})` : ""}`);
}

function parseArgs(rawArgs) {
  const parsed = { input: "", json: "", markdown: "" };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--input") {
      parsed.input = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--input=")) {
      parsed.input = arg.slice("--input=".length);
      continue;
    }
    let handled = false;
    for (const key of ["json", "markdown"]) {
      if (arg === `--${key}`) {
        parsed[key] = rawArgs[index + 1] || "";
        index += 1;
        handled = true;
        break;
      }
      if (arg.startsWith(`--${key}=`)) {
        parsed[key] = arg.slice(key.length + 3);
        handled = true;
        break;
      }
    }
    if (handled) continue;
    if (!parsed.input && !arg.startsWith("--")) {
      parsed.input = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function relative(targetPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
