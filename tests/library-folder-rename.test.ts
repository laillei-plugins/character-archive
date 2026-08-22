import assert from "node:assert/strict";
import { test } from "node:test";

import {
  libraryAffectedByFolderRename,
  planMirroredFolderNoteRename,
  remapFolderPrefix,
  remapLibraryFolderSettings,
  remapLibraryIdentities,
  remapPrefixedStoragePath,
  rewriteImageWikiLibraryPrefix,
  shouldRewriteGalleryLibrary,
} from "../src/data/libraryFolderRename.ts";
import type { LibraryFolderSettings } from "../src/data/libraryFolderRename.ts";

function emptySettings(): LibraryFolderSettings {
  return {
    libraryFolder: "Character Archive",
    vaultMediaFolder: "Character Archive",
    characterTemplatePath: "",
    characterTemplateByGenre: {},
    lastOpenedGalleryPath: "",
    groupOrderByLibrary: {},
    galleryPageState: {},
    webShareByPage: {},
    groupSchemas: [],
    fieldKeyLedgers: [],
    cardFieldVisibility: [],
    cardFieldOrder: [],
  };
}

test("exact and nested libraries follow a folder rename; siblings do not", () => {
  assert.equal(
    libraryAffectedByFolderRename("Character Archive", "Character Archive"),
    true,
  );
  assert.equal(
    libraryAffectedByFolderRename("Character Archive/Nested", "Character Archive"),
    true,
  );
  assert.equal(
    libraryAffectedByFolderRename("Second Library", "Character Archive"),
    false,
  );
  assert.deepEqual(
    remapLibraryIdentities(
      ["Character Archive", "Second Library", "Character Archive/Nested"],
      "Character Archive",
      "Story Vault",
    ),
    [
      { from: "Character Archive", to: "Story Vault" },
      { from: "Character Archive/Nested", to: "Story Vault/Nested" },
    ],
  );
});

test("prefix remap is idempotent and refuses substring collisions", () => {
  assert.equal(
    remapFolderPrefix("Character Archive/note.md", "Character Archive", "Story Vault"),
    "Story Vault/note.md",
  );
  assert.equal(
    remapFolderPrefix("Story Vault/note.md", "Character Archive", "Story Vault"),
    "Story Vault/note.md",
  );
  assert.equal(
    remapFolderPrefix("Character ArchiveExtra/note.md", "Character Archive", "Story Vault"),
    "Character ArchiveExtra/note.md",
  );
});

test("web-share character keys remap inside the @character/ prefix", () => {
  assert.equal(
    remapPrefixedStoragePath(
      "@character/Character Archive/Hero.md",
      "Character Archive",
      "Story Vault",
    ),
    "@character/Story Vault/Hero.md",
  );
});

test("gallery YAML rewrites only an explicit matching library", () => {
  assert.equal(
    shouldRewriteGalleryLibrary("Character Archive", "Character Archive"),
    true,
  );
  assert.equal(shouldRewriteGalleryLibrary("", "Character Archive"), false);
  assert.equal(shouldRewriteGalleryLibrary(null, "Character Archive"), false);
  assert.equal(
    shouldRewriteGalleryLibrary("Second Library", "Character Archive"),
    false,
  );
});

test("image rewrite touches wiki embeds only and keeps NAI ::", () => {
  const body = [
    "See Character Archive/docs in prose.",
    "![[Character Archive/Hero/cover.webp]]",
    "```",
    "1.2::Character Archive/not-a-path::",
    "```",
    "",
  ].join("\n");
  const next = rewriteImageWikiLibraryPrefix(
    body,
    "Character Archive",
    "Story Vault",
  );
  assert.match(next, /!\[\[Story Vault\/Hero\/cover\.webp\]\]/);
  assert.match(next, /See Character Archive\/docs in prose/);
  assert.match(next, /1\.2::Character Archive\/not-a-path::/);
});

test("mirrored folder note renames unless the destination is occupied", () => {
  assert.deepEqual(
    planMirroredFolderNoteRename({
      newFolder: "Story Vault",
      oldFolderName: "Character Archive",
      occupiedPaths: ["Story Vault/keep.md"],
    }),
    {
      from: "Story Vault/Character Archive.md",
      to: "Story Vault/Story Vault.md",
    },
  );
  assert.equal(
    planMirroredFolderNoteRename({
      newFolder: "Story Vault",
      oldFolderName: "Character Archive",
      occupiedPaths: ["Story Vault/Story Vault.md"],
    }),
    null,
  );
});

test("settings remap follows the library and leaves sibling keys", () => {
  const settings = emptySettings();
  settings.lastOpenedGalleryPath = "Character Archive/Character Archive.md";
  settings.groupOrderByLibrary = {
    "Character Archive": { Example: ["A"] },
    "Second Library": { Example: ["B"] },
  };
  settings.galleryPageState = {
    "Character Archive/Character Archive.md": { activeGenre: "Example" },
  };
  settings.groupSchemas = [{ library: "Character Archive" }];
  settings.cardFieldVisibility = [
    { page: "Character Archive/Character Archive.md" },
  ];
  const changed = remapLibraryFolderSettings(
    settings,
    "Character Archive",
    "Story Vault",
    {
      from: "Story Vault/Character Archive.md",
      to: "Story Vault/Story Vault.md",
    },
  );
  assert.equal(changed, true);
  assert.equal(settings.libraryFolder, "Story Vault");
  assert.equal(settings.vaultMediaFolder, "Story Vault");
  assert.equal(settings.lastOpenedGalleryPath, "Story Vault/Story Vault.md");
  assert.deepEqual(settings.groupOrderByLibrary["Story Vault"], {
    Example: ["A"],
  });
  assert.deepEqual(settings.groupOrderByLibrary["Second Library"], {
    Example: ["B"],
  });
  assert.equal(settings.groupSchemas[0]?.library, "Story Vault");
  remapLibraryFolderSettings(settings, "Character Archive", "Story Vault");
  assert.equal(settings.libraryFolder, "Story Vault");
});
