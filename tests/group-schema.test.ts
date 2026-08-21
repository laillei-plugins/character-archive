/**
 * Freeze regressions for 그룹 속성 — 정하기와 채우기.
 *
 * `groupSchema.ts` imports nothing from Obsidian, so `node --test` runs it
 * straight from TypeScript. What is locked here is everything that decides
 * *which* field a value belongs to: key allocation (never reused), the lazy
 * built-in baseline, the active-only patch planner, tombstones, 보기 defaults,
 * archive renames, and which library owns a note. The public-page rules live in
 * `tests/share-projection.test.ts`; the Obsidian-side wiring (Book modal, peek
 * editors, heal enqueue, note renames) needs a vault and carries its rules at
 * the call sites.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BUILTIN_FIELD_DEFS,
  LOCKED_FIELD_IDS,
  activateField,
  adoptFieldOption,
  addCustomField,
  addFieldOption,
  applyNotePropertyPlan,
  applyGroupDeletion,
  canRetypeFieldId,
  collectScanPaths,
  deactivateField,
  effectiveActiveFields,
  ensureGroupSchema,
  fieldValue,
  findGroupSchema,
  groupRouteInventory,
  isDefaultSchemaCustomized,
  isFieldVisible,
  isRoutingFieldId,
  ledgerKeys,
  leftoverFieldOptionIds,
  longestMatchingLibrary,
  migratedBuiltinBaseline,
  multiValuedRecords,
  normalizeCardFieldOrder,
  normalizeGroupSchemas,
  planActivePropertyPatch,
  planNoteProperties,
  planGroupDeletion,
  projectSchemaFields,
  reachableActiveFieldIds,
  removeFieldOption,
  renameArchiveScope,
  renameField,
  renameFieldOption,
  reorderActiveFields,
  resolveFieldOrder,
  resolveGroupSchema,
  retypeField,
  sanitizeFieldKey,
  seedBuiltinVisibility,
  setFieldOrder,
  setFieldVisibility,
  storedFieldOrder,
  unionActiveFieldsForArchive,
  type GroupSchemaStore,
} from "../src/data/groupSchema.ts";

const LIB = "Character Archive";
const ARC = "쿠원";

/** Built-ins that can be ordinary schema rows — everything but `그룹`. */
const ORDINARY_BUILTINS = BUILTIN_FIELD_DEFS.filter(
  (def) => !isRoutingFieldId(def.id),
);

function store(
  patch: Partial<GroupSchemaStore> = {},
): GroupSchemaStore {
  return {
    cardProperties: BUILTIN_FIELD_DEFS.map((def) => ({
      id: def.id,
      visible: def.id === "name" || def.id === "status",
    })),
    groupSchemas: [],
    fieldKeyLedgers: [],
    cardFieldVisibility: [],
    cardFieldOrder: [],
    ...patch,
  };
}

/** A character as CharacterStore hands it over. */
function character(
  values: Record<string, string | string[]> = {},
): Parameters<typeof fieldValue>[0] {
  return {
    title: "에트나",
    이름: "에트나",
    코드네임: "",
    본명: "",
    소속: "",
    그룹: "가이드",
    상태: "On",
    관계: "",
    인연: "",
    태그: [],
    values,
  };
}

/* ------------------------------------------------------- 1. key non-reuse */

test("a re-added field never gets the removed field's key", () => {
  const s = store();
  const first = addCustomField(s, LIB, ARC, "가이드", "별명", "text");
  assert.ok(first);
  assert.equal(first.key, "별명");

  deactivateField(s, LIB, ARC, "가이드", first.id);

  const second = addCustomField(s, LIB, ARC, "가이드", "별명", "text");
  assert.ok(second);
  assert.notEqual(second.key, first.key, "a retired key must stay retired");
  assert.notEqual(second.id, first.id, "field ids are never reused either");
  assert.equal(second.key, "별명_2");

  // The first key stays in the ledger and its definition stays as a tombstone.
  assert.ok(ledgerKeys(s, LIB, ARC).includes("별명"));
  const schema = resolveGroupSchema(s, LIB, ARC, "가이드");
  const tomb = schema.fields.find((f) => f.id === first.id);
  assert.ok(tomb);
  assert.equal(tomb.active, false);
  assert.equal(tomb.key, "별명");
});

test("the same label in two groups of one archive gets two keys", () => {
  const s = store();
  const guide = addCustomField(s, LIB, ARC, "가이드", "별명", "text");
  const sentinel = addCustomField(s, LIB, ARC, "센티넬", "별명", "text");
  assert.ok(guide && sentinel);
  assert.notEqual(guide.key, sentinel.key);
  assert.equal(guide.key, "별명");
  assert.equal(sentinel.key, "별명_2");
});

test("a key is only unique per library+archive scope", () => {
  const s = store();
  const here = addCustomField(s, LIB, ARC, "", "별명", "text");
  const there = addCustomField(s, LIB, "Fearless", "", "별명", "text");
  assert.ok(here && there);
  // Different archives are different scopes — the same key is fine.
  assert.equal(here.key, "별명");
  assert.equal(there.key, "별명");
});

test("allocation avoids keys already hand-written in archive notes", () => {
  const s = store();
  const field = addCustomField(
    s,
    LIB,
    ARC,
    "가이드",
    "나이",
    "text",
    ["나이"],
  );
  assert.ok(field);
  assert.equal(field.key, "나이_2");
  assert.ok(ledgerKeys(s, LIB, ARC).includes("나이_2"));
});

test("sanitize refuses dangerous keys and keeps readable ones", () => {
  assert.equal(sanitizeFieldKey("좋아하는 색"), "좋아하는_색");
  assert.equal(sanitizeFieldKey("  a:b#c  "), "a_b_c");
  assert.equal(sanitizeFieldKey("kind"), "속성");
  assert.equal(sanitizeFieldKey("__proto__"), "_proto_");
  assert.equal(sanitizeFieldKey("장르"), "속성");
  assert.equal(sanitizeFieldKey(""), "속성");
  assert.equal(sanitizeFieldKey("   "), "속성");
});

/* ------------------------------------------------ 2. migration + baseline */

test("the baseline follows the stored 보기 order, all nine active", () => {
  const s = store({
    cardProperties: [
      { id: "tags", visible: true },
      { id: "codename", visible: false },
      { id: "name", visible: true },
    ],
  });
  const fields = migratedBuiltinBaseline(s.cardProperties);
  assert.deepEqual(
    fields.slice(0, 3).map((f) => f.id),
    ["tags", "codename", "name"],
  );
  assert.equal(fields.length, ORDINARY_BUILTINS.length);
  assert.ok(
    !fields.some((f) => f.id === "group"),
    "`그룹` routes to a schema; it is never a row inside one",
  );
  assert.ok(fields.every((f) => f.active), "eye state is not active state");

  const schema = resolveGroupSchema(s, LIB, ARC, "가이드");
  assert.deepEqual(
    schema.fields.map((f) => f.id),
    fields.map((f) => f.id),
  );
  assert.equal(schema.revision, 0);
});

test("an unseen group gets the baseline, not a sibling's custom fields", () => {
  const s = store();
  const custom = addCustomField(s, LIB, ARC, "가이드", "별명", "text");
  assert.ok(custom);

  const unseen = resolveGroupSchema(s, LIB, ARC, "센티넬");
  assert.equal(unseen.fields.length, ORDINARY_BUILTINS.length);
  assert.ok(!unseen.fields.some((f) => f.id === custom.id));
  // 미분류 is its own scope, and equally untouched.
  const ungrouped = resolveGroupSchema(s, LIB, ARC, "");
  assert.ok(!ungrouped.fields.some((f) => f.id === custom.id));
});

test("resolve does not persist; the caller does", () => {
  const s = store();
  resolveGroupSchema(s, LIB, ARC, "가이드");
  assert.equal(s.groupSchemas.length, 0);
  ensureGroupSchema(s, LIB, ARC, "가이드");
  assert.equal(s.groupSchemas.length, 1);
  ensureGroupSchema(s, LIB, ARC, "가이드");
  assert.equal(s.groupSchemas.length, 1, "ensure is idempotent");
});

