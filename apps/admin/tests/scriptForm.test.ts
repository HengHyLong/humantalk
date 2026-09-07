import assert from "node:assert/strict";
import test from "node:test";
import { resolveScriptExhibitionId } from "../src/admin/scriptForm.ts";

test("script form keeps a valid selected exhibition", () => {
  assert.equal(resolveScriptExhibitionId(["expo-1", "expo-2"], "expo-2", "expo-1"), "expo-2");
});

test("script form replaces a stale exhibition id with the current scope", () => {
  assert.equal(resolveScriptExhibitionId(["expo-1", "expo-2"], "deleted-expo", "expo-2"), "expo-2");
});

test("script form falls back to an existing exhibition", () => {
  assert.equal(resolveScriptExhibitionId(["expo-1"], undefined, ""), "expo-1");
  assert.equal(resolveScriptExhibitionId([], "deleted-expo", ""), "");
});
