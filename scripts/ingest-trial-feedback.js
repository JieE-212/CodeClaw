import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const distPath = path.join(rootPath, "dist");
const args = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(rootPath, args.input || "docs/trial-feedback");
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_FEEDBACK_SUMMARY.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_FEEDBACK_SUMMARY.md"));

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

async function buildReport(sourcePath) {
  const files = await readMarkdownFiles(sourcePath);
  const parsed = files.map((file) => parseTrialFile(file));
  const signals = collectSignals(parsed);
  const blockers = collectBlockers(signals);
  const warnings = collectWarnings(signals, blockers);
  const decision = decide({ files, signals, blockers, warnings });

  return {
    ok: true,
    mode: "trial-feedback-ingest",
    createdAt: new Date().toISOString(),
    sourceRoot: rootPath,
    inputPath: sourcePath,
    decision,
    files: files.map((file) => ({
      path: file.path,
      relativePath: path.relative(rootPath, file.path).split(path.sep).join("/"),
      bytes: file.text.length
    })),
    coverage: {
      feedbackFiles: countMatching(files, /feedback/i),
      observationFiles: countMatching(files, /observation/i),
      resultFiles: countMatching(files, /result/i),
      answeredRows: signals.answeredRows.length,
      unansweredRows: signals.unansweredRows.length,
      answeredFields: signals.answeredFields.length,
      issueNotes: signals.issueNotes.length
    },
    decisionSignals: signals.decisionSignals,
    blockers,
    warnings,
    safetyConcerns: signals.safetyConcerns,
    frictionThemes: rankThemes(signals),
    recommendedFixes: recommendedFixes({ signals, blockers, warnings }),
    issueNotes: signals.issueNotes.slice(0, 30),
    nextSteps: nextSteps(decision)
  };
}

async function readMarkdownFiles(sourcePath) {
  if (!(await exists(sourcePath))) return [];
  const stat = await fs.stat(sourcePath);
  if (stat.isFile()) {
    return sourcePath.toLowerCase().endsWith(".md")
      ? [{ path: sourcePath, text: await fs.readFile(sourcePath, "utf8") }]
      : [];
  }
  const files = [];
  await walk(sourcePath, async (entryPath, dirent) => {
    if (dirent.isFile() && entryPath.toLowerCase().endsWith(".md")) {
      files.push({ path: entryPath, text: await fs.readFile(entryPath, "utf8") });
    }
  });
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
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

function parseTrialFile(file) {
  return {
    file,
    rows: parseTables(file),
    fields: parseFields(file),
    issueNotes: parseIssueNotes(file)
  };
}

function parseTables(file) {
  const lines = file.text.split(/\r?\n/);
  const rows = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!isTableLine(lines[index]) || !isDividerLine(lines[index + 1])) continue;
    const headers = splitTableLine(lines[index]);
    const resultIndex = headers.findIndex((header) => normalizeHeader(header) === "result");
    if (resultIndex === -1) continue;
    const labelIndex = headers.findIndex((header) => ["check", "outcome", "moment"].includes(normalizeHeader(header)));
    const notesIndex = headers.findIndex((header) => ["notes", "evidence"].includes(normalizeHeader(header)));
    let rowIndex = index + 2;
    while (rowIndex < lines.length && isTableLine(lines[rowIndex])) {
      if (!isDividerLine(lines[rowIndex])) {
        const cells = splitTableLine(lines[rowIndex]);
        const label = cleanCell(cells[labelIndex >= 0 ? labelIndex : 0] || "");
        const result = cleanCell(cells[resultIndex] || "");
        const notes = cleanCell(cells[notesIndex] || "");
        const answer = normalizeAnswer(result);
        rows.push({
          file: file.path,
          line: rowIndex + 1,
          label,
          result,
          answer,
          notes,
          category: categorize(`${label} ${notes}`)
        });
      }
      rowIndex += 1;
    }
  }
  return rows;
}

function parseFields(file) {
  const fields = [];
  const lines = file.text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*-\s+([^:]{2,80}):\s*(.*)$/)
      || lines[index].match(/^\s*-\s+(.{2,80}?\?)\s*:?[ \t]*(.*)$/);
    if (!match) continue;
    const key = cleanCell(match[1]);
    const value = cleanCell(match[2]);
    fields.push({
      file: file.path,
      line: index + 1,
      key,
      value,
      answer: normalizeAnswer(value),
      category: categorize(`${key} ${value}`)
    });
  }
  return fields;
}

