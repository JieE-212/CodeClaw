import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  assertPinnedRemoteAddress,
  buildOpenAICompatibleEndpoint,
  classifyIpAddress,
  requestJsonSafely,
  resolveModelEndpoint
} from "../packages/model-provider/src/safe-transport.js";

const BODY = Buffer.from('{"model":"m","messages":[]}', "utf8");

test("OpenAI-compatible endpoint construction fixes the final route", () => {
  assert.equal(buildOpenAICompatibleEndpoint("http://localhost:1234/v1/"), "http://localhost:1234/v1/chat/completions");
  assert.equal(buildOpenAICompatibleEndpoint("https://models.example/"), "https://models.example/chat/completions");
  for (const value of [
    "ftp://models.example/v1",
    "https://user:secret@models.example/v1",
    "https://models.example/v1?key=secret",
    "https://models.example/v1#fragment",
    "https://models.example/v1/chat/completions",
    "http://models.example/v1",
    "http://192.168.1.10:11434/v1",
    "https://127.0.0.1/v1"
  ]) {
    assert.throws(() => buildOpenAICompatibleEndpoint(value), { code: "invalid_url" });
  }
});

test("IP classification distinguishes loopback, public, and blocked scopes", () => {
  for (const address of ["127.0.0.1", "127.20.30.40", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(classifyIpAddress(address), "loopback", address);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "192.31.196.1", "2001:4860:4860::8888", "2606:4700:4700::1111"]) {
    assert.equal(classifyIpAddress(address), "public", address);
  }
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "::",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1"
  ]) {
    assert.equal(classifyIpAddress(address), "blocked", address);
  }
});

test("remote address verification rejects any destination change", () => {
  assert.equal(assertPinnedRemoteAddress("::ffff:127.0.0.1", "127.0.0.1"), true);
  assert.throws(() => assertPinnedRemoteAddress("127.0.0.2", "127.0.0.1"), { code: "destination_changed" });
  assert.throws(() => assertPinnedRemoteAddress(undefined, "127.0.0.1"), { code: "destination_changed" });
});

test("endpoint resolution enforces scheme scope and returns a DNS-pinned lookup", async () => {
  const loopback = await resolveModelEndpoint("http://model.test/v1/chat/completions", {
    lookup: async () => [{ address: "::1", family: 6 }, { address: "127.0.0.1", family: 4 }]
  });
  assert.equal(loopback.address, "127.0.0.1");
  const pinned = await callLookup(loopback.lookup, "different-host.test", {});
  assert.deepEqual(pinned, { address: "127.0.0.1", family: 4 });

  const publicEndpoint = await resolveModelEndpoint("https://model.test/v1/chat/completions", {
    lookup: async () => [{ address: "8.8.8.8", family: 4 }]
  });
  assert.equal(publicEndpoint.scope, "public");

  await assert.rejects(resolveModelEndpoint("http://model.test/v1/chat/completions", {
    lookup: async () => [{ address: "8.8.8.8", family: 4 }]
  }), { code: "destination_blocked" });
  await assert.rejects(resolveModelEndpoint("https://model.test/v1/chat/completions", {
    lookup: async () => [{ address: "8.8.8.8", family: 4 }, { address: "169.254.169.254", family: 4 }]
  }), { code: "destination_blocked" });
  await assert.rejects(resolveModelEndpoint("https://127.0.0.1/v1/chat/completions"), { code: "destination_blocked" });
});

test("safe transport pins DNS and sends the supplied buffer without serialization", async () => {
  let lookupCount = 0;
  let received = null;
  await withServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = {
      host: request.headers.host,
      authorization: request.headers.authorization,
      acceptEncoding: request.headers["accept-encoding"],
      connection: request.headers.connection,
      body: Buffer.concat(chunks)
    };
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end('{"choices":[{"message":{"content":"ok"}}]}');
  }, async ({ port }) => {
    const payload = await requestJsonSafely({
      endpoint: `http://model.test:${port}/v1/chat/completions`,
      apiKey: "transport-key",
      bodyBuffer: BODY,
      lookup: async () => {
        lookupCount += 1;
        return [{ address: "127.0.0.1", family: 4 }];
      }
    });
    assert.equal(payload.choices[0].message.content, "ok");
  });
  assert.equal(lookupCount, 1);
  assert.match(received.host, /^model\.test:/);
  assert.equal(received.authorization, "Bearer transport-key");
  assert.equal(received.acceptEncoding, "identity");
  assert.equal(received.connection, "close");
  assert.deepEqual(received.body, BODY);
});

test("safe transport rejects redirects, non-JSON, upstream bodies, and oversized responses without leaking secrets", async () => {
  const upstreamSecret = "UPSTREAM-BODY-SHOULD-NOT-LEAK";
  const apiKey = "API-KEY-SHOULD-NOT-LEAK";
  let call = 0;
  await withServer(async (request, response) => {
    for await (const _chunk of request) {}
    call += 1;
    if (call === 1) {
      response.writeHead(302, { location: "http://169.254.169.254/latest" });
      response.end();
      return;
    }
    if (call === 2) {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("not json");
      return;
    }
    if (call === 3) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: upstreamSecret } }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ value: "x".repeat(200) }));
  }, async ({ endpoint }) => {
    for (const [code, upstreamStatus, options] of [
      ["redirect_blocked", 302, {}],
      ["response_not_json", 200, {}],
      ["upstream_http_error", 500, {}],
      ["response_too_large", 200, { maxResponseBytes: 40 }]
    ]) {
      await assert.rejects(requestJsonSafely({ endpoint, apiKey, bodyBuffer: BODY, ...options }), (error) => {
        assert.equal(error.code, code);
        assert.equal(error.status, 502);
        assert.equal(error.upstreamStatus, upstreamStatus);
        assert.doesNotMatch(String(error.message), new RegExp(upstreamSecret));
        assert.doesNotMatch(String(error.message), new RegExp(apiKey));
        return true;
      });
    }
  });
  assert.equal(call, 4);
});

test("safe transport applies request size, credential, and absolute timeout limits", async () => {
  await withServer((_request, _response) => {}, async ({ endpoint }) => {
    await assert.rejects(requestJsonSafely({
      endpoint,
      apiKey: "key",
      bodyBuffer: BODY,
      timeoutMs: 35
    }), (error) => {
      assert.equal(error.code, "request_timeout");
      assert.equal(error.status, 504);
      assert.equal(error.upstreamStatus, null);
      return true;
    });
  });

  await assert.rejects(requestJsonSafely({
    endpoint: "http://127.0.0.1:1/v1/chat/completions",
    apiKey: "key",
    bodyBuffer: BODY,
    maxRequestBytes: 2
  }), { code: "request_too_large" });
  await assert.rejects(requestJsonSafely({
    endpoint: "http://127.0.0.1:1/v1/chat/completions",
    apiKey: "secret\r\ninjected: true",
    bodyBuffer: BODY
  }), (error) => {
    assert.equal(error.code, "invalid_request");
    assert.doesNotMatch(error.message, /secret|injected/i);
    return true;
  });
});

async function callLookup(lookup, hostname, options) {
  return new Promise((resolve, reject) => {
    lookup(hostname, options, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
}

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  try {
    await run({
      port: address.port,
      endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`
    });
  } finally {
    server.closeAllConnections?.();
    if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
