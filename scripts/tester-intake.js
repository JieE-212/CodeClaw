import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const distPath = path.join(rootPath, "dist");
const args = parseArgs(process.argv.slice(2));
const rosterPath = path.resolve(rootPath, args.roster || path.join(".codeclaw", "trial-intake", "TESTER_ROSTER.json"));
const jsonPath = path.resolve(rootPath, args.json || path.join("dist", "TRIAL_TESTER_INTAKE_REPORT.json"));
const markdownPath = path.resolve(rootPath, args.markdown || path.join("dist", "TRIAL_TESTER_INTAKE_REPORT.md"));

if (args.init) await initRoster(rosterPath, args.force);

const report = await buildReport(rosterPath);

await fs.mkdir(distPath, { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision: report.decision,
  rosterPath,
  testers: report.counts.testers,
  ready: report.counts.ready,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  jsonPath,
  markdownPath
}, null, 2));

if (!report.ok) process.exitCode = 1;

async function initRoster(targetPath, force) {
  if ((await exists(targetPath)) && !force) return;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(rosterTemplate(), null, 2)}\n`, "utf8");
}

async function buildReport(targetPath) {
  const blockers = [];
  const warnings = [];
  const roster = await readRoster(targetPath);

  if (!roster) {
    return payload({
      ok: true,
      decision: "WAITING_FOR_TESTER_INTAKE",
      blockers,
      warnings: [`Tester roster is missing. Run npm.cmd run trial:intake -- --init to create ${relative(targetPath)}.`],
      testers: []
    });
  }

  const testers = Array.isArray(roster.testers) ? roster.testers.map(normalizeTester) : [];
  if (!Array.isArray(roster.testers)) blockers.push("Roster must contain a testers array.");
  if (!testers.length) warnings.push("Roster has no tester entries.");

  const ids = new Set();
  for (const tester of testers) {
    const prefix = tester.id || "tester";
    if (!tester.id) blockers.push(`${prefix}: tester id is required.`);
    if (tester.id && ids.has(tester.id)) blockers.push(`${tester.id}: duplicate tester id.`);
    if (tester.id) ids.add(tester.id);
    if (!isSafeTesterId(tester.id)) blockers.push(`${prefix}: tester id must use only lowercase letters, numbers, dot, underscore, or dash.`);
    if (!supportedLanguages().includes(tester.language)) blockers.push(`${prefix}: language must be one of ${supportedLanguages().join(", ")}.`);
    if (!tester.consent) blockers.push(`${prefix}: consent must be true before hosting.`);
    if (!tester.privacyAccepted) blockers.push(`${prefix}: privacyAccepted must be true before hosting.`);
    if (!tester.allowedScope.includes("demo")) blockers.push(`${prefix}: allowedScope must include demo.`);
    if (!tester.allowedScope.includes("real-read-only")) warnings.push(`${prefix}: real-read-only scope is not accepted; keep the session Demo-only.`);
    if (tester.allowedScope.includes("real-apply")) warnings.push(`${prefix}: real-apply is not recommended for early external trials.`);
    if (!tester.projectPermission) warnings.push(`${prefix}: projectPermission is empty; confirm the tester owns or may inspect the project.`);
    for (const field of tester.disallowedPersonalFields) {
      blockers.push(`${prefix}: remove personal field "${field}" from roster. Keep names and contact info outside the repo.`);
    }
  }

  const ready = testers.filter((tester) => testerReady(tester));
  if (!ready.length && testers.length) warnings.push("No tester is ready for a hosted session yet.");

  const decision = blockers.length
    ? "INTAKE_HOLD"
    : ready.length
      ? warnings.length ? "READY_FOR_SESSION_WITH_REVIEW" : "READY_FOR_SESSION"
      : "WAITING_FOR_TESTER_INTAKE";

  return payload({
    ok: blockers.length === 0,
    decision,
    blockers,
    warnings,
    testers
  });
}

function payload({ ok, decision, blockers, warnings, testers }) {
  const readyTesters = testers.filter((tester) => testerReady(tester));
  const nextTester = readyTesters[0] || testers[0] || null;
  return {
    ok,
    mode: "trial-tester-intake",
    createdAt: new Date().toISOString(),
    decision,
    rosterPath,
    rosterRelativePath: relative(rosterPath),
    counts: {
      testers: testers.length,
      ready: readyTesters.length,
      review: testers.filter((tester) => tester.needsReview).length,
      blocked: testers.filter((tester) => tester.blocked).length
    },
    testers: testers.map(publicTester),
    nextTester: nextTester ? publicTester(nextTester) : null,
    blockers,
    warnings,
    localOnly: true,
    privacyRules: [
      "Keep real names, contact details, company names, and private project names outside this roster.",
      "Use tester ids like tester-1 or pilot-zh-1.",
      "Do not copy roster files into local trial packages or public repositories."
    ],
    nextCommands: nextTester ? [
      `npm.cmd run trial:session-pack -- --tester ${nextTester.id} --force`,
      `npm.cmd run trial:host-ready -- --tester ${nextTester.id}`,
      "npm.cmd run trial:status"
    ] : [
      "npm.cmd run trial:intake -- --init",
      "Fill .codeclaw/trial-intake/TESTER_ROSTER.json locally.",
      "npm.cmd run trial:intake"
    ],
    nextSteps: nextSteps(decision)
  };
}

function normalizeTester(raw) {
  const forbidden = personalFieldNames().filter((field) => Object.hasOwn(raw, field));
  const id = sanitizeTesterId(raw.id || raw.testerId || "");
  const allowedScope = Array.isArray(raw.allowedScope) ? raw.allowedScope.map((item) => String(item).trim()).filter(Boolean) : [];
  const tester = {
    id,
    language: String(raw.language || "").trim(),
    consent: raw.consent === true,
    privacyAccepted: raw.privacyAccepted === true,
    allowedScope,
    projectPermission: String(raw.projectPermission || "").trim(),
    hostLanguage: String(raw.hostLanguage || raw.language || "").trim(),
    status: String(raw.status || "").trim() || "candidate",
    notes: String(raw.notes || "").trim(),
    disallowedPersonalFields: forbidden
  };
  tester.blocked = !tester.id
    || !isSafeTesterId(tester.id)
    || !supportedLanguages().includes(tester.language)
    || !tester.consent
    || !tester.privacyAccepted
    || !tester.allowedScope.includes("demo")
    || forbidden.length > 0;
  tester.needsReview = !tester.blocked && (!tester.allowedScope.includes("real-read-only") || !tester.projectPermission || tester.allowedScope.includes("real-apply"));
  return tester;
}

function testerReady(tester) {
  return !tester.blocked;
}

function publicTester(tester) {
  return {
    id: tester.id,
    language: tester.language,
    hostLanguage: tester.hostLanguage,
    consent: tester.consent,
    privacyAccepted: tester.privacyAccepted,
    allowedScope: tester.allowedScope,
    projectPermission: tester.projectPermission ? "recorded" : "",
    status: tester.status,
    ready: testerReady(tester),
    needsReview: tester.needsReview,
    blocked: tester.blocked
  };
}

function nextSteps(decision) {
  if (decision === "INTAKE_HOLD") {
    return [
      "Fix every blocker in the roster.",
      "Do not host a tester whose consent, privacy acceptance, language, or allowed scope is missing.",
      "Rerun npm.cmd run trial:intake."
    ];
  }
  if (decision === "WAITING_FOR_TESTER_INTAKE") {
    return [
      "Create or fill the local tester roster.",
      "Use anonymous tester ids only.",
      "Rerun npm.cmd run trial:intake before generating a session pack."
    ];
  }
  if (decision === "READY_FOR_SESSION_WITH_REVIEW") {
    return [
      "Host may proceed after accepting review warnings.",
      "Keep Demo-first and stop before real project Apply.",
      "Generate the tester-specific session pack."
    ];
  }
  return [
    "Generate the tester-specific session pack.",
    "Run trial:host-ready for that tester.",
    "Rerun trial:status before the hosted session."
  ];
}

function rosterTemplate() {
  return {
    localOnly: true,
    instructions: [
      "Keep this file local. It is ignored by Git and excluded from trial packages.",
      "Use anonymous tester ids. Do not store real names, email, phone, company, GitHub, Gitee, or private project names here.",
      "allowedScope should usually be [\"demo\", \"real-read-only\"] for early external trials."
    ],
    exampleTester: {
      id: "tester-1",
      language: "zh-CN",
      hostLanguage: "zh-CN",
      consent: true,
      privacyAccepted: true,
      allowedScope: ["demo", "real-read-only"],
      projectPermission: "Tester confirmed they may inspect the chosen local project.",
      status: "candidate",
      notes: "Copy this object into testers locally. Do not include real names or contact info."
    },
    testers: []
  };
}

async function readRoster(targetPath) {
  try {
    return JSON.parse(await fs.readFile(targetPath, "utf8"));
  } catch {
    return null;
  }
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial Tester Intake Report",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Roster: ${report.rosterRelativePath}`,
    `Local only: ${report.localOnly ? "Yes" : "No"}`,
    "",
    "## Counts",
    "",
    `- Testers: ${report.counts.testers}`,
    `- Ready: ${report.counts.ready}`,
    `- Review: ${report.counts.review}`,
    `- Blocked: ${report.counts.blocked}`,
    "",
    "## Testers",
    "",
    "| Tester | Language | Scope | Ready | Review | Blocked |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.testers.map((tester) => `| ${tester.id || "n/a"} | ${tester.language || "n/a"} | ${tester.allowedScope.join(", ") || "n/a"} | ${tester.ready ? "Yes" : "No"} | ${tester.needsReview ? "Yes" : "No"} | ${tester.blocked ? "Yes" : "No"} |`),
    "",
    "## Blockers",
    "",
    ...(report.blockers.length ? report.blockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Privacy Rules",
    "",
    ...report.privacyRules.map((item) => `- ${item}`),
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

function parseArgs(rawArgs) {
  const parsed = { roster: "", json: "", markdown: "", init: false, force: false };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--init") {
      parsed.init = true;
      continue;
    }
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    let handled = false;
    for (const key of ["roster", "json", "markdown"]) {
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
    if (!parsed.roster && !arg.startsWith("--")) {
      parsed.roster = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function personalFieldNames() {
  return ["name", "realName", "email", "phone", "contact", "company", "github", "gitee", "wechat", "projectName", "repoName"];
}

function supportedLanguages() {
  return ["en", "zh-CN", "ru"];
}

function sanitizeTesterId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function isSafeTesterId(value) {
  return /^[a-z0-9][a-z0-9._-]{1,40}$/.test(String(value || ""));
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
