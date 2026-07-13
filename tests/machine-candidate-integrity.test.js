import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  CANDIDATE_AUTHORITY_FILENAME,
  CANDIDATE_AUTHORITY_SHA256_FILENAME,
  verifyCandidateIntegrity,
  writeCandidateAuthority
} from "../packages/local-launcher/src/candidate-integrity.js";

const METADATA = Object.freeze({
  packageVersion: "0.1.0",
  sourceCommit: "0123456789abcdef0123456789abcdef01234567",
  sourceDirty: false
});

test("candidate Authority is deterministic, self-excluding, canonical, and independently verifiable", async (t) => {
  const root = await temporaryCandidate(t, "codeclaw-candidate-authority-");
  await fs.mkdir(path.join(root, "src", "empty"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), "{\"name\":\"candidate\"}\n", "utf8");
  await fs.writeFile(path.join(root, "src", "index.js"), "export const ready = true;\n", "utf8");

  const written = await writeCandidateAuthority(root, METADATA);
  assert.equal(written.ok, true);
  assert.match(written.candidateId, /^codeclaw-[0-9a-f]{64}$/);
  assert.equal(written.sourceCommit, METADATA.sourceCommit);
  assert.equal(written.sourceDirty, false);
  assert.deepEqual(written.authority.directories, ["src", "src/empty"]);
  assert.deepEqual(written.authority.files.map((file) => file.path), ["package.json", "src/index.js"]);
  assert.equal(written.authority.fileCount, 2);
  assert.equal(written.authority.directoryCount, 2);
  assert.equal(written.authority.totalBytes, written.authority.files.reduce((sum, file) => sum + file.size, 0));

  const authorityPath = path.join(root, CANDIDATE_AUTHORITY_FILENAME);
  const sidecarPath = path.join(root, CANDIDATE_AUTHORITY_SHA256_FILENAME);
  const authorityText = await fs.readFile(authorityPath, "utf8");
  const authorityBytes = Buffer.from(authorityText, "utf8");
  const sidecar = await fs.readFile(sidecarPath, "utf8");
  assert.equal(sidecar, `${digest(authorityBytes)}  ${CANDIDATE_AUTHORITY_FILENAME}\n`);
  assert.doesNotMatch(authorityText, new RegExp(escapeRegExp(path.resolve(root)), "i"));

  const parsed = JSON.parse(authorityText);
  const payload = { ...parsed };
  delete payload.candidateId;
  delete payload.payloadSha256;
  const payloadSha256 = digest(canonicalJson(payload));
  assert.equal(parsed.payloadSha256, payloadSha256);
  assert.equal(parsed.candidateId, `codeclaw-${payloadSha256}`);
  assert.equal(authorityText, `${canonicalJson(parsed)}\n`);

  const verified = await verifyCandidateIntegrity(root);
  assert.equal(verified.candidateId, written.candidateId);
  assert.equal(verified.manifestSha256, digest(authorityBytes));

  const rewritten = await writeCandidateAuthority(root, METADATA);
  assert.equal(rewritten.candidateId, written.candidateId);
  assert.equal(await fs.readFile(authorityPath, "utf8"), authorityText);
});

test("verification rejects changed, missing, extra, and truncated payload content", async (t) => {
  await t.test("changed file", async (t) => {
    const { root, target } = await basicCandidate(t, "changed");
    await fs.writeFile(target, "changed-content\n", "utf8");
    await rejectsCode(() => verifyCandidateIntegrity(root), "CANDIDATE_INTEGRITY_MISMATCH");
  });

  await t.test("missing file", async (t) => {
    const { root, target } = await basicCandidate(t, "missing");
    await fs.rm(target);
    await rejectsCode(() => verifyCandidateIntegrity(root), "CANDIDATE_INTEGRITY_MISMATCH");
  });

  await t.test("extra file", async (t) => {
    const { root } = await basicCandidate(t, "extra");
    await fs.writeFile(path.join(root, "extra.txt"), "extra\n", "utf8");
    await rejectsCode(() => verifyCandidateIntegrity(root), "CANDIDATE_INTEGRITY_MISMATCH");
  });

  await t.test("extra empty directory", async (t) => {
    const { root } = await basicCandidate(t, "extra-directory");
    await fs.mkdir(path.join(root, "unexpected-empty"));
    await rejectsCode(() => verifyCandidateIntegrity(root), "CANDIDATE_INTEGRITY_MISMATCH");
  });

  await t.test("truncated file", async (t) => {
    const { root, target } = await basicCandidate(t, "truncated");
    await fs.truncate(target, 2);
    await rejectsCode(() => verifyCandidateIntegrity(root), "CANDIDATE_INTEGRITY_MISMATCH");
  });
});

