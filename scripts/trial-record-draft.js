import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const args = parseArgs(process.argv.slice(2));
const sessionPath = path.resolve(rootPath, args.session || path.join("dist", "trial-session-packs", "tester-2"));
const notesPath = args.notes ? path.resolve(rootPath, args.notes) : "";
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_RECORD_DRAFT.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_RECORD_DRAFT.md"));

const report = await buildReport();

await fs.mkdir(path.dirname(jsonPath), { recursive: true });
await fs.mkdir(path.dirname(markdownPath), { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  session: report.sessionRelativePath,
  sources: report.sources.length,
  suggestions: report.suggestions.length,
  missing: report.missing.length,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  jsonPath,
  markdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function buildReport() {
  const blockers = [];
  const warnings = [];
  const sources = await readSources();
  if (!(await exists(sessionPath))) blockers.push(`Session folder does not exist: ${relative(sessionPath)}.`);
  if (!sources.length) blockers.push("No tester notes were found. Pass --notes <local-notes.md> or fill the session capture files first.");

  const evidence = sources.flatMap(parseEvidence);
  const privacyFindings = collectPrivacyFindings(sources);
  blockers.push(...privacyFindings.blockers);
  warnings.push(...privacyFindings.warnings);

  const suggestions = [];
  const missing = [];
  for (const target of targetFields()) {
    const match = findEvidence(evidence, target);
    if (match) {
      suggestions.push({
        file: target.file,
        field: target.field,
        value: match.value,
        source: match.source,
        sourceRelativePath: match.sourceRelativePath,
        line: match.line
      });
    } else {
      missing.push({ file: target.file, field: target.field, ask: target.ask });
    }
  }

  const decision = blockers.length
    ? "RECORD_DRAFT_HOLD"
    : missing.length
      ? "RECORD_DRAFT_READY_WITH_GAPS"
      : "RECORD_DRAFT_READY";

  return {
    ok: blockers.length === 0,
    mode: "trial-record-draft",
    createdAt: new Date().toISOString(),
    decision,
    sessionPath,
    sessionRelativePath: relative(sessionPath),
    notesPath,
    notesRelativePath: notesPath ? relative(notesPath) : "",
    sources: sources.map((source) => ({
      relativePath: source.relativePath,
      bytes: source.text.length,
      evidenceItems: parseEvidence(source).length
    })),
    suggestions,
    missing,
    privacyFindings,
    blockers: unique(blockers),
    warnings: unique(warnings),
    localOnly: true,
    nextCommands: nextCommands(decision),
    nextSteps: nextSteps(decision)
  };
}

async function readSources() {
  const candidates = notesPath ? [notesPath] : [
    path.join(sessionPath, "LIVE_SESSION_CAPTURE.md"),
    path.join(sessionPath, "LIVE_SESSION_HOST_SUMMARY.md"),
    path.join(sessionPath, "HUMAN_TRIAL_OBSERVATION.md"),
    path.join(sessionPath, "TRIAL_FEEDBACK_TEMPLATE.md"),
    path.join(sessionPath, "TRIAL_RESULT_RECORD.md")
  ];
  const sources = [];
  for (const filePath of candidates) {
    const text = await readText(filePath);
    if (!text.trim()) continue;
    sources.push({ path: filePath, relativePath: relative(filePath), text });
  }
  return sources;
}

function parseEvidence(source) {
  const evidence = [];
  const lines = source.text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || isInstructionLine(line)) continue;

    const field = parseFieldLine(line);
    if (field && !isPlaceholder(field.value)) {
      evidence.push(evidenceItem(field, source, index));
      continue;
    }

    const table = parseTableLine(line);
    if (table && !isPlaceholder(table.value)) {
      evidence.push(evidenceItem(table, source, index));
    }
  }
  return evidence;
}

function evidenceItem(field, source, index) {
  return {
    key: normalizeKey(field.key),
    rawKey: field.key,
    value: cleanValue(field.value),
    source: source.path,
    sourceRelativePath: source.relativePath,
    line: index + 1
  };
}

function parseFieldLine(line) {
  const cleaned = line.replace(/^\s*[-*]\s+/, "");
  const match = cleaned.match(/^([^:\uFF1A]{2,100})[:\uFF1A]\s*(.+)$/);
  if (!match) return null;
  return { key: cleanValue(match[1]), value: cleanValue(match[2]) };
}

