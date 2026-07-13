import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildDataBoundaryManifest,
  copyManifestPayload,
  manifestsHaveSamePayload,
  manifestsHaveSameSource,
  readManifestFiles
} from "../packages/data-boundary/src/index.js";

test("data-boundary inventory is complete beyond the repository scanner's 800-file display limit", async (t) => {
  const root = await temporaryDirectory(t, "codeclaw-boundary-many-");
  await fs.mkdir(path.join(root, "src"));
  const writes = [];
  for (let index = 0; index < 805; index += 1) {
    writes.push(fs.writeFile(path.join(root, "src", `file-${String(index).padStart(4, "0")}.txt`), `${index}\n`, "utf8"));
  }
  await Promise.all(writes);

  const manifest = await buildDataBoundaryManifest(root);
  assert.equal(manifest.eligible, true);
  assert.equal(manifest.fileCount, 805);
  assert.equal(manifest.files.at(-1).path, "src/file-0804.txt");
});

test("data-boundary policy records exclusions and blocks secrets instead of silently copying them", async (t) => {
  const root = await temporaryDirectory(t, "codeclaw-boundary-policy-");
  await fs.mkdir(path.join(root, "nested"));
  await fs.mkdir(path.join(root, "node_modules"));
  await fs.mkdir(path.join(root, ".ssh"));
  await fs.mkdir(path.join(root, ".AWS"));
  await fs.writeFile(path.join(root, ".gitignore"), "ignored.txt\nnested/*.tmp\n!nested/keep.tmp\n", "utf8");
  await fs.writeFile(path.join(root, "source.js"), "export const ok = true;\n", "utf8");
  await fs.writeFile(path.join(root, "ignored.txt"), "ignored\n", "utf8");
  await fs.writeFile(path.join(root, "nested", "drop.tmp"), "drop\n", "utf8");
  await fs.writeFile(path.join(root, "nested", "keep.tmp"), "keep\n", "utf8");
  await fs.writeFile(path.join(root, "node_modules", "dependency.js"), "generated\n", "utf8");
  await fs.writeFile(path.join(root, ".env"), "API_KEY=not-copied\n", "utf8");
  await fs.writeFile(path.join(root, ".npmrc"), "//registry.invalid/:_authToken=not-copied\n", "utf8");
  await fs.writeFile(path.join(root, "credentials.json"), "{}\n", "utf8");
  await fs.writeFile(path.join(root, "private.key"), "not-a-real-private-key\n", "utf8");
  await fs.writeFile(path.join(root, "id_ed25519"), "not-a-real-private-key\n", "utf8");
  await fs.writeFile(path.join(root, ".ssh", "config"), "Host private\n", "utf8");
  await fs.writeFile(path.join(root, ".AWS", "credentials"), "not-real\n", "utf8");

  const manifest = await buildDataBoundaryManifest(root);
  assert.equal(manifest.eligible, false);
  assert.ok(manifest.blockers.some((item) => item.path === ".env" && item.reason === "sensitive-file"));
  for (const relative of [".npmrc", "credentials.json", "private.key", "id_ed25519"]) {
    assert.ok(manifest.blockers.some((item) => item.path === relative && item.reason === "sensitive-file"), relative);
  }
  assert.ok(manifest.blockers.some((item) => item.path === ".ssh" && item.reason === "sensitive-directory"));
  assert.ok(manifest.blockers.some((item) => item.path === ".AWS" && item.reason === "sensitive-directory"));
  assert.ok(manifest.excluded.some((item) => item.path === "ignored.txt" && item.reason === "gitignore"));
  assert.ok(manifest.excluded.some((item) => item.path === "nested/drop.tmp" && item.reason === "gitignore"));
  assert.ok(manifest.excluded.some((item) => item.path === "node_modules" && item.reason === "generated-directory"));
  assert.ok(manifest.files.some((item) => item.path === "nested/keep.tmp"));
  assert.ok(!manifest.files.some((item) => item.path === ".env"));
});

