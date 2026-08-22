/**
 * Public command-surface: one job per palette row; leftover open stays hidden.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  COMMAND_SURFACE,
  CREATE_GALLERY_NAME,
  HEAL_IMAGE_LINKS_NAME,
  OPEN_GALLERY_NAME,
  commandById,
  hiddenCompatCheck,
  paletteCommands,
} from "../src/ui/commandSurface.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("palette lists eleven jobs and hides the leftover default-open id", () => {
  const palette = paletteCommands();
  assert.equal(palette.length, 11);
  assert.equal(
    palette.some((command) => command.id === "new-gallery-page-default"),
    false,
  );
  const hidden = commandById("new-gallery-page-default");
  assert.equal(hidden?.visibility, "hidden");
  assert.equal(hidden?.job, "open-default-compat");
  assert.equal(COMMAND_SURFACE.length, 12);
});

test("open command is last-used and shares the ribbon name", () => {
  const open = commandById("open-gallery");
  assert.equal(open?.job, "open-last-used");
  assert.equal(open?.name, OPEN_GALLERY_NAME);
  assert.equal(OPEN_GALLERY_NAME, "마지막 갤러리 열기");
});

test("create uses one name on every surface", () => {
  const create = commandById("new-gallery-page");
  assert.equal(create?.name, CREATE_GALLERY_NAME);
  assert.equal(CREATE_GALLERY_NAME, "새 갤러리 만들기");
});

test("heal name states the legacy-folder job", () => {
  assert.equal(
    commandById("heal-library-image-links")?.name,
    HEAL_IMAGE_LINKS_NAME,
  );
  assert.equal(HEAL_IMAGE_LINKS_NAME, "예전 폴더 이미지 다시 연결");
});

test("hidden compat stays off the palette check and on for execute", () => {
  assert.equal(hiddenCompatCheck(true), false);
  assert.equal(hiddenCompatCheck(false), true);
});

test("source wires last-used open, hidden compat, and the shared create name", () => {
  const main = readFileSync(join(root, "src/main.ts"), "utf8");
  const modal = readFileSync(join(root, "src/ui/CreateGalleryModal.ts"), "utf8");
  const view = readFileSync(join(root, "src/views/GalleryView.ts"), "utf8");
  const page = readFileSync(join(root, "src/page/galleryPage.ts"), "utf8");

  assert.match(main, /openLastUsedOrDefaultGallery/);
  assert.match(main, /hiddenCompatCheck/);
  assert.doesNotMatch(main, /name: "갤러리 열기"/);
  assert.doesNotMatch(main, /name: "깨진 이미지 다시 연결"/);
  assert.match(modal, /CREATE_GALLERY_NAME/);
  assert.doesNotMatch(modal, /새 갤러리 창/);
  assert.match(view, /CREATE_GALLERY_NAME/);
  assert.doesNotMatch(view, /새 갤러리 페이지/);
  assert.match(page, /OPEN_GALLERY_NAME/);
  assert.doesNotMatch(page, /«갤러리 열기»/);
});
