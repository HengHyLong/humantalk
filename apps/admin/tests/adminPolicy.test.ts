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

test("lead and system permissions follow the planned role matrix", () => {
  assert.equal(canAccess("sys_admin", "lead:view_sensitive"), true);
  assert.equal(canAccess("content_ops", "lead:feedback"), true);
  assert.equal(canAccess("data_viewer", "lead:export"), true);
  assert.equal(canAccess("data_viewer", "lead:view_sensitive"), false);
  assert.equal(canAccess("security_audit", "audit:trace"), true);
  assert.equal(canAccess("security_audit", "system:ops"), false);
  assert.equal(canUseButton("readonly", "lead:write"), false);
  assert.equal(canUseButton("sys_admin", "ops:failover"), true);
});
