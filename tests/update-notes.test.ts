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
  assert.equal(normalizeSeenUpdateNotesVersion(" 0.1.20 "), "0.1.20");
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
    /보관함 폴더 이름을 누르면 그 보관함 갤러리만 열려요/,
  );
  assert.match(
    UPDATE_NOTES_MARKDOWN,
    /마지막으로 봤던 갤러리를 다시 열어요/,
  );
  assert.match(
    UPDATE_NOTES_MARKDOWN,
    /읽기 모드에서 카드의 그림을 누르면 크게 볼 수 있어요/,
  );
  assert.match(
    UPDATE_NOTES_MARKDOWN,
    /«이름순»을 고르면 카드 전체가 이름 순서대로 정렬돼요/,
  );
  assert.match(
    UPDATE_NOTES_MARKDOWN,
    /«새 갤러리 만들기»/,
  );
  assert.match(
    UPDATE_NOTES_MARKDOWN,
    /Clicking a library folder name opens that library's gallery only/,
  );
  assert.match(
    UPDATE_NOTES_MARKDOWN,
    /reopen the gallery you last viewed/,
  );
  assert.match(
    UPDATE_NOTES_MARKDOWN,
    /click a card image to see it large/,
  );
  assert.match(
    UPDATE_NOTES_MARKDOWN,
    /sorts every card by name/,
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
