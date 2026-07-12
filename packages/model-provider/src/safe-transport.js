import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class ModelTransportError extends Error {
  constructor(code, message, { status = null, upstreamStatus = null } = {}) {
    super(message);
    this.name = "ModelTransportError";
    this.code = code;
    this.status = normalizeLocalErrorStatus(status) || defaultLocalErrorStatus(code);
    this.upstreamStatus = normalizeUpstreamStatus(upstreamStatus);
  }
}

export function buildOpenAICompatibleEndpoint(baseUrl) {
  let endpoint;
  try {
    endpoint = new URL(String(baseUrl || ""));
  } catch {
    throw transportError("invalid_url", "Model endpoint URL is invalid.");
  }

  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw transportError("invalid_url", "Model endpoint must use HTTP or HTTPS.");
  }
  if (endpoint.username || endpoint.password) {
    throw transportError("invalid_url", "Model endpoint must not contain credentials.");
  }
  if (endpoint.hash || endpoint.search) {
    throw transportError("invalid_url", "Model endpoint must not contain a query or fragment.");
  }
  if (!endpoint.hostname) {
    throw transportError("invalid_url", "Model endpoint must contain a hostname.");
  }
  const hostname = normalizeHostname(endpoint.hostname);
  const literalFamily = net.isIP(hostname);
  const literalScope = literalFamily ? classifyIpAddress(hostname) : "hostname";
  if (endpoint.protocol === "http:" && hostname !== "localhost" && literalScope !== "loopback") {
    throw transportError("invalid_url", "Plain HTTP model base URLs must use localhost or a literal loopback address.");
  }
  if (endpoint.protocol === "https:" && literalFamily && literalScope !== "public") {
    throw transportError("invalid_url", "HTTPS model base URLs must not use a private, local, or reserved literal address.");
  }

  const basePath = endpoint.pathname.replace(/\/+$/, "");
  if (/(^|\/)chat\/completions$/i.test(basePath)) {
    throw transportError("invalid_url", "Configure the model base URL without the chat completions suffix.");
  }
  endpoint.pathname = `${basePath}/chat/completions` || "/chat/completions";
  return endpoint.toString();
}

export async function resolveModelEndpoint(endpointValue, { lookup = dns.lookup, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const endpoint = parsePreparedEndpoint(endpointValue);
  const hostname = normalizeHostname(endpoint.hostname);
  const literalFamily = net.isIP(hostname);
  let addresses;

  if (literalFamily) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      const resolved = await withTimeout(
        Promise.resolve(lookup(hostname, { all: true, verbatim: true })),
        timeoutMs,
        () => transportError("request_timeout", "Model request timed out.")
      );
      addresses = normalizeLookupResults(resolved);
    } catch (error) {
      if (error instanceof ModelTransportError) throw error;
      throw transportError("dns_failed", "Model endpoint DNS resolution failed.");
    }
  }

  if (!addresses.length) throw transportError("dns_failed", "Model endpoint DNS resolution returned no addresses.");
  const classified = addresses.map((entry) => ({ ...entry, scope: classifyIpAddress(entry.address) }));
  const requiredScope = endpoint.protocol === "http:" ? "loopback" : "public";
  if (classified.some((entry) => entry.scope !== requiredScope)) {
    const message = endpoint.protocol === "http:"
      ? "Plain HTTP model endpoints are limited to loopback addresses."
      : "HTTPS model endpoints must resolve only to public addresses.";
    throw transportError("destination_blocked", message);
  }

  const selected = classified
    .slice()
    .sort((left, right) => left.family - right.family || left.address.localeCompare(right.address))[0];
  return Object.freeze({
    endpoint: endpoint.toString(),
    address: selected.address,
    family: selected.family,
    scope: selected.scope,
    lookup: createPinnedLookup(selected)
  });
}

export async function requestJsonSafely({
  endpoint,
  apiKey,
  bodyBuffer,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  lookup = dns.lookup
} = {}) {
  if (!Buffer.isBuffer(bodyBuffer)) throw transportError("invalid_request", "Prepared model request body is unavailable.");
  if (typeof apiKey !== "string" || !apiKey || /[\u0000-\u001f\u007f]/.test(apiKey)) {
    throw transportError("invalid_request", "Model API credential is invalid.");
  }
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes <= 0 || bodyBuffer.byteLength > maxRequestBytes) {
    throw transportError("request_too_large", "Prepared model request exceeds the allowed size.");
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw transportError("invalid_request", "Model response size limit is invalid.");
  }
  const normalizedTimeout = normalizeTimeout(timeoutMs);
  const startedAt = Date.now();
  const resolved = await resolveModelEndpoint(endpoint, { lookup, timeoutMs: normalizedTimeout });
  const remainingMs = Math.max(1, normalizedTimeout - (Date.now() - startedAt));
  return performRequest({
    endpoint: new URL(resolved.endpoint),
    apiKey: String(apiKey || ""),
    bodyBuffer,
    timeoutMs: remainingMs,
    maxResponseBytes,
    pinnedLookup: resolved.lookup,
    pinnedAddress: resolved.address
  });
}