test("a zero-member group schema round-trips through the array store", () => {
  const s = store();
  addCustomField(s, LIB, ARC, "사라진그룹", "옛속성", "select");
  const raw = JSON.parse(JSON.stringify(s.groupSchemas)) as unknown;
  const back = normalizeGroupSchemas(raw);
  assert.equal(back.length, 1);
  const restored = store({ groupSchemas: back });
  const schema = findGroupSchema(restored, LIB, ARC, "사라진그룹");
  assert.ok(schema, "a group with no cards keeps its schema");
  assert.ok(schema.fields.some((f) => f.key === "옛속성"));
});

test("normalize drops malformed records and reserved keys", () => {
  const good = normalizeGroupSchemas([
    {
      library: LIB,
      archive: ARC,
      group: "가이드",
      revision: 3,
      fields: [
        ...BUILTIN_FIELD_DEFS.map((d) => ({ id: d.id, key: d.key, type: d.type })),
        { id: "f_1", key: "kind", type: "text" },
        { id: "f_2", key: "별명", type: "banana" },
        { id: "", key: "무명", type: "text" },
        { id: "f_3", key: "별명", type: "text", active: false, purge: true },
      ],
    },
    { library: "", archive: ARC, group: "", fields: [] },
    { library: LIB, archive: ARC, group: "반쪽", fields: [{ id: "f_9", key: "x", type: "text" }] },
  ]);
  assert.equal(good.length, 1, "no-library and locked-less records are dropped");
  const record = good[0];
  assert.ok(record);
  assert.equal(record.revision, 3);
  assert.ok(!record.fields.some((f) => f.key === "kind"));
  assert.ok(!record.fields.some((f) => f.id === "f_2"), "unknown type dropped");
  assert.ok(
    record.fields.some((f) => f.id === "f_3" && !f.active && f.purge),
  );
});

/* ---------------------------------------------------- 3. tombstones + locks */

test("locked fields cannot be deactivated", () => {
  const s = store();
  ensureGroupSchema(s, LIB, ARC, "가이드");
  const before = resolveGroupSchema(s, LIB, ARC, "가이드");
  for (const id of LOCKED_FIELD_IDS) {
    deactivateField(s, LIB, ARC, "가이드", id);
  }
  const after = resolveGroupSchema(s, LIB, ARC, "가이드");
  assert.equal(after.revision, before.revision, "a no-op does not bump revision");
  assert.deepEqual(
    effectiveActiveFields(after).map((f) => f.id),
    effectiveActiveFields(before).map((f) => f.id),
  );
});

test("an optional built-in can be deactivated and keeps its key", () => {
  const s = store();
  deactivateField(s, LIB, ARC, "가이드", "codename");
  const schema = resolveGroupSchema(s, LIB, ARC, "가이드");
  assert.ok(!effectiveActiveFields(schema).some((f) => f.id === "codename"));
  const tomb = schema.fields.find((f) => f.id === "codename");
  assert.ok(tomb);
  assert.equal(tomb.key, "코드네임");
  assert.equal(tomb.purge, true);
});

test("activateField restores a tombstone to the end of the active list", () => {
  const s = store();
  ensureGroupSchema(s, LIB, ARC, "가이드");
  deactivateField(s, LIB, ARC, "가이드", "bond");
  const before = resolveGroupSchema(s, LIB, ARC, "가이드");
  activateField(s, LIB, ARC, "가이드", "bond");
  const after = resolveGroupSchema(s, LIB, ARC, "가이드");
  assert.equal(after.revision, before.revision + 1);
  const bond = after.fields.find((f) => f.id === "bond");
  assert.ok(bond);
  assert.equal(bond.active, true);
  assert.equal(bond.purge, undefined);
  const actives = effectiveActiveFields(after);
  assert.equal(actives[actives.length - 1].id, "bond");
});

test("activateField is a no-op on an already-active field", () => {
  const s = store();
  ensureGroupSchema(s, LIB, ARC, "가이드");
  const before = resolveGroupSchema(s, LIB, ARC, "가이드");
  activateField(s, LIB, ARC, "가이드", "bond");
  const after = resolveGroupSchema(s, LIB, ARC, "가이드");
  assert.equal(after.revision, before.revision);
});

test("rename touches the label only, and reorder keeps actives in front", () => {
  const s = store();
  const custom = addCustomField(s, LIB, ARC, "가이드", "별명", "text");
  assert.ok(custom);
  renameField(s, LIB, ARC, "가이드", custom.id, "부르는 이름");
  deactivateField(s, LIB, ARC, "가이드", "bond");

  let schema = resolveGroupSchema(s, LIB, ARC, "가이드");
  const renamed = schema.fields.find((f) => f.id === custom.id);
  assert.ok(renamed);
  assert.equal(renamed.label, "부르는 이름");
  assert.equal(renamed.key, "별명", "the YAML key never moves");

  const actives = effectiveActiveFields(schema).map((f) => f.id);
  const flipped = [...actives].reverse();
  reorderActiveFields(s, LIB, ARC, "가이드", flipped);
  schema = resolveGroupSchema(s, LIB, ARC, "가이드");
  assert.deepEqual(effectiveActiveFields(schema).map((f) => f.id), flipped);
  assert.deepEqual(
    schema.fields.slice(0, flipped.length).map((f) => f.id),
    flipped,
    "actives form the array prefix; tombstones follow",
  );
  assert.ok(schema.fields.slice(flipped.length).every((f) => !f.active));
});

test("every persisted mutation bumps the revision", () => {
  const s = store();
  const custom = addCustomField(s, LIB, ARC, "가이드", "별명", "select");
  assert.ok(custom);
  const afterAdd = resolveGroupSchema(s, LIB, ARC, "가이드").revision;
  assert.equal(afterAdd, 1);
  addFieldOption(s, LIB, ARC, "가이드", custom.id, "야옹");
  assert.equal(resolveGroupSchema(s, LIB, ARC, "가이드").revision, 2);
  deactivateField(s, LIB, ARC, "가이드", custom.id);
  assert.equal(resolveGroupSchema(s, LIB, ARC, "가이드").revision, 3);
});

/* --------------------------------------------------- 3b. the type mutator */

test("a type change bumps the revision; an identical one does not", () => {
  const s = store();
  const field = addCustomField(s, LIB, ARC, "가이드", "성격", "text");
  assert.ok(field);
  const before = resolveGroupSchema(s, LIB, ARC, "가이드").revision;

  assert.equal(retypeField(s, LIB, ARC, "가이드", field.id, "select"), "changed");
  assert.equal(resolveGroupSchema(s, LIB, ARC, "가이드").revision, before + 1);
  assert.equal(
    resolveGroupSchema(s, LIB, ARC, "가이드").fields.find((f) => f.id === field.id)
      ?.type,
    "select",
  );

  assert.equal(
    retypeField(s, LIB, ARC, "가이드", field.id, "select"),
    "unchanged",
    "an idempotent pick must not churn every reader's revision",
  );
  assert.equal(resolveGroupSchema(s, LIB, ARC, "가이드").revision, before + 1);

  assert.equal(
    retypeField(s, LIB, ARC, "가이드", "f_없음", "select"),
    "unknown-field",
  );
});

test("`이름` and `그룹` refuse a type change", () => {
  const s = store();
  ensureGroupSchema(s, LIB, ARC, "가이드");
  assert.equal(
    retypeField(s, LIB, ARC, "가이드", "name", "select"),
    "fixed-field",
  );
  assert.equal(
    retypeField(s, LIB, ARC, "가이드", "group", "select"),
    "fixed-field",
  );
  const schema = resolveGroupSchema(s, LIB, ARC, "가이드");
  assert.equal(schema.fields.find((f) => f.id === "name")?.type, "text");
  assert.equal(schema.revision, 0, "a refused change writes nothing");
  assert.equal(canRetypeFieldId("name"), false);
  assert.equal(canRetypeFieldId("status"), true);
});

