import assert from "node:assert/strict";
import { test } from "node:test";

import {
  characterWebShareStatePath,
  clearLastShareIfSameUrl,
  hasUnclaimedLegacyWebShare,
  hostedShareBaseFromUrl,
  isWebShareStateStale,
  recordLastShareUnlessLegacy,
  remapWebShareRecord,
  uploadKeyForHostedTarget,
} from "../src/share/webShareState.ts";

test("an HTML version change detects staleness without dropping credentials", () => {
  const state = {
    url: "https://character-archive.pages.dev/g/example",
    id: "example",
    manageKey: "keep-this-secret",
    at: "2026-08-22T00:00:00.000Z",
    htmlVersion: 11,
  };
  const before = structuredClone(state);

  assert.equal(isWebShareStateStale(state, 12), true);
  assert.deepEqual(state, before);
  assert.equal(state.manageKey, "keep-this-secret");
});

test("character shares use their own normalized management-state key", () => {
  assert.equal(
    characterWebShareStatePath(" Characters\\Kuwon.md "),
    "@character/Characters/Kuwon.md",
  );
  assert.equal(characterWebShareStatePath("  "), "");
});

test("rename moves a management record when the destination is empty", () => {
  const source = { "Gallery A.md": { manageKey: "key-a" } };
  const result = remapWebShareRecord(
    source,
    "Gallery A.md",
    "Folder/Gallery A.md",
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.records, {
    "Folder/Gallery A.md": { manageKey: "key-a" },
  });
  assert.deepEqual(source, { "Gallery A.md": { manageKey: "key-a" } });
});

test("rename collision preserves both live-link management keys", () => {
  const records = {
    "Old.md": { manageKey: "old-live-key" },
    "New.md": { manageKey: "new-live-key" },
  };
  const result = remapWebShareRecord(records, "New.md", "Old.md");

  assert.equal(result.changed, false);
  assert.strictEqual(result.records, records);
  assert.deepEqual(result.records, records);
});

test("a configured upload key never crosses hosted-share origins", () => {
  assert.equal(
    uploadKeyForHostedTarget(
      "https://new-host.example",
      "https://new-host.example/",
      " new-host-secret ",
    ),
    "new-host-secret",
  );
  assert.equal(
    uploadKeyForHostedTarget(
      hostedShareBaseFromUrl("https://old-host.example/g/12345678"),
      "https://new-host.example",
      "new-host-secret",
    ),
    undefined,
  );
  assert.equal(
    uploadKeyForHostedTarget("not a URL", "https://new-host.example", "secret"),
    undefined,
  );
});

test("a new publish cannot overwrite an unclaimed legacy management key", () => {
  const fields = {
    webShareLastUrl: "https://old.example/g/legacy123",
    webShareLastId: "legacy123",
    webShareLastManageKey: "legacy-secret",
    webShareLastAt: "2025-01-01T00:00:00.000Z",
    webShareHtmlVersion: 10,
  };
  const before = structuredClone(fields);

  assert.equal(hasUnclaimedLegacyWebShare(fields), true);
  assert.equal(
    recordLastShareUnlessLegacy(
      fields,
      "https://new.example/g/new12345",
      "2026-01-01T00:00:00.000Z",
      12,
    ),
    false,
  );
  assert.deepEqual(fields, before);
});

test("the last-link mirror advances normally when no legacy key exists", () => {
  const fields = {
    webShareLastUrl: "",
    webShareLastId: "",
    webShareLastManageKey: "",
    webShareLastAt: "",
    webShareHtmlVersion: 0,
  };

  assert.equal(
    recordLastShareUnlessLegacy(
      fields,
      "https://new.example/g/new12345",
      "2026-01-01T00:00:00.000Z",
      12,
    ),
    true,
  );
  assert.deepEqual(fields, {
    webShareLastUrl: "https://new.example/g/new12345",
    webShareLastId: "",
    webShareLastManageKey: "",
    webShareLastAt: "2026-01-01T00:00:00.000Z",
    webShareHtmlVersion: 12,
  });
});

test("server-confirmed stop clears only the matching last-link credential", () => {
  const fields = {
    webShareLastUrl: "https://old.example/g/legacy123",
    webShareLastId: "legacy123",
    webShareLastManageKey: "legacy-secret",
    webShareLastAt: "2025-01-01T00:00:00.000Z",
    webShareHtmlVersion: 10,
  };

  assert.equal(
    clearLastShareIfSameUrl(fields, "https://new.example/g/new12345"),
    false,
  );
  assert.equal(fields.webShareLastManageKey, "legacy-secret");
  assert.equal(
    clearLastShareIfSameUrl(fields, "https://old.example/g/legacy123"),
    true,
  );
  assert.equal(fields.webShareLastManageKey, "");
  assert.equal(fields.webShareLastUrl, "");
});
