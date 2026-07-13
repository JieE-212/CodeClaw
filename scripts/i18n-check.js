import fs from "node:fs/promises";
import path from "node:path";
import { DICTIONARIES, SUPPORTED_LANGUAGES } from "../apps/web/public/i18n.js";

const rootPath = process.cwd();
const htmlPath = path.join(rootPath, "apps", "web", "public", "index.html");
const appPath = path.join(rootPath, "apps", "web", "public", "app.js");
const i18nPath = path.join(rootPath, "apps", "web", "public", "i18n.js");
const REQUIRED_LANGUAGES = Object.freeze(["en", "zh-CN", "ru"]);
const RETIRED_KEY_PREFIXES = Object.freeze(["quick.", "guide.", "trialHost."]);
const DYNAMIC_KEY_REGISTRY = "DYNAMIC_I18N_KEYS";
const TRANSLATED_ATTRIBUTES = Object.freeze({
  "aria-label": "data-i18n-aria-label",
  placeholder: "data-i18n-placeholder",
  title: "data-i18n-title",
  alt: "data-i18n-alt"
});
const SUPPORTED_I18N_ATTRIBUTES = new Set(["data-i18n", ...Object.values(TRANSLATED_ATTRIBUTES), "data-i18n-value", "data-i18n-label"]);
const CONTROL_TEXT_ELEMENTS = new Set(["a", "button", "label", "legend", "option", "summary"]);
const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const TRANSLATION_SCRIPTS = Object.freeze({
  "zh-CN": { name: "Han", pattern: /\p{Script=Han}/u },
  ru: { name: "Cyrillic", pattern: /\p{Script=Cyrillic}/u }
});
const TECHNICAL_TRANSLATION_KEYS = /^(?:language\.(?:english|chinese|russian)|model\.preset\.|model\.cost\.(?:dashscope|flash|pro|openai)\.title|model\.review\.sha|verify\.output\.(?:stdout|stderr)|task\.summary\.verificationDetail)/;

const [html, appJs, i18nJs] = await Promise.all([
  fs.readFile(htmlPath, "utf8"),
  fs.readFile(appPath, "utf8"),
  fs.readFile(i18nPath, "utf8")
]);

const failures = [];
const warnings = [];
const translationQualityChecks = Object.fromEntries(Object.keys(TRANSLATION_SCRIPTS).map((language) => [language, 0]));
const htmlAnalysis = analyzeHtml();
const appAnalysis = analyzeAppTranslations(htmlAnalysis.dynamicKeyCandidates);
const usedKeys = collectUsedKeys();
const retiredDictionaryKeys = collectRetiredDictionaryKeys();
const retiredKeyReferences = new Set([
  ...[...usedKeys].filter(isRetiredKey),
  ...collectStringLiterals(appJs).map((item) => item.value).filter(isRetiredKey)
]);

checkSupportedLanguages();
checkDictionaryKeyParity();
checkPlaceholders();
checkUnicodeReplacementCharacters();
checkTranslationQuality();
checkUsedKeys();
checkRetiredKeys();
checkHtmlTranslationAttributes();
checkDynamicTranslations();
checkLanguageSelect();
checkI18nExports();

const report = {
  ok: failures.length === 0,
  mode: "i18n-check",
  languages: SUPPORTED_LANGUAGES,
  dictionaryKeys: Object.fromEntries(Object.entries(DICTIONARIES).map(([language, dictionary]) => [language, Object.keys(dictionary).length])),
  usedKeys: usedKeys.size,
  htmlI18nAttributes: htmlAnalysis.i18nAttributes.length,
  dynamicTranslationCalls: appAnalysis.dynamicCalls.length,
  registeredDynamicKeys: appAnalysis.registry.keys.size,
  translationQualityChecks,
  retiredDictionaryKeys: retiredDictionaryKeys.length,
  retiredKeyReferences: retiredKeyReferences.size,
  warnings,
  failures
};

console.log(JSON.stringify(report, null, 2));

if (failures.length) process.exitCode = 1;