test("a built-in's type override survives normalization; `이름`'s does not", () => {
  const s = store();
  ensureGroupSchema(s, LIB, ARC, "가이드");
  retypeField(s, LIB, ARC, "가이드", "codename", "multi-select");
  const stored = findGroupSchema(s, LIB, ARC, "가이드");
  assert.ok(stored);

  // Round-trip exactly as a reload would: serialize, then normalize back. The
  // `이름` row is tampered with on the way out — a legacy or hand-edited write
  // must not be able to retype the card identity.
  const raw = JSON.parse(
    JSON.stringify([
      {
        ...stored,
        fields: stored.fields.map((f) =>
          f.id === "name" ? { ...f, type: "multi-select" } : f,
        ),
      },
    ]),
  );
  const reloaded = normalizeGroupSchemas(raw);
  const fields = reloaded[0]?.fields ?? [];
  assert.equal(
    fields.find((f) => f.id === "codename")?.type,
    "multi-select",
    "a persisted override is authoritative after a reload",
  );
  assert.equal(
    fields.find((f) => f.id === "codename")?.key,
    "코드네임",
    "the YAML key never moves",
  );
  assert.equal(
    fields.find((f) => f.id === "name")?.type,
    "text",
    "`이름` is always text, whatever is stored",
  );
});

test("switching to text keeps dormant options; switching back restores them", () => {
  const s = store();
  const field = addCustomField(s, LIB, ARC, "가이드", "성격", "select");
  assert.ok(field);
  addFieldOption(s, LIB, ARC, "가이드", field.id, "차분함");
  addFieldOption(s, LIB, ARC, "가이드", field.id, "활발함");

  retypeField(s, LIB, ARC, "가이드", field.id, "text");
  const dormant = resolveGroupSchema(s, LIB, ARC, "가이드").fields.find(
    (f) => f.id === field.id,
  );
  assert.deepEqual(
    dormant?.options.map((o) => o.label),
    ["차분함", "활발함"],
    "a type change is not a delete",
  );

  // The reload in between is the part that used to erase them.
  const reloaded = normalizeGroupSchemas(
    JSON.parse(JSON.stringify(s.groupSchemas)),
  );
  s.groupSchemas = reloaded;
  retypeField(s, LIB, ARC, "가이드", field.id, "multi-select");
  const restored = resolveGroupSchema(s, LIB, ARC, "가이드").fields.find(
    (f) => f.id === field.id,
  );
  assert.deepEqual(restored?.options.map((o) => o.label), ["차분함", "활발함"]);
  // …and a new option still cannot reuse a dormant id.
  const next = addFieldOption(s, LIB, ARC, "가이드", field.id, "새로");
  assert.equal(next, "o_3");
});

/**
 * A note as CharacterStore hands it over: `values` keeps the YAML shape, while
 * the typed built-in field is the flattened text it always was.
 */
function withCodename(stored: string | string[]) {
  const record = character({ 코드네임: stored });
  record.코드네임 = Array.isArray(stored) ? stored.join(", ") : stored;
  return record;
}

test("a retyped value is coerced, never rewritten", () => {
  const codename = { id: "codename", key: "코드네임" };
  const one = withCodename("그림자");
  const many = withCodename(["그림자", "밤"]);

  // text (the built-in default) reads the typed field, exactly as before.
  assert.equal(fieldValue(one, { ...codename, type: "text" }), "그림자");
  // multi-select reads a scalar as a singleton and a list losslessly.
  assert.deepEqual(fieldValue(one, { ...codename, type: "multi-select" }), [
    "그림자",
  ]);
  assert.deepEqual(fieldValue(many, { ...codename, type: "multi-select" }), [
    "그림자",
    "밤",
  ]);
  // A stored list under a scalar type displays joined, losing nothing on disk.
  assert.equal(fieldValue(many, { ...codename, type: "select" }), "그림자, 밤");

  // `태그` is a multi-select built-in; read as text it joins.
  const tagged = character();
  tagged.태그 = ["귀여움", "밤"];
  assert.equal(
    fieldValue(tagged, { id: "tags", key: "태그", type: "text" }),
    "귀여움, 밤",
  );
});

test("multi-select → scalar is refused only when a member would lose a value", () => {
  const codename = { id: "codename", key: "코드네임" };
  const safe = [withCodename("그림자"), character()];
  const lossy = [withCodename("그림자"), withCodename(["그림자", "밤"])];
  assert.deepEqual(multiValuedRecords(safe, codename), []);
  assert.equal(multiValuedRecords(lossy, codename).length, 1);

  // A custom field is read the same way, through `values[key]`.
  const custom = { id: "f_1", key: "별명" };
  assert.equal(
    multiValuedRecords([character({ 별명: ["가", "나"] })], custom).length,
    1,
  );
  assert.deepEqual(multiValuedRecords([character({ 별명: "가" })], custom), []);
});

test("a scoped type override counts as a customized default schema", () => {
  const s = store();
  ensureGroupSchema(s, LIB, ARC, "");
  assert.equal(isDefaultSchemaCustomized(s, LIB, ARC), false);
  retypeField(s, LIB, ARC, "", "codename", "select");
  assert.equal(isDefaultSchemaCustomized(s, LIB, ARC), true);
});

test("a removed option id is never handed to a new option", () => {
  const s = store();
  const field = addCustomField(s, LIB, ARC, "가이드", "성격", "select");
  assert.ok(field);
  const first = addFieldOption(s, LIB, ARC, "가이드", field.id, "차분함");
  const second = addFieldOption(s, LIB, ARC, "가이드", field.id, "활발함");
  assert.equal(first, "o_1");
  assert.equal(second, "o_2");
  removeFieldOption(s, LIB, ARC, "가이드", field.id, "o_2");
  const third = addFieldOption(s, LIB, ARC, "가이드", field.id, "다시 활발함");
  assert.notEqual(third, "o_2", "renaming must not revive a stored value");
  assert.equal(third, "o_3");
});

test("a dormant field option can be restored by its exact id", () => {
  const s = store();
  const field = addCustomField(s, LIB, ARC, "가이드", "성격", "select");
  assert.ok(field);
  addFieldOption(s, LIB, ARC, "가이드", field.id, "차분함");
  addFieldOption(s, LIB, ARC, "가이드", field.id, "활발함");
  removeFieldOption(s, LIB, ARC, "가이드", field.id, "o_2");

  let current = resolveGroupSchema(s, LIB, ARC, "가이드").fields.find(
    (item) => item.id === field.id,
  );
  assert.ok(current);
  assert.deepEqual(
    leftoverFieldOptionIds(current, [
      { values: { [field.key]: ["o_2", "legacy"] } },
    ]),
    ["o_2", "legacy"],
  );

  assert.equal(
    adoptFieldOption(s, LIB, ARC, "가이드", field.id, "o_2"),
    true,
  );
  current = resolveGroupSchema(s, LIB, ARC, "가이드").fields.find(
    (item) => item.id === field.id,
  );
  assert.ok(current);
  assert.equal(current.options.find((option) => option.id === "o_2")?.label, "o_2");
  assert.deepEqual(
    leftoverFieldOptionIds(current, [
      { values: { [field.key]: ["o_2", "legacy"] } },
    ]),
    ["legacy"],
  );
});

test("adopting a high dormant id advances the next minted option id", () => {
  const s = store();
  const field = addCustomField(s, LIB, ARC, "가이드", "성격", "select");
  assert.ok(field);
  assert.equal(
    adoptFieldOption(s, LIB, ARC, "가이드", field.id, "o_9"),
    true,
  );
  assert.equal(
    addFieldOption(s, LIB, ARC, "가이드", field.id, "새 항목"),
    "o_10",
  );
});

/* ------------------------------------------------------- 4. patch planner */

