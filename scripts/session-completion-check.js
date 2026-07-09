import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const distPath = path.join(rootPath, "dist");
const args = parseArgs(process.argv.slice(2));
const sessionPath = path.resolve(rootPath, args.session || path.join("dist", "trial-session-packs", "tester-1"));
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_SESSION_COMPLETION_REPORT.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_SESSION_COMPLETION_REPORT.md"));
const checklistPath = path.resolve(rootPath, args.checklist || path.join(sessionPath, "HOST_COMPLETION_CHECKLIST.md"));

const report = await buildReport();

await fs.mkdir(path.dirname(jsonPath), { recursive: true });
await fs.mkdir(path.dirname(markdownPath), { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  sessionPath,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  checklistPath: report.checklistRelativePath,
  jsonPath,
  markdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function buildReport() {
  const blockers = [];
  const warnings = [];
  const files = await readSessionFiles(sessionPath);
  const analyses = files.map(analyzeFile);

  if (!(await exists(sessionPath))) blockers.push("Session folder does not exist.");
  const byKind = {
    observation: analyses.find((item) => item.kind === "observation"),
    feedback: analyses.find((item) => item.kind === "feedback"),
    result: analyses.find((item) => item.kind === "result")
  };

  checkRequiredFile("observation", "HUMAN_TRIAL_OBSERVATION.md", byKind.observation, blockers);
  checkRequiredFile("feedback", "TRIAL_FEEDBACK_TEMPLATE.md", byKind.feedback, blockers);
  checkRequiredFile("result", "TRIAL_RESULT_RECORD.md", byKind.result, blockers);

  if (byKind.observation) checkObservation(byKind.observation, blockers, warnings);
  if (byKind.feedback) checkFeedback(byKind.feedback, blockers, warnings);
  if (byKind.result) checkResult(byKind.result, blockers, warnings);

  const privacyFindings = collectPrivacyFindings(analyses);
  blockers.push(...privacyFindings.blockers);
  warnings.push(...privacyFindings.warnings);

  if (await exists(sessionPath)) {
    await fs.mkdir(path.dirname(checklistPath), { recursive: true });
    await fs.writeFile(checklistPath, renderChecklist({ blockers, warnings, analyses }), "utf8");
  }

  const decision = blockers.length
    ? "SESSION_COMPLETION_HOLD"
    : warnings.length
      ? "SESSION_COMPLETION_READY_WITH_REVIEW"
      : "SESSION_COMPLETION_READY";
  return {
    ok: blockers.length === 0,
    mode: "trial-session-completion",
    createdAt: new Date().toISOString(),
    sessionPath,
    sessionRelativePath: relative(sessionPath),
    decision,
    checklistPath,
    checklistRelativePath: relative(checklistPath),
    coverage: {
      files: analyses.map((item) => ({
        kind: item.kind,
        relativePath: item.relativePath,
        answeredRows: item.answeredRows.length,
        answeredFields: item.answeredFields.length,
        issueNotes: item.issueNotes.length,
        bytes: item.text.length
      })),
      observationReady: Boolean(byKind.observation && !missingObservationFields(byKind.observation).length),
      feedbackReady: Boolean(byKind.feedback && !missingFeedbackFields(byKind.feedback).length),
      resultReady: Boolean(byKind.result && !missingResultFields(byKind.result).length)
    },
    blockers: unique(blockers),
    warnings: unique(warnings),
    privacyFindings,
    nextCommands: blockers.length ? [
      `npm.cmd run trial:complete-session -- --session ${relative(sessionPath)}`,
      `npm.cmd run trial:privacy-check -- ${relative(sessionPath)}`
    ] : [
      `npm.cmd run trial:post-session -- --session ${relative(sessionPath)} --next-tester ${nextTesterId(inferTesterId(sessionPath))}`,
      "npm.cmd run trial:status"
    ],
    nextSteps: nextSteps(blockers.length === 0, warnings.length > 0)
  };
}

async function readSessionFiles(folder) {
  if (!(await exists(folder))) return [];
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const targets = new Set([
    "HUMAN_TRIAL_OBSERVATION.md",
    "TRIAL_FEEDBACK_TEMPLATE.md",
    "TRIAL_RESULT_RECORD.md"
  ]);
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    if (!targets.has(entry.name) && kindForName(entry.name) === "record") continue;
    const filePath = path.join(folder, entry.name);
    files.push({
      path: filePath,
      relativePath: relative(filePath),
      name: entry.name,
      text: await fs.readFile(filePath, "utf8")
    });
  }
  return files;
}

function analyzeFile(file) {
  const rows = parseTables(file);
  const fields = parseFields(file);
  const issueNotes = parseIssueNotes(file);
  return {
    ...file,
    kind: kindForName(file.name),
    rows,
    fields,
    issueNotes,
    answeredRows: rows.filter((row) => !isPlaceholder(row.result)),
    answeredFields: fields.filter((field) => !isPlaceholder(field.value))
  };
}

function checkRequiredFile(kind, name, analysis, blockers) {
  if (!analysis) blockers.push(`${name} is missing.`);
  if (analysis && analysis.text.trim().length < 120) blockers.push(`${name} is too short to be a completed record.`);
  if (analysis && !analysis.answeredRows.length && !analysis.answeredFields.length && !analysis.issueNotes.length) {
    blockers.push(`${name} still looks empty.`);
  }
}

function checkObservation(analysis, blockers, warnings) {
  const missing = missingObservationFields(analysis);
  blockers.push(...missing.map((item) => `Observation is missing: ${item}.`));
  if (analysis.answeredRows.length < 6) blockers.push("Observation checklist has fewer than 6 answered rows.");
  if (!analysis.issueNotes.length && !fieldValue(analysis, "Recommended product fix")) {
    warnings.push("Observation has no concrete issue note or product fix.");
  }
}

function checkFeedback(analysis, blockers, warnings) {
  const missing = missingFeedbackFields(analysis);
  blockers.push(...missing.map((item) => `Feedback is missing: ${item}.`));
  if (analysis.answeredRows.length < 8) blockers.push("Feedback template has fewer than 8 answered rows.");
  if (!analysis.issueNotes.length) warnings.push("Feedback has no issue notes.");
}

function checkResult(analysis, blockers, warnings) {
  const missing = missingResultFields(analysis);
  blockers.push(...missing.map((item) => `Result record is missing: ${item}.`));
  if (analysis.answeredRows.length < 6) blockers.push("Result record has fewer than 6 answered outcome rows.");
  const decision = fieldValue(analysis, "Decision after trial");
  if (decision && !/^(continue|fix first|stop)$/i.test(decision)) {
    blockers.push("Result decision must be Continue, Fix first, or Stop.");
  }
  const proceed = fieldValue(analysis, "Proceed to tester 2");
  if (proceed && !/^(yes|no)$/i.test(proceed)) blockers.push("Proceed to tester 2 must be Yes or No.");
  if (/^yes$/i.test(proceed) && isPlaceholder(fieldValue(analysis, "Required fix before tester 2"))) {
    warnings.push("Proceed is Yes but Required fix before tester 2 is empty; write None if no fix is needed.");
  }
}

function missingObservationFields(analysis) {
  return requiredMissing(analysis, [
    "Biggest friction",
    "Biggest trust concern",
    "First point where host helped",
    "Recommended product fix",
    "Safe to continue to tester 2"
  ]);
}

function missingFeedbackFields(analysis) {
  return requiredMissing(analysis, [
    "Observed live",
    "Goal",
    "Would you use CodeClaw again on a real project?",
    "Would you try one disposable patch next?",
    "Most useful part",
    "Most confusing part",
    "Should this build go to tester 2?"
  ]);
}

function missingResultFields(analysis) {
  return requiredMissing(analysis, [
    "Decision after trial",
    "First stuck moment",
    "Host intervention needed",
    "Severity",
    "Strongest trust-building moment",
    "Strongest trust concern",
    "Proceed to tester 2",
    "Required fix before tester 2"
  ]);
}

function requiredMissing(analysis, keys) {
  return keys.filter((key) => isPlaceholder(fieldValue(analysis, key)));
}

function collectPrivacyFindings(analyses) {
  const blockers = [];
  const warnings = [];
  for (const analysis of analyses) {
    const lines = analysis.text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const location = `${analysis.relativePath}:${index + 1}`;
      if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(line)) {
        blockers.push(`Personal email found at ${location}.`);
      }
      if (/(?:\+?\d[\s().-]*){10,}/.test(line) && /\d{3}/.test(line)) {
        blockers.push(`Possible phone number found at ${location}.`);
      }
      if (/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b|\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/.test(line)) {
        blockers.push(`Possible secret token found at ${location}.`);
      }
      if (/^\s*-\s*(Name|Tester|Host|Trial host):\s*(.+)$/i.test(line)) {
        const [, key, value] = line.match(/^\s*-\s*(Name|Tester|Host|Trial host):\s*(.+)$/i);
        if (!isSafeIdentityValue(value)) blockers.push(`Personal ${key} field should use an anonymous id at ${location}.`);
      }
      if (/(?:[A-Za-z]:\\Users\\[^\\\s]+\\|\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/)/.test(line)) {
        warnings.push(`Personal path found at ${location}; redact before sharing.`);
      }
      if (/\b(?:github|gitee)\.com\/[A-Za-z0-9_.-]+/i.test(line)) {
        warnings.push(`Public account URL found at ${location}; confirm it is not tester identity.`);
      }
    }
  }
  return { blockers: unique(blockers), warnings: unique(warnings) };
}

