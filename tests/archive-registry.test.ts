/**
 * Declared archives: the registry that lets an archive exist with no card.
 *
 * `archiveRegistry.ts` imports only modules that import nothing themselves, so
 * the real file is bundled here and driven without a vault. Nothing in this
 * file runs inside Obsidian.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["src/data/archiveRegistry.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const api = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0]!.text).toString("base64")
);

const root = join(import.meta.dirname, "..");
const LIB = "Character Archive";
const ko = (a: string, b: string) => a.localeCompare(b, "ko");

test("missing or malformed declarations normalize to an empty registry", () => {
  for (const raw of [undefined, null, "만안", 3, {}, { library: LIB }]) {
    assert.deepEqual(api.normalizeDeclaredArchives(raw), []);
  }
  assert.deepEqual(
    api.normalizeDeclaredArchives([
      null,
      "만안",
      { library: LIB },
      { archive: "만안" },
      { library: 3, archive: "만안" },
      { library: LIB, archive: "   " },
      { library: "  ", archive: "만안" },
    ]),
    [],
  );
});

test("rows normalize the library key and the archive name, then de-dupe per library", () => {
  const decomposed = "만안".normalize("NFD");
  assert.notEqual(decomposed, "만안");
  assert.deepEqual(
    api.normalizeDeclaredArchives([
      { library: " Lib\\Sub// ", archive: `  ${decomposed} ` },
      { library: "Lib/Sub", archive: "만안" },
      { library: "Lib/Sub", archive: "Night" },
      { library: "Lib/Sub/", archive: "NIGHT" },
      { library: "Other", archive: "night" },
    ]),
    [
      { library: "Lib/Sub", archive: "만안" },
      { library: "Lib/Sub", archive: "Night" },
      { library: "Other", archive: "night" },
    ],
  );
});

test("the archive list is the library's observed names plus its own declarations, sorted once", () => {
  const declared = [
    { library: LIB, archive: "만안" },
    { library: "Second Library", archive: "다른 보관함" },
    { library: LIB, archive: "fearless" },
  ];
  const list = api.listArchives(["예시", "Fearless"], declared, LIB);
  assert.deepEqual(list, ["Fearless", "예시", "만안"].sort(ko));
  // Observed spelling stands; the declared respelling adds nothing.
  assert.equal(list.includes("fearless"), false);
  // Another library's declaration never leaks in.
  assert.equal(list.includes("다른 보관함"), false);
  assert.deepEqual(api.listArchives([], declared, "Second Library"), [
    "다른 보관함",
  ]);
  assert.deepEqual(api.listArchives([], declared, "Third"), []);
});

test("a declared archive is listed empty, with cards, and after its last card is removed", () => {
  const declared = [{ library: LIB, archive: "만안" }];
  assert.deepEqual(api.listArchives([], declared, LIB), ["만안"]);
  assert.deepEqual(
    api.listArchives(["만안", "예시"], declared, LIB),
    ["만안", "예시"].sort(ko),
  );
  assert.deepEqual(api.listArchives(["예시"], declared, LIB), ["만안", "예시"].sort(ko));
  // An archive that was only ever inferred still leaves with its last card.
  assert.deepEqual(api.listArchives([], [], LIB), []);
});

test("a remembered archive resolves to the listed spelling", () => {
  assert.equal(api.resolveArchiveSpelling(["Fearless", "예시"], "예시"), "예시");
  assert.equal(
    api.resolveArchiveSpelling(["Fearless", "예시"], "fearless"),
    "Fearless",
  );
  assert.equal(api.resolveArchiveSpelling(["Fearless"], "만안"), "");
  assert.equal(api.resolveArchiveSpelling(["Fearless"], ""), "");
});

test("a duplicate name is refused by portable identity with the agreed wording", () => {
  assert.equal(
    api.archiveNameProblem({
      name: "  fearless ",
      existing: ["Fearless", "예시"],
      folders: [],
    }),
    "「fearless」 아카이브가 이미 있어요. 다른 이름을 정해 주세요.",
  );
  assert.equal(
    api.archiveNameProblem({
      name: "만안".normalize("NFD"),
      existing: ["만안"],
      folders: [],
    }),
    "「만안」 아카이브가 이미 있어요. 다른 이름을 정해 주세요.",
  );
  assert.equal(
    api.archiveNameProblem({ name: "만안", existing: ["예시"], folders: [] }),
    null,
  );
});

test("a rename exempts only the exact source, so a case-only rename works", () => {
  assert.equal(
    api.archiveNameProblem({
      name: "foo",
      existing: ["Foo", "예시"],
      folders: [],
      source: "Foo",
    }),
    null,
  );
  // A second archive already holds the target's identity: still a collision.
  assert.equal(
    api.archiveNameProblem({
      name: "foo",
      existing: ["Foo", "FOO"],
      folders: [],
      source: "Foo",
    }),
    "「foo」 아카이브가 이미 있어요. 다른 이름을 정해 주세요.",
  );
});

test("reserved names are refused with their own reason; underscore and 예시 stay allowed", () => {
  const check = (name: string) =>
    api.archiveNameProblem({ name, existing: [], folders: [] });
  const unclassified = check("미분류");
  const galleries = check("_Galleries");
  const starter = check("_STARTER");
  const builtin = check("constructor");
  for (const reason of [unclassified, galleries, starter, builtin]) {
    assert.equal(typeof reason, "string");
    assert.match(reason, /쓸 수 없어요\.$/);
  }
  assert.equal(new Set([unclassified, galleries, starter, builtin]).size, 4);
  assert.match(galleries, /「_Galleries」.*갤러리 노트 폴더/);
  assert.match(starter, /「_STARTER」.*예시 카드 폴더/);
  for (const name of ["__proto__", "toString", "hasOwnProperty", "valueOf"]) {
    assert.equal(check(name), builtin.replace("constructor", name));
  }
  assert.equal(check("예시"), null);
  assert.equal(check("_draft"), null);
  assert.equal(check("Constructor"), null);
});

test("the reserved folder names are the ones the plugin actually uses", () => {
  const page = readFileSync(join(root, "src/page/galleryPage.ts"), "utf8");
  const template = readFileSync(
    join(root, "src/data/bundledTemplate.ts"),
    "utf8",
  );
  assert.match(page, /export const GALLERY_PAGES_DIR = "_galleries";/);
  assert.match(template, /export const EXAMPLE_FOLDER = "_starter";/);
});

test("portable filename rules apply to archive names", () => {
  const check = (name: unknown) =>
    api.archiveNameProblem({ name, existing: [], folders: [] });
  assert.equal(check("   "), "이름을 입력해 주세요.");
  assert.equal(check("a/b"), "파일 이름에 쓸 수 없는 문자가 있어요.");
  assert.equal(check("Re:Zero"), "파일 이름에 쓸 수 없는 문자가 있어요.");
  assert.equal(check("끝."), "이름 끝에 점이나 공백을 둘 수 없어요.");
  assert.equal(check("CON"), "운영체제가 예약한 이름이라 사용할 수 없어요.");
});

test("a name that an existing top-level folder already owns is refused", () => {
  // Folder `Kuwon` holds another archive's cards under a different name.
  assert.equal(
    api.archiveNameProblem({
      name: "kuwon",
      existing: ["Fearless"],
      folders: ["Kuwon", "_starter"],
    }),
    "「Kuwon」 폴더가 이미 있어요. 다른 이름을 정해 주세요.",
  );
  assert.equal(
    api.archiveNameProblem({
      name: "만안",
      existing: ["Fearless"],
      folders: ["Kuwon", "_starter"],
    }),
    null,
  );
});

test("a rename may take the folder its own cards already live in, and no other", () => {
  assert.equal(
    api.archiveNameProblem({
      name: "Kuwon",
      existing: ["Fearless", "예시"],
      folders: ["Kuwon", "Sample"],
      source: "Fearless",
      sourceFolders: ["Kuwon"],
    }),
    null,
  );
  assert.equal(
    api.archiveNameProblem({
      name: "Kuwon",
      existing: ["Fearless", "예시"],
      folders: ["Kuwon", "Sample"],
      source: "예시",
      sourceFolders: ["Sample"],
    }),
    "「Kuwon」 폴더가 이미 있어요. 다른 이름을 정해 주세요.",
  );
  // A declared empty archive keeps the folder named after itself.
  assert.equal(
    api.archiveNameProblem({
      name: "foo",
      existing: ["Foo"],
      folders: ["Foo"],
      source: "Foo",
      sourceFolders: [],
    }),
    null,
  );
});

test("the top-level folder of a note is read relative to its library", () => {
  assert.equal(api.topLevelFolderOf("Lib", "Lib/Kuwon/Rin/Rin.md"), "Kuwon");
  assert.equal(api.topLevelFolderOf("Lib", "Lib/Rin/Rin.md"), "Rin");
  assert.equal(api.topLevelFolderOf("Lib", "Lib/Rin.md"), "");
  assert.equal(api.topLevelFolderOf("Lib", "Other/Kuwon/Rin/Rin.md"), "");
  assert.equal(api.topLevelFolderOf("Lib/", "Lib/Kuwon/Rin/Rin.md"), "Kuwon");
});

test("declaring checks the store it writes and never touches another library", () => {
  const store = { declaredArchives: [{ library: "Second Library", archive: "Night" }] };
  const name = api.declareArchive(store, {
    library: `${LIB}/`,
    name: "  Night ",
    observed: ["예시"],
    folders: [],
  });
  assert.equal(name, "Night");
  assert.deepEqual(store.declaredArchives, [
    { library: "Second Library", archive: "Night" },
    { library: LIB, archive: "Night" },
  ]);

  const before = store.declaredArchives;
  assert.throws(
    () =>
      api.declareArchive(store, {
        library: LIB,
        name: "night",
        observed: ["예시"],
        folders: [],
      }),
    (error: unknown) =>
      error instanceof api.ArchiveNameError &&
      error.message ===
        "「night」 아카이브가 이미 있어요. 다른 이름을 정해 주세요.",
  );
  assert.throws(
    () =>
      api.declareArchive(store, {
        library: LIB,
        name: "예시",
        observed: ["예시"],
        folders: [],
      }),
    api.ArchiveNameError,
  );
  assert.equal(store.declaredArchives, before);
});

test("renaming moves a declaration inside its own library only", () => {
  const store = {
    declaredArchives: [
      { library: LIB, archive: "만안" },
      { library: "Second Library", archive: "만안" },
    ],
  };
  assert.equal(api.renameDeclaredArchive(store, LIB, "만안", " 월하 "), true);
  assert.deepEqual(store.declaredArchives, [
    { library: LIB, archive: "월하" },
    { library: "Second Library", archive: "만안" },
  ]);
  // An archive that was only inferred from cards is not backfilled.
  assert.equal(api.renameDeclaredArchive(store, LIB, "Fearless", "Brave"), false);
  assert.deepEqual(store.declaredArchives, [
    { library: LIB, archive: "월하" },
    { library: "Second Library", archive: "만안" },
  ]);
});

test("a rename ends with exactly one notice that matches what was saved", () => {
  assert.equal(
    api.archiveRenameNotice({ next: "월하", count: 3, saved: true }),
    "아카이브 이름을 「월하」로 바꿨어요 · 노트 3개",
  );
  assert.equal(
    api.archiveRenameNotice({ next: "월하", count: 0, saved: true }),
    "아카이브 이름을 「월하」로 바꿨어요",
  );
  const emptyFailed = api.archiveRenameNotice({
    next: "월하",
    count: 0,
    saved: false,
    error: "disk full",
  });
  assert.match(emptyFailed, /바꾸지 못했어요/);
  assert.match(emptyFailed, /disk full/);
  assert.doesNotMatch(emptyFailed, /바꿨어요/);
  const notesMoved = api.archiveRenameNotice({
    next: "월하",
    count: 2,
    saved: false,
    error: "disk full",
  });
  assert.match(notesMoved, /노트는 「월하」로 바꿨지만 설정 저장에 실패했어요/);
  assert.doesNotMatch(notesMoved, /아카이브 이름을 「월하」로 바꿨어요/);
});