test("ordinary source names containing token or secret remain copyable", async (t) => {
  const base = await temporaryDirectory(t, "codeclaw-boundary-source-names-");
  const source = path.join(base, "source");
  const target = path.join(base, "target");
  await fs.mkdir(source);
  await fs.mkdir(target);
  const ordinaryFiles = ["token.js", "tokenizer.js", "secretary.js"];
  for (const name of ordinaryFiles) {
    await fs.writeFile(path.join(source, name), `export const fileName = ${JSON.stringify(name)};\n`, "utf8");
  }

  const manifest = await buildDataBoundaryManifest(source);
  assert.equal(manifest.eligible, true);
  assert.deepEqual(manifest.files.map((item) => item.path), ordinaryFiles.sort());
  await copyManifestPayload(source, target, manifest);
  for (const name of ordinaryFiles) {
    assert.equal(await fs.readFile(path.join(target, name), "utf8"), `export const fileName = ${JSON.stringify(name)};\n`);
  }
});

test("manifest file reads preserve UTF-8 BOM and report exact Chinese and emoji bytes", async (t) => {
  const root = await temporaryDirectory(t, "codeclaw-boundary-read-utf8-");
  const content = "\uFEFF中文模型🙂\n";
  await fs.writeFile(path.join(root, "context.txt"), content, "utf8");
  const manifest = await buildDataBoundaryManifest(root);
  const manifestFile = manifest.files.find((item) => item.path === "context.txt");

  const [read] = await readManifestFiles(root, manifest, ["context.txt"]);

  assert.equal(read.path, "context.txt");
  assert.equal(read.content, content);
  assert.equal(read.byteLength, Buffer.byteLength(content, "utf8"));
  assert.equal(read.sha256, manifestFile.sha256);
  assert.ok(read.byteLength > read.content.length);
});

test("manifest file reads reject invalid UTF-8", async (t) => {
  const root = await temporaryDirectory(t, "codeclaw-boundary-read-invalid-utf8-");
  await fs.writeFile(path.join(root, "binary.bin"), Buffer.from([0xff, 0xfe, 0xfd]));
  const manifest = await buildDataBoundaryManifest(root);

  await assert.rejects(
    () => readManifestFiles(root, manifest, ["binary.bin"]),
    (error) => error.code === "DATA_BOUNDARY_TEXT_UNREADABLE"
  );
});

test("manifest file reads refuse duplicate, unsafe, excluded, sensitive, generated, and marker paths", async (t) => {
  const root = await temporaryDirectory(t, "codeclaw-boundary-read-refused-");
  await fs.mkdir(path.join(root, "node_modules"));
  await fs.writeFile(path.join(root, ".gitignore"), "ignored.txt\n", "utf8");
  await fs.writeFile(path.join(root, "source.js"), "export const safe = true;\n", "utf8");
  await fs.writeFile(path.join(root, "ignored.txt"), "ignored\n", "utf8");
  await fs.writeFile(path.join(root, ".env"), "TOKEN=not-disclosed\n", "utf8");
  await fs.writeFile(path.join(root, "node_modules", "dependency.js"), "generated\n", "utf8");
  await fs.writeFile(path.join(root, ".codeclaw-disposable-copy.json"), "{}\n", "utf8");
  const manifest = await buildDataBoundaryManifest(root, { allowDisposableMarker: true });

  assert.equal((await readManifestFiles(root, manifest, ["source.js"]))[0].content, "export const safe = true;\n");
  for (const refused of [
    "ignored.txt",
    ".env",
    "node_modules/dependency.js",
    ".codeclaw-disposable-copy.json",
    "../source.js",
    "./source.js",
    "folder/../source.js",
    path.resolve(root, "source.js")
  ]) {
    await assert.rejects(
      () => readManifestFiles(root, manifest, [refused]),
      (error) => error.code === "DATA_BOUNDARY_READ_PATH_REFUSED",
      refused
    );
  }
  await assert.rejects(
    () => readManifestFiles(root, manifest, ["source.js", "source.js"]),
    (error) => error.code === "DATA_BOUNDARY_READ_PATH_DUPLICATE"
  );
});

