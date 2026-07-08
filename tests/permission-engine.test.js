import test from "node:test";
import assert from "node:assert/strict";
import { classifyToolCall } from "../packages/permission-engine/src/index.js";

test("read tools do not require approval", () => {
  const permission = classifyToolCall("read_file", { path: "README.md" });
  assert.equal(permission.requiresApproval, false);
});

test("write tools require approval", () => {
  const permission = classifyToolCall("write_patch", { path: "src/index.ts" });
  assert.equal(permission.requiresApproval, true);
});