function checkSupportedLanguages() {
  const required = [...REQUIRED_LANGUAGES].sort();
  const dictionaryLanguages = Object.keys(DICTIONARIES).sort();
  const supported = [...SUPPORTED_LANGUAGES].sort();
  if (JSON.stringify(supported) !== JSON.stringify(required)) {
    failures.push(`SUPPORTED_LANGUAGES must contain exactly ${required.join(", ")}; got ${supported.join(", ") || "none"}.`);
  }
  if (JSON.stringify(dictionaryLanguages) !== JSON.stringify(required)) {
    failures.push(`DICTIONARIES must contain exactly ${required.join(", ")}; got ${dictionaryLanguages.join(", ") || "none"}.`);
  }
  if (JSON.stringify(dictionaryLanguages) !== JSON.stringify(supported)) {
    failures.push(`SUPPORTED_LANGUAGES (${supported.join(", ")}) does not match DICTIONARIES (${dictionaryLanguages.join(", ")}).`);
  }
}

function checkDictionaryKeyParity() {
  const baseKeys = new Set(Object.keys(DICTIONARIES.en || {}));
  if (!baseKeys.size) failures.push("English dictionary is empty or missing.");

  for (const language of REQUIRED_LANGUAGES) {
    const keys = new Set(Object.keys(DICTIONARIES[language] || {}));
    const missing = [...baseKeys].filter((key) => !keys.has(key));
    const extra = [...keys].filter((key) => !baseKeys.has(key));
    if (missing.length) failures.push(`${language} dictionary is missing keys: ${missing.join(", ")}`);
    if (extra.length) failures.push(`${language} dictionary has extra keys: ${extra.join(", ")}`);
  }
}

function checkPlaceholders() {
  const base = DICTIONARIES.en || {};
  for (const [key, englishValue] of Object.entries(base)) {
    if (typeof englishValue !== "string" || !englishValue.trim()) {
      failures.push(`en.${key} must be a non-empty string.`);
      continue;
    }
    const englishPlaceholders = placeholders(englishValue).sort();
    for (const language of REQUIRED_LANGUAGES) {
      const localized = DICTIONARIES[language]?.[key];
      if (typeof localized !== "string") continue;
      if (!localized.trim()) failures.push(`${language}.${key} is empty.`);
      const localizedPlaceholders = placeholders(localized).sort();
      if (JSON.stringify(englishPlaceholders) !== JSON.stringify(localizedPlaceholders)) {
        failures.push(`${language}.${key} placeholders differ from en: expected {${englishPlaceholders.join(", ")}}, got {${localizedPlaceholders.join(", ")}}`);
      }
    }
  }
}

function checkUnicodeReplacementCharacters() {
  for (const [language, dictionary] of Object.entries(DICTIONARIES)) {
    for (const [key, value] of Object.entries(dictionary)) {
      if (typeof value === "string" && /\uFFFD/u.test(value)) {
        failures.push(`${language}.${key} appears corrupted: translation contains a Unicode replacement character.`);
      }
    }
  }
}

function checkTranslationQuality() {
  const english = DICTIONARIES.en || {};
  for (const [language, rule] of Object.entries(TRANSLATION_SCRIPTS)) {
    const dictionary = DICTIONARIES[language] || {};
    for (const [key, englishValue] of Object.entries(english)) {
      const localized = dictionary[key];
      if (typeof localized !== "string") continue;

      if (!isLiteralCodeOrUrl(localized) && hasQuestionMarkDegeneration(localized)) {
        failures.push(`${language}.${key} appears corrupted: translation contains consecutive question marks or a high question-mark ratio.`);
        continue;
      }
      if (!requiresNaturalLanguageTranslation(key, englishValue)) continue;

      translationQualityChecks[language] += 1;
      if (!rule.pattern.test(localized)) {
        failures.push(`${language}.${key} must contain ${rule.name} text for this natural-language value; got ${shortValue(localized)}.`);
      }
    }
  }
}

function hasQuestionMarkDegeneration(value) {
  const text = String(value);
  if (/\?{3,}/.test(text)) return true;
  const compact = text.replace(/\s+/g, "");
  const questions = (compact.match(/\?/g) || []).length;
  return questions >= 2 && questions / Math.max(1, compact.length) >= 0.25;
}

function requiresNaturalLanguageTranslation(key, englishValue) {
  const text = String(englishValue || "").trim();
  if (!/[A-Za-z]/.test(text)) return false;
  if (TECHNICAL_TRANSLATION_KEYS.test(key)) return false;
  if (isLiteralCodeOrUrl(text)) return false;
  if (/^(?:CodeClaw|Mock|Demo|Apply|Revert|Git|Node(?:\.js)?|npm(?:\.cmd)?|SHA-256|Stdout:?|Stderr:?)$/i.test(text)) return false;
  return true;
}