test("manifest file reads enforce per-file and aggregate byte limits before disclosure", async (t) => {
  const root = await temporaryDirectory(t, "codeclaw-boundary-read-limits-");
  await fs.writeFile(path.join(root, "first.txt"), "12345", "utf8");
  await fs.writeFile(path.join(root, "second.txt"), "6789", "utf8");
  const manifest = await buildDataBoundaryManifest(root);

  await assert.rejects(
    () => readManifestFiles(root, manifest, ["first.txt"], { maxFileBytes: 4, maxTotalBytes: 20 }),
    (error) => error.code === "DATA_BOUNDARY_READ_FILE_LIMIT" && error.status === 413
  );
  await assert.rejects(
    () => readManifestFiles(root, manifest, ["first.txt", "second.txt"], { maxFileBytes: 5, maxTotalBytes: 8 }),
    (error) => error.code === "DATA_BOUNDARY_READ_TOTAL_LIMIT" && error.status === 413
  );
  const reads = await readManifestFiles(root, manifest, ["first.txt", "second.txt"], { maxFileBytes: 5, maxTotalBytes: 9 });
  assert.deepEqual(reads.map((item) => item.byteLength), [5, 4]);
  await assert.rejects(
    () => readManifestFiles(root, manifest, ["first.txt"], { maxFileBytes: -1 }),
    (error) => error.code === "DATA_BOUNDARY_READ_LIMIT_INVALID" && error.status === 400
  );
});

test("data-boundary exclusions honor root double-star, escaped markers, classes, and nested rules", async (t) => {
  const root = await temporaryDirectory(t, "codeclaw-boundary-ignore-semantics-");
  await fs.mkdir(path.join(root, "nested"));
  await fs.writeFile(path.join(root, ".gitignore"), [
    "**/private.json",
    String.raw`\#notes.txt`,
    String.raw`\!important.txt`,
    "[ab].txt"
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(root, "nested", ".gitignore"), "*.tmp\n!keep.tmp\n", "utf8");
  for (const relative of ["private.json", "#notes.txt", "!important.txt", "a.txt", "nested/drop.tmp", "nested/keep.tmp"]) {
    await fs.writeFile(path.join(root, ...relative.split("/")), `${relative}\n`, "utf8");
  }

  const manifest = await buildDataBoundaryManifest(root);
  for (const relative of ["private.json", "#notes.txt", "!important.txt", "a.txt", "nested/drop.tmp"]) {
    assert.ok(manifest.excluded.some((item) => item.path === relative && item.reason === "gitignore"), relative);
    assert.ok(!manifest.files.some((item) => item.path === relative), relative);
  }
  assert.ok(manifest.files.some((item) => item.path === "nested/keep.tmp"));
});

test("source Manifest changes when an entry is replaced with identical bytes", async (t) => {
  const root = await temporaryDirectory(t, "codeclaw-boundary-replace-");
  const target = path.join(root, "same.txt");
  await fs.writeFile(target, "same bytes\n", "utf8");
  const before = await buildDataBoundaryManifest(root);
  await fs.unlink(target);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await fs.writeFile(target, "same bytes\n", "utf8");
  const after = await buildDataBoundaryManifest(root);

  assert.equal(before.payloadDigest, after.payloadDigest);
  assert.equal(manifestsHaveSamePayload(before, after), true);
  assert.equal(manifestsHaveSameSource(before, after), false);
});

test("manifest file reads reject same-byte file and parent-directory replacements", async (t) => {
  const fileRoot = await temporaryDirectory(t, "codeclaw-boundary-read-file-replace-");
  const filePath = path.join(fileRoot, "same.txt");
  await fs.writeFile(filePath, "same bytes\n", "utf8");
  const fileManifest = await buildDataBoundaryManifest(fileRoot);
  await fs.unlink(filePath);
  await fs.writeFile(filePath, "same bytes\n", "utf8");
  await assert.rejects(
    () => readManifestFiles(fileRoot, fileManifest, ["same.txt"]),
    (error) => error.code === "DATA_BOUNDARY_SOURCE_CHANGED"
  );

  const parentRoot = await temporaryDirectory(t, "codeclaw-boundary-read-parent-replace-");
  const sourceDirectory = path.join(parentRoot, "src");
  await fs.mkdir(sourceDirectory);
  await fs.writeFile(path.join(sourceDirectory, "same.txt"), "same bytes\n", "utf8");
  const parentManifest = await buildDataBoundaryManifest(parentRoot);
  await fs.rename(sourceDirectory, path.join(parentRoot, "src-old"));
  await fs.mkdir(sourceDirectory);
  await fs.writeFile(path.join(sourceDirectory, "same.txt"), "same bytes\n", "utf8");
  await assert.rejects(
    () => readManifestFiles(parentRoot, parentManifest, ["src/same.txt"]),
    (error) => error.code === "DATA_BOUNDARY_PATH_CHANGED"
  );
});

test("manifest file reads detect mutation after the stable handle starts reading", async (t) => {
  const root = await temporaryDirectory(t, "codeclaw-boundary-read-during-change-");
  const target = path.join(root, "changing.txt");
  await fs.writeFile(target, "original bytes\n", "utf8");
  const manifest = await buildDataBoundaryManifest(root);
  const originalOpen = fs.open;
  let injected = false;

  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (path.resolve(args[0]) !== path.resolve(target) || args[1] !== "r") return handle;
    return {
      stat: handle.stat.bind(handle),
      close: handle.close.bind(handle),
      read: async (...readArgs) => {
        const result = await handle.read(...readArgs);
        if (!injected) {
          injected = true;
          await fs.writeFile(target, "mutated bytes with a different length\n", "utf8");
        }
        return result;
      }
    };
  };
  try {
    await assert.rejects(
      () => readManifestFiles(root, manifest, ["changing.txt"]),
      (error) => error.code === "DATA_BOUNDARY_SOURCE_CHANGED"
    );
    assert.equal(injected, true);
  } finally {
    fs.open = originalOpen;
  }
});

