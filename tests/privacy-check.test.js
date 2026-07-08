import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootPath, "scripts", "privacy-check.js");

test("privacy-check passes clean trial feedback", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-privacy-safe-"));
  const inputPath = path.join(tempRoot, "session");
  const jsonPath = path.join(tempRoot, "privacy.json");
  const markdownPath = path.join(tempRoot, "privacy.md");

  await fs.mkdir(inputPath, { recursive: true });
  await fs.writeFile(path.join(inputPath, "feedback.md"), [
    "# Trial Feedback",
    "",
    "Tester completed the demo and had one wording suggestion.",
    "No logs, keys, source files, or project paths were shared.",
    ""
  ].join("\n"), "utf8");

  const result = await runPrivacyCheck([inputPath, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.ok, true);
  assert.equal(report.decision, "PRIVACY_OK");
  assert.equal(report.blockers.length, 0);
  assert.equal(report.warnings.length, 0);
});

test("privacy-check blocks unsafe trial records and redacts secret excerpts", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-privacy-risk-"));
  const riskInput = path.join(tempRoot, "session");
  const jsonPath = path.join(tempRoot, "privacy.json");
  const markdownPath = path.join(tempRoot, "privacy.md");

  await fs.mkdir(riskInput, { recursive: true });
  await fs.writeFile(path.join(riskInput, "unsafe-feedback.md"), [
    "# Unsafe Trial Feedback Example",
    "",
    "```text",
    "OPENAI_API_KEY=sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "```",
    "",
    "```js",
    "import fs from \"node:fs\";",
    "export function one() { return 1; }",
    "export function two() { return 2; }",
    "export function three() { return 3; }",
    "export function four() { return 4; }",
    "export function five() { return 5; }",
    "export function six() { return 6; }",
    "export function seven() { return 7; }",
    "export function eight() { return 8; }",
    "export function nine() { return 9; }",
    "export function ten() { return 10; }",
    "export function eleven() { return 11; }",
    "export function twelve() { return 12; }",
    "export function thirteen() { return 13; }",
    "export function fourteen() { return 14; }",
    "export function fifteen() { return 15; }",
    "export function sixteen() { return 16; }",
    "export function seventeen() { return 17; }",
    "export function eighteen() { return 18; }",
    "export function nineteen() { return 19; }",
    "export function twenty() { return 20; }",
    "```",
    ""
  ].join("\n"), "utf8");

  const result = await runPrivacyCheck([riskInput, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));
  const markdown = await fs.readFile(markdownPath, "utf8");

  assert.notEqual(result.code, 0);
  assert.equal(report.ok, false);
  assert.equal(report.decision, "PRIVACY_HOLD");
  assert.ok(report.blockers.some((item) => item.rule === "openai-key"));
  assert.ok(report.blockers.some((item) => item.rule === "env-assignment"));
  assert.ok(report.blockers.some((item) => item.rule === "long-code-block"));
  assert.doesNotMatch(markdown, /sk-proj-AAAAAAAA/);
  assert.match(markdown, /sk-\.\.\.REDACTED/);
});

function runPrivacyCheck(args) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [scriptPath, ...args], { cwd: rootPath }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") {
        reject(error);
        return;
      }
      resolve({
        code: typeof error?.code === "number" ? error.code : 0,
        stdout,
        stderr
      });
    });
  });
}
