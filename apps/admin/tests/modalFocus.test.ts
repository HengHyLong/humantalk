import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

test("editing a modal field does not rerun the focus-management effect", () => {
  const modalSource = source("../src/admin/CrudPages.tsx");

  assert.match(modalSource, /const onCloseRef = useRef\(onClose\)/);
  assert.match(modalSource, /const savingRef = useRef\(saving\)/);
  assert.match(modalSource, /if \(event\.key === "Escape" && !savingRef\.current\) onCloseRef\.current\(\)/);
  assert.doesNotMatch(modalSource, /\}, \[onClose, saving\]\);/);
});

test("typing in a confirmation dialog does not refocus its confirm button", () => {
  const dialogSource = source("../src/admin/ui.tsx");

  assert.match(dialogSource, /const onCloseRef = useRef\(onClose\)/);
  assert.match(dialogSource, /if \(event\.key === "Escape"\) onCloseRef\.current\(\)/);
  assert.doesNotMatch(dialogSource, /\}, \[onClose\]\);/);
});
