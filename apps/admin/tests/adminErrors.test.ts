import test from "node:test";
import assert from "node:assert/strict";
import { AdminRequestError, toAdminRequestLabel, toLoginUiError, toSafeRequestError, toUiError } from "../src/admin/errors";

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

test("login errors never expose unauthenticated request or backend details", () => {
  const credentialError = toLoginUiError(new AdminRequestError(
    "username=admin password=secret database=postgres://internal",
    { status: 401, code: "INVALID_CREDENTIALS", requestId: "trace-login" },
  ));
  assert.equal(credentialError.message, "用户名或密码错误");
  assert.equal(credentialError.message.includes("admin"), false);
  assert.equal(credentialError.message.includes("secret"), false);
  assert.equal(credentialError.requestId, "trace-login");

  const serverError = toLoginUiError(new Error("POST http://10.0.0.8/auth/login failed"));
  assert.equal(serverError.message, "登录服务暂时不可用，请稍后重试");
  assert.equal(serverError.message.includes("10.0.0.8"), false);
});

test("admin request labels never expose paths, ids or query parameters", () => {
  const venueLabel = toAdminRequestLabel("/admin/event/venues?page=1&page_size=100", "GET");
  assert.equal(venueLabel, "读取场地数据");
  assert.equal(venueLabel.includes("page"), false);
  assert.equal(venueLabel.includes("venues"), false);

  const unknownLabel = toAdminRequestLabel("/admin/internal/secrets/record-123?token=secret", "PATCH");
  assert.equal(unknownLabel, "数据操作");
  assert.equal(unknownLabel.includes("secret"), false);
  assert.equal(unknownLabel.includes("record-123"), false);
});

test("authenticated admin forms show whitelisted FastAPI business errors", () => {
  const error = toSafeRequestError(400, {
    detail: {
      code: "WELCOME_SCRIPT_INVALID",
      detail: "internal raw detail must not be forwarded",
    },
  }, "trace-welcome");

  assert.equal(error.code, "WELCOME_SCRIPT_INVALID");
  assert.equal(error.message, "欢迎配置必须关联当前展会已启用的迎宾话术");
  assert.equal(error.message.includes("internal"), false);
  assert.equal(error.requestId, "trace-welcome");
});

test("script validation errors show safe actionable messages", () => {
  assert.equal(toSafeRequestError(422, { detail: { code: "EXHIBITION_REQUIRED" } }).message, "请选择有效的所属展会");
  assert.equal(toSafeRequestError(422, { detail: { code: "SCRIPT_CONTENT_REQUIRED" } }).message, "话术名称和内容不能为空");
  assert.equal(toSafeRequestError(422, { detail: { code: "SCRIPT_SCENE_INVALID" } }).message, "请选择有效的话术使用场景");
  assert.equal(toSafeRequestError(422, { detail: { code: "SCRIPT_STATUS_INVALID" } }).message, "请选择有效的话术状态");
});

test("unknown validation details remain masked", () => {
  const error = toSafeRequestError(400, {
    detail: {
      code: "UNKNOWN_VALIDATION",
      detail: "database=postgres://secret",
    },
  });
  assert.equal(error.message, "请检查输入内容后重试");
  assert.equal(error.message.includes("secret"), false);
});