test("Authority and sidecar tampering fail closed even when an attacker recomputes the sidecar", async (t) => {
  await t.test("truncated Authority JSON", async (t) => {
    const { root } = await basicCandidate(t, "authority-truncated");
    await replaceAuthority(root, "{\"schema\":");
    await rejectsCode(() => verifyCandidateIntegrity(root), "CANDIDATE_AUTHORITY_INVALID");
  });

  await t.test("dirty source claim", async (t) => {
    const { root } = await basicCandidate(t, "authority-dirty");
    const authority = await readAuthority(root);
    authority.sourceDirty = true;
    await replaceAuthority(root, `${canonicalJson(authority)}\n`);
    await rejectsCode(() => verifyCandidateIntegrity(root), "CANDIDATE_SOURCE_DIRTY");
  });

  await t.test("absolute manifest path", async (t) => {
    const { root } = await basicCandidate(t, "authority-absolute");
    const authority = await readAuthority(root);
    authority.files[0].path = "C:/private/escape.txt";
    await replaceAuthority(root, `${canonicalJson(authority)}\n`);
    await rejectsCode(() => verifyCandidateIntegrity(root), "CANDIDATE_PATH_UNSAFE");
  });

  await t.test("parent traversal manifest path", async (t) => {
    const { root } = await basicCandidate(t, "authority-parent");
    const authority = await readAuthority(root);
    authority.files[0].path = "../escape.txt";
    await replaceAuthority(root, `${canonicalJson(authority)}\n`);
    await rejectsCode(() => verifyCandidateIntegrity(root), "CANDIDATE_PATH_UNSAFE");
  });

  await t.test("case-folding collision inside a recomputed Authority", async (t) => {
    const { root } = await basicCandidate(t, "authority-case-collision");
    const authority = await readAuthority(root);
    authority.files.push({ ...authority.files[0], path: authority.files[0].path.toUpperCase() });
    authority.files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    authority.fileCount = authority.files.length;
    authority.totalBytes = authority.files.reduce((sum, file) => sum + file.size, 0);
    await replaceAuthority(root, `${canonicalJson(authority)}\n`);
    await rejectsCode(() => verifyCandidateIntegrity(root), "CANDIDATE_PATH_COLLISION");
  });

  await t.test("sidecar truncation", async (t) => {
    const { root } = await basicCandidate(t, "sidecar-truncated");
    await fs.writeFile(path.join(root, CANDIDATE_AUTHORITY_SHA256_FILENAME), "abc\n", "utf8");
    await rejectsCode(() => verifyCandidateIntegrity(root), "CANDIDATE_SIDECAR_INVALID");
  });

  await t.test("Authority BOM remains visible to canonical validation", async (t) => {
    const { root } = await basicCandidate(t, "authority-bom");
    const authority = await fs.readFile(path.join(root, CANDIDATE_AUTHORITY_FILENAME), "utf8");
    await replaceAuthority(root, `\ufeff${authority}`);
    await rejectsCode(() => verifyCandidateIntegrity(root), "CANDIDATE_AUTHORITY_INVALID");
  });

  await t.test("sidecar BOM remains visible to exact-text validation", async (t) => {
    const { root } = await basicCandidate(t, "sidecar-bom");
    const sidecarPath = path.join(root, CANDIDATE_AUTHORITY_SHA256_FILENAME);
    const sidecar = await fs.readFile(sidecarPath, "utf8");
    await fs.writeFile(sidecarPath, `\ufeff${sidecar}`, "utf8");
    await rejectsCode(() => verifyCandidateIntegrity(root), "CANDIDATE_SIDECAR_INVALID");
  });
});

test("metadata must identify one clean semantic-versioned 40-character source commit", async (t) => {
  const root = await temporaryCandidate(t, "codeclaw-candidate-metadata-");
  await fs.writeFile(path.join(root, "app.txt"), "app\n", "utf8");
  await rejectsCode(
    () => writeCandidateAuthority(root, { ...METADATA, sourceDirty: true }),
    "CANDIDATE_SOURCE_DIRTY"
  );
  await rejectsCode(
    () => writeCandidateAuthority(root, { ...METADATA, sourceCommit: "abc" }),
    "CANDIDATE_METADATA_INVALID"
  );
  await rejectsCode(
    () => writeCandidateAuthority(root, { ...METADATA, packageVersion: "not a version" }),
    "CANDIDATE_METADATA_INVALID"
  );
});