function parseIssueNotes(file) {
  const lines = file.text.split(/\r?\n/);
  const notes = [];
  let collect = false;
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^##+\s+(.+)$/);
    if (heading) {
      collect = /\b(issues|bugs|product fixes|friction|trust|host notes|overall|go\/no-go)\b/i.test(heading[1]);
      continue;
    }
    if (!collect) continue;
    const numbered = lines[index].match(/^\s*\d+\.\s+(.+)$/);
    if (numbered && !isPlaceholder(numbered[1]) && shouldCollectIssueNote(numbered[1])) {
      notes.push(noteItem(file.path, index + 1, numbered[1]));
      continue;
    }
    const bullet = lines[index].match(/^\s*-\s+(.+)$/);
    if (bullet && !bullet[1].includes(":") && !isPlaceholder(bullet[1]) && shouldCollectIssueNote(bullet[1])) {
      notes.push(noteItem(file.path, index + 1, bullet[1]));
    }
  }
  return notes;
}

function collectSignals(parsedFiles) {
  const answeredRows = [];
  const unansweredRows = [];
  const answeredFields = [];
  const unansweredFields = [];
  const issueNotes = [];
  const safetyConcerns = [];
  const decisionSignals = [];

  for (const parsed of parsedFiles) {
    for (const row of parsed.rows) {
      if (!row.answer) {
        unansweredRows.push(publicSignal(row));
        continue;
      }
      const signal = publicSignal(row);
      answeredRows.push(signal);
      if (isDecisionSignal(row)) decisionSignals.push(signal);
      if (isSafetyConcern(row)) safetyConcerns.push(signal);
    }
    for (const field of parsed.fields) {
      if (!field.answer && !field.value) {
        unansweredFields.push(publicSignal(field));
        continue;
      }
      if (!field.answer && isPlaceholder(field.value)) {
        unansweredFields.push(publicSignal(field));
        continue;
      }
      const signal = publicSignal(field);
      answeredFields.push(signal);
      if (isDecisionSignal(field)) decisionSignals.push(signal);
      if (isSafetyConcern(field)) safetyConcerns.push(signal);
    }
    for (const note of parsed.issueNotes) {
      issueNotes.push(note);
      if (isSafetyText(note.text)) safetyConcerns.push(note);
    }
  }

  return {
    answeredRows,
    unansweredRows,
    answeredFields,
    unansweredFields,
    issueNotes,
    safetyConcerns,
    decisionSignals
  };
}

function collectBlockers(signals) {
  const blockers = [];
  for (const signal of [...signals.answeredRows, ...signals.answeredFields]) {
    const severity = severityFor(signal);
    if (severity === "blocker") blockers.push(withReason(signal, blockerReason(signal)));
  }
  for (const note of signals.issueNotes) {
    if (/\b(high|critical|crash|unsafe|unexpected write|wrote files|api key leaked|could not launch)\b/i.test(note.text)) {
      blockers.push(withReason(note, "High-risk issue note."));
    }
  }
  return dedupeSignals(blockers);
}

function collectWarnings(signals, blockers) {
  const warnings = [];
  const blockerKeys = new Set(blockers.map(signalKey));
  for (const signal of [...signals.answeredRows, ...signals.answeredFields]) {
    const severity = severityFor(signal);
    if (severity === "warning" && !blockerKeys.has(signalKey(signal))) {
      warnings.push(withReason(signal, warningReason(signal)));
    }
  }
  for (const note of signals.issueNotes) {
    if (!blockerKeys.has(signalKey(note)) && /\b(confus|friction|slow|hesitat|stuck|unclear|maybe)\b/i.test(note.text)) {
      warnings.push(withReason(note, "Friction issue note."));
    }
  }
  return dedupeSignals(warnings);
}

function severityFor(signal) {
  const label = `${signal.label || signal.key || ""} ${signal.text || ""}`.toLowerCase();
  const answer = signal.answer || normalizeAnswer(signal.value || signal.result || "");
  const value = `${signal.value || signal.result || ""}`.toLowerCase();
  if (/\bseverity\b/.test(label) && /\bhigh\b/.test(value)) return "blocker";
  if (/\bdecision after trial\b/.test(label) && /\bstop\b/.test(value)) return "blocker";
  if (/\bdecision after trial\b/.test(label) && /\bfix first\b/.test(value)) return "blocker";
  if (isNextTesterDecisionLabel(label) && answer === "no") return "blocker";
  if (answer === "fail") return isSafetyText(label) ? "blocker" : "warning";
  if (answer === "friction") return isSafetyText(label) ? "blocker" : "warning";
  if (answer === "no" && isExpectedYes(label)) return isSafetyText(label) ? "blocker" : "warning";
  if (answer === "yes" && isExpectedNo(label)) return isSafetyText(label) ? "blocker" : "warning";
  if (answer === "maybe") return "warning";
  if (/\bseverity\b/.test(label) && /\bmedium\b/.test(value)) return "warning";
  return "ok";
}

