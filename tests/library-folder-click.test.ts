/**
 * Library-folder title click: gallery only, one tab per library.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AutoRevealRestoreError,
  classifyLibraryFolderClick,
  decideGalleryOpenLeaf,
  libraryFolderNotePath,
  pickGalleryLeafForLibrary,
  isGalleryByCache,
  pickLibraryCreatePath,
  pickLibraryEntryPath,
  textGalleryLibrary,
  textHasGalleryFrontmatter,
  withAutoRevealSuppressed,
  type ExplorerViewLike,
} from "../src/ui/libraryFolderOpen.ts";

const LIBRARIES = ["Character Archive", "Second Library"];

test("title click on the default library folder is intercepted", () => {
  assert.equal(
    classifyLibraryFolderClick({
      isChevron: false,
      folderPath: "Character Archive",
      libraryPaths: LIBRARIES,
    }),
    "title",
  );
});

test("title click on a second library folder is intercepted", () => {
  assert.equal(
    classifyLibraryFolderClick({
      isChevron: false,
      folderPath: "Second Library",
      libraryPaths: LIBRARIES,
    }),
    "title",
  );
});

test("chevron on a library folder is pass-through", () => {
  assert.equal(
    classifyLibraryFolderClick({
      isChevron: true,
      folderPath: "Second Library",
      libraryPaths: LIBRARIES,
    }),
    "chevron",
  );
});

test("a folder that is not a known library is ignored", () => {
  assert.equal(
    classifyLibraryFolderClick({
      isChevron: false,
      folderPath: "Notes",
      libraryPaths: LIBRARIES,
    }),
    "other",
  );
});

test("existing gallery leaf must match the clicked library", () => {
  const leaves = [
    { id: "other", library: "Second Library" },
    { id: "mine", library: "Character Archive" },
  ];
  const picked = pickGalleryLeafForLibrary(
    leaves,
    "Character Archive",
    (leaf) => leaf.library,
  );
  assert.equal(picked?.id, "mine");
});

test("unrelated gallery leaves do not steal the click", () => {
  const leaves = [{ id: "other", library: "Second Library" }];
  assert.equal(
    pickGalleryLeafForLibrary(leaves, "Character Archive", (leaf) => leaf.library),
    undefined,
  );
});

test("entry resolution prefers the folder note", () => {
  assert.equal(
    pickLibraryEntryPath({
      library: "Second Library",
      existingGalleryPaths: [
        "Second Library/Second Library.md",
        "Second Library/Character Archive.md",
      ],
      unpinnedGalleryPaths: ["Second Library/_galleries/extra.md"],
    }),
    "Second Library/Second Library.md",
  );
});

test("entry resolution falls back to Character Archive.md", () => {
  assert.equal(
    pickLibraryEntryPath({
      library: "Second Library",
      existingGalleryPaths: ["Second Library/Character Archive.md"],
      unpinnedGalleryPaths: [],
    }),
    "Second Library/Character Archive.md",
  );
});

test("entry resolution uses the first unpinned gallery path", () => {
  assert.equal(
    pickLibraryEntryPath({
      library: "Second Library",
      existingGalleryPaths: [
        "Second Library/_galleries/zeta.md",
        "Second Library/_galleries/alpha.md",
      ],
      unpinnedGalleryPaths: [
        "Second Library/_galleries/zeta.md",
        "Second Library/_galleries/alpha.md",
      ],
    }),
    "Second Library/_galleries/alpha.md",
  );
});

test("missing entry asks to create the folder note", () => {
  assert.equal(
    pickLibraryEntryPath({
      library: "Second Library",
      existingGalleryPaths: [],
      unpinnedGalleryPaths: [],
    }),
    "create-folder-note",
  );
  assert.equal(
    libraryFolderNotePath("Second Library"),
    "Second Library/Second Library.md",
  );
});

test("a non-gallery folder note is not reused as the entry", () => {
  assert.equal(
    pickLibraryEntryPath({
      library: "Second Library",
      existingGalleryPaths: [],
      unpinnedGalleryPaths: [],
    }),
    "create-folder-note",
  );
  assert.equal(
    pickLibraryCreatePath({
      library: "Second Library",
      occupiedPaths: ["Second Library/Second Library.md"],
    }),
    "Second Library/Character Archive.md",
  );
});

test("a just-created gallery note is recognized from its own YAML", () => {
  const body =
    '---\ncharinfo: gallery\nlibrary: "Second Library"\n---\n';
  assert.equal(textHasGalleryFrontmatter(body), true);
  assert.equal(textGalleryLibrary(body), "Second Library");
  assert.equal(textHasGalleryFrontmatter("# not a gallery\n"), false);
});

test("a conventional path with other frontmatter is not a gallery", () => {
  assert.equal(
    isGalleryByCache({
      hasFrontmatter: true,
      charinfo: "character",
      pathIsDefaultEntry: true,
    }),
    false,
  );
  assert.equal(
    isGalleryByCache({
      hasFrontmatter: false,
      charinfo: undefined,
      pathIsDefaultEntry: true,
    }),
    true,
  );
});

test("create is blocked when both entry names are occupied", () => {
  assert.equal(
    pickLibraryCreatePath({
      library: "Second Library",
      occupiedPaths: [
        "Second Library/Second Library.md",
        "Second Library/Character Archive.md",
      ],
    }),
    "blocked",
  );
});

test("same-file gallery is revealed instead of opening another tab", () => {
  assert.equal(
    decideGalleryOpenLeaf({
      hasSameFileLeaf: true,
      replaceActive: true,
      hasMostRecent: true,
      mostRecentIsSidebar: false,
      mostRecentIsGallery: true,
    }),
    "reveal-same-file",
  );
});

test("a main-area note may be reused", () => {
  assert.equal(
    decideGalleryOpenLeaf({
      hasSameFileLeaf: false,
      replaceActive: true,
      hasMostRecent: true,
      mostRecentIsSidebar: false,
      mostRecentIsGallery: false,
    }),
    "reuse-recent",
  );
});

test("a different library gallery forces a new tab", () => {
  assert.equal(
    decideGalleryOpenLeaf({
      hasSameFileLeaf: false,
      replaceActive: true,
      hasMostRecent: true,
      mostRecentIsSidebar: false,
      mostRecentIsGallery: true,
    }),
    "new-tab",
  );
});

test("file-explorer focus also opens a new tab", () => {
  assert.equal(
    decideGalleryOpenLeaf({
      hasSameFileLeaf: false,
      replaceActive: true,
      hasMostRecent: true,
      mostRecentIsSidebar: true,
      mostRecentIsGallery: false,
    }),
    "new-tab",
  );
});

function mockExplorer(autoReveal: boolean): ExplorerViewLike & {
  states: Array<Record<string, unknown>>;
  failNext?: boolean;
  failRestore?: boolean;
} {
  let current: Record<string, unknown> = {
    sortOrder: "alphabetical",
    autoReveal,
  };
  const states: Array<Record<string, unknown>> = [];
  const explorer: ExplorerViewLike & {
    states: Array<Record<string, unknown>>;
    failNext?: boolean;
    failRestore?: boolean;
  } = {
    states,
    getState: () => ({ ...current }),
    setState: (state) => {
      if (explorer.failNext) {
        explorer.failNext = false;
        throw new Error("setState failed");
      }
      if (explorer.failRestore && states.length >= 1) {
        throw new Error("restore failed");
      }
      current = { ...(state as Record<string, unknown>) };
      states.push({ ...current });
    },
  };
  return explorer;
}

test("auto-reveal is suppressed for the operation and restored after success", async () => {
  const explorer = mockExplorer(true);
  const result = await withAutoRevealSuppressed([explorer], async () => {
    assert.equal(explorer.getState().autoReveal, false);
    return "opened";
  });
  assert.equal(result, "opened");
  assert.equal(explorer.getState().autoReveal, true);
  assert.deepEqual(
    explorer.states.map((state) => state.autoReveal),
    [false, true],
  );
});

test("auto-reveal is restored when activation throws", async () => {
  const explorer = mockExplorer(true);
  await assert.rejects(
    () =>
      withAutoRevealSuppressed([explorer], async () => {
        assert.equal(explorer.getState().autoReveal, false);
        throw new Error("activate failed");
      }),
    /activate failed/,
  );
  assert.equal(explorer.getState().autoReveal, true);
});

test("a later explorer suppress failure still restores earlier explorers", async () => {
  const first = mockExplorer(true);
  const second = mockExplorer(true);
  second.failNext = true;
  await assert.rejects(
    () => withAutoRevealSuppressed([first, second], async () => "nope"),
    /setState failed/,
  );
  assert.equal(first.getState().autoReveal, true);
  assert.equal(second.getState().autoReveal, true);
});

test("auto-reveal already off is left untouched", async () => {
  const explorer = mockExplorer(false);
  await withAutoRevealSuppressed([explorer], async () => "ok");
  assert.equal(explorer.states.length, 0);
  assert.equal(explorer.getState().autoReveal, false);
});

test("restore failure wins even when the open also fails", async () => {
  const explorer = mockExplorer(true);
  explorer.failRestore = true;
  await assert.rejects(
    () =>
      withAutoRevealSuppressed([explorer], async () => {
        throw new Error("open failed");
      }),
    (error: unknown) => {
      assert.ok(error instanceof AutoRevealRestoreError);
      return true;
    },
  );
  assert.equal(explorer.getState().autoReveal, false);
});

test("restore failure is reported after a successful open", async () => {
  const explorer = mockExplorer(true);
  explorer.failRestore = true;
  await assert.rejects(
    () => withAutoRevealSuppressed([explorer], async () => "opened"),
    (error: unknown) => {
      assert.ok(error instanceof AutoRevealRestoreError);
      return true;
    },
  );
  assert.equal(explorer.getState().autoReveal, false);
});