test("copy payload streams all files and the target Manifest matches exactly", async (t) => {
  const base = await temporaryDirectory(t, "codeclaw-boundary-copy-");
  const source = path.join(base, "source");
  const target = path.join(base, "target");
  await fs.mkdir(path.join(source, "empty"), { recursive: true });
  await fs.mkdir(target);
  await fs.writeFile(path.join(source, "binary.bin"), Buffer.from([0, 1, 2, 3, 255]));
  await fs.writeFile(path.join(source, "readme.md"), "# Source\n", "utf8");
  const sourceManifest = await buildDataBoundaryManifest(source);

  await copyManifestPayload(source, target, sourceManifest);
  const targetManifest = await buildDataBoundaryManifest(target);

  assert.equal(manifestsHaveSamePayload(sourceManifest, targetManifest), true);
  assert.deepEqual(await fs.readFile(path.join(target, "binary.bin")), Buffer.from([0, 1, 2, 3, 255]));
});

test("links and portable path collisions fail closed", async (t) => {
  const base = await temporaryDirectory(t, "codeclaw-boundary-links-");
  const external = path.join(base, "external.txt");
  const root = path.join(base, "root");
  await fs.mkdir(root);
  await fs.writeFile(external, "outside\n", "utf8");
  try {
    await fs.symlink(external, path.join(root, "link.txt"), "file");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) return t.skip("Symbolic links are unavailable in this environment.");
    throw error;
  }
  const linked = await buildDataBoundaryManifest(root);
  assert.ok(linked.blockers.some((item) => item.reason === "symbolic-link"));

  if (process.platform !== "win32") {
    await fs.unlink(path.join(root, "link.txt"));
    await fs.writeFile(path.join(root, "Name.txt"), "one\n", "utf8");
    await fs.writeFile(path.join(root, "name.txt"), "two\n", "utf8");
    const collided = await buildDataBoundaryManifest(root);
    assert.ok(collided.blockers.some((item) => item.reason === "portable-path-collision"));
  }
});

test("a linked source root is rejected before realpath can hide it", async (t) => {
  const base = await temporaryDirectory(t, "codeclaw-boundary-root-link-");
  const source = path.join(base, "source");
  const link = path.join(base, "linked-source");
  await fs.mkdir(source);
  try {
    await fs.symlink(source, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) return t.skip("Directory links are unavailable in this environment.");
    throw error;
  }
  await assert.rejects(() => buildDataBoundaryManifest(link), (error) => error.code === "DATA_BOUNDARY_ROOT_UNSAFE");
});

test("hard-linked source files block the whole copy boundary", async (t) => {
  const root = await temporaryDirectory(t, "codeclaw-boundary-hardlink-");
  const first = path.join(root, "first.txt");
  await fs.writeFile(first, "shared entity\n", "utf8");
  try {
    await fs.link(first, path.join(root, "second.txt"));
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS", "EXDEV"].includes(error.code)) return t.skip("Hard links are unavailable in this environment.");
    throw error;
  }
  const manifest = await buildDataBoundaryManifest(root);
  assert.equal(manifest.eligible, false);
  assert.equal(manifest.blockers.filter((item) => item.reason === "hard-link").length, 2);
});