function decide({ files, signals, blockers, warnings }) {
  if (files.length === 0) return "WAITING_FOR_FEEDBACK";
  if (blockers.length > 0) return "NO_GO_FIX_FIRST";
  const goSignals = signals.decisionSignals.filter((signal) => {
    const label = `${signal.label || signal.key || ""}`.toLowerCase();
    return isNextTesterDecisionLabel(label);
  });
  if (goSignals.some((signal) => signal.answer === "yes")) return warnings.length ? "READY_WITH_WATCH_ITEMS" : "READY_FOR_TESTER_2";
  return warnings.length ? "REVIEW_BEFORE_TESTER_2" : "NEEDS_HOST_DECISION";
}

function rankThemes(signals) {
  const counts = new Map();
  const allSignals = [
    ...signals.answeredRows,
    ...signals.answeredFields,
    ...signals.issueNotes,
    ...signals.safetyConcerns
  ];
  for (const signal of allSignals) {
    const severity = severityFor(signal);
    if (severity === "ok" && !signal.text) continue;
    const category = signal.category || categorize(`${signal.label || signal.key || ""} ${signal.text || ""}`);
    const current = counts.get(category) || { theme: category, count: 0, blockers: 0, warnings: 0, examples: [] };
    current.count += 1;
    if (severity === "blocker") current.blockers += 1;
    if (severity === "warning") current.warnings += 1;
    if (current.examples.length < 3) current.examples.push(displaySignal(signal));
    counts.set(category, current);
  }
  return [...counts.values()].sort((a, b) => b.blockers - a.blockers || b.warnings - a.warnings || b.count - a.count);
}

function recommendedFixes({ signals, blockers, warnings }) {
  const fixes = [];
  const themes = rankThemes(signals);
  for (const theme of themes) {
    if (theme.blockers === 0 && theme.warnings === 0) continue;
    fixes.push(fixForTheme(theme));
  }
  if (blockers.length === 0 && warnings.length === 0 && signals.answeredRows.length + signals.answeredFields.length > 0) {
    fixes.push("No blocking product fix found. Prepare the next tester with the same hosted script and watch for repeated friction.");
  }
  if (signals.answeredRows.length + signals.answeredFields.length === 0) {
    fixes.push("Collect at least one completed feedback, observation, or result record before deciding whether to continue to the next tester.");
  }
  return [...new Set(fixes)].slice(0, 8);
}

function fixForTheme(theme) {
  const prefix = theme.blockers ? "Fix before the next tester" : "Watch or improve";
  const text = {
    startup: "startup and launcher clarity.",
    language: "language switcher discoverability and translated first-run copy.",
    "demo-real-mode": "Demo vs real project mode labeling.",
    path: "path entry recovery and folder/file guidance.",
    preflight: "read-only preflight explanations, warnings, and context relevance.",
    safety: "Apply/Verify/write-boundary safety copy and confirmations.",
    model: "model setup, cost guidance, and API-key safety messaging.",
    patch: "patch proposal review clarity.",
    verification: "verification command detection and confirmation copy.",
    audit: "audit trail visibility.",
    docs: "Quick Start, runbook, or feedback form wording.",
    feedback: "feedback collection completeness.",
    other: "the recorded friction items."
  }[theme.theme] || "the recorded friction items.";
  return `${prefix}: ${text}`;
}

