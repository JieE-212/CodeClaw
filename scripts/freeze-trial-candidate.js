import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const distPath = path.join(rootPath, "dist");
const readinessPath = path.join(distPath, "TRIAL_READINESS_REPORT.json");
const simulatedPath = path.join(distPath, "SIMULATED_FIRST_TRIAL_REPORT.json");
const jsonPath = path.join(distPath, "TRIAL_FREEZE_REPORT.json");
const markdownPath = path.join(distPath, "TRIAL_FREEZE_REPORT.md");

const readiness = await readJson(readinessPath);
const simulated = await readJson(simulatedPath);
const blockers = freezeBlockers(readiness, simulated);
const warnings = freezeWarnings(readiness, simulated);
const decision = blockers.length ? "NO_GO" : "GO_HOSTED_TRIAL";

const report = {
  ok: blockers.length === 0,
  mode: "trial-freeze",
  decision,
  createdAt: new Date().toISOString(),
  sourceRoot: rootPath,
  packagePath: readiness.packagePath || "",
  inputs: {
    readinessPath,
    simulatedPath
  },
  gate: {
    blockers,
    warnings
  },
  summary: {
    readinessOk: Boolean(readiness.ok),
    simulatedOk: Boolean(simulated.ok),
    missingRequired: readiness.hygiene?.missingRequired?.length ?? null,
    disallowed: readiness.hygiene?.disallowed?.length ?? null,
    frictionAudit: (simulated.frictionAudit || []).map((item) => ({ area: item.area, status: item.status })),
    demoPatchProposalFiles: simulated.demo?.patchProposalFiles || [],
    realPreflightWarnings: simulated.realReadOnlyPreflight?.warnings ?? null,
    realPreflightBlockers: simulated.realReadOnlyPreflight?.blockers ?? null
  },
  hostPacket: [
    "docs/START_GUIDE.md",
    "docs/HUMAN_TRIAL_OBSERVATION.md",
    "docs/TRIAL_FEEDBACK_TEMPLATE.md",
    "docs/TRIAL_FEEDBACK_INGEST.md",
    "docs/TRIAL_FIX_BACKLOG.md",
    "docs/TRIAL_SESSION_PACK.md",
    "docs/TRIAL_HOST_READY.md",
    "docs/TRIAL_POST_SESSION.md",
    "docs/TRIAL_PRIVACY_CHECK.md",
    "docs/TRIAL_COHORT_SUMMARY.md",
    "docs/TRIAL_ARCHIVE_SESSION.md",
    "docs/TRIAL_STATUS.md",
    "docs/TRIAL_TESTER_INTAKE.md",
    "docs/TRIAL_INTAKE_SESSION.md",
    "docs/TRIAL_HOST_RUN.md",
    "docs/TRIAL_SESSION_COMPLETION.md",
    "docs/TRIAL_SESSION_REVIEW.md",
    "docs/TRIAL_INTAKE_REVIEW_DRY_RUN.md",
    "docs/TRIAL_HOST_BRIEF.md",
    "docs/TRIAL_GO_NO_GO.md"
  ],
  nextSteps: blockers.length
    ? ["Fix blockers, rerun trial:simulate, trial:ready, and trial:freeze."]
    : [
        "Share the generated package folder or zip with one hosted tester.",
        "Ask the tester to start with docs/START_GUIDE.md.",
        "Use docs/HUMAN_TRIAL_OBSERVATION.md during the session.",
        "Collect docs/TRIAL_FEEDBACK_TEMPLATE.md afterward.",
        "Do not proceed to tester 2 until the host writes a short go/no-go note."
      ]
};

await fs.mkdir(distPath, { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: report.ok,
  decision,
  jsonPath,
  markdownPath,
  packagePath: report.packagePath,
  blockers: blockers.length,
  warnings: warnings.length
}, null, 2));

