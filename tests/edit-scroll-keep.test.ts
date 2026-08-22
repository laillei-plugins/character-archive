/**
 * Edit-mode scroll: pin the first visible card, not a raw pixel.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  captureEditScrollAnchor,
  restoreEditScrollTop,
} from "../src/ui/editScrollKeep.ts";

test("capture pins the first card whose bottom is still in the scrollport", () => {
  const anchor = captureEditScrollAnchor(100, 240, [
    { path: "A.md", top: 20, bottom: 90 },
    { path: "B.md", top: 80, bottom: 160 },
    { path: "C.md", top: 170, bottom: 250 },
  ]);
  assert.equal(anchor.path, "B.md");
  assert.equal(anchor.delta, -20);
  assert.equal(anchor.scrollTop, 240);
});

test("empty list falls back to numeric scroll only", () => {
  const anchor = captureEditScrollAnchor(0, 80, []);
  assert.deepEqual(anchor, { path: null, delta: 0, scrollTop: 80 });
});

test("restore keeps the card at the same offset from the scrollport top", () => {
  const next = restoreEditScrollTop({
    anchor: { path: "B.md", delta: 40, scrollTop: 240 },
    mainTop: 0,
    scrollHeight: 2000,
    clientHeight: 400,
    cardTop: 360,
  });
  assert.equal(next, 320);
});

test("cover-change enters edit through setEditMode, not a raw render", () => {
  const view = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/views/GalleryView.ts"),
    "utf8",
  );
  assert.match(view, /this\.setEditMode\(true\);\s*void this\.openCoverPicker/);
  assert.doesNotMatch(view, /this\.editMode = true;\s*this\.render\(\);/);
});

test("missing card uses the clamped numeric fallback", () => {
  const next = restoreEditScrollTop({
    anchor: { path: "gone.md", delta: 12, scrollTop: 900 },
    mainTop: 0,
    scrollHeight: 500,
    clientHeight: 400,
    cardTop: null,
  });
  assert.equal(next, 100);
});
