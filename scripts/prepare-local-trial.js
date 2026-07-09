import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const args = parseArgs(process.argv.slice(2));
const packageName = `CodeClaw-local-trial-${dateStamp()}`;
const outputPath = path.resolve(args.out || path.join(rootPath, "dist", packageName));

const includeEntries = [
  "apps",
  "docs",
  "examples",
  "packages",
  "scripts",
  "tests",
  ".gitignore",
  "package.json",
  "README.md",
  "run-nightly-trial.cmd",
  "start-codeclaw.cmd",
  "start-codeclaw.ps1"
];

const excludedNames = new Set([
  ".git",
  ".codeclaw",
  "node_modules",
  "coverage",
  "dist",
  "build",
  "trial-feedback",
  "trial-session-packs",
  "trial-privacy-risk"
]);

const excludedFiles = new Set(["server-bg.log"]);

await assertSafeOutputPath(outputPath);

if (await exists(outputPath)) {
  if (!args.force) {
    throw new Error(`Output already exists: ${outputPath}\nUse --force to replace it.`);
  }
  await fs.rm(outputPath, { recursive: true, force: true });
}

await fs.mkdir(outputPath, { recursive: true });

const copied = [];
for (const entry of includeEntries) {
  const sourcePath = path.join(rootPath, entry);
  const targetPath = path.join(outputPath, entry);
  if (!(await exists(sourcePath))) {
    throw new Error(`Required package entry is missing: ${entry}`);
  }
  await copyEntry(sourcePath, targetPath, entry, copied);
}

await writeManifest(copied);

console.log(JSON.stringify({
  ok: true,
  mode: "local-trial-package",
  outputPath,
  copiedFiles: copied.length,
  excluded: {
    directories: [...excludedNames],
    files: [...excludedFiles, "*.log", "*.local", ".env", ".env.*"]
  }
}, null, 2));

async function copyEntry(sourcePath, targetPath, relativePath, copied) {
  if (shouldExclude(relativePath)) return;
  const stat = await fs.stat(sourcePath);
  if (stat.isDirectory()) {
    await fs.mkdir(targetPath, { recursive: true });
    const names = await fs.readdir(sourcePath);
    for (const name of names) {
      await copyEntry(
        path.join(sourcePath, name),
        path.join(targetPath, name),
        path.join(relativePath, name),
        copied
      );
    }
    return;
  }
  if (!stat.isFile()) return;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  copied.push(relativePath.split(path.sep).join("/"));
}

function shouldExclude(relativePath) {
  const parts = relativePath.split(/[\\/]+/);
  if (parts.some((part) => excludedNames.has(part))) return true;
  const base = parts.at(-1) || "";
  if (excludedFiles.has(base)) return true;
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (base.endsWith(".local")) return true;
  if (base.endsWith(".log")) return true;
  return false;
}

async function writeManifest(copied) {
  const manifest = [
    "# CodeClaw Local Trial Package Manifest",
    "",
    `Created at: ${new Date().toISOString()}`,
    `Source root: ${rootPath}`,
    "",
    "## Before Sharing",
    "",
    "Run these in the source project before packaging:",
    "",
    "```bash",
    "npm.cmd run health",
    "npm.cmd run check",
    "npm.cmd test",
    "```",
    "",
    "## Tester Start",
    "",
    "Double-click `start-codeclaw.cmd`, then follow `docs/START_GUIDE.md`.",
    "For hosted first trials, keep `docs/TRIAL_HOST_BRIEF.md`, `docs/TRIAL_GO_NO_GO.md`, `docs/TRIAL_5_MIN_PRECHECK.md`, and a generated `trial:session-pack` folder open. Run `npm.cmd run trial:intake` before generating a real tester session pack. Run `npm.cmd run trial:status` whenever the next step is unclear. Run `npm.cmd run trial:host-ready` immediately before hosting. Ask testers to fill the generated feedback files afterward, then run `npm.cmd run trial:ingest-feedback` plus `npm.cmd run trial:fix-backlog` before inviting tester 2. After at least two completed tester folders exist, run `npm.cmd run trial:cohort-summary` before expanding to 3-5 testers. Run `npm.cmd run trial:archive-session` to create a local-only evidence archive after privacy passes.",
    "",
    "## Exclusions",
    "",
    "- `.git/`",
    "- `.codeclaw/`",
    "- `node_modules/`",
    "- `coverage/`, `dist/`, `build/`",
    "- `docs/trial-feedback/`, `trial-session-packs/`",
    "- `examples/trial-privacy-risk/`",
    "- `.env`, `.env.*`, `*.local`, `*.log`",
    "- `server-bg.log`",
    "",
    "## Copied Files",
    "",
    ...copied.map((file) => `- ${file}`),
    ""
  ].join("\n");
  await fs.writeFile(path.join(outputPath, "PACKAGE_MANIFEST.md"), manifest, "utf8");
}

async function assertSafeOutputPath(candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Package output must stay inside the CodeClaw project root.");
  }
  for (const entry of includeEntries) {
    const sourcePath = path.join(rootPath, entry);
    if (candidatePath === sourcePath) {
      throw new Error(`Package output cannot replace source entry: ${entry}`);
    }
    const relativeToEntry = path.relative(sourcePath, candidatePath);
    if (relativeToEntry && !relativeToEntry.startsWith("..") && !path.isAbsolute(relativeToEntry)) {
      throw new Error(`Package output cannot be inside copied source entry: ${entry}`);
    }
  }
}

function parseArgs(rawArgs) {
  const parsed = { out: "", force: false };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    if (arg === "--out") {
      parsed.out = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      parsed.out = arg.slice("--out=".length);
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

function dateStamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}
