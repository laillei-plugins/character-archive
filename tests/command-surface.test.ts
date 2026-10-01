/**
 * Public command-surface: exactly two palette jobs, and the edit toggle acts on
 * the active gallery only.
 *
 * `commandSurface.ts` imports nothing, so the real toggle decision runs here.
 * The registration in `main.ts` needs Obsidian and is checked as source text.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  COMMAND_SURFACE,
  CREATE_GALLERY_NAME,
  OPEN_GALLERY_NAME,
  commandById,
  toggleActiveEditMode,
} from "../src/ui/commandSurface.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const REMOVED_IDS = [
  "new-gallery-page",
  "new-gallery-page-default",
  "new-character",
  "refresh-gallery",
  "share-gallery-web",
  "copy-gallery-page-link",
  "copy-gallery-wikilink",
  "sweep-empty-folders",
  "sweep-orphan-gallery-pages",
  "heal-library-image-links",
];

function fakeGallery(editMode: boolean) {
  return {
    editMode,
    calls: [] as boolean[],
    setEditMode(enabled: boolean) {
      this.calls.push(enabled);
      this.editMode = enabled;
    },
  };
}

test("the palette is exactly open-last-used and the edit toggle", () => {
  assert.deepEqual(
    COMMAND_SURFACE.map((command) => [command.id, command.name, command.job]),
    [
      ["open-gallery", "갤러리 열기", "open-last-used"],
      ["toggle-edit-mode", "갤러리 편집 켜기 / 끄기", "toggle-edit"],
    ],
  );
  assert.equal(commandById("open-gallery")?.name, OPEN_GALLERY_NAME);
  for (const id of REMOVED_IDS) assert.equal(commandById(id), undefined);
});

test("the gallery-creation label survives for the pane menu and its dialog", () => {
  assert.equal(CREATE_GALLERY_NAME, "새 갤러리 만들기");
});

test("the edit toggle is unavailable with no active gallery", () => {
  assert.equal(toggleActiveEditMode(true, null), false);
  assert.equal(toggleActiveEditMode(false, null), false);
});

test("checking the edit toggle never flips the active gallery", () => {
  const active = fakeGallery(false);
  assert.equal(toggleActiveEditMode(true, active), true);
  assert.deepEqual(active.calls, []);
  assert.equal(active.editMode, false);
});

test("running the edit toggle flips the active gallery and no other", () => {
  const active = fakeGallery(false);
  const background = fakeGallery(false);
  assert.equal(toggleActiveEditMode(false, active), true);
  assert.deepEqual(active.calls, [true]);
  assert.equal(toggleActiveEditMode(false, active), true);
  assert.deepEqual(active.calls, [true, false]);
  assert.deepEqual(background.calls, []);
  assert.equal(background.editMode, false);
});

test("main registers the two commands by id and targets the active view only", () => {
  const main = readFileSync(join(root, "src/main.ts"), "utf8");

  assert.equal((main.match(/this\.addCommand\(/g) ?? []).length, 2);
  assert.match(main, /commandById\("open-gallery"\)!/);
  assert.match(main, /commandById\("toggle-edit-mode"\)!/);
  assert.match(main, /openLastUsedOrDefaultGallery/);
  assert.match(
    main,
    /toggleActiveEditMode\(\s*checking,\s*this\.app\.workspace\.getActiveViewOfType\(GalleryView\),\s*\)/,
  );
  for (const id of REMOVED_IDS) {
    assert.equal(main.includes(`"${id}"`), false, id);
  }
  assert.doesNotMatch(main, /hiddenCompatCheck/);
  assert.doesNotMatch(main, /name: "갤러리 열기"/);
  assert.doesNotMatch(main, /name: "깨진 이미지 다시 연결"/);
});

test("the command surface carries no hidden-visibility machinery", () => {
  const surface = readFileSync(join(root, "src/ui/commandSurface.ts"), "utf8");
  assert.doesNotMatch(surface, /visibility/);
  assert.doesNotMatch(surface, /hiddenCompatCheck/);
  assert.doesNotMatch(surface, /HEAL_IMAGE_LINKS_NAME/);
  assert.doesNotMatch(surface, /paletteCommands/);
});

test("shared names still reach every surface that shows them", () => {
  const modal = readFileSync(join(root, "src/ui/CreateGalleryModal.ts"), "utf8");
  const view = readFileSync(join(root, "src/views/GalleryView.ts"), "utf8");
  const page = readFileSync(join(root, "src/page/galleryPage.ts"), "utf8");

  assert.match(modal, /CREATE_GALLERY_NAME/);
  assert.doesNotMatch(modal, /새 갤러리 창/);
  // The pane menu is the remaining way to create another gallery.
  assert.match(view, /\.setTitle\(CREATE_GALLERY_NAME\)/);
  assert.doesNotMatch(view, /새 갤러리 페이지/);
  assert.match(page, /OPEN_GALLERY_NAME/);
  assert.doesNotMatch(page, /«갤러리 열기»/);
});

test("both READMEs document the two palette commands and none of the removed ones", () => {
  const en = readFileSync(join(root, "README.md"), "utf8");
  const ko = readFileSync(join(root, "README.ko.md"), "utf8");

  assert.match(en, /\| Open last-used gallery \| 갤러리 열기 \|/);
  assert.ok(en.includes("| Toggle gallery edit mode | 갤러리 편집 켜기 / 끄기 |"));
  assert.match(ko, /갤러리 열기/);
  assert.ok(ko.includes("갤러리 편집 켜기 / 끄기"));
  for (const readme of [en, ko]) {
    assert.doesNotMatch(readme, /캐릭터 노트 만들기/);
    assert.doesNotMatch(readme, /\| (Share gallery|New gallery) \|/);
  }
});