function parseTableLine(line) {
  if (!/^\|.*\|$/.test(line) || /^[-:|\s]+$/.test(line.replace(/\|/g, ""))) return null;
  const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cleanValue);
  if (cells.length < 2) return null;
  const key = cells[0];
  const value = cells.find((cell, index) => index > 0 && !isPlaceholder(cell));
  if (!key || !value) return null;
  return { key, value };
}

function findEvidence(evidence, target) {
  const aliases = target.aliases.map(normalizeKey);
  return evidence.find((item) => aliases.includes(item.key)) || null;
}

function targetFields() {
  return [
    target("HUMAN_TRIAL_OBSERVATION.md", "Biggest friction", ["Biggest friction", "Main observed friction", "\u6700\u5927\u5361\u70b9", "\u4e3b\u8981\u56f0\u60d1", "\u5361\u5728\u54ea\u91cc"], "What was the biggest friction or first stuck point?"),
    target("HUMAN_TRIAL_OBSERVATION.md", "Biggest trust concern", ["Biggest trust concern", "Main trust concern", "\u4e3b\u8981\u4fe1\u4efb\u987e\u8651", "\u4fe1\u4efb\u987e\u8651"], "What made the tester hesitate or feel unsafe?"),
    target("HUMAN_TRIAL_OBSERVATION.md", "First point where host helped", ["First point where host helped", "Host intervention point", "\u4e3b\u6301\u4eba\u7b2c\u4e00\u6b21\u5e2e\u52a9", "\u4e3b\u6301\u4eba\u5e2e\u52a9\u70b9"], "Where did the host first help?"),
    target("HUMAN_TRIAL_OBSERVATION.md", "Recommended product fix", ["Recommended product fix", "What would need to improve first", "What would need to improve first?", "\u5efa\u8bae\u4fee\u590d", "\u4ea7\u54c1\u4fee\u590d\u5efa\u8bae"], "What product fix should be made first?"),
    target("HUMAN_TRIAL_OBSERVATION.md", "Safe to continue to tester 2", ["Safe to continue to tester 2", "Safe to continue", "\u662f\u5426\u540c\u610f\u8fdb\u5165 tester-2", "\u662f\u5426\u7ee7\u7eed"], "Is it safe to continue? Yes or No."),
    target("TRIAL_FEEDBACK_TEMPLATE.md", "Observed live", ["Observed live", "\u662f\u5426\u73b0\u573a\u89c2\u5bdf"], "Was the session observed live?"),
    target("TRIAL_FEEDBACK_TEMPLATE.md", "Goal", ["Goal", "\u76ee\u6807", "\u6d4b\u8bd5\u76ee\u6807"], "What was the tester trying to do?"),
    target("TRIAL_FEEDBACK_TEMPLATE.md", "Would you use CodeClaw again on a real project?", ["Would you use CodeClaw again on a real project", "Would you use CodeClaw again on a real project?", "Would use again", "\u662f\u5426\u613f\u610f\u771f\u5b9e\u9879\u76ee\u518d\u7528", "\u613f\u610f\u518d\u7528"], "Would the tester use CodeClaw again on a real project?"),
    target("TRIAL_FEEDBACK_TEMPLATE.md", "Would you try one disposable patch next?", ["Would you try one disposable patch next", "Would you try one disposable patch next?", "Disposable patch next", "\u662f\u5426\u613f\u610f\u5c1d\u8bd5\u4e00\u6b21\u6027\u8865\u4e01", "\u613f\u610f\u5c1d\u8bd5\u8865\u4e01"], "Would the tester try a disposable patch next?"),
    target("TRIAL_FEEDBACK_TEMPLATE.md", "Most useful part", ["Most useful part", "\u6700\u6709\u7528\u7684\u90e8\u5206"], "What was most useful?"),
    target("TRIAL_FEEDBACK_TEMPLATE.md", "Most confusing part", ["Most confusing part", "\u6700\u56f0\u60d1\u7684\u90e8\u5206", "\u4e3b\u8981\u56f0\u60d1"], "What was most confusing?"),
    target("TRIAL_FEEDBACK_TEMPLATE.md", "Should this build go to tester 2?", ["Should this build go to tester 2", "Should this build go to tester 2?", "Should continue", "\u662f\u5426\u540c\u610f\u8fdb\u5165 tester-2", "\u662f\u5426\u7ee7\u7eed"], "Should this build continue to the next tester?"),
    target("TRIAL_RESULT_RECORD.md", "Decision after trial", ["Decision after trial", "Trial decision", "\u6d4b\u8bd5\u540e\u51b3\u5b9a", "\u7ed3\u8bba"], "Decision after trial: Continue, Fix first, or Stop."),
    target("TRIAL_RESULT_RECORD.md", "First stuck moment", ["First stuck moment", "First stuck step", "\u7b2c\u4e00\u4e2a\u5361\u70b9", "\u5361\u5728\u54ea\u91cc"], "What was the first stuck moment?"),
    target("TRIAL_RESULT_RECORD.md", "Host intervention needed", ["Host intervention needed", "Did the tester need help", "Did the tester need help?", "\u662f\u5426\u9700\u8981\u4e3b\u6301\u4eba\u5e2e\u52a9", "\u4e3b\u6301\u4eba\u662f\u5426\u5e2e\u52a9"], "Did the host need to help? Yes or No."),
    target("TRIAL_RESULT_RECORD.md", "Severity", ["Severity", "\u4e25\u91cd\u7a0b\u5ea6"], "Severity: Low, Medium, or High."),
    target("TRIAL_RESULT_RECORD.md", "Strongest trust-building moment", ["Strongest trust-building moment", "Trust-building moment", "\u6700\u5efa\u7acb\u4fe1\u4efb\u7684\u65f6\u523b", "\u4fe1\u4efb\u5efa\u7acb"], "What built trust most?"),
    target("TRIAL_RESULT_RECORD.md", "Strongest trust concern", ["Strongest trust concern", "\u4e3b\u8981\u4fe1\u4efb\u987e\u8651", "\u4fe1\u4efb\u987e\u8651"], "What was the strongest trust concern?"),
    target("TRIAL_RESULT_RECORD.md", "Proceed to tester 2", ["Proceed to tester 2", "Proceed", "\u662f\u5426\u540c\u610f\u8fdb\u5165 tester-2", "\u662f\u5426\u7ee7\u7eed"], "Proceed? Yes or No."),
    target("TRIAL_RESULT_RECORD.md", "Required fix before tester 2", ["Required fix before tester 2", "Required fix", "\u8fdb\u5165 tester-2 \u524d\u5fc5\u987b\u4fee\u590d", "\u5fc5\u987b\u4fee\u590d"], "What must be fixed first? Write None if no fix is needed.")
  ];
}

