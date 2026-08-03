import assert from "node:assert/strict";
import test from "node:test";

import { canAccess, canUseButton, ROLE_PERMISSIONS } from "../src/admin/policy";

test("admin roles expose the planned menu permissions", () => {
  assert.equal(canAccess("sys_admin", "system:user"), true);
  assert.equal(canAccess("content_ops", "asset:gif"), true);
  assert.equal(canAccess("data_viewer", "asset:gif"), false);
  assert.equal(canAccess("readonly", "knowledge:qa"), true);
  assert.ok(ROLE_PERMISSIONS.security_audit.includes("report:interaction"));
});

test("readonly users cannot use write buttons", () => {
  assert.equal(canUseButton("readonly", "event:exhibition:write"), false);
  assert.equal(canUseButton("content_ops", "event:exhibition:write"), true);
  assert.equal(canUseButton("readonly", "asset:gif:write"), false);
  assert.equal(canUseButton("content_ops", "asset:gif:write"), true);
  assert.equal(canUseButton("sys_admin", "knowledge:rollback"), true);
});
