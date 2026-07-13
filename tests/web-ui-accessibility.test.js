import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { DICTIONARIES, SUPPORTED_LANGUAGES } from "../apps/web/public/i18n.js";

const [html, app, css] = await Promise.all([
  fs.readFile(new URL("../apps/web/public/index.html", import.meta.url), "utf8"),
  fs.readFile(new URL("../apps/web/public/app.js", import.meta.url), "utf8"),
  fs.readFile(new URL("../apps/web/public/styles.css", import.meta.url), "utf8")
]);

test("form controls have localized labels and localized accessible attributes", () => {
  const controls = [...html.matchAll(/<(input|select|textarea)\b[^>]*>/g)].map((match) => match[0]);
  assert.ok(controls.length > 0);
  for (const control of controls) {
    if (/type="hidden"/.test(control)) continue;
    const id = attribute(control, "id");
    assert.ok(id, `form control needs an id: ${control}`);
    const explicitLabel = html.match(new RegExp(`<label\\b[^>]*for="${escapeRegExp(id)}"[^>]*>[\\s\\S]*?<\\/label>`))?.[0];
    const labelledBy = attribute(control, "aria-labelledby");
    assert.ok(explicitLabel || labelledBy, `form control #${id} needs a label`);
    if (explicitLabel) assert.match(explicitLabel, /data-i18n="[^"]+"/, `label for #${id} must be localized`);
    if (labelledBy) assert.match(html, new RegExp(`id="${escapeRegExp(labelledBy)}"[^>]*data-i18n="[^"]+"`));
  }

  for (const tag of html.match(/<[^>]+>/g) || []) {
    if (/\saria-label="/.test(tag)) assert.ok(attribute(tag, "data-i18n-aria-label"), `aria-label must be localized: ${tag}`);
    if (/\splaceholder="/.test(tag)) assert.ok(attribute(tag, "data-i18n-placeholder"), `placeholder must be localized: ${tag}`);
    if (/\stitle="/.test(tag)) assert.ok(attribute(tag, "data-i18n-title"), `title must be localized: ${tag}`);
  }
});

test("every HTML localization attribute resolves in all three dictionaries", () => {
  const keyAttributes = ["data-i18n", "data-i18n-aria-label", "data-i18n-placeholder", "data-i18n-title"];
  for (const name of keyAttributes) {
    for (const key of attributeValues(html, name)) {
      for (const language of SUPPORTED_LANGUAGES) {
        assert.equal(typeof DICTIONARIES[language][key], "string", `${language}.${key} is missing`);
        assert.ok(DICTIONARIES[language][key].length > 0, `${language}.${key} is empty`);
      }
    }
  }
});

test("navigation, workflow progress, and the single primary status expose current state", () => {
  assert.match(html, /<nav\b[^>]*data-i18n-aria-label="[^"]+"/);
  assert.equal(countMatches(html, /aria-current="page"/g), 1);
  assert.match(app, /setAttribute\(["']aria-current["']\s*,\s*["']page["']\)/);
  assert.match(app, /setAttribute\(["']aria-current["']\s*,\s*["']step["']\)/);

  const mainDocument = html.replace(/<dialog\b[\s\S]*?<\/dialog>/g, "");
  assert.equal(countMatches(mainDocument, /\srole="status"/g), 1);
  const status = tagById(html, "workflowStatus");
  assert.equal(attribute(status, "role"), "status");
  assert.equal(attribute(status, "aria-live"), "polite");
  assert.equal(attribute(status, "aria-atomic"), "true");
});

test("keyboard order has no positive tabindex and model review remains mode-independent", () => {
  for (const value of attributeValues(html, "tabindex")) {
    const numeric = Number(value);
    assert.ok(!Number.isFinite(numeric) || numeric <= 0, `positive tabindex is forbidden: ${value}`);
  }

  const dialog = html.match(/<dialog\b[^>]*id="modelOutboundReview"[^>]*>/)?.[0] || "";
  assert.ok(dialog);
  assert.doesNotMatch(dialog, /(?:beginner|advanced|mode-only|data-mode)/i);
  assert.doesNotMatch(css, /(?:beginner|advanced)[^,{]*#modelOutboundReview|#modelOutboundReview[^,{]*(?:beginner|advanced)/i);
  const sync = functionBody(app, "syncVisibility");
  assert.doesNotMatch(sync, /modelOutboundReview\.(?:hidden|style\.display)|modelOutboundReview\.setAttribute\(["']hidden/);
});

test("responsive, focus, reduced-motion, forced-colors, and sticky workflow contracts exist", () => {
  assert.match(css, /\.sidebar\s*\{[^}]*position:\s*sticky/);
  assert.match(css, /\[data-workflow-section\]\s*\{[^}]*scroll-margin-top:/);
  for (const width of [900, 620, 390]) assert.match(css, new RegExp(`@media\\s*\\(max-width:\\s*${width}px\\)`));
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /@media\s*\(forced-colors:\s*active\)/);
});

test("primary action colors meet WCAG AA text contrast", () => {
  const background = cssVariable(css, "--primary-action-bg");
  const foreground = cssVariable(css, "--primary-action-text");
  const primaryRule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .find(([, selector, body]) => /button/.test(selector) && /var\(--primary-action-bg\)/.test(body) && /var\(--primary-action-text\)/.test(body));
  assert.ok(primaryRule, "primary button rule must use the reviewed contrast variables");
  assert.ok(contrastRatio(background, foreground) >= 4.5, `primary action contrast is ${contrastRatio(background, foreground).toFixed(2)}:1`);
});

function cssVariable(source, name) {
  const raw = source.match(new RegExp(`${escapeRegExp(name)}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`))?.[1];
  assert.ok(raw, `missing six-digit ${name}`);
  return raw;
}

function contrastRatio(left, right) {
  const [lighter, darker] = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  return channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function functionBody(source, name) {
  const start = source.search(new RegExp(`function\\s+${escapeRegExp(name)}\\s*\\(`));
  assert.notEqual(start, -1, `missing function ${name}`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = brace; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unclosed function ${name}`);
}

function attribute(source, name) {
  return source.match(new RegExp(`${escapeRegExp(name)}="([^"]*)"`))?.[1] || "";
}

function tagById(source, id) {
  const tag = (source.match(/<[^>]+>/g) || []).find((candidate) => attribute(candidate, "id") === id);
  assert.ok(tag, `missing #${id}`);
  return tag;
}

function attributeValues(source, name) {
  return [...source.matchAll(new RegExp(`${escapeRegExp(name)}="([^"]*)"`, "g"))].map((match) => match[1]);
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