if (blockers.length) {
  process.exitCode = 1;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Missing or invalid freeze input: ${filePath}\n${error.message}`);
  }
}

function freezeBlockers(readiness, simulated) {
  const blockers = [];
  if (!readiness.ok) blockers.push("trial:ready did not pass.");
  if (!simulated.ok) blockers.push("trial:simulate did not pass.");
  if (!readiness.packagePath) blockers.push("No package path was produced.");
  if ((readiness.hygiene?.missingRequired || []).length) blockers.push("Trial package is missing required files.");
  if ((readiness.hygiene?.disallowed || []).length) blockers.push("Trial package contains disallowed local state, env, log, dependency, build, or git files.");
  if ((simulated.demo?.blockers || 0) > 0) blockers.push("Demo preflight has blockers.");
  if (!(simulated.demo?.patchProposalFiles || []).length) blockers.push("Demo does not reach a patch proposal.");
  if (simulated.demo?.writeAttempted) blockers.push("Demo simulation attempted a write before approval.");
  if (!simulated.demo?.demoRestored) blockers.push("Demo files were not restored after simulation.");
  if ((simulated.realReadOnlyPreflight?.blockers || 0) > 0) blockers.push("Real-project read-only preflight has blockers.");
  if (simulated.realReadOnlyPreflight?.writeAttempted) blockers.push("Real-project read-only preflight attempted a write or command.");
  if (simulated.failurePaths?.emptyPath?.code !== "PATH_EMPTY") blockers.push("Empty path recovery is not returning PATH_EMPTY.");
  if (simulated.failurePaths?.filePath?.code !== "PATH_IS_FILE") blockers.push("File path recovery is not returning PATH_IS_FILE.");
  if (!simulated.failurePaths?.unconfirmedApply?.blocked) blockers.push("Unconfirmed Apply is not blocked.");
  if (!simulated.failurePaths?.unconfirmedVerify?.blocked) blockers.push("Unconfirmed Verify is not blocked.");
  for (const item of simulated.frictionAudit || []) {
    if (item.status === "fail") blockers.push(`Friction audit failed: ${item.area}.`);
  }
  return blockers;
}

function freezeWarnings(readiness, simulated) {
  const warnings = [];
  for (const item of simulated.frictionAudit || []) {
    if (item.status === "watch") warnings.push(`Watch during hosted trial: ${item.area}.`);
  }
  if ((simulated.realReadOnlyPreflight?.warnings || 0) > 0) warnings.push("Real-project read-only preflight has warnings.");
  if ((simulated.failurePaths?.noCommandProject?.warnings || 0) > 0) warnings.push("No-command fixture reports expected warnings; confirm tester understands no-command projects.");
  if ((readiness.hygiene?.files || 0) === 0) warnings.push("Package file count is zero or unavailable.");
  return warnings;
}

function renderMarkdown(report) {
  return [
    "# CodeClaw Trial Freeze Report",
    "",
    `Created at: ${report.createdAt}`,
    `Decision: ${report.decision}`,
    `Package: ${report.packagePath || "None"}`,
    "",
    "## Gate",
    "",
    report.gate.blockers.length ? "### Blockers" : "### Blockers",
    "",
    ...(report.gate.blockers.length ? report.gate.blockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    "### Warnings",
    "",
    ...(report.gate.warnings.length ? report.gate.warnings.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Summary",
    "",
    `- Readiness ok: ${yes(report.summary.readinessOk)}`,
    `- Simulated first trial ok: ${yes(report.summary.simulatedOk)}`,
    `- Missing required package entries: ${report.summary.missingRequired}`,
    `- Disallowed package entries: ${report.summary.disallowed}`,
    `- Demo patch proposal files: ${report.summary.demoPatchProposalFiles.join(", ") || "None"}`,
    `- Real preflight blockers: ${report.summary.realPreflightBlockers}`,
    `- Real preflight warnings: ${report.summary.realPreflightWarnings}`,
    "",
    "## Friction Audit",
    "",
    "| Area | Status |",
    "| --- | --- |",
    ...report.summary.frictionAudit.map((item) => `| ${item.area} | ${item.status} |`),
    "",
    "## Host Packet",
    "",
    ...report.hostPacket.map((item) => `- ${item}`),
    "",
    "## Next Steps",
    "",
    ...report.nextSteps.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function yes(value) {
  return value ? "Yes" : "No";
}