function isLiteralCodeOrUrl(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^(?:https?|file):\/\//i.test(text) || /^\/api\//.test(text) || /^[A-Za-z]:[\\/]/.test(text)) return true;
  if (/^`[\s\S]*`$/.test(text) || /^```[\s\S]*```$/.test(text)) return true;
  if (/^[A-Za-z_$][\w$]*\s*=\s*\{[A-Za-z_$][\w$]*\}(?:\s*,\s*[A-Za-z_$][\w$]*\s*=\s*\{[A-Za-z_$][\w$]*\})*$/.test(text)) return true;
  if (/^(?:[\w.-]+\.(?:js|mjs|cjs|json|md|txt|css|html)|[A-Fa-f0-9]{32,}|[a-z]+:\/\/\S+)$/i.test(text)) return true;
  return false;
}

function checkUsedKeys() {
  const base = DICTIONARIES.en || {};
  for (const key of usedKeys) {
    if (!Object.hasOwn(base, key)) failures.push(`Used i18n key is missing from dictionaries: ${key}`);
  }
}

function checkRetiredKeys() {
  const dictionaryKeys = collectRetiredDictionaryKeys();
  for (const language of REQUIRED_LANGUAGES) {
    const keys = dictionaryKeys.filter((item) => item.language === language).map((item) => item.key);
    if (keys.length) failures.push(`${language} dictionary still contains ${keys.length} retired i18n key(s): ${summarizeList(keys)}`);
  }
  const referenced = [...usedKeys].filter(isRetiredKey);
  if (referenced.length) failures.push(`${referenced.length} retired i18n key reference(s) remain: ${summarizeList(referenced)}`);
  const literals = collectStringLiterals(appJs).filter((item) => isRetiredKey(item.value));
  if (literals.length) {
    const locations = literals.map((item) => `app.js:${lineNumberAt(appJs, item.index)} ${item.value}`);
    failures.push(`${literals.length} retired i18n key literal(s) remain in app.js: ${summarizeList(locations)}`);
  }
}

function checkHtmlTranslationAttributes() {
  for (const attributeName of htmlAnalysis.usedI18nAttributeNames) {
    if (!i18nJs.includes(attributeName)) {
      failures.push(`i18n.js does not wire HTML translation attribute ${attributeName}.`);
    }
  }
}

function checkDynamicTranslations() {
  const { dynamicCalls, registry, requiredDynamicKeys } = appAnalysis;
  if (!dynamicCalls.length) {
    if (registry.found && registry.keys.size) failures.push(`${DYNAMIC_KEY_REGISTRY} is stale because app.js has no dynamic t(...) calls.`);
    return;
  }
  if (!registry.found) {
    failures.push(`app.js has ${dynamicCalls.length} dynamic t(...) call(s) but no ${DYNAMIC_KEY_REGISTRY} string registry.`);
    return;
  }
  if (!registry.keys.size) failures.push(`${DYNAMIC_KEY_REGISTRY} must not be empty while dynamic t(...) calls exist.`);
  for (const key of requiredDynamicKeys) {
    if (!registry.keys.has(key)) failures.push(`${DYNAMIC_KEY_REGISTRY} is missing dynamic i18n key: ${key}`);
  }
  const unused = [...registry.keys].filter((key) => !requiredDynamicKeys.has(key));
  if (unused.length) failures.push(`${DYNAMIC_KEY_REGISTRY} contains stale keys not derived from a current dynamic t(...) call: ${unused.join(", ")}`);
}