test("planActivePropertyPatch restores only missing active keys", () => {
  const fm = { kind: "character", 이름: "에트나", 별명: "냐" };
  const patch = planActivePropertyPatch(fm, [
    { key: "이름", type: "text" },
    { key: "태그", type: "multi-select" },
    { key: "별명", type: "text" },
    { key: "성격", type: "select" },
  ]);
  assert.deepEqual(patch, { 태그: [], 성격: "" });
  assert.ok(Array.isArray(patch?.태그));
});

test("the planner never mentions inactive or unknown keys", () => {
  const fm = { kind: "character", 이름: "", 없앤속성: "지켜야 함", 내메모: 1 };
  const patch = planActivePropertyPatch(fm, [
    { key: "이름", type: "text" },
    { key: "본명", type: "text" },
  ]);
  assert.deepEqual(patch, { 본명: "" });
  assert.ok(patch && !("없앤속성" in patch), "a tombstone key is not restored");
  assert.ok(patch && !("내메모" in patch), "unknown keys are left alone");
});

test("nothing missing, non-character, or reserved plans no write", () => {
  assert.equal(
    planActivePropertyPatch({ kind: "character", 이름: "" }, [
      { key: "이름", type: "text" },
    ]),
    null,
  );
  assert.equal(planActivePropertyPatch({ kind: "gallery" }, [{ key: "이름", type: "text" }]), null);
  assert.equal(planActivePropertyPatch({}, [{ key: "이름", type: "text" }]), null);
  assert.equal(planActivePropertyPatch(null, []), null);
  assert.equal(
    planActivePropertyPatch({ kind: "character" }, [
      { key: "kind", type: "text" },
      { key: "장르", type: "text" },
    ]),
    null,
    "reserved keys are never created",
  );
});

test("heal uses the latest active set, not the one it was queued with", () => {
  const s = store();
  const field = addCustomField(s, LIB, ARC, "가이드", "별명", "text");
  assert.ok(field);
  // The note is queued here (schema revision 1, 별명 active)…
  const fm = { kind: "character", 이름: "에트나" };
  deactivateField(s, LIB, ARC, "가이드", field.id);
  // …and the run resolves the schema again, now at revision 2.
  const patch = planActivePropertyPatch(
    fm,
    effectiveActiveFields(resolveGroupSchema(s, LIB, ARC, "가이드")),
  );
  assert.ok(patch);
  assert.ok(!("별명" in patch), "a removed key must not come back");
  assert.ok("본명" in patch, "the built-ins are still restored");
});

test("note reconciliation removes only purge-marked schema keys", () => {
  const fm: Record<string, unknown> = {
    kind: "character",
    이름: "에트나",
    지난_속성: "보존",
    지울_속성: "삭제",
    내메모: "유지",
  };
  const plan = planNoteProperties(fm, [
    { id: "name", key: "이름", type: "text", active: true },
    { id: "f_1", key: "지난_속성", type: "text", active: false },
    {
      id: "f_2",
      key: "지울_속성",
      type: "text",
      active: false,
      purge: true,
    },
  ]);
  assert.ok(plan);
  assert.deepEqual(plan.remove, ["지울_속성"]);
  applyNotePropertyPlan(fm, plan);
  assert.equal(fm.지난_속성, "보존");
  assert.equal(fm.내메모, "유지");
  assert.equal("지울_속성" in fm, false);
});

test("note reconciliation orders active fields before storage and reaches a fixpoint", () => {
  const fm: Record<string, unknown> = {
    kind: "character",
    장르: "예시",
    그룹: "중심",
    이름: "에트나",
    상태: "On",
    내메모: "유지",
    cover: "[[cover.png]]",
    order: 0,
    coverPosition: "50% 50%",
  };
  const fields = [
    { id: "name", key: "이름", type: "text" as const, active: true },
    { id: "status", key: "상태", type: "select" as const, active: true },
    { id: "f_1", key: "별명", type: "text" as const, active: true },
  ];
  const plan = planNoteProperties(fm, fields);
  assert.ok(plan && !plan.clean);
  assert.deepEqual(plan.add, { 별명: "" });
  applyNotePropertyPlan(fm, plan);
  assert.deepEqual(Object.keys(fm), [
    "kind",
    "장르",
    "그룹",
    "이름",
    "상태",
    "별명",
    "내메모",
    "cover",
    "coverPosition",
    "order",
  ]);
  assert.equal(fm.내메모, "유지");
  const second = planNoteProperties(fm, fields);
  assert.ok(second?.clean, "plan → apply → plan must not rewrite forever");
});

test("purge cannot delete identity, routing, or storage keys", () => {
  const protectedKeys = [
    "이름",
    "그룹",
    "kind",
    "장르",
    "작품",
    "cover",
    "coverPosition",
    "cover_position",
    "order",
    "charinfo_order",
  ];
  const fm = Object.fromEntries(
    protectedKeys.map((key) => [key, key === "kind" ? "character" : "값"]),
  );
  const plan = planNoteProperties(
    fm,
    protectedKeys.map((key, index) => ({
      id: `forged_${index}`,
      key,
      type: "text" as const,
      active: false,
      purge: true as const,
    })),
  );
  assert.ok(plan);
  assert.deepEqual(plan.remove, []);
  applyNotePropertyPlan(fm, plan);
  for (const key of protectedKeys) assert.ok(key in fm, key);
});

/* --------------------------------------------------------- 5. values + 보기 */

test("fieldValue reads built-ins typed and custom fields from values", () => {
  const record = character({ 별명: "냐", 성격: ["o_1", " "] });
  assert.equal(fieldValue(record, { id: "name", key: "이름", type: "text" }), "에트나");
  assert.equal(fieldValue(record, { id: "group", key: "그룹", type: "text" }), "가이드");
  assert.equal(fieldValue(record, { id: "f_1", key: "별명", type: "text" }), "냐");
  assert.deepEqual(
    fieldValue(record, { id: "f_2", key: "성격", type: "multi-select" }),
    ["o_1"],
  );
  // A missing custom key reads as the type-correct empty, never `undefined`.
  assert.equal(fieldValue(record, { id: "f_3", key: "없음", type: "text" }), "");
  assert.deepEqual(
    fieldValue(record, { id: "f_4", key: "없음", type: "multi-select" }),
    [],
  );
});

test("a missing eye row reads name/status on, other built-ins off, custom on", () => {
  // `cardProperties` says the opposite of the default for every built-in —
  // nothing may read it live, so the answers must not move.
  const s = store({
    cardProperties: BUILTIN_FIELD_DEFS.map((def) => ({
      id: def.id,
      visible: !(def.id === "name" || def.id === "status"),
    })),
  });
  const field = addCustomField(s, LIB, ARC, "가이드", "별명", "text");
  assert.ok(field);
  assert.equal(isFieldVisible(s, "page.md", ARC, field.id), true);
  assert.equal(isFieldVisible(s, "page.md", ARC, "name"), true);
  assert.equal(isFieldVisible(s, "page.md", ARC, "status"), true);
  for (const def of BUILTIN_FIELD_DEFS) {
    if (def.id === "name" || def.id === "status") continue;
    assert.equal(
      isFieldVisible(s, "page.md", ARC, def.id),
      false,
      `${def.id} starts hidden`,
    );
  }
});

test("seeded visibility rows override the missing-row defaults", () => {
  const rows = seedBuiltinVisibility(
    [],
    [{ page: "page.md", archive: ARC }],
    [
      { id: "name", visible: false },
      { id: "codename", visible: true },
    ],
  );
  const s = store({ cardFieldVisibility: rows });
  assert.equal(
    isFieldVisible(s, "page.md", ARC, "name"),
    false,
    "a migrated vault keeps the eyes it had",
  );
  assert.equal(isFieldVisible(s, "page.md", ARC, "codename"), true);
  // The seed only covers the pair it was given.
  assert.equal(isFieldVisible(s, "other.md", ARC, "codename"), false);
});

