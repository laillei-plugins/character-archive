import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  UPDATE_NOTES_MARKDOWN,
  UPDATE_NOTES_VERSION,
  normalizeSeenUpdateNotesVersion,
  shouldOpenUpdateNotes,
  updateNotesPath,
} from "../src/data/updateNotes.ts";

test("update notes open once for an existing install on the matching release", () => {
  assert.equal(
    shouldOpenUpdateNotes({
      installedVersion: UPDATE_NOTES_VERSION,
      seenVersion: "0.1.17",
      hadStoredSettings: true,
    }),
    true,
  );
  assert.equal(
    shouldOpenUpdateNotes({
      installedVersion: UPDATE_NOTES_VERSION,
      seenVersion: UPDATE_NOTES_VERSION,
      hadStoredSettings: true,
    }),
    false,
  );
});

test("fresh installs and a different plugin version do not open this note", () => {
  assert.equal(
    shouldOpenUpdateNotes({
      installedVersion: UPDATE_NOTES_VERSION,
      seenVersion: "",
      hadStoredSettings: false,
    }),
    false,
  );
  assert.equal(
    shouldOpenUpdateNotes({
      installedVersion: "9.9.9",
      seenVersion: "0.1.17",
      hadStoredSettings: true,
    }),
    false,
  );
  assert.equal(
    shouldOpenUpdateNotes({
      installedVersion: UPDATE_NOTES_VERSION,
      seenVersion: "9.9.9",
      hadStoredSettings: true,
    }),
    false,
  );
});

test("stored seen versions are normalized before comparison", () => {
  assert.equal(normalizeSeenUpdateNotesVersion(null), "");
  assert.equal(normalizeSeenUpdateNotesVersion(" 0.1.28 "), "0.1.28");
  assert.equal(normalizeSeenUpdateNotesVersion(18), "");
});

test("one update note keeps Korean before the equivalent English section", () => {
  assert.equal(
    updateNotesPath("Character Archive"),
    `Character Archive/_updates/${UPDATE_NOTES_VERSION}.md`,
  );
  const korean = UPDATE_NOTES_MARKDOWN.indexOf("## 업데이트 내용");
  const english = UPDATE_NOTES_MARKDOWN.indexOf("## What's new");
  assert.ok(korean >= 0 && english > korean);
  assert.match(
    UPDATE_NOTES_MARKDOWN,
    /새 아카이브 만들기/,
  );
  assert.match(
    UPDATE_NOTES_MARKDOWN,
    /Create archive/,
  );
});

test("startup opens an existing note without overwriting it, then records seen", () => {
  const root = join(import.meta.dirname, "..");
  const main = readFileSync(join(root, "src/main.ts"), "utf8");
  assert.match(
    main,
    /existing instanceof TFile\s*\? existing\s*:\s*await this\.app\.vault\.create/,
  );
  assert.match(main, /getLeaf\("tab"\)\.openFile\(file, \{ active: true \}\)/);
  assert.ok(
    main.indexOf("openFile(file") <
      main.indexOf(
        "settings.lastOpenedUpdateNotesVersion = UPDATE_NOTES_VERSION",
        main.indexOf("openFile(file"),
      ),
  );
});