function target(file, field, aliases, ask) {
  return { file, field, aliases, ask };
}

function collectPrivacyFindings(sources) {
  const blockers = [];
  const warnings = [];
  for (const source of sources) {
    const lines = source.text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const location = `${source.relativePath}:${index + 1}`;
      const instructionLine = isInstructionLine(line);
      if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(line)) blockers.push(`Personal email found at ${location}.`);
      if (/(?:\+?\d[\s().-]*){10,}/.test(line) && /\d{3}/.test(line)) blockers.push(`Possible phone number found at ${location}.`);
      if (/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b|\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/.test(line)) blockers.push(`Possible secret token found at ${location}.`);
      if (/(?:[A-Za-z]:\\Users\\[^\\\s]+\\|\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/)/.test(line)) warnings.push(`Personal path found at ${location}; redact before sharing.`);
      if (/\b(?:github|gitee)\.com\/[A-Za-z0-9_.-]+/i.test(line)) warnings.push(`Public account URL found at ${location}; confirm it is not tester identity.`);
      if (!instructionLine && /\b(screenshot|screen shot|log file|source snippet)\b/i.test(line)) warnings.push(`Sensitive artifact reference found at ${location}; keep raw artifacts local and out of commits.`);
      if (!instructionLine && /(?:\u622a\u56fe|\u65e5\u5fd7|\u6e90\u7801(?:\u7247\u6bb5)?)/.test(line)) warnings.push(`Sensitive artifact reference found at ${location}; keep raw artifacts local and out of commits.`);
    }
  }
  return { blockers: unique(blockers), warnings: unique(warnings) };
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial Record Draft",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Session: ${report.sessionRelativePath}`,
    `Notes: ${report.notesRelativePath || "session files"}`,
    "",
    "This draft is local-only. It does not edit tester records and does not invent missing feedback.",
    "",
    "## Suggested Fields",
    "",
    "| Target file | Field | Draft value | Source |",
    "| --- | --- | --- | --- |",
    ...(report.suggestions.length
      ? report.suggestions.map((item) => `| ${item.file} | ${item.field} | ${escapeTable(item.value)} | ${item.sourceRelativePath}:${item.line} |`)
      : ["| n/a | n/a | No explicit values found. | n/a |"]),
    "",
    "## Missing Fields",
    "",
    ...(report.missing.length ? report.missing.map((item) => `- ${item.file} / ${item.field}: ${item.ask}`) : ["- None"]),
    "",
    "## Privacy Findings",
    "",
    ...(report.privacyFindings.blockers.length ? report.privacyFindings.blockers.map((item) => `- BLOCKER: ${item}`) : ["- No privacy blockers found."]),
    ...(report.privacyFindings.warnings.length ? report.privacyFindings.warnings.map((item) => `- WARNING: ${item}`) : ["- No privacy warnings found."]),
    "",
    "## Blockers",
    "",
    ...(report.blockers.length ? report.blockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Next Commands",
    "",
    ...report.nextCommands.map((item) => `- ${item}`),
    "",
    "## Next Steps",
    "",
    ...report.nextSteps.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function nextCommands(decision) {
  if (decision === "RECORD_DRAFT_HOLD") {
    return [
      `npm.cmd run trial:record-draft -- --session ${relative(sessionPath)} --notes <local-notes.md>`,
      `npm.cmd run trial:privacy-check -- ${relative(sessionPath)}`
    ];
  }
  return [
    `npm.cmd run trial:complete-session -- --session ${relative(sessionPath)}`,
    `npm.cmd run trial:privacy-check -- ${relative(sessionPath)}`,
    `npm.cmd run trial:after-live -- --session ${relative(sessionPath)} --tester ${path.basename(sessionPath)} --force`
  ];
}

function nextSteps(decision) {
  if (decision === "RECORD_DRAFT_HOLD") {
    return [
      "Fix privacy blockers or add local tester notes first.",
      "Do not copy private artifacts into source control.",
      "Rerun this command after notes are redacted."
    ];
  }
  if (decision === "RECORD_DRAFT_READY_WITH_GAPS") {
    return [
      "Copy only confirmed draft values into the three session record files.",
      "Ask the tester or host for the missing fields instead of guessing.",
      "Run trial:complete-session after the records are filled."
    ];
  }
  return [
    "Copy confirmed values into the three session record files.",
    "Run trial:complete-session and trial:privacy-check.",
    "Then run trial:after-live for the completed tester."
  ];
}

function parseArgs(rawArgs) {
  const parsed = { session: "", notes: "", json: "", markdown: "" };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    let handled = false;
    for (const key of ["session", "notes", "json", "markdown"]) {
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
    if (!parsed.notes && !arg.startsWith("--")) {
      parsed.notes = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function isInstructionLine(line) {
  const cleaned = cleanValue(line).replace(/^[-*#]+\s*/, "");
  return /^(do not|don't|keep raw|local-only|excluded|privacy rules|use only anonymous|fill this file|run these|after the session)\b/i.test(cleaned);
}

function isPlaceholder(value) {
  const cleaned = cleanValue(value);
  if (!cleaned || cleaned === "." || cleaned === "-") return true;
  if (/^(n\/a|na|none|\u65e0)$/i.test(cleaned)) return false;
  if (/\s\/\s/.test(cleaned)) return true;
  return /^(yes \/ no|yes \/ no \/ n\/a|yes \/ no \/ maybe|pass \/ friction \/ fail|continue \/ fix first \/ stop|low \/ medium \/ high)$/i.test(cleaned);
}

function cleanValue(value) {
  return String(value || "").replace(/`/g, "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return cleanValue(value).toLowerCase().replace(/[?\uFF1F]/g, "").replace(/\s+/g, " ");
}

function escapeTable(value) {
  return String(value || "").replace(/\|/g, "\\|");
}

function relative(targetPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
