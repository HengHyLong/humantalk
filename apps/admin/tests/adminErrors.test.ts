import test from "node:test";
import assert from "node:assert/strict";
import { AdminRequestError, toUiError } from "../src/admin/errors";

test("maps backend statuses to safe UI messages", () => {
  assert.deepEqual(toUiError(new AdminRequestError("database password leaked", { status: 500, requestId: "trace-1" })), {
    code: "INTERNAL_ERROR",
    message: "系统暂时无法完成操作，请稍后重试",
    requestId: "trace-1",
    retryable: true,
  });
  assert.equal(toUiError(new AdminRequestError("raw backend detail", { status: 403 })).message, "当前账号没有权限执行此操作");
});

test("maps network failures without exposing the original exception", () => {
  const error = toUiError(new TypeError("fetch http://internal-service failed"));
  assert.equal(error.code, "NETWORK_ERROR");
  assert.equal(error.message, "无法连接服务，请检查网络后重试");
  assert.equal(error.message.includes("internal-service"), false);
});