function renderChecklist({ blockers, warnings, analyses }) {
  return [
    "# CodeClaw Host Completion Checklist",
    "",
    `Created at: ${new Date().toISOString()}`,
    `Session: ${relative(sessionPath)}`,
    "",
    "## Gate",
    "",
    ...(blockers.length ? blockers.map((item) => `- [ ] ${item}`) : ["- [x] No completion blockers found."]),
    "",
    "## Warnings",
    "",
    ...(warnings.length ? warnings.map((item) => `- [ ] ${item}`) : ["- [x] No completion warnings found."]),
    "",
    "## Records",
    "",
    ...analyses.map((item) => `- ${item.name}: ${item.answeredRows.length} answered rows, ${item.answeredFields.length} answered fields, ${item.issueNotes.length} issue notes`),
    "",
    "## Before Post-Session",
    "",
    "- [ ] Observation checklist is filled.",
    "- [ ] Feedback template is filled.",
    "- [ ] Result record has a clear go/no-go decision.",
    "- [ ] Personal tester identity, contact data, paths, secrets, logs, and source snippets are removed or anonymized.",
    "- [ ] Host accepts any remaining warnings.",
    ""
  ].join("\n");
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial Session Completion Report",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Session: ${report.sessionRelativePath}`,
    `Checklist: ${report.checklistRelativePath}`,
    "",
    "## Coverage",
    "",
    ...report.coverage.files.map((item) => `- ${item.kind}: ${item.relativePath} (${item.answeredRows} rows, ${item.answeredFields} fields, ${item.issueNotes} notes)`),
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

function parseTables(file) {
  const lines = file.text.split(/\r?\n/);
  const rows = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!isTableLine(lines[index]) || !isDividerLine(lines[index + 1])) continue;
    const headers = splitTableLine(lines[index]);
    const resultIndex = headers.findIndex((header) => ["result", "actual"].includes(normalizeHeader(header)));
    if (resultIndex === -1) continue;
    const labelIndex = headers.findIndex((header) => ["check", "outcome", "moment", "step"].includes(normalizeHeader(header)));
    const notesIndex = headers.findIndex((header) => ["notes", "evidence"].includes(normalizeHeader(header)));
    let rowIndex = index + 2;
    while (rowIndex < lines.length && isTableLine(lines[rowIndex])) {
      if (!isDividerLine(lines[rowIndex])) {
        const cells = splitTableLine(lines[rowIndex]);
        rows.push({
          line: rowIndex + 1,
          label: cleanCell(cells[labelIndex >= 0 ? labelIndex : 0] || ""),
          result: cleanCell(cells[resultIndex] || ""),
          notes: cleanCell(cells[notesIndex] || "")
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
    const match = lines[index].match(/^\s*-\s+([^:]{2,90}):\s*(.*)$/);
    if (match) {
      fields.push({
        line: index + 1,
        key: cleanCell(match[1]),
        value: cleanCell(match[2])
      });
      continue;
    }
    const question = lines[index].match(/^\s*-\s+(.+\?)\s+(.+)$/);
    if (!question) continue;
    fields.push({
      line: index + 1,
      key: cleanCell(question[1]),
      value: cleanCell(question[2])
    });
  }
  return fields;
}

function parseIssueNotes(file) {
  const notes = [];
  const lines = file.text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*\d+\.\s+(.+)$/);
    if (!match || isPlaceholder(match[1])) continue;
    notes.push({ line: index + 1, text: cleanCell(match[1]) });
  }
  return notes;
}

function fieldValue(analysis, key) {
  const normalized = cleanCell(key).toLowerCase();
  const field = analysis.fields.find((item) => item.key.toLowerCase() === normalized);
  return field?.value || "";
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

function normalizeHeader(value) {
  return cleanCell(value).toLowerCase();
}

function cleanCell(value) {
  return String(value || "").replace(/`/g, "").replace(/\s+/g, " ").trim();
}

function isPlaceholder(value) {
  const cleaned = cleanCell(value);
  if (!cleaned || cleaned === "." || cleaned === "-") return true;
  if (/^(n\/a|na)$/i.test(cleaned)) return false;
  if (/\s\/\s/.test(cleaned)) return true;
  return /^(yes \/ no|yes \/ no \/ n\/a|pass \/ friction \/ fail|continue \/ fix first \/ stop|low \/ medium \/ high)$/i.test(cleaned);
}

function isSafeIdentityValue(value) {
  const cleaned = cleanCell(value).toLowerCase();
  if (!cleaned || isPlaceholder(cleaned)) return true;
  return /^(tester|host|anonymous|anon|sample|codeclaw-host|product|none|n\/a)([-_\s.]?[a-z0-9]+)*$/i.test(cleaned);
}

function kindForName(name) {
  if (/observation/i.test(name)) return "observation";
  if (/feedback/i.test(name)) return "feedback";
  if (/result/i.test(name)) return "result";
  return "record";
}

function nextSteps(ready, hasWarnings) {
  if (!ready) {
    return [
      "Fill or redact the listed items.",
      "Rerun npm.cmd run trial:complete-session -- --session <completed-session-folder>.",
      "Do not run trial:post-session until this report is ready."
    ];
  }
  if (hasWarnings) {
    return [
      "Host must accept warnings before post-session.",
      "Run trial:post-session against this session folder.",
      "Archive only after privacy and post-session reports pass."
    ];
  }
  return [
    "Run trial:post-session against this completed session folder.",
    "Rerun trial:status after post-session finishes."
  ];
}

function nextTesterId(value) {
  const match = String(value || "").match(/^(.*?)(\d+)$/);
  if (!match) return `${sanitizeTesterId(value) || "tester"}-next`;
  return `${match[1]}${Number(match[2]) + 1}`;
}

function inferTesterId(folder) {
  return sanitizeTesterId(path.basename(folder));
}

function sanitizeTesterId(value) {
  const cleaned = String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "tester-1";
}

function parseArgs(rawArgs) {
  const parsed = { session: "", json: "", markdown: "", checklist: "" };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--session") {
      parsed.session = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--session=")) {
      parsed.session = arg.slice("--session=".length);
      continue;
    }
    let handled = false;
    for (const key of ["json", "markdown", "checklist"]) {
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
    if (!parsed.session && !arg.startsWith("--")) {
      parsed.session = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function relative(targetPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
