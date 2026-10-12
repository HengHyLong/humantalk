import test from "node:test";
import assert from "node:assert/strict";
import { resolveNavigationImage } from "../src/lib/navigationImage";

const api = (path: string) => `https://example.test/api${path}`;

test("v2.6 route image arrays render through the authenticated API proxy", () => {
  assert.equal(resolveNavigationImage({ image_urls: ["/scene-assets/files/route/file"] }, api), "https://example.test/api/scene-assets/files/route/file");
});

test("legacy image_url and zoom source remain supported", () => {
  assert.equal(resolveNavigationImage({ image_url: "https://example.test/map.png" }, api), "https://example.test/map.png");
  assert.equal(resolveNavigationImage({ image_url: "/api/scene-assets/map.png" }, api), "/api/scene-assets/map.png");
});

test("empty legacy fields and array entries fall back to the first usable map", () => {
  assert.equal(resolveNavigationImage({ image_url: " ", image_urls: ["", " ", " /scene-assets/map.png "] }, api), "https://example.test/api/scene-assets/map.png");
  assert.equal(resolveNavigationImage({ image_url: "https://example.test/legacy.png", image_urls: ["https://example.test/new.png"] }, api), "https://example.test/legacy.png");
});

test("missing map keeps a text-only route", () => {
  assert.equal(resolveNavigationImage(null, api), "");
  assert.equal(resolveNavigationImage({ image_urls: [] }, api), "");
});