function checkLanguageSelect() {
  const languageSelect = html.match(/<select\b[^>]*\bid=["']languageSelect["'][^>]*>[\s\S]*?<\/select>/i)?.[0] || "";
  if (!languageSelect) {
    failures.push("Missing #languageSelect language selector.");
    return;
  }
  const optionValues = [...languageSelect.matchAll(/<option\b[^>]*\bvalue=["']([^"']+)["']/gi)].map((match) => match[1]);
  const missingOptions = REQUIRED_LANGUAGES.filter((language) => !optionValues.includes(language));
  const extraOptions = optionValues.filter((language) => !REQUIRED_LANGUAGES.includes(language));
  if (missingOptions.length) failures.push(`Language selector is missing options: ${missingOptions.join(", ")}`);
  if (extraOptions.length) failures.push(`Language selector has unsupported options: ${extraOptions.join(", ")}`);
}

function checkI18nExports() {
  if (!i18nJs.includes("export const DICTIONARIES")) failures.push("i18n.js must export DICTIONARIES for coverage checks.");
  if (!i18nJs.includes("export const SUPPORTED_LANGUAGES")) failures.push("i18n.js must export SUPPORTED_LANGUAGES for coverage checks.");
}

function collectUsedKeys() {
  return new Set([
    ...htmlAnalysis.i18nAttributes.map((item) => item.value),
    ...htmlAnalysis.dynamicKeyCandidates.flatMap((item) => item.values),
    ...appAnalysis.literalKeys,
    ...appAnalysis.registry.keys,
    ...appAnalysis.requiredDynamicKeys
  ].filter(Boolean));
}

function analyzeHtml() {
  const i18nAttributes = [];
  const usedI18nAttributeNames = new Set();
  const dynamicKeyCandidates = [];
  const stack = [];
  const tokenPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>|[^<]+/g;

  for (const match of html.matchAll(tokenPattern)) {
    const token = match[0];
    if (token.startsWith("<!--") || token.startsWith("<!")) continue;
    if (!token.startsWith("<")) {
      inspectControlText(token, match.index, stack);
      continue;
    }
    const closing = token.match(/^<\/\s*([A-Za-z][\w:-]*)/);
    if (closing) {
      const name = closing[1].toLowerCase();
      const index = stack.map((item) => item.name).lastIndexOf(name);
      if (index !== -1) stack.splice(index);
      continue;
    }
    const opening = token.match(/^<\s*([A-Za-z][\w:-]*)([\s\S]*?)(\/?)>$/);
    if (!opening) continue;
    const name = opening[1].toLowerCase();
    const attributes = parseHtmlAttributes(opening[2], match.index + token.indexOf(opening[2]));
    const element = { name, attributes, line: lineNumberAt(html, match.index), hardcodedReported: false };
    inspectElementAttributes(element);
    if (!VOID_ELEMENTS.has(name) && opening[3] !== "/") stack.push(element);
  }

  return { i18nAttributes, usedI18nAttributeNames, dynamicKeyCandidates };

  function inspectElementAttributes(element) {
    for (const [attributeName, attribute] of element.attributes) {
      if (attributeName === "data-i18n" || attributeName.startsWith("data-i18n-")) {
        if (!SUPPORTED_I18N_ATTRIBUTES.has(attributeName)) {
          failures.push(`index.html:${element.line} uses unsupported translation attribute ${attributeName}.`);
          continue;
        }
        if (!attribute.value.trim()) failures.push(`index.html:${element.line} has an empty ${attributeName} key.`);
        i18nAttributes.push({ name: attributeName, value: attribute.value.trim(), line: element.line });
        usedI18nAttributeNames.add(attributeName);
      }
      if (/^data-[\w-]+-key$/.test(attributeName) && !attributeName.startsWith("data-i18n-")) {
        const value = attribute.value.trim();
        const candidateName = kebabToCamel(attributeName.slice("data-".length));
        if (!value) failures.push(`index.html:${element.line} has an empty dynamic key attribute ${attributeName}.`);
        dynamicKeyCandidates.push({ name: candidateName, values: value ? [value] : [], line: element.line });
      }
    }

    for (const [rawName, translatedName] of Object.entries(TRANSLATED_ATTRIBUTES)) {
      const rawValue = element.attributes.get(rawName)?.value.trim() || "";
      if (rawValue && !element.attributes.has(translatedName)) {
        failures.push(`index.html:${element.line} hard-codes ${rawName} without ${translatedName}: ${shortValue(rawValue)}`);
      }
    }
    if (element.name === "input" && /^(?:button|reset|submit)$/i.test(element.attributes.get("type")?.value || "")) {
      const value = element.attributes.get("value")?.value.trim() || "";
      if (value && !element.attributes.has("data-i18n-value")) {
        failures.push(`index.html:${element.line} hard-codes a visible input value without data-i18n-value: ${shortValue(value)}`);
      }
    }
    if (element.name === "optgroup") {
      const label = element.attributes.get("label")?.value.trim() || "";
      if (label && !element.attributes.has("data-i18n-label")) {
        failures.push(`index.html:${element.line} hard-codes an optgroup label without data-i18n-label: ${shortValue(label)}`);
      }
    }
  }
}

function inspectControlText(rawText, offset, stack) {
  const controlIndex = stack.map((item) => CONTROL_TEXT_ELEMENTS.has(item.name)).lastIndexOf(true);
  if (controlIndex === -1) return;
  const control = stack[controlIndex];
  const text = decodeHtmlForInspection(rawText).replace(/\s+/g, " ").trim();
  if (!text) return;
  const translated = stack.slice(controlIndex).some((item) => item.attributes.has("data-i18n"));
  if (translated) return;
  if (/[\p{L}\p{N}]/u.test(text)) {
    if (!control.hardcodedReported) {
      failures.push(`index.html:${lineNumberAt(html, offset)} hard-codes visible <${control.name}> text without data-i18n: ${shortValue(text)}`);
      control.hardcodedReported = true;
    }
    return;
  }
  const hasTranslatedAccessibleName = control.attributes.has("data-i18n-aria-label") || control.attributes.has("aria-labelledby");
  if (!hasTranslatedAccessibleName && !control.hardcodedReported) {
    failures.push(`index.html:${lineNumberAt(html, offset)} uses a symbolic <${control.name}> label without a translated accessible name: ${shortValue(text)}`);
    control.hardcodedReported = true;
  }
}

function parseHtmlAttributes(source, baseOffset) {
  const attributes = new Map();
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (attributes.has(name)) failures.push(`index.html:${lineNumberAt(html, baseOffset + match.index)} repeats attribute ${name}.`);
    attributes.set(name, { value, index: baseOffset + match.index });
  }
  return attributes;
}

function analyzeAppTranslations(htmlCandidates) {
  const calls = collectTranslationCalls(appJs);
  const literalKeys = new Set();
  const dynamicCalls = [];
  for (const call of calls) {
    const literal = staticStringValue(call.expression);
    if (literal !== null) literalKeys.add(literal);
    else dynamicCalls.push(call);
  }

  const candidateMap = collectAppDynamicCandidates();
  for (const candidate of htmlCandidates) addCandidates(candidateMap, candidate.name, candidate.values);
  const registry = collectDynamicRegistry();
  const requiredDynamicKeys = new Set();
  for (const call of dynamicCalls) {
    const resolved = resolveDynamicCall(call, candidateMap);
    if (!resolved.size) {
      failures.push(`app.js:${call.line} dynamic t(...) expression cannot be statically enumerated: ${shortValue(call.expression)}`);
      continue;
    }
    for (const key of resolved) requiredDynamicKeys.add(key);
  }
  return { calls, literalKeys, dynamicCalls, registry, requiredDynamicKeys };
}

function collectTranslationCalls(source) {
  const calls = [];
  const pattern = /\bt\s*\(/g;
  for (const match of source.matchAll(pattern)) {
    const argumentStart = match.index + match[0].length;
    const expression = readFirstJavaScriptArgument(source, argumentStart);
    if (expression === null) {
      failures.push(`app.js:${lineNumberAt(source, match.index)} has an unreadable t(...) call.`);
      continue;
    }
    calls.push({ expression, line: lineNumberAt(source, match.index), index: match.index });
  }
  return calls;
}

function readFirstJavaScriptArgument(source, start) {
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (character === "'" || character === '"') {
      index = skipQuoted(source, index, character);
      continue;
    }
    if (character === "`") {
      index = skipTemplate(source, index);
      continue;
    }
    if (character === "/" && next === "/") {
      index = source.indexOf("\n", index + 2);
      if (index === -1) return null;
      continue;
    }
    if (character === "/" && next === "*") {
      index = source.indexOf("*/", index + 2);
      if (index === -1) return null;
      index += 1;
      continue;
    }
    if (character === "(") parentheses += 1;
    else if (character === ")") {
      if (!parentheses && !brackets && !braces) return source.slice(start, index).trim();
      parentheses -= 1;
    } else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "{") braces += 1;
    else if (character === "}") braces -= 1;
    else if (character === "," && !parentheses && !brackets && !braces) return source.slice(start, index).trim();
  }
  return null;
}