test("Windows case-folding and Unicode NFC collisions are rejected", async (t) => {
  await t.test("case-folding collision where supported", async (t) => {
    const root = await temporaryCandidate(t, "codeclaw-candidate-case-");
    await fs.writeFile(path.join(root, "Alpha.txt"), "one\n", "utf8");
    await fs.writeFile(path.join(root, "alpha.txt"), "two\n", "utf8");
    const names = await fs.readdir(root);
    if (names.length !== 2) return t.skip("The current filesystem is case-insensitive and cannot construct the collision fixture.");
    await rejectsCode(() => writeCandidateAuthority(root, METADATA), "CANDIDATE_PATH_COLLISION");
  });

  await t.test("Unicode NFC collision where supported", async (t) => {
    const root = await temporaryCandidate(t, "codeclaw-candidate-nfc-");
    const composed = "\u00e9.txt";
    const decomposed = "e\u0301.txt";
    await fs.writeFile(path.join(root, composed), "one\n", "utf8");
    await fs.writeFile(path.join(root, decomposed), "two\n", "utf8");
    const names = await fs.readdir(root);
    if (!names.includes(composed) || !names.includes(decomposed)) {
      return t.skip("The current filesystem normalizes Unicode names and cannot construct the NFC collision fixture.");
    }
    await rejectsCode(() => writeCandidateAuthority(root, METADATA), "CANDIDATE_PATH_COLLISION");
  });
});

test("links, junctions, hard links, and linked Authority exceptions are rejected", async (t) => {
  await t.test("hard-linked payload", async (t) => {
    const root = await temporaryCandidate(t, "codeclaw-candidate-hardlink-");
    const first = path.join(root, "first.txt");
    await fs.writeFile(first, "shared\n", "utf8");
    try {
      await fs.link(first, path.join(root, "second.txt"));
    } catch (error) {
      return t.skip(`Hard links are unavailable (${error.code}).`);
    }
    await rejectsCode(() => writeCandidateAuthority(root, METADATA), "CANDIDATE_ENTRY_UNSAFE");
  });

  await t.test("symbolic link or junction payload", async (t) => {
    const root = await temporaryCandidate(t, "codeclaw-candidate-link-");
    const outside = await temporaryCandidate(t, "codeclaw-candidate-link-target-");
    await fs.writeFile(path.join(outside, "outside.txt"), "outside\n", "utf8");
    try {
      await fs.symlink(outside, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      return t.skip(`Directory links are unavailable (${error.code}).`);
    }
    await rejectsCode(() => writeCandidateAuthority(root, METADATA), "CANDIDATE_ENTRY_UNSAFE");
  });

  await t.test("linked sidecar exception", async (t) => {
    const { root } = await basicCandidate(t, "linked-sidecar");
    const sidecar = path.join(root, CANDIDATE_AUTHORITY_SHA256_FILENAME);
    const outside = path.join(await temporaryCandidate(t, "codeclaw-sidecar-target-"), "outside.txt");
    await fs.writeFile(outside, "outside\n", "utf8");
    await fs.rm(sidecar);
    try {
      await fs.symlink(outside, sidecar, "file");
    } catch (error) {
      return t.skip(`File links are unavailable (${error.code}).`);
    }
    await rejectsCode(() => verifyCandidateIntegrity(root), "CANDIDATE_ENTRY_UNSAFE");
  });

  await t.test("hard-linked Authority exception", async (t) => {
    const { root } = await basicCandidate(t, "hardlinked-authority");
    const authorityPath = path.join(root, CANDIDATE_AUTHORITY_FILENAME);
    const secondLink = path.join(root, "authority-second-link.json");
    try {
      await fs.link(authorityPath, secondLink);
    } catch (error) {
      return t.skip(`Hard links are unavailable (${error.code}).`);
    }
    await rejectsCode(() => verifyCandidateIntegrity(root), "CANDIDATE_ENTRY_UNSAFE");
  });

  await t.test("linked candidate root", async (t) => {
    const base = await temporaryCandidate(t, "codeclaw-candidate-root-link-");
    const target = path.join(base, "target");
    const linkedRoot = path.join(base, "linked-root");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "app.txt"), "app\n", "utf8");
    try {
      await fs.symlink(target, linkedRoot, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      return t.skip(`Root links are unavailable (${error.code}).`);
    }
    await rejectsCode(() => writeCandidateAuthority(linkedRoot, METADATA), "CANDIDATE_ROOT_UNSAFE");
  });

  await t.test("special filesystem object where supported", async (t) => {
    if (process.platform === "win32") return t.skip("Unix-domain socket filesystem entries are unavailable on Windows.");
    const root = await temporaryCandidate(t, "codeclaw-candidate-special-");
    const socketPath = path.join(root, "special.sock");
    const server = net.createServer();
    t.after(() => new Promise((resolve) => server.close(resolve)));
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    await rejectsCode(() => writeCandidateAuthority(root, METADATA), "CANDIDATE_ENTRY_UNSAFE");
  });
});

