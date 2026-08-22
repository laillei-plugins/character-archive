import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  basenameWithoutMarkdown,
  characterNameProblem,
  hasPortablePathCollision,
  normalizeCharacterName,
  notePathForName,
  portablePathIdentity,
  remapPathKey,
} from "../src/data/characterName.ts";

test("character names trim once and produce a sibling Markdown path", () => {
  assert.equal(normalizeCharacterName("  에트나  "), "에트나");
  assert.equal(
    notePathForName("Archive/Work/Character 123/새 캐릭터.md", " 에트나 "),
    "Archive/Work/Character 123/에트나.md",
  );
  assert.equal(basenameWithoutMarkdown("Archive/에트나.md"), "에트나");
});

test("portable filename validation rejects destructive or contradictory names", () => {
  assert.equal(characterNameProblem("   "), "empty");
  assert.equal(characterNameProblem("."), "dot");
  assert.equal(characterNameProblem("에트나.md"), "extension");
  assert.equal(characterNameProblem("A/B"), "invalid-character");
  assert.equal(characterNameProblem("A\\B"), "invalid-character");
  assert.equal(characterNameProblem("A?"), "invalid-character");
  assert.equal(characterNameProblem("A."), "trailing");
  assert.equal(characterNameProblem("CON"), "reserved");
  assert.equal(characterNameProblem("lpt9.txt"), "reserved");
  assert.equal(characterNameProblem("에트나"), null);
});

test("portable collision checks case and Unicode normalization but exempts the source", () => {
  const source = "Archive/Folder/Alice.md";
  assert.equal(
    hasPortablePathCollision([source], source, "Archive/Folder/alice.md"),
    false,
  );
  assert.equal(
    hasPortablePathCollision(
      [source, "Archive/Folder/ALICE.md"],
      source,
      "Archive/Folder/alice.md",
    ),
    true,
  );
  assert.equal(
    hasPortablePathCollision(
      [source, "Archive/Folder/ALICE.md"],
      "Archive/Folder/Other.md",
      "Archive/Folder/alice.md",
    ),
    true,
  );
  assert.equal(portablePathIdentity("e\u0301.md"), portablePathIdentity("é.md"));
});

test("path remapping covers exact and field-qualified menu keys", () => {
  assert.equal(remapPathKey("A.md", "A.md", "B.md"), "B.md");
  assert.equal(remapPathKey("A.md#tags", "A.md", "B.md"), "B.md#tags");
  assert.equal(remapPathKey("C.md", "A.md", "B.md"), "C.md");
});

test("production creation and rename UI keep one native close authority", () => {
  const root = join(import.meta.dirname, "..");
  const page = readFileSync(join(root, "src/page/galleryPage.ts"), "utf8");
  const modal = readFileSync(join(root, "src/ui/CharacterNameModal.ts"), "utf8");
  const view = readFileSync(join(root, "src/views/GalleryView.ts"), "utf8");
  const main = readFileSync(join(root, "src/main.ts"), "utf8");

  assert.match(page, /promptCharacterName/);
  assert.match(page, /const folderName = `캐릭터 \$\{stamp\}`/);
  assert.match(page, /`\$\{destFolder\}\/\$\{title\}\.md`/);
  assert.match(modal, /class CharacterNameModal extends Modal/);
  assert.doesNotMatch(modal, /setIcon\([^\n]*"x"|text:\s*"취소"/);
  assert.match(view, /setIcon\(rename, "pencil"\)/);
  assert.match(main, /private characterNameLane = new WeakMap<TFile, Promise<unknown>>/);
  assert.match(main, /view\.handleCharacterRenamed\(oldPath, newPath, file, syncTitle\)/);
  assert.doesNotMatch(main, /renameFile\([^\n]*parent/i);
});

test("image pickup searches for the unique character note, not a folder-matched basename", () => {
  const root = join(import.meta.dirname, "..");
  const main = readFileSync(join(root, "src/main.ts"), "utf8");
  assert.match(main, /const notes = this\.app\.vault\.getMarkdownFiles\(\)\.filter/);
  assert.match(main, /notes\.length === 1/);
  assert.doesNotMatch(main, /const notePath = `\$\{dir\}\/\$\{base\}\.md`/);
});