test("data-boundary manifests expose complete runtime-budget evidence", async (t) => {
  const root = await temporaryDirectory(t, "codeclaw-boundary-evidence-");
  await fs.writeFile(path.join(root, "source.txt"), "safe\n", "utf8");

  const manifest = await buildDataBoundaryManifest(root);

  assert.equal(manifest.truncated, false);
  assert.deepEqual(manifest.truncationReasons, []);
  assert.equal(manifest.budget.operation, "data-boundary-manifest");
  assert.equal(manifest.budget.truncated, false);
  assert.deepEqual(manifest.budget.reasons, []);
  assert.equal(manifest.budget.used.entriesVisited, 1);
  assert.equal(manifest.budget.used.filesCollected, 1);
});

test("data-boundary traversal and evidence collections fail closed at hard budgets", async (t) => {
  const bytesRoot = await temporaryDirectory(t, "codeclaw-boundary-byte-budget-");
  const oversizedFile = path.join(bytesRoot, "oversized.bin");
  await fs.writeFile(oversizedFile, Buffer.alloc(32, 1));
  const originalOpen = fs.open;
  let oversizedFileOpened = false;
  fs.open = async (...args) => {
    if (path.resolve(args[0]) === path.resolve(oversizedFile) && args[1] === "r") oversizedFileOpened = true;
    return originalOpen(...args);
  };
  try {
    await assert.rejects(
      () => buildDataBoundaryManifest(bytesRoot, { maxBytes: 8 }),
      budgetFailure("DATA_BOUNDARY_BYTE_LIMIT", "max-total-bytes")
    );
  } finally {
    fs.open = originalOpen;
  }
  assert.equal(oversizedFileOpened, false, "a stat-known oversized file must be rejected before hashing I/O");

  const entriesRoot = await temporaryDirectory(t, "codeclaw-boundary-entry-budget-");
  await fs.writeFile(path.join(entriesRoot, "one.txt"), "1", "utf8");
  await fs.writeFile(path.join(entriesRoot, "two.txt"), "2", "utf8");
  await assert.rejects(
    () => buildDataBoundaryManifest(entriesRoot, { maxEntries: 1 }),
    budgetFailure("DATA_BOUNDARY_ENTRY_LIMIT", "max-entries")
  );

  const directoryRoot = await temporaryDirectory(t, "codeclaw-boundary-directory-budget-");
  await fs.mkdir(path.join(directoryRoot, "one"));
  await assert.rejects(
    () => buildDataBoundaryManifest(directoryRoot, { maxDirectories: 1 }),
    budgetFailure("DATA_BOUNDARY_DIRECTORY_LIMIT", "max-directories")
  );

  const depthRoot = await temporaryDirectory(t, "codeclaw-boundary-depth-budget-");
  await fs.mkdir(path.join(depthRoot, "one", "two"), { recursive: true });
  await assert.rejects(
    () => buildDataBoundaryManifest(depthRoot, { maxDepth: 1 }),
    budgetFailure("DATA_BOUNDARY_DEPTH_LIMIT", "max-depth")
  );

  const excludedRoot = await temporaryDirectory(t, "codeclaw-boundary-excluded-budget-");
  await fs.writeFile(path.join(excludedRoot, ".gitignore"), "one.txt\ntwo.txt\n", "utf8");
  await fs.writeFile(path.join(excludedRoot, "one.txt"), "1", "utf8");
  await fs.writeFile(path.join(excludedRoot, "two.txt"), "2", "utf8");
  await assert.rejects(
    () => buildDataBoundaryManifest(excludedRoot, { maxExcludedItems: 1 }),
    budgetFailure("DATA_BOUNDARY_EXCLUDED_LIMIT", "max-excluded-items")
  );

  const blockerRoot = await temporaryDirectory(t, "codeclaw-boundary-blocker-budget-");
  await fs.writeFile(path.join(blockerRoot, ".env"), "SECRET=1\n", "utf8");
  await fs.writeFile(path.join(blockerRoot, ".npmrc"), "token=1\n", "utf8");
  await assert.rejects(
    () => buildDataBoundaryManifest(blockerRoot, { maxBlockerItems: 1 }),
    budgetFailure("DATA_BOUNDARY_BLOCKER_LIMIT", "max-blocker-items")
  );
});