test("directory, depth, file, entry, per-file, and aggregate-byte hard budgets fail closed", async (t) => {
  const cases = [
    {
      name: "files",
      options: { maxFiles: 1 },
      prepare: async (root) => {
        await fs.writeFile(path.join(root, "one.txt"), "1", "utf8");
        await fs.writeFile(path.join(root, "two.txt"), "2", "utf8");
      },
      resource: "files"
    },
    {
      name: "entries",
      options: { maxEntries: 1 },
      prepare: async (root) => {
        await fs.writeFile(path.join(root, "one.txt"), "1", "utf8");
        await fs.writeFile(path.join(root, "two.txt"), "2", "utf8");
      },
      resource: "entries"
    },
    {
      name: "directories",
      options: { maxDirectories: 1 },
      prepare: (root) => fs.mkdir(path.join(root, "nested")),
      resource: "directories"
    },
    {
      name: "depth",
      options: { maxDepth: 0 },
      prepare: (root) => fs.writeFile(path.join(root, "file.txt"), "1", "utf8"),
      resource: "depth"
    },
    {
      name: "file bytes",
      options: { maxFileBytes: 3 },
      prepare: (root) => fs.writeFile(path.join(root, "file.txt"), "1234", "utf8"),
      resource: "file-bytes"
    },
    {
      name: "total bytes",
      options: { maxTotalBytes: 5 },
      prepare: async (root) => {
        await fs.writeFile(path.join(root, "one.txt"), "123", "utf8");
        await fs.writeFile(path.join(root, "two.txt"), "456", "utf8");
      },
      resource: "total-bytes"
    }
  ];

  for (const item of cases) {
    await t.test(item.name, async (t) => {
      const root = await temporaryCandidate(t, `codeclaw-candidate-budget-${item.resource}-`);
      await item.prepare(root);
      await assert.rejects(
        () => writeCandidateAuthority(root, METADATA, item.options),
        (error) => error.code === "CANDIDATE_BUDGET_EXCEEDED" && error.status === 413 && error.budget?.resource === item.resource
      );
    });
  }
});

test("a file that grows after stat cannot read past the streaming hash budget", async (t) => {
  const root = await temporaryCandidate(t, "codeclaw-candidate-growth-");
  const target = path.join(root, "growing.bin");
  await fs.writeFile(target, Buffer.alloc(4, 1));
  const originalOpen = fs.open;
  let grew = false;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (path.resolve(args[0]) !== path.resolve(target) || args[1] !== "r") return handle;
    return {
      stat: handle.stat.bind(handle),
      close: handle.close.bind(handle),
      read: async (...readArgs) => {
        if (!grew) {
          grew = true;
          await fs.appendFile(target, Buffer.alloc(16, 2));
        }
        return handle.read(...readArgs);
      }
    };
  };
  try {
    await assert.rejects(
      () => writeCandidateAuthority(root, METADATA, { maxFileBytes: 8 }),
      (error) => error.code === "CANDIDATE_BUDGET_EXCEEDED" && error.budget?.resource === "file-bytes" && error.budget.observed === 9
    );
  } finally {
    fs.open = originalOpen;
  }
});

async function basicCandidate(t, label) {
  const root = await temporaryCandidate(t, `codeclaw-candidate-${label}-`);
  const target = path.join(root, "app.txt");
  await fs.writeFile(target, "candidate-content\n", "utf8");
  await writeCandidateAuthority(root, METADATA);
  return { root, target };
}

async function temporaryCandidate(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return root;
}

async function readAuthority(root) {
  return JSON.parse(await fs.readFile(path.join(root, CANDIDATE_AUTHORITY_FILENAME), "utf8"));
}

async function replaceAuthority(root, text) {
  const content = Buffer.from(text, "utf8");
  await fs.writeFile(path.join(root, CANDIDATE_AUTHORITY_FILENAME), content);
  await fs.writeFile(
    path.join(root, CANDIDATE_AUTHORITY_SHA256_FILENAME),
    `${digest(content)}  ${CANDIDATE_AUTHORITY_FILENAME}\n`,
    "utf8"
  );
}

async function rejectsCode(operation, code) {
  await assert.rejects(operation, (error) => error.code === code);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
