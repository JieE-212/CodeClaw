import fs from "node:fs/promises";
import path from "node:path";
import { DICTIONARIES, SUPPORTED_LANGUAGES } from "../apps/web/public/i18n.js";

const rootPath = process.cwd();
const htmlPath = path.join(rootPath, "apps", "web", "public", "index.html");
const appPath = path.join(rootPath, "apps", "web", "public", "app.js");
const i18nPath = path.join(rootPath, "apps", "web", "public", "i18n.js");

const [html, appJs, i18nJs] = await Promise.all([
  fs.readFile(htmlPath, "utf8"),
  fs.readFile(appPath, "utf8"),
  fs.readFile(i18nPath, "utf8")
]);

const failures = [];
const warnings = [];

checkSupportedLanguages();
checkDictionaryKeyParity();
checkPlaceholders();
checkUsedKeys();
checkLanguageSelect();
checkPackageScript();

const report = {
  ok: failures.length === 0,
  mode: "i18n-check",
  languages: SUPPORTED_LANGUAGES,
  dictionaryKeys: Object.fromEntries(Object.entries(DICTIONARIES).map(([language, dictionary]) => [language, Object.keys(dictionary).length])),
  usedKeys: collectUsedKeys().size,
  warnings,
  failures
};

console.log(JSON.stringify(report, null, 2));

if (failures.length) {
  process.exitCode = 1;
}

function checkSupportedLanguages() {
  const dictionaryLanguages = Object.keys(DICTIONARIES).sort();
  const supported = [...SUPPORTED_LANGUAGES].sort();
  if (JSON.stringify(dictionaryLanguages) !== JSON.stringify(supported)) {
    failures.push(`SUPPORTED_LANGUAGES (${supported.join(", ")}) does not match DICTIONARIES (${dictionaryLanguages.join(", ")}).`);
  }
  for (const language of SUPPORTED_LANGUAGES) {
    if (!DICTIONARIES[language]) failures.push(`Missing dictionary for supported language: ${language}`);
  }
}

function checkDictionaryKeyParity() {
  const baseKeys = new Set(Object.keys(DICTIONARIES.en || {}));
  if (!baseKeys.size) failures.push("English dictionary is empty or missing.");

  for (const language of SUPPORTED_LANGUAGES) {
    const keys = new Set(Object.keys(DICTIONARIES[language] || {}));
    const missing = [...baseKeys].filter((key) => !keys.has(key));
    const extra = [...keys].filter((key) => !baseKeys.has(key));
    if (missing.length) failures.push(`${language} dictionary is missing keys: ${missing.join(", ")}`);
    if (extra.length) warnings.push(`${language} dictionary has extra keys: ${extra.join(", ")}`);
  }
}

function checkPlaceholders() {
  const base = DICTIONARIES.en || {};
  for (const [key, englishValue] of Object.entries(base)) {
    const englishPlaceholders = placeholders(englishValue).sort();
    for (const language of SUPPORTED_LANGUAGES) {
      const localized = DICTIONARIES[language]?.[key];
      if (typeof localized !== "string") continue;
      const localizedPlaceholders = placeholders(localized).sort();
      if (JSON.stringify(englishPlaceholders) !== JSON.stringify(localizedPlaceholders)) {
        failures.push(`${language}.${key} placeholders differ from en: expected {${englishPlaceholders.join(", ")}}, got {${localizedPlaceholders.join(", ")}}`);
      }
      if (!localized.trim()) failures.push(`${language}.${key} is empty.`);
    }
  }
}

function checkUsedKeys() {
  const usedKeys = collectUsedKeys();
  const base = DICTIONARIES.en || {};
  for (const key of usedKeys) {
    if (!base[key]) failures.push(`Used i18n key is missing from dictionaries: ${key}`);
  }
}

function checkLanguageSelect() {
  const languageSelect = html.match(/<select\s+id="languageSelect"[\s\S]*?<\/select>/)?.[0] || "";
  if (!languageSelect) {
    failures.push("Missing #languageSelect language selector.");
    return;
  }
  const optionValues = [...languageSelect.matchAll(/<option\s+value="([^"]+)"/g)].map((match) => match[1]);
  const missingOptions = SUPPORTED_LANGUAGES.filter((language) => !optionValues.includes(language));
  const extraOptions = optionValues.filter((language) => SUPPORTED_LANGUAGES.includes(language) === false);
  if (missingOptions.length) failures.push(`Language selector is missing options: ${missingOptions.join(", ")}`);
  if (extraOptions.length) failures.push(`Language selector has unsupported options: ${extraOptions.join(", ")}`);
}

function checkPackageScript() {
  if (!i18nJs.includes("export const DICTIONARIES")) failures.push("i18n.js must export DICTIONARIES for coverage checks.");
  if (!i18nJs.includes("export const SUPPORTED_LANGUAGES")) failures.push("i18n.js must export SUPPORTED_LANGUAGES for coverage checks.");
}

function collectUsedKeys() {
  const keys = new Set();
  for (const match of html.matchAll(/\sdata-i18n(?:-[\w-]+)?="([^"]+)"/g)) {
    keys.add(match[1]);
  }
  for (const match of appJs.matchAll(/\bt\(\s*["']([^"']+)["']/g)) {
    keys.add(match[1]);
  }
  return keys;
}

function placeholders(value) {
  return [...String(value).matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
}