test("toggling one page never touches cardProperties or another page", () => {
  const s = store();
  const before = JSON.stringify(s.cardProperties);
  const field = addCustomField(s, LIB, ARC, "가이드", "별명", "text");
  assert.ok(field);

  setFieldVisibility(s, "page.md", ARC, field.id, false);
  setFieldVisibility(s, "page.md", ARC, "codename", true);

  assert.equal(isFieldVisible(s, "page.md", ARC, field.id), false);
  assert.equal(isFieldVisible(s, "page.md", ARC, "codename"), true);
  assert.equal(
    isFieldVisible(s, "other.md", ARC, field.id),
    true,
    "eyes are per page + archive",
  );
  assert.equal(
    isFieldVisible(s, "other.md", ARC, "codename"),
    false,
    "page B keeps the default",
  );
  assert.equal(
    isFieldVisible(s, "page.md", "Fearless", "codename"),
    false,
    "another archive on the same page keeps the default",
  );
  assert.equal(
    JSON.stringify(s.cardProperties),
    before,
    "the legacy list is a migration seed, not a writeback target",
  );
});

test("보기 lists the archive union once, with a group suffix on clashes", () => {
  const s = store();
  const guide = addCustomField(s, LIB, ARC, "가이드", "별명", "text");
  const sentinel = addCustomField(s, LIB, ARC, "센티넬", "별명", "text");
  const solo = addCustomField(s, LIB, ARC, "", "혼자쓰는", "text");
  assert.ok(guide && sentinel && solo);

  const rows = unionActiveFieldsForArchive(s, LIB, ARC, "page.md", [
    "가이드",
    "센티넬",
    "",
  ]);
  const builtins = rows.filter((row) => row.builtin);
  assert.equal(builtins.length, ORDINARY_BUILTINS.length, "built-ins once");
  assert.ok(
    !rows.some((row) => row.fieldId === "group"),
    "보기 never lists the routing field",
  );

  const clashes = rows.filter((row) => row.fieldId === guide.id || row.fieldId === sentinel.id);
  assert.deepEqual(clashes.map((row) => row.label), ["별명 (가이드)", "별명 (센티넬)"]);
  const ungrouped = rows.find((row) => row.fieldId === solo.id);
  assert.ok(ungrouped);
  assert.equal(ungrouped.label, "혼자쓰는", "a unique label keeps its name");
  assert.equal(ungrouped.group, "");

  // Another archive of the same library must not leak in.
  const other = addCustomField(s, LIB, "Fearless", "가이드", "다른아카이브", "text");
  assert.ok(other);
  assert.ok(
    !unionActiveFieldsForArchive(s, LIB, ARC, "page.md", ["가이드"]).some(
      (row) => row.key === other.key,
    ),
    "a field from another archive must not appear in this archive's 보기",
  );
});

test("보기 keeps a zero-member group's custom field", () => {
  const s = store();
  const ghost = addCustomField(s, LIB, ARC, "사라진그룹", "옛속성", "text");
  assert.ok(ghost);
  // Nobody is in 사라진그룹 any more — only 가이드 has cards.
  const rows = unionActiveFieldsForArchive(s, LIB, ARC, "page.md", ["가이드"]);
  assert.ok(
    rows.some((row) => row.fieldId === ghost.id),
    "a persisted group with no cards still owns its field",
  );
});

test("an observed group's baseline restores a field another group removed", () => {
  const s = store();
  // Group A is persisted with 태그 removed; group B has never been stored.
  ensureGroupSchema(s, LIB, ARC, "가이드");
  deactivateField(s, LIB, ARC, "가이드", "tags");
  assert.ok(
    !unionActiveFieldsForArchive(s, LIB, ARC, "page.md", ["가이드"]).some(
      (row) => row.fieldId === "tags",
    ),
    "with only group A around, 태그 is gone",
  );

  const rows = unionActiveFieldsForArchive(s, LIB, ARC, "page.md", [
    "가이드",
    "센티넬",
  ]);
  assert.ok(
    rows.some((row) => row.fieldId === "tags"),
    "group B still has the built-in baseline, so 태그 is listed",
  );
});

/* ------------------------------------------------------- 6. archive rename */

test("an archive move carries schemas, tombstones, revisions and ledger keys", () => {
  const s = store();
  const kept = addCustomField(s, LIB, ARC, "가이드", "별명", "select");
  const tomb = addCustomField(s, LIB, ARC, "가이드", "옛속성", "text");
  assert.ok(kept && tomb);
  addFieldOption(s, LIB, ARC, "가이드", kept.id, "야옹");
  deactivateField(s, LIB, ARC, "가이드", tomb.id);
  ensureGroupSchema(s, LIB, ARC, "");
  setFieldVisibility(s, "page.md", ARC, kept.id, false);
  const revisionBefore = resolveGroupSchema(s, LIB, ARC, "가이드").revision;
  const keysBefore = ledgerKeys(s, LIB, ARC);

  renameArchiveScope(s, LIB, ARC, "쿠원2", ["page.md"]);

  assert.equal(findGroupSchema(s, LIB, ARC, "가이드"), null, "the old scope is gone");
  const moved = findGroupSchema(s, LIB, "쿠원2", "가이드");
  assert.ok(moved);
  assert.equal(moved.revision, revisionBefore, "revisions survive the move");
  assert.ok(
    findGroupSchema(s, LIB, "쿠원2", ""),
    "every group of the archive moves, 미분류 included",
  );
  const movedTomb = moved.fields.find((f) => f.id === tomb.id);
  assert.ok(movedTomb);
  assert.equal(movedTomb.active, false, "a tombstone stays a tombstone");
  const movedKept = moved.fields.find((f) => f.id === kept.id);
  assert.ok(movedKept);
  assert.deepEqual(movedKept.options.map((o) => o.label), ["야옹"]);
  assert.deepEqual(ledgerKeys(s, LIB, "쿠원2"), keysBefore, "key history moves");
  assert.equal(
    isFieldVisible(s, "page.md", "쿠원2", kept.id),
    false,
    "the scoped eye row followed its archive",
  );
});

test("a same-label field added after the move gets the next key and id", () => {
  const s = store();
  const first = addCustomField(s, LIB, ARC, "가이드", "별명", "text");
  assert.ok(first);
  renameArchiveScope(s, LIB, ARC, "쿠원2", ["page.md"]);

  const second = addCustomField(s, LIB, "쿠원2", "가이드", "별명", "text");
  assert.ok(second);
  assert.equal(second.key, "별명_2", "the moved ledger still owns 별명");
  assert.notEqual(second.id, first.id);
  assert.equal(second.id, "f_2");
});

test("a destination that already exists throws before anything moves", () => {
  const s = store();
  addCustomField(s, LIB, ARC, "가이드", "별명", "text");
  addCustomField(s, LIB, "Fearless", "가이드", "다른것", "text");
  const before = JSON.stringify(s);

  assert.throws(
    () => renameArchiveScope(s, LIB, ARC, "Fearless", ["page.md"]),
    /Fearless/,
  );
  assert.equal(JSON.stringify(s), before, "a refused rename writes nothing");
});

test("a destination eye row on a targeted page also refuses the move", () => {
  const s = store();
  ensureGroupSchema(s, LIB, ARC, "가이드");
  setFieldVisibility(s, "page.md", "Fearless", "codename", true);
  const before = JSON.stringify(s);
  assert.throws(() =>
    renameArchiveScope(s, LIB, ARC, "Fearless", ["page.md"]),
  );
  assert.equal(JSON.stringify(s), before);
  // The same row on an untargeted page is another library's business.
  const other = store({
    groupSchemas: [resolveGroupSchema(store(), LIB, ARC, "가이드")],
    cardFieldVisibility: [
      { page: "other.md", archive: "Fearless", fieldId: "codename", visible: true },
    ],
  });
  renameArchiveScope(other, LIB, ARC, "Fearless", ["page.md"]);
  assert.ok(findGroupSchema(other, LIB, "Fearless", "가이드"));
});

