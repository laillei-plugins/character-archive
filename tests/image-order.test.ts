import assert from "node:assert/strict";
import { test } from "node:test";

import { moveImageKey } from "../src/data/imageOrder.ts";

test("moves the first key to last and the last key back to first", () => {
  const keys = ["a", "b", "c", "d"];
  assert.deepEqual(moveImageKey(keys, "a", "d", "after"), ["b", "c", "d", "a"]);
  assert.deepEqual(moveImageKey(keys, "d", "a", "before"), ["d", "a", "b", "c"]);
  assert.deepEqual(keys, ["a", "b", "c", "d"]);
});

test("adjacent before and after locate the anchor after the dragged key is removed", () => {
  const keys = ["a", "b", "c"];
  assert.deepEqual(moveImageKey(keys, "a", "b", "after"), ["b", "a", "c"]);
  assert.deepEqual(moveImageKey(keys, "b", "a", "before"), ["b", "a", "c"]);
  assert.deepEqual(moveImageKey(keys, "b", "c", "after"), ["a", "c", "b"]);
  assert.deepEqual(moveImageKey(keys, "c", "b", "before"), ["a", "c", "b"]);
  assert.deepEqual(keys, ["a", "b", "c"]);
});

test("missing keys and the same identity return an unchanged copy", () => {
  const keys = ["a", "b", "c"];
  const results = [
    moveImageKey(keys, "missing", "b", "before"),
    moveImageKey(keys, "a", "missing", "after"),
    moveImageKey(keys, "gone", "also-gone", "before"),
    moveImageKey(keys, "b", "b", "before"),
    moveImageKey(keys, "b", "b", "after"),
  ];
  for (const result of results) {
    assert.deepEqual(result, ["a", "b", "c"]);
    assert.notEqual(result, keys);
  }
  assert.deepEqual(keys, ["a", "b", "c"]);
});

test("duplicates and unrelated keys stay in their original order", () => {
  const keys = ["a", "b", "a", "c", "d"];
  const moved = moveImageKey(keys, "b", "d", "before");
  assert.deepEqual(moved, ["a", "a", "c", "b", "d"]);
  assert.notEqual(moved, keys);
  assert.deepEqual(keys, ["a", "b", "a", "c", "d"]);
  assert.deepEqual(moveImageKey([], "a", "b", "after"), []);
});
