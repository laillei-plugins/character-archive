/**
 * Image focus: reading-only open, clamp at ends, reconcile by key.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  advanceFocus,
  focusArrowState,
  focusKeyAction,
  openFocus,
  reconcileFocus,
  shouldOpenImageFocus,
} from "../src/ui/imageFocus.ts";

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
