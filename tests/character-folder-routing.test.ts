/**
 * Where a new card's folder goes.
 *
 * `characterFolderRouting.ts` imports nothing, so `node --test` runs the real
 * scoring straight from TypeScript. The vault walk that feeds it lives in
 * `galleryPage.ts` and still needs a running Obsidian.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  resolveCharacterParentFolder,
  scoreRoutingSibling,
} from "../src/data/characterFolderRouting.ts";

const LIB = "Character Archive";
const fearlessA = {
  path: `${LIB}/Kuwon/Rin/Rin.md`,
  genre: "Fearless",
  group: "A",
};
const fearlessLoose = {
  path: `${LIB}/Kuwon/Sol/Sol.md`,
  genre: "Fearless",
  group: "",
};

test("the first card of an empty archive never follows another archive's same-named group", () => {
  assert.equal(scoreRoutingSibling(fearlessA, "만안", "A"), 0);
  assert.equal(
    resolveCharacterParentFolder(LIB, [fearlessA, fearlessLoose], "만안", "A"),
    `${LIB}/만안`,
  );
});

test("the first ungrouped card of an empty archive never follows another archive's ungrouped cards", () => {
  assert.equal(scoreRoutingSibling(fearlessLoose, "만안", ""), 0);
  assert.equal(
    resolveCharacterParentFolder(LIB, [fearlessA, fearlessLoose], "만안", ""),
    `${LIB}/만안`,
  );
});

test("the second card of an archive follows its first, whatever the folder is called", () => {
  const first = { path: `${LIB}/만안/Yun/Yun.md`, genre: "만안", group: "" };
  assert.equal(
    resolveCharacterParentFolder(LIB, [fearlessA, first], "만안", ""),
    `${LIB}/만안`,
  );
  // Archive `Fearless` lives in a folder with a different name.
  assert.equal(
    resolveCharacterParentFolder(LIB, [first, fearlessA], "Fearless", "A"),
    `${LIB}/Kuwon`,
  );
  assert.equal(
    resolveCharacterParentFolder(LIB, [first, fearlessA], "Fearless", "B"),
    `${LIB}/Kuwon`,
  );
});

test("inside one archive a same-group sibling outranks a merely same-archive one", () => {
  assert.equal(scoreRoutingSibling(fearlessA, "Fearless", "A"), 3);
  assert.equal(scoreRoutingSibling(fearlessA, "Fearless", "B"), 1);
  assert.equal(scoreRoutingSibling(fearlessLoose, "Fearless", ""), 2);
  assert.equal(scoreRoutingSibling(fearlessA, "Fearless", ""), 1);
  const otherGroup = {
    path: `${LIB}/Kuwon/Sol/Sol.md`,
    genre: "Fearless",
    group: "B",
  };
  const sameGroup = {
    path: `${LIB}/Deep/Wing/Rin/Rin.md`,
    genre: "Fearless",
    group: "A",
  };
  assert.equal(
    resolveCharacterParentFolder(LIB, [otherGroup, sameGroup], "Fearless", "A"),
    `${LIB}/Deep/Wing`,
  );
  // Equal scores: the first sibling wins.
  const twin = { ...sameGroup, path: `${LIB}/Later/Rin/Rin.md` };
  assert.equal(
    resolveCharacterParentFolder(LIB, [sameGroup, twin], "Fearless", "A"),
    `${LIB}/Deep/Wing`,
  );
});

test("a blank archive still follows blank-archive siblings, and only those", () => {
  const blankA = { path: `${LIB}/Loose/Jin/Jin.md`, genre: "", group: "A" };
  const blankNone = { path: `${LIB}/Mina/Mina.md`, genre: "", group: "" };
  assert.equal(scoreRoutingSibling(blankA, "", "A"), 2);
  assert.equal(scoreRoutingSibling(blankNone, "", ""), 1);
  assert.equal(scoreRoutingSibling(fearlessA, "", "A"), 0);
  assert.equal(scoreRoutingSibling(fearlessLoose, "", ""), 0);
  assert.equal(
    resolveCharacterParentFolder(LIB, [fearlessA, blankA], "", "A"),
    `${LIB}/Loose`,
  );
  // A sibling whose folder sits directly under the library routes to the library.
  assert.equal(
    resolveCharacterParentFolder(LIB, [fearlessLoose, blankNone], "", ""),
    LIB,
  );
  assert.equal(
    resolveCharacterParentFolder(LIB, [fearlessA], "", "A"),
    `${LIB}/A`,
  );
});

test("with no sibling the archive, then the group, then the library names the folder", () => {
  assert.equal(resolveCharacterParentFolder(LIB, [], "만안", "A"), `${LIB}/만안`);
  assert.equal(resolveCharacterParentFolder(LIB, [], "", "A"), `${LIB}/A`);
  assert.equal(resolveCharacterParentFolder(LIB, [], "", ""), LIB);
});

test("notes outside the library are never siblings", () => {
  const outside = {
    path: "Character Archive Extra/Kuwon/Rin/Rin.md",
    genre: "Fearless",
    group: "A",
  };
  assert.equal(
    resolveCharacterParentFolder(LIB, [outside], "Fearless", "A"),
    `${LIB}/Fearless`,
  );
});

test("the vault writer routes through the tested scoring", () => {
  const page = readFileSync(
    join(import.meta.dirname, "..", "src/page/galleryPage.ts"),
    "utf8",
  );
  assert.match(
    page,
    /resolveCharacterParentFolder\(lib, siblings, genre, group\)/,
  );
  assert.doesNotMatch(page, /score \+= /);
});