function collectAppDynamicCandidates() {
  const candidates = new Map();
  const directPattern = /\b([A-Za-z_$][\w$]*Key)\s*(?::|=)\s*(["'])([^"'\r\n]+)\2/g;
  for (const match of appJs.matchAll(directPattern)) addCandidates(candidates, match[1], [match[3]]);

  const initializerPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*Key)\s*=/g;
  for (const match of appJs.matchAll(initializerPattern)) {
    const end = findJavaScriptStatementEnd(appJs, match.index + match[0].length);
    const statement = appJs.slice(match.index, end);
    const values = collectStringLiterals(statement).map((item) => item.value).filter(looksLikeI18nKey);
    addCandidates(candidates, match[1], values);
  }

  const functionPattern = /\bfunction\s+([A-Za-z_$][\w$]*Key)\s*\([^)]*\)\s*\{/g;
  for (const match of appJs.matchAll(functionPattern)) {
    const openingBrace = appJs.indexOf("{", match.index);
    const closingBrace = findMatchingDelimiter(appJs, openingBrace, "{", "}");
    if (closingBrace === -1) continue;
    const values = collectStringLiterals(appJs.slice(openingBrace, closingBrace + 1)).map((item) => item.value).filter(looksLikeI18nKey);
    addCandidates(candidates, match[1], values);
  }

  const aliases = [...appJs.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*Key)\s*=\s*([A-Za-z_$][\w$]*Key)\s*\(/g)];
  for (let pass = 0; pass <= aliases.length; pass += 1) {
    for (const match of aliases) addCandidates(candidates, match[1], candidates.get(match[2]) || []);
  }
  return candidates;
}

