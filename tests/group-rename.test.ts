import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  groupAddProblem,
  groupRenameErrorMessage,
  groupRenameProblem,
  groupRenameSuccessMessage,
  normalizeRenameInput,
  renameGroupOrderList,
} from "../src/data/groupRename.ts";
import {
  ensureGroupSchema,
  findGroupSchema,
  renameGroupRoute,
  renameGroupScope,
  type GroupSchemaStore,
} from "../src/data/groupSchema.ts";

function emptyStore(): GroupSchemaStore {
  return {
    cardProperties: [],
    propertyDisplayNames: undefined,
    groupSchemas: [],
    fieldKeyLedgers: [],
    cardFieldVisibility: [],
    cardFieldOrder: [],
  };
}

test("rename validation normalizes input and blocks empty, unnamed, and duplicate targets", () => {
  assert.equal(normalizeRenameInput("  중심  "), "중심");
  assert.equal(groupRenameProblem({ from: "", to: "중심", existing: [] }), "unnamed-source");
  assert.equal(groupRenameProblem({ from: "중심", to: "  ", existing: [] }), "empty");
  assert.equal(
    groupRenameProblem({ from: "중심", to: " 미녀 ", existing: ["중심", "미녀"] }),
    "duplicate",
  );
  assert.equal(
    groupRenameProblem({ from: "중심", to: " 중심 ", existing: ["중심"] }),
    null,
  );
  assert.match(groupRenameErrorMessage("duplicate"), /이미 같은 이름/);
  assert.match(groupRenameSuccessMessage("중심", "주요 인물", 3), /노트 3개/);
  assert.match(groupRenameSuccessMessage("빈 그룹", "보조", 0), /빈 그룹/);
});

test("the drawer may rename 기본 but reserves its visible label", () => {
  assert.equal(
    groupRenameProblem({
      from: "",
      to: "주인공",
      existing: ["조연"],
      allowDefaultSource: true,
      defaultRouteVisible: true,
    }),
    null,
  );
  assert.equal(
    groupRenameProblem({
      from: "",
      to: "기본",
      existing: [],
      allowDefaultSource: true,
      defaultRouteVisible: true,
    }),
    "reserved",
  );
  assert.equal(
    groupAddProblem({ name: "기본", existing: [], defaultRouteVisible: true }),
    "reserved",
  );
  assert.equal(
    groupAddProblem({
      name: "__charinfo:default__",
      existing: [],
      defaultRouteVisible: true,
    }),
    "reserved",
  );
  assert.match(groupRenameErrorMessage("reserved"), /기본 그룹/);
});

test("schema rename moves one scoped record, preserves fields, and refuses a merge", () => {
  const settings = emptyStore();
  const source = ensureGroupSchema(settings, "Library A", "예시", "중심");
  source.fields[0]!.label = "보존할 이름";
  ensureGroupSchema(settings, "Library B", "예시", "중심");

  renameGroupScope(settings, "Library A", "예시", "중심", "주요 인물");
  assert.equal(findGroupSchema(settings, "Library A", "예시", "중심"), null);
  assert.equal(
    findGroupSchema(settings, "Library A", "예시", "주요 인물")?.fields[0]?.label,
    "보존할 이름",
  );
  assert.ok(findGroupSchema(settings, "Library B", "예시", "중심"));

  ensureGroupSchema(settings, "Library A", "예시", "미녀");
  assert.throws(
    () => renameGroupScope(settings, "Library A", "예시", "주요 인물", "미녀"),
    /이미 있어요/,
  );
});

test("schema-only rename persists a route even when the source had no record", () => {
  const settings = emptyStore();
  renameGroupScope(settings, "Library A", "예시", "중심", "주요 인물");
  assert.ok(findGroupSchema(settings, "Library A", "예시", "주요 인물"));
});

test("renaming 기본 moves its schema identity to the named route", () => {
  const settings = emptyStore();
  const source = ensureGroupSchema(settings, "Library A", "예시", "");
  source.fields[0]!.label = "보존할 기본 이름";
  renameGroupRoute(settings, "Library A", "예시", "", "주인공");
  assert.equal(findGroupSchema(settings, "Library A", "예시", ""), null);
  assert.equal(
    findGroupSchema(settings, "Library A", "예시", "주인공")?.fields[0]?.label,
    "보존할 기본 이름",
  );
});

test("group order replacement keeps the exact rank", () => {
  assert.deepEqual(renameGroupOrderList(["미녀", "중심", "조연"], "중심", "주요 인물"), [
    "미녀",
    "주요 인물",
    "조연",
  ]);
});

test("production markup keeps rename clickable and drag handle-only", () => {
  const root = join(import.meta.dirname, "..");
  const view = readFileSync(join(root, "src/views/GalleryView.ts"), "utf8");
  const dialog = readFileSync(join(root, "src/ui/GroupRenameDialog.ts"), "utf8");
  const css = readFileSync(join(root, "styles.css"), "utf8");
  assert.match(view, /setIcon\(renameBtn, "pencil"\)/);
  assert.match(view, /setIcon\(rename, "pencil"\)/);
  assert.match(view, /handleSelector: "\.charinfo-genre__drag-handle"/);
  assert.doesNotMatch(view, /handleSelector: "\.charinfo-genre__drag-handle, \.charinfo-genre__header"/);
  assert.doesNotMatch(dialog, /close-button|setIcon\([^\n]*"x"/);
  assert.match(css, /\.charinfo-gallery\.is-edit \.charinfo-genre__title-row\s*\{[^}]*min-height/s);
  assert.match(css, /\.charinfo-genre__drag-handle\s*\{[^}]*width: var\(--size-4-6, 24px\);[^}]*height: var\(--size-4-8, 32px\)/s);
  assert.match(css, /\.charinfo-genre__header h3\s*\{[^}]*min-width: 0;[^}]*text-overflow: ellipsis/s);
});
