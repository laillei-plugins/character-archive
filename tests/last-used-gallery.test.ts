/**
 * Last-used ribbon: stored note path, lazy fallback, rename remap.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decideRibbonOpen,
  normalizeLastOpenedGalleryPath,
  remapLastOpenedGalleryPath,
  shouldRecordLastOpenedGallery,
} from "../src/ui/libraryFolderOpen.ts";

test("ribbon opens the stored last-used gallery when it still exists", () => {
  assert.equal(
    decideRibbonOpen({
      lastPath: "Second Library/_galleries/Home.md",
      fileExists: true,
      isGallery: true,
    }),
    "last-used",
  );
});

test("ribbon falls back to the default entry when last-used is missing or not a gallery", () => {
  assert.equal(
    decideRibbonOpen({
      lastPath: "",
      fileExists: false,
      isGallery: false,
    }),
    "default",
  );
  assert.equal(
    decideRibbonOpen({
      lastPath: "gone.md",
      fileExists: false,
      isGallery: false,
    }),
    "default",
  );
  assert.equal(
    decideRibbonOpen({
      lastPath: "Notes/plain.md",
      fileExists: true,
      isGallery: false,
    }),
    "default",
  );
});

test("loading a gallery file records it as last-used; unchanged path does not rewrite", () => {
  assert.equal(
    shouldRecordLastOpenedGallery("", "Second Library/_galleries/Home.md"),
    true,
  );
  assert.equal(
    shouldRecordLastOpenedGallery(
      "Second Library/_galleries/Home.md",
      "Second Library/_galleries/Home.md",
    ),
    false,
  );
  assert.equal(shouldRecordLastOpenedGallery("kept.md", ""), false);
});

test("renaming the last-used gallery note remaps the stored path", () => {
  assert.equal(
    remapLastOpenedGalleryPath(
      "Second Library/_galleries/Home.md",
      "Second Library/_galleries/Home.md",
      "Second Library/_galleries/Studio.md",
    ),
    "Second Library/_galleries/Studio.md",
  );
  assert.equal(
    remapLastOpenedGalleryPath(
      "Second Library/_galleries/Home.md",
      "other.md",
      "other-2.md",
    ),
    "Second Library/_galleries/Home.md",
  );
});

test("migrateSettings defaults lastOpenedGalleryPath to an empty string", () => {
  assert.equal(normalizeLastOpenedGalleryPath(undefined), "");
  assert.equal(normalizeLastOpenedGalleryPath(12), "");
  assert.equal(
    normalizeLastOpenedGalleryPath("Second Library/_galleries/Home.md"),
    "Second Library/_galleries/Home.md",
  );
});
