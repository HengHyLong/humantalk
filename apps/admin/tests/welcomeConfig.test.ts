import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("../src/admin/InteractionManagementPages.tsx", import.meta.url)), "utf8");

test("welcome configuration only offers active scripts for the current exhibition", () => {
  assert.match(source, /script\.scene === "welcome"/);
  assert.match(source, /script\.status === "active"/);
  assert.match(source, /!script\.exhibitionId \|\| script\.exhibitionId === exhibitionId/);
  assert.match(source, /请选择当前展会已启用的迎宾话术模板/);
  assert.match(source, /availableWelcomeScripts\.map/);
});