export function classifyIpAddress(value) {
  const address = normalizeHostname(String(value || ""));
  const family = net.isIP(address);
  if (family === 4) return classifyIpv4(address);
  if (family === 6) return classifyIpv6(address);
  return "invalid";
}

export function assertPinnedRemoteAddress(actualAddress, pinnedAddress) {
  const actual = canonicalIpAddress(actualAddress);
  const pinned = canonicalIpAddress(pinnedAddress);
  if (!actual || !pinned || actual !== pinned) {
    throw transportError("destination_changed", "Model connection did not reach the DNS-pinned address.");
  }
  return true;
}

function performRequest({ endpoint, apiKey, bodyBuffer, timeoutMs, maxResponseBytes, pinnedLookup, pinnedAddress }) {
  return new Promise((resolve, reject) => {
    const client = endpoint.protocol === "https:" ? https : http;
    let settled = false;
    let deadline = null;
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      request?.destroy();
      reject(error instanceof ModelTransportError ? error : transportError("network_error", "Model request failed."));
    };
    const finishResolve = (value) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      resolve(value);
    };
    let request;
    try {
      request = client.request({
        protocol: endpoint.protocol,
        hostname: normalizeHostname(endpoint.hostname),
        port: endpoint.port || undefined,
        path: `${endpoint.pathname}${endpoint.search}`,
        method: "POST",
        agent: false,
        lookup: pinnedLookup,
        headers: {
          accept: "application/json",
          "accept-encoding": "identity",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json; charset=utf-8",
          "content-length": String(bodyBuffer.byteLength)
        }
      }, (response) => {
      try {
        assertPinnedRemoteAddress(response.socket?.remoteAddress, pinnedAddress);
      } catch (error) {
        response.destroy();
        finishReject(error);
        return;
      }
      const status = Number(response.statusCode || 0);
      if (status >= 300 && status < 400) {
        response.resume();
        finishReject(transportError("redirect_blocked", "Model endpoint redirects are not allowed.", { upstreamStatus: status }));
        return;
      }

      const declaredLength = Number(response.headers["content-length"]);
      if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
        response.destroy();
        finishReject(transportError("response_too_large", "Model response exceeds the allowed size.", { upstreamStatus: status }));
        return;
      }

      const chunks = [];
      let received = 0;
      response.on("data", (chunk) => {
        if (settled) return;
        received += chunk.byteLength;
        if (received > maxResponseBytes) {
          response.destroy();
          finishReject(transportError("response_too_large", "Model response exceeds the allowed size.", { upstreamStatus: status }));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", () => finishReject(transportError("network_error", "Model response failed.", { upstreamStatus: status })));
      response.on("end", () => {
        if (settled) return;
        const contentType = String(response.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
        if (contentType !== "application/json" && !contentType.endsWith("+json")) {
          finishReject(transportError("response_not_json", "Model response was not JSON.", { upstreamStatus: status }));
          return;
        }
        let payload;
        try {
          payload = JSON.parse(Buffer.concat(chunks, received).toString("utf8"));
        } catch {
          finishReject(transportError("response_not_json", "Model response was not valid JSON.", { upstreamStatus: status }));
          return;
        }
        if (status < 200 || status >= 300) {
          finishReject(transportError("upstream_http_error", `Model endpoint returned HTTP ${status}.`, { upstreamStatus: status }));
          return;
        }
        finishResolve(payload);
      });
      });
    } catch {
      finishReject(transportError("network_error", "Model request failed."));
      return;
    }

    deadline = setTimeout(() => finishReject(transportError("request_timeout", "Model request timed out.")), timeoutMs);
    request.on("error", () => finishReject(transportError("network_error", "Model request failed.")));
    request.end(bodyBuffer);
  });
}

function parsePreparedEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(String(value || ""));
  } catch {
    throw transportError("invalid_url", "Model endpoint URL is invalid.");
  }
  if (!/^https?:$/.test(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash || endpoint.search || !endpoint.hostname) {
    throw transportError("invalid_url", "Prepared model endpoint is invalid.");
  }
  if (!/(^|\/)chat\/completions$/i.test(endpoint.pathname.replace(/\/+$/, ""))) {
    throw transportError("invalid_url", "Prepared model endpoint path is invalid.");
  }
  return endpoint;
}