test("eye rows outside the supplied pages keep their archive", () => {
  const s = store();
  ensureGroupSchema(s, LIB, ARC, "가이드");
  setFieldVisibility(s, "mine.md", ARC, "codename", true);
  setFieldVisibility(s, "theirs.md", ARC, "codename", true);

  renameArchiveScope(s, LIB, ARC, "쿠원2", ["mine.md"]);

  assert.equal(isFieldVisible(s, "mine.md", "쿠원2", "codename"), true);
  assert.equal(
    s.cardFieldVisibility.some(
      (row) => row.page === "theirs.md" && row.archive === ARC,
    ),
    true,
    "a page of another library must keep pointing at its own archive",
  );
});

test("an archive rename to the same normalized name does nothing", () => {
  const s = store();
  ensureGroupSchema(s, LIB, ARC, "가이드");
  const before = JSON.stringify(s);
  renameArchiveScope(s, LIB, ARC, ` ${ARC} `, ["page.md"]);
  assert.equal(JSON.stringify(s), before);
});

/* ----------------------------------------------------- 7. library identity */

test("a note under a nested library belongs to the nested one", () => {
  assert.equal(
    longestMatchingLibrary("Root/Sub/x.md", ["Root", "Root/Sub"], "Fallback"),
    "Root/Sub",
  );
  assert.equal(
    longestMatchingLibrary("Root/x.md", ["Root", "Root/Sub"], "Fallback"),
    "Root",
  );
  assert.equal(
    longestMatchingLibrary("Elsewhere/x.md", ["Root", "Root/Sub"], "Fallback"),
    "Fallback",
    "no identity contains it → the default library",
  );
  assert.equal(
    longestMatchingLibrary("Root/Sub/x.md", ["Root/Sub/", " Root "], "Fallback"),
    "Root/Sub",
    "identities are normalized before matching",
  );
});

test("overlapping scan roots hand each file over exactly once", () => {
  const paths = collectScanPaths(
    ["Root/a.md", "Root/Sub/b.md", "Root/Sub/b.md", "Elsewhere/c.md"],
    ["Root", "Root/Sub"],
  );
  assert.deepEqual(paths, ["Root/a.md", "Root/Sub/b.md"]);
});

/* ------------------------------------------------------------- 8. sharing */

test("share projection includes active custom fields and omits tombstones", () => {
  const s = store();
  const kept = addCustomField(s, LIB, ARC, "가이드", "별명", "text");
  const dropped = addCustomField(s, LIB, ARC, "가이드", "옛속성", "text");
  assert.ok(kept && dropped);
  deactivateField(s, LIB, ARC, "가이드", dropped.id);

  const record = character({ 별명: "냐", 옛속성: "남아 있음" });
  const fields = effectiveActiveFields(resolveGroupSchema(s, LIB, ARC, "가이드"));
  const published = fields
    .filter((field) => !["name", "status", "tags"].includes(field.id))
    .map((field) => ({
      key: field.key,
      value: fieldValue(record, field),
    }));

  assert.ok(published.some((prop) => prop.key === "별명" && prop.value === "냐"));
  assert.ok(
    !published.some((prop) => prop.key === "옛속성"),
    "an inactive key must not leak into a public page",
  );
});

/* ------------------------------------------- 9. routing field vs schema row */

test("a legacy persisted `그룹` row is stripped, the note value is not", () => {
  const back = normalizeGroupSchemas([
    {
      library: LIB,
      archive: ARC,
      group: "가이드",
      revision: 4,
      fields: BUILTIN_FIELD_DEFS.map((d) => ({
        id: d.id,
        key: d.key,
        type: d.type,
      })),
    },
  ]);
  const record = back[0];
  assert.ok(record);
  assert.equal(record.revision, 4, "the record stays usable, not dropped");
  assert.ok(
    !record.fields.some((f) => f.id === "group" || f.key === "그룹"),
    "the routing definition is gone from the ledger",
  );
  // The value on the note is what routing reads, and it is untouched.
  assert.equal(
    fieldValue(character(), { id: "group", key: "그룹", type: "text" }),
    "가이드",
  );
});

test("a legacy schema without `상태` or `그룹` still normalizes", () => {
  const back = normalizeGroupSchemas([
    {
      library: LIB,
      archive: ARC,
      group: "가이드",
      fields: [{ id: "name", key: "이름", type: "text" }],
    },
  ]);
  assert.equal(back.length, 1, "only `이름` is required");
  const record = back[0];
  assert.ok(record);
  assert.deepEqual(record.fields.map((f) => f.id), ["name"]);
});

test("`이름` is the only lock; the data API can restore inactive `상태`", () => {
  assert.deepEqual([...LOCKED_FIELD_IDS], ["name"]);
  const s = store();
  ensureGroupSchema(s, LIB, ARC, "가이드");
  deactivateField(s, LIB, ARC, "가이드", "status");
  let schema = resolveGroupSchema(s, LIB, ARC, "가이드");
  assert.ok(
    !effectiveActiveFields(schema).some((f) => f.id === "status"),
    "a schema with no 상태 renders no status pill",
  );
  const tomb = schema.fields.find((f) => f.id === "status");
  assert.ok(tomb);
  assert.equal(tomb.active, false);
  assert.equal(tomb.key, "상태", "the stored value keeps its key");

  activateField(s, LIB, ARC, "가이드", "status");
  schema = resolveGroupSchema(s, LIB, ARC, "가이드");
  assert.ok(effectiveActiveFields(schema).some((f) => f.id === "status"));

  deactivateField(s, LIB, ARC, "가이드", "name");
  schema = resolveGroupSchema(s, LIB, ARC, "가이드");
  assert.ok(
    effectiveActiveFields(schema).some((f) => f.id === "name"),
    "the card identity cannot be removed",
  );
});

/* ---------------------------------------- 10. one page/archive field order */

test("a missing order row reads as the baseline order", () => {
  const s = store({
    cardProperties: [
      { id: "name", visible: true },
      { id: "codename", visible: false },
      { id: "status", visible: true },
    ],
  });
  const union = unionActiveFieldsForArchive(s, LIB, ARC, "page.md", [""]).map(
    (row) => row.fieldId,
  );
  assert.deepEqual(storedFieldOrder(s, "page.md", ARC), []);
  assert.deepEqual(
    resolveFieldOrder(s, "page.md", ARC, union),
    union,
    "no stored row → the migration order, unchanged",
  );
});

test("one stored order serves heterogeneous schemas", () => {
  const s = store();
  const guideOnly = addCustomField(s, LIB, ARC, "가이드", "코드", "text");
  const sentinelOnly = addCustomField(s, LIB, ARC, "센티넬", "소속코드", "text");
  assert.ok(guideOnly && sentinelOnly);
  deactivateField(s, LIB, ARC, "센티넬", "codename");

  setFieldOrder(s, "page.md", ARC, [
    "name",
    guideOnly.id,
    "status",
    sentinelOnly.id,
    "codename",
  ]);

  const guide = resolveGroupSchema(s, LIB, ARC, "가이드");
  const sentinel = resolveGroupSchema(s, LIB, ARC, "센티넬");
  const order = resolveFieldOrder(
    s,
    "page.md",
    ARC,
    unionActiveFieldsForArchive(s, LIB, ARC, "page.md", [
      "가이드",
      "센티넬",
    ]).map((row) => row.fieldId),
  );

  const guideIds = projectSchemaFields(order, guide).map((f) => f.id);
  const sentinelIds = projectSchemaFields(order, sentinel).map((f) => f.id);
  assert.deepEqual(guideIds.slice(0, 3), ["name", guideOnly.id, "status"]);
  assert.deepEqual(
    sentinelIds.slice(0, 3),
    ["name", "status", sentinelOnly.id],
    "a field this group lacks is skipped, not reshuffled",
  );
  assert.ok(
    !sentinelIds.includes("codename"),
    "a field this group removed never reaches the surface",
  );
  // The shared prefix keeps its relative sequence in both schemas.
  assert.ok(guideIds.indexOf("name") < guideIds.indexOf("status"));
  assert.ok(sentinelIds.indexOf("name") < sentinelIds.indexOf("status"));
});