function nextSteps(decision) {
  if (decision === "WAITING_FOR_FEEDBACK") {
    return [
      "Place completed trial markdown files in docs/trial-feedback or pass a folder path to npm.cmd run trial:ingest-feedback -- <folder>.",
      "Collect at least TRIAL_FEEDBACK_TEMPLATE.md, HUMAN_TRIAL_OBSERVATION.md, and TRIAL_RESULT_RECORD.md for tester 1."
    ];
  }
  if (decision === "NO_GO_FIX_FIRST") {
    return [
      "Fix blockers before inviting the next tester.",
      "Rerun trial:simulate, trial:ready, trial:freeze, trial:dispatch, then rerun trial:ingest-feedback with the completed records."
    ];
  }
  if (decision === "REVIEW_BEFORE_TESTER_2" || decision === "NEEDS_HOST_DECISION") {
    return [
      "Have the host make an explicit next-tester go/no-go entry in TRIAL_RESULT_RECORD.md.",
      "Fix or accept warnings before inviting the next tester."
    ];
  }
  return [
    "Invite the next tester with the current hosted trial packet.",
    "Keep the same observation checklist so friction can be compared across testers."
  ];
}

function isTableLine(line) {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isDividerLine(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableLine(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cleanCell);
}

function cleanCell(value) {
  return String(value || "").replace(/`/g, "").replace(/\s+/g, " ").trim();
}

function normalizeHeader(value) {
  return cleanCell(value).toLowerCase();
}

function normalizeAnswer(value) {
  const cleaned = cleanCell(value).toLowerCase();
  if (!cleaned || isPlaceholder(cleaned)) return "";
  if (["yes", "no", "maybe", "pass", "friction", "fail", "n/a", "na"].includes(cleaned)) {
    return cleaned === "na" ? "n/a" : cleaned;
  }
  if (["low", "medium", "high"].includes(cleaned)) return cleaned;
  return "";
}

function isPlaceholder(value) {
  const cleaned = cleanCell(value).toLowerCase();
  return !cleaned || cleaned === "." || /^n\/a\s*\/|\/\s*n\/a$/.test(cleaned) || cleaned.includes(" / ");
}

function isExpectedYes(label) {
  return /\b(worked|opened|understand|understood|clear|completed|relevant|trustworthy|safe|use codeclaw again|try one disposable|no writes occurred|no unexpected writes|filled|launched|reached|worked)\b/i.test(label);
}

function isExpectedNo(label) {
  return /\b(port issue occurred|host intervention needed|did the tester need help|action feel surprising|surprising or risky)\b/i.test(label);
}

function isDecisionSignal(signal) {
  const text = `${signal.label || signal.key || ""}`.toLowerCase();
  return /\bdecision after trial\b/.test(text) || isNextTesterDecisionLabel(text);
}

function isNextTesterDecisionLabel(value) {
  return /\b(?:proceed to (?:tester 2|the next tester)|safe to continue to (?:tester 2|the next tester)|should this build (?:go to tester 2|continue to the next tester))\b/i.test(value);
}

function isSafetyConcern(signal) {
  const severity = severityFor(signal);
  return severity !== "ok" && isSafetyText(`${signal.label || signal.key || ""} ${signal.text || signal.value || signal.result || ""}`);
}

function isSafetyText(value) {
  return /\b(write|writes|wrote|apply|verify|command|preflight|blocker|trust|safe|safety|api key|unexpected|permission|read-only|patch gate|revert)\b/i.test(value);
}

function shouldCollectIssueNote(value) {
  const text = cleanCell(value);
  if (!text.includes("?")) return true;
  if (/\?\s*maybe\b/i.test(text)) return true;
  if (/\?\s*yes\b/i.test(text)) return /\b(need help|surprising|risky|port issue|unexpected)\b/i.test(text);
  if (/\?\s*no\b/i.test(text)) {
    if (/\b(surprising|risky|need help|port issue|unexpected)\b/i.test(text)) return false;
    return /\b(understand|safe|clear|trust|write|apply|verify|preflight|audit)\b/i.test(text);
  }
  return true;
}

function categorize(value) {
  const text = value.toLowerCase();
  if (/\b(start|launch|browser|port|running|start-codeclaw|launcher)\b/.test(text)) return "startup";
  if (/\b(language|translation|translated|chinese|english|russian|ui language)\b/.test(text)) return "language";
  if (/\b(demo|real project|mode)\b/.test(text)) return "demo-real-mode";
  if (/\b(path|folder|file path|project path)\b/.test(text)) return "path";
  if (/\b(preflight|context|warning|blocker|read-only)\b/.test(text)) return "preflight";
  if (/\b(apply|write|writes|safe|trust|permission|api key|surprising|risky)\b/.test(text)) return "safety";
  if (/\b(model|flash|pro|cost|api key)\b/.test(text)) return "model";
  if (/\b(patch proposal|changed files|review|revert)\b/.test(text)) return "patch";
  if (/\b(verify|verification|command|test)\b/.test(text)) return "verification";
  if (/\b(audit|trail|log)\b/.test(text)) return "audit";
  if (/\b(quick start|task guide|guide|template|runbook|message|copy)\b/.test(text)) return "docs";
  if (/\b(feedback|observation|result record)\b/.test(text)) return "feedback";
  return "other";
}

function noteItem(file, line, text) {
  return {
    file,
    line,
    text: cleanCell(text),
    category: categorize(text)
  };
}

function publicSignal(signal) {
  return {
    file: signal.file,
    line: signal.line,
    label: signal.label || signal.key || "",
    result: signal.result || signal.value || "",
    answer: signal.answer || "",
    notes: signal.notes || "",
    category: signal.category || categorize(`${signal.label || signal.key || ""} ${signal.notes || signal.value || ""}`)
  };
}

function withReason(signal, reason) {
  return { ...signal, reason };
}

function blockerReason(signal) {
  const label = `${signal.label || ""}`.toLowerCase();
  if (isNextTesterDecisionLabel(label)) return "Host marked the build as not ready for the next tester.";
  if (isSafetyText(label)) return "Safety or trust boundary failed.";
  return "Trial result needs a fix before wider testing.";
}

function warningReason(signal) {
  if (isSafetyText(`${signal.label || ""} ${signal.notes || ""}`)) return "Safety or trust boundary needs review.";
  return "Trial friction was recorded.";
}

function dedupeSignals(signals) {
  const seen = new Set();
  const unique = [];
  for (const signal of signals) {
    const key = signalKey(signal);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(signal);
  }
  return unique;
}

function signalKey(signal) {
  return [signal.file, signal.line, signal.label || signal.text || "", signal.result || signal.value || ""].join("|");
}

function displaySignal(signal) {
  const label = signal.label || signal.key || signal.text || "note";
  const result = signal.result || signal.value || "";
  return result ? `${label}: ${result}` : label;
}

function countMatching(files, pattern) {
  return files.filter((file) => pattern.test(path.basename(file.path))).length;
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial Feedback Summary",
    "",
    `Created at: ${report.createdAt}`,
    `Input: ${report.inputPath}`,
    `Decision: ${report.decision}`,
    "",
    "## Coverage",
    "",
    `- Files: ${report.files.length}`,
    `- Feedback files: ${report.coverage.feedbackFiles}`,
    `- Observation files: ${report.coverage.observationFiles}`,
    `- Result files: ${report.coverage.resultFiles}`,
    `- Answered rows: ${report.coverage.answeredRows}`,
    `- Answered fields: ${report.coverage.answeredFields}`,
    `- Issue notes: ${report.coverage.issueNotes}`,
    "",
    "## Blockers",
    "",
    ...listSignals(report.blockers),
    "",
    "## Warnings",
    "",
    ...listSignals(report.warnings),
    "",
    "## Safety Concerns",
    "",
    ...listSignals(report.safetyConcerns),
    "",
    "## Friction Themes",
    "",
    ...(report.frictionThemes.length
      ? report.frictionThemes.map((theme) => `- ${theme.theme}: ${theme.count} signals, ${theme.blockers} blockers, ${theme.warnings} warnings`)
      : ["- None"]),
    "",
    "## Recommended Fixes",
    "",
    ...(report.recommendedFixes.length ? report.recommendedFixes.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Issue Notes",
    "",
    ...(report.issueNotes.length ? report.issueNotes.map((item) => `- ${item.text}`) : ["- None"]),
    "",
    "## Next Steps",
    "",
    ...report.nextSteps.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function listSignals(signals) {
  if (!signals.length) return ["- None"];
  return signals.map((signal) => {
    const source = path.relative(rootPath, signal.file || "").split(path.sep).join("/");
    const label = signal.label || signal.text || "note";
    const result = signal.result ? ` (${signal.result})` : "";
    const reason = signal.reason ? ` - ${signal.reason}` : "";
    return `- ${label}${result}${reason} [${source}:${signal.line || 1}]`;
  });
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
    if (arg === "--json") {
      parsed.json = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--json=")) {
      parsed.json = arg.slice("--json=".length);
      continue;
    }
    if (arg === "--markdown") {
      parsed.markdown = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--markdown=")) {
      parsed.markdown = arg.slice("--markdown=".length);
      continue;
    }
    if (!parsed.input && !arg.startsWith("--")) {
      parsed.input = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