function normalizeLookupResults(results) {
  const list = Array.isArray(results) ? results : results ? [results] : [];
  const seen = new Set();
  const normalized = [];
  for (const result of list) {
    const address = normalizeHostname(typeof result === "string" ? result : result?.address);
    const family = Number(typeof result === "string" ? net.isIP(address) : result?.family || net.isIP(address));
    if ((family !== 4 && family !== 6) || net.isIP(address) !== family) {
      throw transportError("dns_failed", "Model endpoint DNS resolution returned an invalid address.");
    }
    const key = `${family}:${address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ address, family });
  }
  return normalized;
}

function createPinnedLookup(selected) {
  return (_hostname, options, callback) => {
    const normalizedOptions = typeof options === "object" && options ? options : {};
    if (normalizedOptions.all) {
      callback(null, [{ address: selected.address, family: selected.family }]);
      return;
    }
    callback(null, selected.address, selected.family);
  };
}

function classifyIpv4(address) {
  const octets = address.split(".").map(Number);
  const [a, b] = octets;
  if (a === 127) return "loopback";
  if (
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (octets[2] === 0 || octets[2] === 2)) ||
    (a === 192 && b === 88 && octets[2] === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && octets[2] === 100) ||
    (a === 203 && b === 0 && octets[2] === 113) ||
    a >= 224
  ) return "blocked";
  return "public";
}

function classifyIpv6(address) {
  const mapped = extractMappedIpv4(address);
  if (mapped) return classifyIpv4(mapped);
  const value = ipv6ToBigInt(address);
  if (value === null) return "invalid";
  if (value === 1n) return "loopback";
  if (value === 0n) return "blocked";

  const inPrefix = (prefix, bits) => value >> BigInt(128 - bits) === prefix >> BigInt(128 - bits);
  if (
    inPrefix(ipv6LiteralToBigInt("fc00::"), 7) ||
    inPrefix(ipv6LiteralToBigInt("fe80::"), 10) ||
    inPrefix(ipv6LiteralToBigInt("fec0::"), 10) ||
    inPrefix(ipv6LiteralToBigInt("ff00::"), 8) ||
    inPrefix(ipv6LiteralToBigInt("64:ff9b::"), 96) ||
    inPrefix(ipv6LiteralToBigInt("64:ff9b:1::"), 48) ||
    inPrefix(ipv6LiteralToBigInt("100::"), 64) ||
    inPrefix(ipv6LiteralToBigInt("2001::"), 32) ||
    inPrefix(ipv6LiteralToBigInt("2001:2::"), 48) ||
    inPrefix(ipv6LiteralToBigInt("2001:3::"), 32) ||
    inPrefix(ipv6LiteralToBigInt("2001:4:112::"), 48) ||
    inPrefix(ipv6LiteralToBigInt("2001:10::"), 28) ||
    inPrefix(ipv6LiteralToBigInt("2001:20::"), 28) ||
    inPrefix(ipv6LiteralToBigInt("2001:30::"), 28) ||
    inPrefix(ipv6LiteralToBigInt("2001:db8::"), 32) ||
    inPrefix(ipv6LiteralToBigInt("2002::"), 16)
  ) return "blocked";
  return inPrefix(ipv6LiteralToBigInt("2000::"), 3) ? "public" : "blocked";
}

function extractMappedIpv4(address) {
  const match = address.toLowerCase().match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (!match || net.isIP(match[1]) !== 4) return null;
  return match[1];
}

function canonicalIpAddress(address) {
  const normalized = normalizeHostname(String(address || ""));
  const family = net.isIP(normalized);
  if (family === 4) {
    const value = normalized.split(".").reduce((result, octet) => (result << 8n) | BigInt(Number(octet)), 0n);
    return `4:${value.toString(16)}`;
  }
  if (family !== 6) return "";
  const value = ipv6ToBigInt(normalized);
  if (value === null) return "";
  if (value >> 32n === 0xffffn) return `4:${(value & 0xffffffffn).toString(16)}`;
  return `6:${value.toString(16)}`;
}

function ipv6LiteralToBigInt(address) {
  return ipv6ToBigInt(address) ?? 0n;
}

function ipv6ToBigInt(address) {
  let normalized = address.toLowerCase();
  const dottedMatch = normalized.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dottedMatch) {
    if (net.isIP(dottedMatch[1]) !== 4) return null;
    const octets = dottedMatch[1].split(".").map(Number);
    normalized = normalized.slice(0, dottedMatch.index) + `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...new Array(missing).fill("0"), ...right];
  if (words.length !== 8 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  return words.reduce((result, word) => (result << 16n) | BigInt(`0x${word}`), 0n);
}

function normalizeHostname(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text.startsWith("[") && text.endsWith("]")) return text.slice(1, -1);
  return text.endsWith(".") ? text.slice(0, -1) : text;
}

function normalizeTimeout(value) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(1, Math.min(Math.floor(timeout), 120_000));
}

function withTimeout(promise, timeoutMs, createError) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(createError()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function normalizeLocalErrorStatus(value) {
  return Number.isInteger(value) && value >= 400 && value <= 599 ? value : null;
}

function normalizeUpstreamStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function defaultLocalErrorStatus(code) {
  if (code === "request_timeout") return 504;
  if (["invalid_url", "invalid_request"].includes(code)) return 400;
  if (code === "request_too_large") return 413;
  if (["provider_not_configured", "invalid_prepared_request", "prepared_request_consumed"].includes(code)) return 409;
  if ([
    "MODEL_RESPONSE_CREDENTIAL_REFLECTION",
    "destination_blocked",
    "destination_changed",
    "dns_failed",
    "invalid_response",
    "network_error",
    "redirect_blocked",
    "response_not_json",
    "response_too_large",
    "upstream_http_error"
  ].includes(code)) return 502;
  return 500;
}

function transportError(code, message, options) {
  return new ModelTransportError(code, message, options);
}