test("a new field appends without disturbing the stored ids", () => {
  const s = store();
  setFieldOrder(s, "page.md", ARC, ["status", "name"]);
  const late = addCustomField(s, LIB, ARC, "가이드", "늦게온속성", "text");
  assert.ok(late);
  const order = resolveFieldOrder(
    s,
    "page.md",
    ARC,
    unionActiveFieldsForArchive(s, LIB, ARC, "page.md", ["가이드"]).map(
      (row) => row.fieldId,
    ),
  );
  assert.deepEqual(order.slice(0, 2), ["status", "name"]);
  assert.equal(order[order.length - 1], late.id, "unseen fields go last");
  assert.deepEqual(
    storedFieldOrder(s, "page.md", ARC),
    ["status", "name"],
    "resolving never writes",
  );
});

test("an order write keeps ids the caller could not see", () => {
  const s = store();
  setFieldOrder(s, "page.md", ARC, ["name", "status", "codename"]);
  // A later drag happens while `codename` is removed from every schema.
  setFieldOrder(s, "page.md", ARC, ["status", "name"]);
  assert.deepEqual(storedFieldOrder(s, "page.md", ARC), [
    "status",
    "name",
    "codename",
  ]);
  // Restoring it later hands back the remembered slot, not the tail.
  assert.deepEqual(
    resolveFieldOrder(s, "page.md", ARC, ["name", "codename", "status"]),
    ["status", "name", "codename"],
  );
});

test("the routing field can never hold an order slot", () => {
  const s = store();
  setFieldOrder(s, "page.md", ARC, ["group", "name"]);
  assert.deepEqual(storedFieldOrder(s, "page.md", ARC), ["name"]);
  assert.deepEqual(
    normalizeCardFieldOrder([
      { page: "page.md", archive: ARC, order: ["group", "name", "name"] },
    ]),
    [{ page: "page.md", archive: ARC, order: ["name"] }],
  );
  assert.deepEqual(
    resolveFieldOrder(s, "page.md", ARC, ["group", "name"]),
    ["name"],
  );
});

test("order normalization keeps page/archive tuples containing spaces distinct", () => {
  assert.deepEqual(
    normalizeCardFieldOrder([
      { page: "A B", archive: "C", order: ["name"] },
      { page: "A", archive: "B C", order: ["status"] },
    ]),
    [
      { page: "A B", archive: "C", order: ["name"] },
      { page: "A", archive: "B C", order: ["status"] },
    ],
  );
});

test("the order row is scoped per page and archive, and moves with a rename", () => {
  const s = store();
  ensureGroupSchema(s, LIB, ARC, "가이드");
  setFieldOrder(s, "mine.md", ARC, ["status", "name"]);
  setFieldOrder(s, "theirs.md", ARC, ["name", "status"]);
  assert.deepEqual(storedFieldOrder(s, "theirs.md", ARC), ["name", "status"]);
  assert.deepEqual(storedFieldOrder(s, "mine.md", "Fearless"), []);

  renameArchiveScope(s, LIB, ARC, "쿠원2", ["mine.md"]);
  assert.deepEqual(storedFieldOrder(s, "mine.md", "쿠원2"), ["status", "name"]);
  assert.deepEqual(
    storedFieldOrder(s, "theirs.md", ARC),
    ["name", "status"],
    "another library's page keeps pointing at its own archive",
  );
});

/* ------------------------------------------------ 11. the shared projection */

test("card and peek share the group's schema order; eyes only hide card rows", () => {
  const s = store();
  const custom = addCustomField(s, LIB, ARC, "가이드", "별명", "text");
  assert.ok(custom);
  // A legacy page order may remain in storage, but current surfaces ignore it.
  setFieldOrder(s, "page.md", ARC, ["status", custom.id, "name", "tags"]);
  setFieldVisibility(s, "page.md", ARC, custom.id, false);

  const schema = resolveGroupSchema(s, LIB, ARC, "가이드");
  const order = effectiveActiveFields(schema).map((field) => field.id);
  const peek = projectSchemaFields(order, schema, { skip: ["name"] }).map(
    (f) => f.id,
  );
  const card = projectSchemaFields(order, schema, {
    visible: (id) => isFieldVisible(s, "page.md", ARC, id),
  }).map((f) => f.id);

  assert.deepEqual(peek.slice(-1), [custom.id]);
  assert.ok(!peek.includes("name"), "the peek title owns 이름");
  assert.equal(card[0], "name");
  assert.ok(!card.includes(custom.id), "a closed eye hides the card row");
  assert.ok(peek.indexOf("status") < peek.indexOf(custom.id));
});

test("the tags exception keeps its slot instead of appending", () => {
  const s = store();
  setFieldOrder(s, "page.md", ARC, ["name", "tags", "status"]);
  const schema = resolveGroupSchema(s, LIB, ARC, "가이드");
  const order = effectiveActiveFields(schema).map((field) => field.id);
  const card = projectSchemaFields(order, schema, {
    // `태그` is the chip axis but its eye is closed.
    visible: (id) => id !== "tags",
    alwaysVisible: ["tags"],
  }).map((f) => f.id);
  assert.ok(card.indexOf("tags") > card.indexOf("status"));
});

test("projection never emits the routing field, even from a stale record", () => {
  const s = store();
  const schema = resolveGroupSchema(s, LIB, ARC, "가이드");
  const stale = {
    ...schema,
    fields: [
      { id: "group", key: "그룹", label: "그룹", type: "text" as const, active: true, options: [] },
      ...schema.fields,
    ],
  };
  const ids = projectSchemaFields(["group", "name"], stale).map((f) => f.id);
  assert.ok(!ids.includes("group"));
  assert.equal(ids[0], "name");
});

/* ------------------------------------------------- 12. the route inventory */

test("an ungrouped record makes the default route a peer", () => {
  const s = store();
  // Opening the modal seeds the default baseline — a mechanical write.
  ensureGroupSchema(s, LIB, ARC, "");
  const inv = groupRouteInventory(s, LIB, ARC, {
    namedGroups: [],
    hasUngroupedRecords: true,
  });
  assert.deepEqual(inv.routes, [""], "real ungrouped cards keep 기본 reachable");
  assert.deepEqual(inv.named, []);
  assert.equal(inv.switchable, false, "one route is not a choice");
  assert.equal(inv.hasUngrouped, true);
  assert.equal(inv.defaultCustomized, false, "a seeded baseline is not a change");
});

test("a seeded baseline is not customization; an edit to it is", () => {
  const s = store();
  ensureGroupSchema(s, LIB, ARC, "");
  assert.equal(isDefaultSchemaCustomized(s, LIB, ARC), false);
  const empty = groupRouteInventory(s, LIB, ARC, {
    namedGroups: [],
    hasUngroupedRecords: false,
    routeOrder: [""],
  });
  assert.deepEqual(empty.routes, [], "a seed and stale rank do not invent 기본");
  assert.equal(empty.switchable, false);

  const quiet = groupRouteInventory(s, LIB, ARC, {
    namedGroups: ["예시"],
    hasUngroupedRecords: false,
  });
  assert.deepEqual(quiet.routes, ["예시"], "an untouched empty fallback stays hidden");
  assert.equal(quiet.switchable, false);
  assert.equal(quiet.defaultCustomized, false);

  deactivateField(s, LIB, ARC, "", "codename");
  const routed = groupRouteInventory(s, LIB, ARC, {
    namedGroups: ["예시"],
    hasUngroupedRecords: false,
  });
  assert.equal(routed.defaultCustomized, true);
  assert.deepEqual(routed.routes, ["예시", ""], "a customization makes 기본 real");
});

test("named groups dedupe and keep the caller's order behind the ranked ones", () => {
  const s = store();
  const inv = groupRouteInventory(s, LIB, ARC, {
    namedGroups: ["예시", "세계관", "예시"],
    hasUngroupedRecords: true,
  });
  assert.deepEqual(inv.named, ["예시", "세계관"], "stable order, deduped");
  assert.deepEqual(inv.routes, ["예시", "세계관", ""], "unranked 기본 stays last");
  assert.equal(inv.switchable, true);
});

