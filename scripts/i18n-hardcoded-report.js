import fs from "node:fs/promises";
import path from "node:path";

const rootPath = process.cwd();
const targets = [
  path.join("apps", "web", "public", "index.html"),
  path.join("apps", "web", "public", "app.js")
];
const reportPath = path.join(rootPath, "dist", "I18N_HARDCODED_REPORT.md");
const cjkPattern = /[\p{Script=Han}]/u;

const findings = [];

for (const relativePath of targets) {
  const absolutePath = path.join(rootPath, relativePath);
  const content = await fs.readFile(absolutePath, "utf8");
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!cjkPattern.test(line)) return;
    findings.push({
      file: relativePath.replaceAll(path.sep, "/"),
      line: index + 1,
      category: classify(line),
      text: line.trim()
    });
  });
}

const grouped = findings.reduce((groups, item) => {
  groups[item.category] ||= [];
  groups[item.category].push(item);
  return groups;
}, {});
const migrationFindings = findings.filter((item) => item.category !== "wired");
const migrationGrouped = migrationFindings.reduce((groups, item) => {
  groups[item.category] ||= [];
  groups[item.category].push(item);
  return groups;
}, {});
const wiredFindings = grouped.wired || [];

const markdown = [
  "# i18n Hardcoded Text Report",
  "",
  "This report is intentionally non-blocking. It lists remaining CJK user-facing text candidates in `index.html` and `app.js` so migration can continue by priority.",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Total findings: ${findings.length}`,
  `Migration candidates: ${migrationFindings.length}`,
  `Already wired: ${wiredFindings.length}`,
  "",
  "## Priority Guidance",
  "",
  "- Migrate visible controls, panel titles, placeholders, empty states, and confirmation text first.",
  "- Leave project data, file paths, command output, and server-returned content alone unless it is product UI copy.",
  "- Lines categorized as `wired` already use `data-i18n` or `t(...)`; they are separated at the end as a sanity list.",
  "",
  "## Migration Candidates",
  "",
  ...Object.entries(migrationGrouped).flatMap(([category, items]) => [
    `### ${category}`,
    "",
    ...items.map((item) => `- \`${item.file}:${item.line}\` ${item.text}`),
    ""
  ]),
  "## Already Wired",
  "",
  ...wiredFindings.map((item) => `- \`${item.file}:${item.line}\` ${item.text}`)
].join("\n");

await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, markdown, "utf8");

console.log(JSON.stringify({
  ok: true,
  mode: "i18n-hardcoded-report",
  files: targets.map((item) => item.replaceAll(path.sep, "/")),
  totalFindings: findings.length,
  migrationCandidates: migrationFindings.length,
  alreadyWired: wiredFindings.length,
  categories: Object.fromEntries(Object.entries(grouped).map(([key, items]) => [key, items.length])),
  reportPath: path.relative(rootPath, reportPath).replaceAll(path.sep, "/")
}, null, 2));

function classify(line) {
  if (/\bdata-i18n(?:-[\w-]+)?=/.test(line) || /\bt\(\s*["']/.test(line)) return "wired";
  if (/<(?:button|input|textarea|select|option|label|h\d|span|pre|div)\b/i.test(line)) return "html-visible";
  if (/\b(confirm|textContent|placeholder|innerHTML|title)\b/.test(line)) return "runtime-visible";
  if (/`.*\$\{/.test(line)) return "runtime-template";
  return "review";
}