test("data-boundary applies bounded strict .gitignore processing", async (t) => {
  const bytesRoot = await temporaryDirectory(t, "codeclaw-boundary-ignore-bytes-");
  await fs.writeFile(path.join(bytesRoot, ".gitignore"), "oversized-pattern\n", "utf8");
  await assert.rejects(
    () => buildDataBoundaryManifest(bytesRoot, { maxIgnoreFileBytes: 4 }),
    budgetFailure("DATA_BOUNDARY_IGNORE_BUDGET_EXCEEDED", "gitignore-file-bytes")
  );

  const rulesRoot = await temporaryDirectory(t, "codeclaw-boundary-ignore-rules-");
  await fs.writeFile(path.join(rulesRoot, ".gitignore"), "one.txt\ntwo.txt\n", "utf8");
  await assert.rejects(
    () => buildDataBoundaryManifest(rulesRoot, { maxIgnoreRules: 1 }),
    budgetFailure("DATA_BOUNDARY_IGNORE_BUDGET_EXCEEDED", "gitignore-rules")
  );

  const matchRoot = await temporaryDirectory(t, "codeclaw-boundary-ignore-match-");
  await fs.writeFile(path.join(matchRoot, ".gitignore"), `${"*a".repeat(20)}b\n`, "utf8");
  await fs.writeFile(path.join(matchRoot, `${"a".repeat(100)}.txt`), "safe\n", "utf8");
  await assert.rejects(
    () => buildDataBoundaryManifest(matchRoot, { maxIgnoreMatchSteps: 100 }),
    budgetFailure("DATA_BOUNDARY_IGNORE_BUDGET_EXCEEDED", "gitignore-match-steps")
  );
});

test("data-boundary cancellation during hashing never returns a partial manifest", async (t) => {
  const root = await temporaryDirectory(t, "codeclaw-boundary-cancel-hash-");
  const target = path.join(root, "source.bin");
  await fs.writeFile(target, Buffer.alloc(1024, 1));
  const controller = new AbortController();
  const cancellation = Object.assign(new Error("cancelled during hash"), { code: "OPERATION_CANCELLED", status: 409 });
  const originalOpen = fs.open;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (path.resolve(args[0]) !== path.resolve(target) || args[1] !== "r") return handle;
    return {
      stat: handle.stat.bind(handle),
      close: handle.close.bind(handle),
      read: async (...readArgs) => {
        const result = await handle.read(...readArgs);
        controller.abort(cancellation);
        return result;
      }
    };
  };
  try {
    await assert.rejects(
      () => buildDataBoundaryManifest(root, { signal: controller.signal }),
      (error) => error === cancellation
    );
  } finally {
    fs.open = originalOpen;
  }
});

test("data-boundary hashing stops at remaining plus one byte when a file grows after stat", async (t) => {
  const root = await temporaryDirectory(t, "codeclaw-boundary-grow-hash-");
  const target = path.join(root, "source.bin");
  await fs.writeFile(target, Buffer.alloc(4, 1));
  const originalOpen = fs.open;
  const requestedReadLengths = [];
  let grew = false;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (path.resolve(args[0]) !== path.resolve(target) || args[1] !== "r") return handle;
    return {
      stat: handle.stat.bind(handle),
      close: handle.close.bind(handle),
      read: async (buffer, offset, length, position) => {
        requestedReadLengths.push(length);
        const result = await handle.read(buffer, offset, length, position);
        if (!grew && result.bytesRead) {
          grew = true;
          await fs.appendFile(target, Buffer.alloc(8, 2));
        }
        return result;
      }
    };
  };
  try {
    await assert.rejects(
      () => buildDataBoundaryManifest(root, { maxBytes: 4 }),
      budgetFailure("DATA_BOUNDARY_BYTE_LIMIT", "max-total-bytes")
    );
  } finally {
    fs.open = originalOpen;
  }
  assert.deepEqual(requestedReadLengths, [5, 1]);
});

function budgetFailure(code, reason) {
  return (error) => error.code === code
    && error.status === 413
    && error.runtimeBudget?.reason === reason
    && error.budget?.truncated === true
    && error.budget.reasons.includes(reason);
}

async function temporaryDirectory(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return root;
}
