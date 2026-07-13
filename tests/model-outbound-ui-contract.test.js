import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const [app, html, css] = await Promise.all([
  fs.readFile(new URL("../apps/web/public/app.js", import.meta.url), "utf8"),
  fs.readFile(new URL("../apps/web/public/index.html", import.meta.url), "utf8"),
  fs.readFile(new URL("../apps/web/public/styles.css", import.meta.url), "utf8")
]);

test("all browser model actions use the reviewed preview and send boundary", () => {
  for (const operation of ["task-suggest", "context-files", "patch-proposal", "failure-fix"]) {
    assert.match(app, new RegExp(`executeReviewedModelOperation\\(\\"${operation}\\"`));
  }
  assert.match(app, /request\("\/api\/model\/preview", \{ operation, taskId: currentTask\.id \}\)/);
  assert.match(app, /requestManagedOperation\("model-send", "\/api\/model\/send", \{[\s\S]*?previewId: payload\.preview\.previewId,[\s\S]*?approvalDigest: payload\.preview\.approvalDigest,[\s\S]*?approved: true/);
  assert.match(app, /request\("\/api\/model\/cancel", \{[\s\S]*?previewId: preview\.previewId,[\s\S]*?approvalDigest: preview\.approvalDigest/);
  for (const legacy of ["/api/model/suggest", "/api/model/context-files", "/api/model/patch-proposal", "/api/model/fix-from-failure"]) {
    assert.doesNotMatch(app, new RegExp(legacy.replaceAll("/", "\\/")));
  }
});

test("an approved in-flight model send exposes a separate local-operation cancel control", () => {
  assert.match(html, /id="cancelModelOperationButton"[^>]+data-i18n="button\.cancelOperation"[^>]+hidden/);
  assert.match(app, /cancelModelOperationButton\.addEventListener\("click", \(\) => cancelActiveOperation\("model-send", modelState\)\)/);
  assert.match(app, /activeOperations\.has\("model-send"\)/);
});

test("outbound review is a labelled native dialog with an independent safe default", () => {
  assert.match(html, /<dialog[^>]+id="modelOutboundReview"[^>]+aria-labelledby="modelReviewTitle"[^>]+aria-describedby="modelReviewWarning"/);
  assert.match(html, /id="modelReviewBody"[^>]+tabindex="0"/);
  assert.match(html, /id="modelReviewCancel"[^>]+type="button"/);
  assert.match(html, /id="modelReviewApprove"[^>]+type="button"/);
  assert.match(app, /modelOutboundReview\.showModal\(\);\s*modelReviewCancel\.focus\(\);/);
  assert.match(app, /modelOutboundReview\.addEventListener\("cancel"/);
  assert.match(app, /finishModelOutboundReview\(false\)/);
});

test("exact request and file disclosure are rendered as text and cleared on close", () => {
  assert.match(app, /visualizeModelReviewBody\(typeof requestInfo\.bodyUtf8 === "string"/);
  assert.match(app, /modelReviewBody\.textContent = visualizedBody\.text/);
  assert.match(app, /modelReviewControlWarning\.textContent = visualizedBody\.controlCount/);
  assert.match(app, /path\.textContent = String\(file\?\.path/);
  assert.match(app, /valueNode\.textContent = String\(value\)/);
  assert.doesNotMatch(app, /modelReview(?:Body|Files|Endpoint|Sha)[\s\S]{0,80}\.innerHTML/);
  assert.match(app, /function clearModelOutboundReview\(\) \{/);
  assert.match(app, /modelReviewBody\.textContent = "";/);
  assert.match(app, /modelReviewFiles\.replaceChildren\(\);/);
});

test("review remains scrollable on desktop and reachable on narrow screens", () => {
  assert.match(css, /\.model-review-scroll \{[^}]*overflow:auto/);
  assert.match(css, /\.model-review-shell \{[^}]*grid-template-rows:auto minmax\(0,1fr\) auto/);
  assert.match(css, /@media \(max-width:620px\)[^{]*\{[\s\S]*?\.model-review-dialog \{ width:100vw; height:100dvh;/);
  assert.match(css, /\.model-review-footer button \{ width:100%; \}/);
});

test("the API-key input is cleared after every save attempt", () => {
  assert.match(app, /saveModelButton\.addEventListener\("click", async \(\) => \{[\s\S]*?finally \{\s*modelApiKey\.value = "";/);
});
