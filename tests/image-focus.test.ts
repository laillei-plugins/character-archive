/**
 * Image focus: reading-only open, clamp at ends, reconcile by key.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  advanceFocus,
  focusArrowState,
  focusKeyAction,
  openFocus,
  reconcileFocus,
  shouldOpenImageFocus,
} from "../src/ui/imageFocus.ts";
import {
  imageFocusAfterStep,
  imageFocusTabTarget,
} from "../src/ui/searchDisclosure.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("reading thumb activation opens focus at the clicked candidate index", () => {
  assert.equal(shouldOpenImageFocus({ editMode: false, batchMode: false }), true);
  const opened = openFocus(["a", "b", "c"], "b");
  assert.deepEqual(opened, { keys: ["a", "b", "c"], index: 1 });
});

test("edit-mode thumb click sets cover and never opens focus", () => {
  assert.equal(shouldOpenImageFocus({ editMode: true, batchMode: false }), false);
  assert.equal(shouldOpenImageFocus({ editMode: false, batchMode: true }), false);
});

test("next at the last candidate clamps and stays open", () => {
  assert.equal(advanceFocus(4, 1, 5), 4);
});

test("prev at index zero clamps", () => {
  assert.equal(advanceFocus(0, -1, 5), 0);
});

test("single candidate renders no arrows", () => {
  assert.deepEqual(focusArrowState(0, 1), {
    show: false,
    prevDisabled: true,
    nextDisabled: true,
  });
  assert.equal(focusArrowState(1, 5).show, true);
});

test("endpoint aria-disabled mapping is stable", () => {
  assert.deepEqual(focusArrowState(0, 3), {
    show: true,
    prevDisabled: true,
    nextDisabled: false,
  });
  assert.deepEqual(focusArrowState(2, 3), {
    show: true,
    prevDisabled: false,
    nextDisabled: true,
  });
});

test("Tab and Shift+Tab cycle close, prev, next; single image keeps close", () => {
  assert.equal(imageFocusTabTarget("close", false, 3), "prev");
  assert.equal(imageFocusTabTarget("prev", false, 3), "next");
  assert.equal(imageFocusTabTarget("next", false, 3), "close");
  assert.equal(imageFocusTabTarget("close", true, 3), "next");
  assert.equal(imageFocusTabTarget("close", false, 1), "close");
  assert.equal(imageFocusTabTarget("close", true, 1), "close");
});

test("repaint preserves the activated arrow and hands disabled endpoints across", () => {
  assert.equal(imageFocusAfterStep("next", 1, 4), "next");
  assert.equal(imageFocusAfterStep("prev", 2, 4), "prev");
  assert.equal(imageFocusAfterStep("prev", 0, 4), "next");
  assert.equal(imageFocusAfterStep("next", 3, 4), "prev");
});

test("reconcile keeps the open image by coverRefKey after a note reorder", () => {
  assert.deepEqual(reconcileFocus("b", ["c", "b", "a"]), {
    kind: "keep",
    index: 1,
  });
});

test("Escape closes focus; arrows step; other keys pass", () => {
  assert.equal(focusKeyAction("Escape"), "close");
  assert.equal(focusKeyAction("ArrowLeft"), "prev");
  assert.equal(focusKeyAction("ArrowRight"), "next");
  assert.equal(focusKeyAction("Tab"), "none");
});

test("reconcile closes focus when the open image leaves the note", () => {
  assert.deepEqual(reconcileFocus("gone", ["a", "b"]), { kind: "close" });
});

test("GalleryView keeps the original opener through steps and wraps nav arrows", () => {
  const view = readFileSync(join(root, "src/views/GalleryView.ts"), "utf8");
  const focus = view.slice(
    view.indexOf("private openImageFocus"),
    view.indexOf("private renderImageStrip"),
  );
  assert.ok(
    (focus.match(/returnKey: state\.returnKey/g) ?? []).length >= 2,
    "step and reconcile both retain the original opener",
  );
  assert.match(
    focus,
    /const nav = overlay\.createDiv\(\{ cls: "charinfo-focus__nav" \}\);[\s\S]*?nav\.createEl\("button"/,
  );
  assert.match(
    focus,
    /const returnKey = this\.imageFocus\?\.returnKey[\s\S]*?charinfo-thumb\[data-id=/,
  );
});
