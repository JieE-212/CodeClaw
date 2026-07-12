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
          await fs.writeFile(target, "mutated bytes!\n", "utf8");
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

async function temporaryDirectory(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return root;
}
