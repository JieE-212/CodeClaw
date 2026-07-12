import test from "node:test";
import assert from "node:assert/strict";
import { visualizeModelReviewBody } from "../apps/web/public/model-review-text.js";

test("model review makes bidi and zero-width controls visible without interpreting markup", () => {
  const raw = '<script>alert("x")</script>\u202Eabc\u200Bdef';
  const rendered = visualizeModelReviewBody(raw);
  assert.equal(rendered.controlCount, 2);
  assert.equal(rendered.text, '<script>alert("x")</script>[U+202E]abc[U+200B]def');
  assert.doesNotMatch(rendered.text, /[\u202e\u200b]/u);
  assert.equal(raw.includes("\u202E"), true);
});

test("ordinary Chinese, Russian, emoji, tabs, and newlines remain unchanged", () => {
  const raw = "中文 Русский 😀\n\tplain";
  assert.deepEqual(visualizeModelReviewBody(raw), { text: raw, controlCount: 0 });
});

test("isolates, BOM, DEL, and Unicode tag characters are also made explicit", () => {
  const rendered = visualizeModelReviewBody("a\u2066b\uFEFFc\u007Fd\u{E0061}e");
  assert.equal(rendered.controlCount, 4);
  assert.equal(rendered.text, "a[U+2066]b[U+FEFF]c[U+007F]d[U+E0061]e");
});
