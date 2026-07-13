import test from "node:test";
import assert from "node:assert/strict";
import { checkedCommandInvocation, fetchBoundedLoopbackJson } from "../scripts/stage4b-machine.js";

test("Stage 4B invokes Windows batch commands through ComSpec without a shell string", () => {
  assert.deepEqual(
    checkedCommandInvocation("npm.cmd", ["run", "check"], { platform: "win32", comspec: "C:\\Windows\\System32\\cmd.exe" }),
    {
      file: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", "run", "check"]
    }
  );
  assert.deepEqual(
    checkedCommandInvocation("node", ["--test"], { platform: "win32", comspec: "cmd.exe" }),
    { file: "node", args: ["--test"] }
  );
});

test("Stage 4B loopback JSON check is exact, redirect-disabled, and bounded", async () => {
  let observedUrl = "";
  let observedInit = null;
  const value = await fetchBoundedLoopbackJson("http://127.0.0.1:4173/api/system/check", {}, {
    fetchImpl: async (url, init) => {
      observedUrl = url;
      observedInit = init;
      return jsonResponse({ ok: true });
    },
    timeoutMs: 100,
    maxBytes: 128
  });
  assert.deepEqual(value, { ok: true });
  assert.equal(observedUrl, "http://127.0.0.1:4173/api/system/check");
  assert.equal(observedInit.redirect, "error");
  assert.ok(observedInit.signal instanceof AbortSignal);

  await assert.rejects(
    () => fetchBoundedLoopbackJson("http://localhost:4173/api/system/check"),
    { code: "STAGE4B_HTTP_TARGET_INVALID" }
  );
  await assert.rejects(
    () => fetchBoundedLoopbackJson("http://127.0.0.1:4173/api/system/check", {}, {
      fetchImpl: async () => responseLike({ redirected: true, url: "http://127.0.0.1:4174/forwarded" }),
      timeoutMs: 100,
      maxBytes: 128
    }),
    { code: "STAGE4B_HTTP_REDIRECTED" }
  );
  await assert.rejects(
    () => fetchBoundedLoopbackJson("http://127.0.0.1:4173/api/system/check", {}, {
      fetchImpl: async () => jsonResponse({ ok: true }, { "content-length": "129" }),
      timeoutMs: 100,
      maxBytes: 128
    }),
    { code: "STAGE4B_HTTP_TOO_LARGE" }
  );
});

test("Stage 4B loopback JSON check rejects a fetch that ignores cancellation at its deadline", async () => {
  await assert.rejects(
    () => fetchBoundedLoopbackJson("http://127.0.0.1:4173/api/system/check", {}, {
      fetchImpl: async () => new Promise(() => {}),
      timeoutMs: 20,
      maxBytes: 128
    }),
    { code: "STAGE4B_HTTP_TIMEOUT" }
  );
});

function jsonResponse(value, headers = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}

function responseLike(overrides = {}) {
  return {
    ok: true,
    redirected: false,
    url: "http://127.0.0.1:4173/api/system/check",
    headers: new Headers({ "content-type": "application/json; charset=utf-8" }),
    body: [Buffer.from('{"ok":true}')],
    ...overrides
  };
}
