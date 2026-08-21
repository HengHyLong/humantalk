import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("../src/admin/EventOperationsPages.tsx", import.meta.url)), "utf8");
const pointPage = source.split("export function PointPage")[1]?.split("export function LegacyRoutePage")[0] ?? "";

test("point validation and save errors are rendered inside the editor modal", () => {
  assert.match(pointPage, /const \[formError, setFormError\] = useState\(""\)/);
  assert.match(pointPage, /setFormError\("请填写所属场地、点位编码和名称。"\)/);
  assert.match(pointPage, /error=\{formError\}/);
  assert.doesNotMatch(pointPage, /catch \(caught\) \{ setError\(caught instanceof Error \? caught\.message : "点位保存失败/);
});