function collectDynamicRegistry() {
  const declarations = [...appJs.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${DYNAMIC_KEY_REGISTRY}\\s*=`, "g"))];
  if (!declarations.length) return { found: false, keys: new Set() };
  if (declarations.length > 1) failures.push(`app.js declares ${DYNAMIC_KEY_REGISTRY} more than once.`);
  const declaration = declarations[0];
  const statementEnd = findJavaScriptStatementEnd(appJs, declaration.index + declaration[0].length);
  const statement = appJs.slice(declaration.index, statementEnd);
  const arrayStart = statement.indexOf("[");
  if (arrayStart === -1) {
    failures.push(`${DYNAMIC_KEY_REGISTRY} must be a literal string array, optionally wrapped in Object.freeze(...) or Set(...).`);
    return { found: true, keys: new Set() };
  }
  const arrayEnd = findMatchingDelimiter(statement, arrayStart, "[", "]");
  if (arrayEnd === -1) {
    failures.push(`${DYNAMIC_KEY_REGISTRY} has an unterminated array.`);
    return { found: true, keys: new Set() };
  }
  const elements = splitTopLevel(statement.slice(arrayStart + 1, arrayEnd), ",").map((item) => item.trim()).filter(Boolean);
  const values = [];
  for (const element of elements) {
    const value = staticStringValue(element);
    if (value === null) failures.push(`${DYNAMIC_KEY_REGISTRY} may contain only literal strings; found ${shortValue(element)}.`);
    else values.push(value);
  }
  const keys = new Set(values);
  if (keys.size !== values.length) failures.push(`${DYNAMIC_KEY_REGISTRY} contains duplicate keys.`);
  return { found: true, keys };
}

function resolveDynamicCall(call, candidateMap) {
  const expression = call.expression.trim();
  if (expression.startsWith("`") && expression.endsWith("`")) return resolveTemplateExpression(expression, candidateMap);
  const keys = new Set();
  for (const literal of collectStringLiterals(expression)) {
    if (looksLikeI18nKey(literal.value)) keys.add(literal.value);
  }
  for (const match of expression.matchAll(/\b([A-Za-z_$][\w$]*Key)\b/g)) {
    for (const value of candidateMap.get(match[1]) || []) keys.add(value);
  }
  return keys;
}

function resolveTemplateExpression(expression, candidateMap) {
  const content = expression.slice(1, -1);
  const pieces = [];
  let cursor = 0;
  const interpolation = /\$\{\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\}/g;
  for (const match of content.matchAll(interpolation)) {
    pieces.push({ literal: content.slice(cursor, match.index) });
    pieces.push({ expression: match[1], candidates: candidateMap.get(match[1].split(".").at(-1)) || [] });
    cursor = match.index + match[0].length;
  }
  pieces.push({ literal: content.slice(cursor) });
  if (!pieces.some((piece) => piece.expression)) return new Set([content]);

  let expansions = [""];
  let fullyEnumerated = true;
  for (const piece of pieces) {
    if (Object.hasOwn(piece, "literal")) {
      expansions = expansions.map((value) => value + piece.literal);
      continue;
    }
    if (!piece.candidates.length) {
      fullyEnumerated = false;
      break;
    }
    expansions = expansions.flatMap((value) => piece.candidates.map((candidate) => value + candidate));
  }
  if (fullyEnumerated) return new Set(expansions);

  const pattern = new RegExp(`^${pieces.map((piece) => Object.hasOwn(piece, "literal") ? escapeRegExp(piece.literal) : ".+").join("")}$`);
  return new Set(Object.keys(DICTIONARIES.en || {}).filter((key) => pattern.test(key)));
}

function collectRetiredDictionaryKeys() {
  const retired = [];
  for (const [language, dictionary] of Object.entries(DICTIONARIES)) {
    for (const key of Object.keys(dictionary)) {
      if (isRetiredKey(key)) retired.push({ language, key });
    }
  }
  return retired;
}

function isRetiredKey(key) {
  return RETIRED_KEY_PREFIXES.some((prefix) => String(key).startsWith(prefix));
}

function addCandidates(map, name, values) {
  if (!map.has(name)) map.set(name, new Set());
  for (const value of values) {
    if (looksLikeI18nKey(value)) map.get(name).add(value);
  }
}

function looksLikeI18nKey(value) {
  return typeof value === "string" && value.includes(".") && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

function staticStringValue(expression) {
  const value = String(expression || "").trim();
  if (value.length < 2) return null;
  const quote = value[0];
  if ((quote !== '"' && quote !== "'" && quote !== "`") || value.at(-1) !== quote) return null;
  if (quote === "`" && /\$\{/.test(value)) return null;
  const body = value.slice(1, -1);
  if (quote === '"') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return body.replace(new RegExp(`\\\\${escapeRegExp(quote)}`, "g"), quote).replace(/\\\\\\\\/g, "\\");
}

function collectStringLiterals(source) {
  const literals = [];
  for (let index = 0; index < source.length; index += 1) {
    const quote = source[index];
    if (quote !== "'" && quote !== '"' && quote !== "`") continue;
    const end = quote === "`" ? skipTemplate(source, index) : skipQuoted(source, index, quote);
    if (end >= source.length) break;
    const raw = source.slice(index, end + 1);
    const value = staticStringValue(raw);
    if (value !== null) literals.push({ value, index });
    index = end;
  }
  return literals;
}

function findJavaScriptStatementEnd(source, start) {
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'" || character === '"') {
      index = skipQuoted(source, index, character);
      continue;
    }
    if (character === "`") {
      index = skipTemplate(source, index);
      continue;
    }
    if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "{") braces += 1;
    else if (character === "}") braces -= 1;
    else if (character === ";" && !parentheses && !brackets && !braces) return index + 1;
  }
  return source.length;
}

