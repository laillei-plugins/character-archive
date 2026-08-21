import assert from "node:assert/strict";
import { test } from "node:test";

import {
  placeAnchoredPopover,
  placeTypeMenu,
} from "../src/ui/typeMenuPlacement.ts";

const rect = (
  left: number,
  top: number,
  width: number,
  height: number,
) => ({ left, top, width, height, right: left + width, bottom: top + height });

test("type menu opens below when the full menu fits", () => {
  assert.deepEqual(placeTypeMenu(rect(120, 100, 180, 44), rect(0, 0, 236, 180), 966, 834), {
    top: 148,
    left: 120,
    maxHeight: 180,
    side: "below",
  });
});

test("type menu flips above when it does not fit below", () => {
  assert.deepEqual(placeTypeMenu(rect(120, 620, 180, 44), rect(0, 0, 236, 180), 966, 700), {
    top: 436,
    left: 120,
    maxHeight: 180,
    side: "above",
  });
});

test("type menu uses the larger side and constrains height when neither fits", () => {
  assert.deepEqual(placeTypeMenu(rect(120, 260, 180, 44), rect(0, 0, 236, 420), 966, 600), {
    top: 308,
    left: 120,
    maxHeight: 284,
    side: "below",
  });
});

test("type menu clamps horizontally to the viewport inset", () => {
  assert.equal(
    placeTypeMenu(rect(900, 100, 58, 44), rect(0, 0, 236, 180), 966, 834).left,
    722,
  );
});

test("end-aligned popover keeps its full width inside a narrow viewport", () => {
  assert.equal(
    placeAnchoredPopover(
      rect(454, 100, 32, 32),
      rect(0, 0, 248, 448),
      520,
      760,
      { anchorGap: 6, align: "end" },
    ).left,
    238,
  );
});

test("start-aligned sibling popover clamps away from the viewport edge", () => {
  assert.equal(
    placeAnchoredPopover(
      rect(-20, 100, 40, 32),
      rect(0, 0, 248, 240),
      520,
      760,
      { anchorGap: 6 },
    ).left,
    8,
  );
});