test("the canonical order places 기본 at whatever rank it was given", () => {
  const s = store();
  const first = groupRouteInventory(s, LIB, ARC, {
    namedGroups: ["예시", "세계관"],
    hasUngroupedRecords: true,
    routeOrder: ["", "세계관", "예시"],
  });
  assert.deepEqual(first.routes, ["", "세계관", "예시"]);
  assert.deepEqual(first.named, ["세계관", "예시"], "named follows the rail");

  const middle = groupRouteInventory(s, LIB, ARC, {
    namedGroups: ["예시", "세계관"],
    hasUngroupedRecords: true,
    routeOrder: ["세계관", "", "예시"],
  });
  assert.deepEqual(middle.routes, ["세계관", "", "예시"]);
});

test("a rank for a route that no longer exists is dropped, not rendered", () => {
  const s = store();
  const inv = groupRouteInventory(s, LIB, ARC, {
    namedGroups: ["예시"],
    hasUngroupedRecords: false,
    // 사라진 그룹 was deleted elsewhere; 예시 is listed twice in the saved rank.
    routeOrder: ["사라진 그룹", "예시", "예시", ""],
  });
  assert.deepEqual(inv.routes, ["예시"], "a stale 기본 rank cannot resurrect it");
  assert.deepEqual(inv.named, ["예시"]);
});

test("a route the rank never mentioned still appears, after the ranked ones", () => {
  const s = store();
  const inv = groupRouteInventory(s, LIB, ARC, {
    namedGroups: ["예시", "신규"],
    hasUngroupedRecords: true,
    routeOrder: ["", "예시"],
  });
  assert.deepEqual(inv.routes, ["", "예시", "신규"]);
});

test("a custom field or a rename in the default schema counts as customized", () => {
  const s = store();
  addCustomField(s, LIB, ARC, "", "별명", "text");
  assert.equal(isDefaultSchemaCustomized(s, LIB, ARC), true);

  const renamed = store();
  ensureGroupSchema(renamed, LIB, ARC, "");
  renameField(renamed, LIB, ARC, "", "codename", "다른 이름");
  assert.equal(isDefaultSchemaCustomized(renamed, LIB, ARC), true);

  const optioned = store();
  const field = addCustomField(optioned, LIB, "Fearless", "", "성격", "select");
  assert.ok(field);
  addFieldOption(optioned, LIB, "Fearless", "", field.id, "차분함");
  assert.equal(isDefaultSchemaCustomized(optioned, LIB, "Fearless"), true);
  assert.equal(
    isDefaultSchemaCustomized(optioned, LIB, ARC),
    false,
    "another archive's default is its own question",
  );
});

test("filter axes come from fields active in a reachable schema", () => {
  const s = store();
  ensureGroupSchema(s, LIB, ARC, "가이드");
  deactivateField(s, LIB, ARC, "가이드", "status");
  const alone = reachableActiveFieldIds(s, LIB, ARC, ["가이드"]);
  assert.equal(alone.has("status"), false, "no schema offers 상태 any more");
  assert.equal(alone.has("relation"), true);
  // A second group's baseline brings the axis back.
  const both = reachableActiveFieldIds(s, LIB, ARC, ["가이드", "센티넬"]);
  assert.equal(both.has("status"), true);
  assert.equal(both.has("group"), false, "routing is never a filter axis");
});

/* ------------------------------------------------ 13. group delete/reassign */

const MEMBERS = [
  { path: "a.md", group: "세계관" },
  { path: "b.md", group: "세계관" },
  { path: "c.md", group: "예시" },
  { path: "a.md", group: "세계관" },
];

test("deleting a populated group plans every member move", () => {
  const s = store();
  ensureGroupSchema(s, LIB, ARC, "세계관");
  ensureGroupSchema(s, LIB, ARC, "예시");
  const plan = planGroupDeletion(s, LIB, ARC, "세계관", "", MEMBERS);
  assert.equal(plan.blocked, null);
  assert.deepEqual(plan.moves, ["a.md", "b.md"], "deduped, source-only");
  assert.equal(plan.to, "");
  assert.equal(plan.archive, ARC);
});

test("a plan accepts 기본 and still refuses itself or an unreachable destination", () => {
  const s = store();
  ensureGroupSchema(s, LIB, ARC, "세계관");
  const defaultPlan = planGroupDeletion(
    s,
    LIB,
    ARC,
    "",
    "예시",
    [{ path: "default.md", group: "" }],
    ["예시"],
  );
  assert.equal(defaultPlan.blocked, null);
  assert.deepEqual(defaultPlan.moves, ["default.md"]);
  assert.equal(
    planGroupDeletion(s, LIB, ARC, "세계관", "세계관", MEMBERS).blocked,
    "same-scope",
  );
  assert.equal(
    planGroupDeletion(s, LIB, ARC, "세계관", "없는그룹", MEMBERS).blocked,
    "unknown-target",
  );
  assert.equal(
    planGroupDeletion(s, LIB, ARC, "세계관", "관측된그룹", MEMBERS, [
      "관측된그룹",
    ]).blocked,
    null,
    "a group with cards but no stored schema is still a destination",
  );
});

test("removal drops one schema, keeps values, keys and siblings", () => {
  const s = store();
  const doomed = addCustomField(s, LIB, ARC, "세계관", "소속코드", "text");
  const kept = addCustomField(s, LIB, ARC, "예시", "별명", "text");
  assert.ok(doomed && kept);
  const keysBefore = ledgerKeys(s, LIB, ARC);

  applyGroupDeletion(s, LIB, ARC, "세계관");

  assert.equal(findGroupSchema(s, LIB, ARC, "세계관"), null);
  assert.ok(findGroupSchema(s, LIB, ARC, "예시"), "a sibling is untouched");
  assert.deepEqual(
    ledgerKeys(s, LIB, ARC),
    keysBefore,
    "removed keys are never handed out again",
  );
  // The note keeps its value; it simply is not listed by the destination.
  const record = character({ 소속코드: "남아 있음" });
  assert.equal(
    fieldValue(record, { id: doomed.id, key: doomed.key, type: "text" }),
    "남아 있음",
  );
  // Re-running converges instead of touching a second group.
  applyGroupDeletion(s, LIB, ARC, "세계관");
  assert.ok(findGroupSchema(s, LIB, ARC, "예시"));
});

test("deleting 기본 resets its stored schema while the route remains resolvable", () => {
  const s = store();
  addCustomField(s, LIB, ARC, "", "기본 전용", "text");
  assert.equal(isDefaultSchemaCustomized(s, LIB, ARC), true);
  applyGroupDeletion(s, LIB, ARC, "");
  assert.equal(findGroupSchema(s, LIB, ARC, ""), null);
  assert.equal(isDefaultSchemaCustomized(s, LIB, ARC), false);
  assert.equal(
    resolveGroupSchema(s, LIB, ARC, "").fields[0]?.id,
    "name",
    "the structural default route resolves its built-in baseline again",
  );
});

test("a retry after a partial move plans only what is left", () => {
  const s = store();
  ensureGroupSchema(s, LIB, ARC, "세계관");
  const half = [
    { path: "a.md", group: "" }, // already moved by the failed attempt
    { path: "b.md", group: "세계관" },
  ];
  const plan = planGroupDeletion(s, LIB, ARC, "세계관", "", half);
  assert.deepEqual(plan.moves, ["b.md"]);
});

test("renaming a field option after a group delete cannot revive it", () => {
  // Guard rail: the deleted group's field ids stay out of every other schema.
  const s = store();
  const field = addCustomField(s, LIB, ARC, "세계관", "성격", "select");
  assert.ok(field);
  addFieldOption(s, LIB, ARC, "세계관", field.id, "차분함");
  applyGroupDeletion(s, LIB, ARC, "세계관");
  renameFieldOption(s, LIB, ARC, "예시", field.id, "o_1", "활발함");
  const other = findGroupSchema(s, LIB, ARC, "예시");
  assert.equal(other, null, "a rename against a missing field persists nothing");
});
