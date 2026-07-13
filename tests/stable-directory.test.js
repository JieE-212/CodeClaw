import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openStableDirectory } from "../packages/shared/src/stable-directory.js";

test("openStableDirectory rejects a persistent parent entity replacement", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-stable-directory-"));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const nested = path.join(root, "nested");
  const moved = path.join(root, "nested-original");
  await fs.mkdir(nested);
  await fs.writeFile(path.join(nested, "file.txt"), "inside\n", "utf8");

  const opened = await openStableDirectory(root, nested, "run a traversal test");
  for await (const _entry of opened.directory) {}
  await fs.rename(nested, moved);
  await fs.mkdir(nested);

  await assert.rejects(
    () => opened.verify(),
    (error) => error.code === "TRAVERSAL_PATH_CHANGED" && error.status === 409
  );
});
