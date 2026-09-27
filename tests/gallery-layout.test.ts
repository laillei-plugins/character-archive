import assert from "node:assert/strict";
import { test } from "node:test";

import {
  galleryDetailLayout,
  sharedDetailLayout,
  type DetailLayout,
} from "../src/data/galleryLayout.ts";

const galleryAuto: Record<number, DetailLayout> = {
  280: { mode: "full", width: null, min: null, max: null, preferred: null },
  899: { mode: "full", width: null, min: null, max: null, preferred: null },
  900: { mode: "split", width: 320, min: 320, max: 405, preferred: null },
  960: { mode: "split", width: 326, min: 320, max: 432, preferred: null },
  1200: { mode: "split", width: 408, min: 320, max: 540, preferred: null },
  1600: { mode: "split", width: 480, min: 320, max: 560, preferred: null },
};

const sharedAuto: Record<number, DetailLayout> = {
  280: { mode: "full", width: null, min: null, max: null, preferred: null },
  899: { mode: "full", width: null, min: null, max: null, preferred: null },
  900: { mode: "full", width: null, min: null, max: null, preferred: null },
  960: { mode: "split", width: 380, min: 320, max: 432, preferred: null },
  1200: { mode: "split", width: 380, min: 320, max: 540, preferred: null },
  1600: { mode: "split", width: 380, min: 320, max: 560, preferred: null },
};

test("gallery and shared breakpoints are 280, 899, 900, 960, 1200, and 1600", () => {
  for (const width of [280, 899, 900, 960, 1200, 1600]) {
    assert.deepEqual(galleryDetailLayout(width), galleryAuto[width], `gallery ${width}`);
    assert.deepEqual(sharedDetailLayout(width), sharedAuto[width], `shared ${width}`);
    assert.deepEqual(galleryDetailLayout(width), galleryDetailLayout(width, null));
    assert.deepEqual(sharedDetailLayout(width), sharedDetailLayout(width, null));
  }
});

test("preference 560, 405, null, then 560 grows and shrinks without rewriting it", () => {
  const steps = [560, 405, null, 560] as const;
  assert.deepEqual(
    steps.map((preferred) => galleryDetailLayout(1600, preferred).width),
    [560, 405, 480, 560],
  );
  assert.deepEqual(
    steps.map((preferred) => sharedDetailLayout(1600, preferred).width),
    [560, 405, 380, 560],
  );
  for (const preferred of steps) {
    assert.equal(galleryDetailLayout(1600, preferred).preferred, preferred);
    assert.equal(sharedDetailLayout(1600, preferred).preferred, preferred);
  }

  const stored = 560;
  const narrowed = galleryDetailLayout(900, stored);
  assert.equal(narrowed.width, 405);
  assert.equal(narrowed.preferred, 560);
  assert.equal(stored, 560);
  const restored = galleryDetailLayout(1600, stored);
  assert.equal(restored.width, 560);
  assert.equal(restored.preferred, 560);
});

test("narrow columns clamp to the split max and keep the gallery remainder", () => {
  const gallery = galleryDetailLayout(900, 560);
  assert.deepEqual(gallery, {
    mode: "split",
    width: 405,
    min: 320,
    max: 405,
    preferred: 560,
  });
  assert.equal(900 - 405, 495);
  assert.ok(900 - gallery.max! >= 492);

  const shared = sharedDetailLayout(960, 560);
  assert.deepEqual(shared, {
    mode: "split",
    width: 432,
    min: 320,
    max: 432,
    preferred: 560,
  });

  assert.equal(galleryDetailLayout(1200, 0).width, 320);
  assert.equal(sharedDetailLayout(1200, 0).width, 320);
  assert.equal(galleryDetailLayout(899, 560).mode, "full");
  assert.equal(galleryDetailLayout(899, 560).width, null);
  assert.equal(galleryDetailLayout(899, 560).preferred, 560);
  assert.equal(sharedDetailLayout(959, 405).mode, "full");
  assert.equal(sharedDetailLayout(959, 405).preferred, 405);
});

test("nonfinite and negative width or preference are rejected", () => {
  const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1];
  for (const width of bad) {
    assert.throws(() => galleryDetailLayout(width), /invalid width/);
    assert.throws(() => sharedDetailLayout(width, 400), /invalid width/);
  }
  for (const preferred of bad) {
    assert.throws(() => galleryDetailLayout(1200, preferred), /invalid preferred/);
    assert.throws(() => sharedDetailLayout(1600, preferred), /invalid preferred/);
  }
  assert.equal(galleryDetailLayout(0).mode, "full");
  assert.equal(sharedDetailLayout(0, 560).preferred, 560);
  assert.equal(sharedDetailLayout(0, 560).width, null);
});