function findMatchingDelimiter(source, start, opening, closing) {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'" || character === '"') {
      index = skipQuoted(source, index, character);
      continue;
    }
    if (character === "`") {
      index = skipTemplate(source, index);
      continue;
    }
    if (character === opening) depth += 1;
    else if (character === closing) {
      depth -= 1;
      if (!depth) return index;
    }
  }
  return -1;
}

function splitTopLevel(source, delimiter) {
  const parts = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'" || character === '"') {
      index = skipQuoted(source, index, character);
      continue;
    }
    if (character === "`") {
      index = skipTemplate(source, index);
      continue;
    }
    if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "{") braces += 1;
    else if (character === "}") braces -= 1;
    else if (character === delimiter && !parentheses && !brackets && !braces) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

function skipQuoted(source, start, quote) {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") index += 1;
    else if (source[index] === quote) return index;
  }
  return source.length;
}

function skipTemplate(source, start) {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") index += 1;
    else if (source[index] === "`") return index;
  }
  return source.length;
}

function placeholders(value) {
  return [...String(value).matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
}

function lineNumberAt(source, index) {
  return source.slice(0, Math.max(0, index)).split("\n").length;
}

function kebabToCamel(value) {
  return String(value).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function decodeHtmlForInspection(value) {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function shortValue(value) {
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > 100 ? `${text.slice(0, 97)}...` : text;
}

function summarizeList(values, limit = 12) {
  const unique = [...new Set(values)];
  const shown = unique.slice(0, limit).join(", ");
  return unique.length > limit ? `${shown}, ... (+${unique.length - limit} more)` : shown;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
