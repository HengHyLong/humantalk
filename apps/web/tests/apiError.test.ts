import assert from "node:assert/strict";
import test from "node:test";

import { toSafeApiMessage } from "../src/lib/apiError";

test("Vidu unavailable response keeps its safe action message", () => {
  assert.equal(
    toSafeApiMessage(503, {
      detail: {
        code: "VIDU_NOT_READY",
        message: "Vidu 数字人驱动尚未配置或服务不可用，请在管理后台完成配置后重试",
      },
    }),
    "Vidu 数字人驱动尚未配置或服务不可用，请在管理后台完成配置后重试",
  );
});

test("unknown server responses never expose raw internals", () => {
  assert.equal(
    toSafeApiMessage(500, { detail: "database password leaked in stack trace" }),
    "系统暂时不可用，请稍后重试",
  );
});

test("object errors are rendered as messages rather than JSON", () => {
  assert.equal(
    toSafeApiMessage(400, { detail: { code: "INVALID_INPUT", message: "图片格式不支持" } }),
    "图片格式不支持",
  );
});
