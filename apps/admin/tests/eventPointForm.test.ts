import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("../src/admin/EventOperationsPages.tsx", import.meta.url)), "utf8");
const modalSource = readFileSync(fileURLToPath(new URL("../src/admin/CrudPages.tsx", import.meta.url)), "utf8");
const pointPage = source.split("export function PointPage")[1]?.split("export function LegacyRoutePage")[0] ?? "";

function pageSource(name: string, nextName?: string): string {
  const page = source.split(`export function ${name}`)[1] ?? "";
  return nextName ? page.split(`export function ${nextName}`)[0] ?? "" : page;
}

test("point validation and save errors are rendered inside the editor modal", () => {
  assert.match(pointPage, /const \[formError, setFormError\] = useState\(""\)/);
  assert.match(pointPage, /setFormError\("请填写所属场地、点位编码和名称。"\)/);
  assert.match(pointPage, /error=\{formError\}/);
  assert.doesNotMatch(pointPage, /catch \(caught\) \{ setError\(caught instanceof Error \? caught\.message : "点位保存失败/);
});

test("event operation save errors stay inside their editor modals", () => {
  const pages = [
    pageSource("VenuePage", "ExhibitorPage"),
    pageSource("ExhibitorPage", "ExhibitPage"),
    pageSource("ExhibitPage", "LegacyPointPage"),
    pageSource("RoutePage", "SchedulePage"),
    pageSource("SchedulePage", "BroadcastPage"),
    pageSource("BroadcastPage"),
  ];

  for (const page of pages) {
    assert.match(page, /const \[formError, setFormError\] = useState\(""\)/);
    assert.match(page, /error=\{formError\}/);
    assert.match(page, /catch \(caught\) \{ setFormError\(caught instanceof Error/);
  }
});

test("shared modal scrolls newly displayed errors into view", () => {
  assert.match(modalSource, /errorRef\.current\?\.scrollIntoView\(\{ block: "nearest", behavior: "smooth" \}\)/);
  assert.match(modalSource, /<p ref=\{errorRef\} tabIndex=\{-1\}[^>]+role="alert"/);
});
