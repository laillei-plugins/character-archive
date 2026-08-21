/**
 * 그룹 속성 — 정하기와 채우기.
 *
 * One schema per `(library, archive, group)`. `속성 관리` decides which fields
 * exist and their order, Peek fills this character's values, and 보기 controls
 * which ordered fields are visible on cards.
 * Every consumer — heal, create, cards, Peek, 보기, move, share — resolves
 * through `resolveGroupSchema` and reads values through `fieldValue`, so a field
 * can never mean two things on two surfaces.
 *
 * Two rules split ownership here:
 * - `그룹` is **routing**, not a field. It picks the schema; it is never a row
 *   inside one (`ROUTING_FIELD_IDS`, stripped on normalize).
 * - active schema order is the presentation authority for cards, Peek, and
 *   share. Legacy `cardFieldOrder` rows remain normalized for compatibility,
 *   but current UI paths neither read nor write them.
 *
 * Storage rules that keep note data attributable:
 * - a custom YAML key is allocated once per `(library, archive)` and is **never
 *   reused**, even after the field is removed (the ledger remembers it);
 * - a user-confirmed removal marks the inactive definition for note cleanup;
 *   legacy tombstones without that marker stay untouched;
 * - renaming a field or an option touches labels only, never keys or ids.
 *
 * Scopes are stored as **arrays**: library / archive / group are user strings
 * and must never become object keys. Lookups scan, or build a `Map` at read time.
 *
 * This file imports nothing — `node --test` runs it straight from TypeScript
 * (see `tests/group-schema.test.ts`). Keep it that way: a relative import
 * without a `.ts` extension cannot load under Node's test runner.
 */

/** Must match `propertySchema.CHARACTER_KIND`. */
const CHARACTER_KIND = "character";

/**
 * Must match `propertySchema.NEVER_CREATE_KEYS` plus identity `kind`.
 * Heal/create must never auto-insert these.
 */
const NEVER_CREATE_KEYS = [
  "kind",
  "장르",
  "작품",
  "order",
  "charinfo_order",
  "cover",
  "coverPosition",
  "cover_position",
] as const;

type CardPropertyId =
  | "name"
  | "status"
  | "group"
  | "relation"
  | "bond"
  | "codename"
  | "realName"
  | "affiliation"
  | "tags";

interface CardPropertyPref {
  id: CardPropertyId;
  visible: boolean;
}

/** Gallery-facing names for the five chip axes — same shape as settings. */
export type PropertyDisplayNames = Partial<
  Record<"status" | "relation" | "bond" | "affiliation" | "tags", string>
>;

const DEFAULT_AXIS_NAMES: Record<string, string> = {
  status: "상태",
  relation: "관계",
  bond: "인연",
  affiliation: "소속",
  tags: "태그",
};

const CARD_TO_AXIS: Partial<Record<CardPropertyId, string>> = {
  status: "status",
  relation: "relation",
  bond: "bond",
  affiliation: "affiliation",
  tags: "tags",
};

function cardDisplayLabel(
  id: CardPropertyId,
  names: PropertyDisplayNames | null | undefined,
  fallback: string,
): string {
  const axis = CARD_TO_AXIS[id];
  if (!axis) return fallback;
  const custom = names?.[axis as keyof PropertyDisplayNames]?.trim();
  return custom || DEFAULT_AXIS_NAMES[axis] || fallback;
}

function normalizeCardProperties(raw: unknown): CardPropertyPref[] {
  const list: CardPropertyPref[] = [];
  const seen = new Set<CardPropertyId>();
  const valid = new Set(BUILTIN_FIELD_DEFS.map((d) => d.id));
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const id = (item as { id?: unknown }).id;
      if (typeof id !== "string" || !valid.has(id as CardPropertyId)) continue;
      const pid = id as CardPropertyId;
      if (seen.has(pid)) continue;
      seen.add(pid);
      list.push({
        id: pid,
        visible: Boolean((item as { visible?: unknown }).visible),
      });
    }
  }
  for (const def of BUILTIN_FIELD_DEFS) {
    if (seen.has(def.id)) continue;
    list.push({
      id: def.id,
      visible: def.id === "name" || def.id === "status",
    });
  }
  return list;
}

export type FieldType = "text" | "select" | "multi-select";

export interface FieldOption {
  id: string;
  label: string;
}

export interface FieldDef {
  /** Stable identity. Built-ins reuse their card property id. */
  id: string;
  /** YAML key. Immutable after the first allocation. */
  key: string;
  /** Display name — the only user-renamable part. */
  label: string;
  /**
   * How this field is rendered and edited **now**, per scope. Every surface
   * reads the type from here, never from the built-in table: a non-`이름`
   * built-in may carry a scoped override, and `normalizeField` keeps it.
   * Changing it never rewrites a stored value and never drops `options`.
   */
  type: FieldType;
  /** `false` = tombstone: the definition stays and the row goes. */
  active: boolean;
  /** Explicit deletion intent. Only marked tombstones may remove note data. */
  purge?: true;
  /**
   * The field's own vocabulary. Option ids are immutable, and the list is kept
   * even while `type` is `text`: a type change must be reversible, so options
   * lie dormant instead of being erased.
   */
  options: FieldOption[];
  /**
   * Per-field option counter. Freeze allows "a per-field seq" so a removed
   * option id is never handed to a new option (that would revive dormant
   * values under a renamed label).
   */
  optionSeq?: number;
}

export interface GroupSchemaRecord {
  library: string;
  archive: string;
  /** `""` = 미분류. */
  group: string;
  /** Monotonic; +1 on every persisted schema mutation. */
  revision: number;
  /** Includes inactive tombstones. Active fields form the display-ordered prefix. */
  fields: FieldDef[];
}

export interface FieldKeyLedger {
  library: string;
  archive: string;
  /** Every key ever allocated in this library+archive. Never shrinks. */
  keys: string[];
  nextFieldSeq: number;
}

export interface CardFieldVisibility {
  page: string;
  archive: string;
  fieldId: string;
  visible: boolean;
}

/**
 * Legacy per-page presentation order retained only for settings compatibility.
 * Current product surfaces use each resolved group's active schema order.
 */
export interface CardFieldOrder {
  page: string;
  archive: string;
  /** Field ids, most important first. Unknown ids are tolerated (not reused). */
  order: string[];
}

/** The settings slice this module reads and mutates (no settings ↔ data cycle). */
export interface GroupSchemaStore {
  /**
   * Legacy list, kept only as the migration seed for the built-in **order** of
   * a group's lazy baseline. It is not the live order, and never the live eye
   * state — card eyes are scoped rows in `cardFieldVisibility`.
   */
  cardProperties: CardPropertyPref[];
  propertyDisplayNames?: PropertyDisplayNames;
  groupSchemas: GroupSchemaRecord[];
  fieldKeyLedgers: FieldKeyLedger[];
  cardFieldVisibility: CardFieldVisibility[];
  /** Legacy page/archive order; current UI and projections do not consume it. */
  cardFieldOrder: CardFieldOrder[];
}

export interface BuiltinFieldDef {
  id: CardPropertyId;
  key: string;
  /**
   * The type a lazy baseline starts from. Authoritative only until a scope
   * stores its own — read `FieldDef.type` everywhere else.
   */
  type: FieldType;
  /** Locked = cannot be deactivated (the card would lose its identity). */
  locked: boolean;
}

/**
 * Fixed id and key — a built-in's YAML key is never re-keyed, so a note written
 * years ago still resolves. `type` is the baseline default only: every built-in
 * except `이름` may carry a scoped override in its `FieldDef`.
 */
export const BUILTIN_FIELD_DEFS: readonly BuiltinFieldDef[] = [
  { id: "name", key: "이름", type: "text", locked: true },
  { id: "status", key: "상태", type: "select", locked: true },
  { id: "group", key: "그룹", type: "text", locked: true },
  { id: "relation", key: "관계", type: "select", locked: false },
  { id: "bond", key: "인연", type: "select", locked: false },
  { id: "codename", key: "코드네임", type: "text", locked: false },
  { id: "realName", key: "본명", type: "text", locked: false },
  { id: "affiliation", key: "소속", type: "select", locked: false },
  { id: "tags", key: "태그", type: "multi-select", locked: false },
];

/**
 * Routing metadata, never an ordinary schema row.
 *
 * `그룹` decides *which* schema a record resolves to, so it can never also be a
 * field inside that schema: a ledger row, a card chip, a peek value row or an
 * empty placeholder for it would all be asking the user to edit the thing that
 * chose the list they are editing. Legacy persisted definitions are stripped on
 * normalize; the YAML value on the note is untouched.
 */
export const ROUTING_FIELD_IDS: readonly string[] = ["group"];

/**
 * The only locked ordinary field. `이름` is the card identity, so it cannot be
 * deactivated; every other field may leave the active presentation schema.
 */
export const LOCKED_FIELD_IDS: readonly string[] = ["name"];

/** Built-in ids whose vocabulary is the global chip axis, not field-local. */
export const CHIP_AXIS_FIELD_IDS: readonly string[] = [
  "status",
  "relation",
  "bond",
  "affiliation",
  "tags",
];

const BUILTIN_BY_ID = new Map(BUILTIN_FIELD_DEFS.map((def) => [def.id as string, def]));
const LOCKED_SET = new Set(LOCKED_FIELD_IDS);
const ROUTING_SET = new Set(ROUTING_FIELD_IDS);
const CHIP_AXIS_SET = new Set(CHIP_AXIS_FIELD_IDS);

/** Section title for `그룹: ""`. */
export const UNGROUPED_LABEL = "미분류";
/** Archive identity for a note with no `장르` (matches CharacterStore). */
export const UNCLASSIFIED_ARCHIVE = "미분류";

const RESERVED_KEYS = new Set<string>([
  "__proto__",
  "constructor",
  "prototype",
  "kind",
  ...NEVER_CREATE_KEYS,
]);

/** Even a forged/tampered tombstone may never delete identity or routing data. */
const PURGE_PROTECTED_KEYS = new Set<string>([
  "이름",
  "그룹",
  ...NEVER_CREATE_KEYS,
]);

/** Position-only storage keys. They stay after user-facing note properties. */
const TRAILING_STORAGE_KEYS = [
  "cover",
  "coverPosition",
  "cover_position",
  "order",
  "charinfo_order",
] as const;

/** Existing-only identity/routing metadata that stays before schema fields. */
const LEADING_METADATA_KEYS = ["kind", "장르", "작품", "그룹"] as const;

const FALLBACK_FIELD_KEY = "속성";

export function isBuiltinFieldId(id: string): boolean {
  return BUILTIN_BY_ID.has(id);
}

export function builtinFieldDef(id: string): BuiltinFieldDef | null {
  return BUILTIN_BY_ID.get(id) ?? null;
}

export function isLockedFieldId(id: string): boolean {
  return LOCKED_SET.has(id);
}

/**
 * True when this field's type is user data.
 *
 * `이름` is the card identity — the title every surface reads — so its type is
 * structure, not a preference. `그룹` is routing and is not a field at all.
 * Every other built-in and every custom field may be retyped per scope.
 */
export function canRetypeFieldId(id: string): boolean {
  return !isLockedFieldId(id) && !isRoutingFieldId(id);
}

/** True for `그룹` — routing metadata, not a schema row. */
export function isRoutingFieldId(id: string): boolean {
  return ROUTING_SET.has(id);
}

/** True when this field's values come from the global chip vocabulary. */
export function isChipAxisField(field: Pick<FieldDef, "id">): boolean {
  return CHIP_AXIS_SET.has(field.id);
}

/* ------------------------------------------------------------- identity keys */

/** Vault-relative path normalize (no Obsidian import here). */
export function normalizeLibraryKey(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

/** Empty `장르` reads as 미분류 everywhere, including CharacterStore. */
export function normalizeArchiveKey(raw: unknown): string {
  return String(raw ?? "").trim() || UNCLASSIFIED_ARCHIVE;
}

/** `""` stays `""` — that is the 미분류 group, a real scope. */
export function normalizeGroupKey(raw: unknown): string {
  return String(raw ?? "").trim();
}

export function groupDisplayName(group: string): string {
  return normalizeGroupKey(group) || UNGROUPED_LABEL;
}

/**
 * Which library a note belongs to: the **longest** configured library that
 * contains it. Nested galleries are the reason this is not "the first match" —
 * a note under `Root/Sub` belongs to `Root/Sub` even while `Root` is also a
 * library, so its schema scope follows the gallery the user actually opened.
 *
 * `libraries` is the undeduped identity list; collapsing it for the archive scan
 * is a separate concern.
 */
export function longestMatchingLibrary(
  path: string,
  libraries: readonly string[],
  fallback: string,
): string {
  const target = normalizeLibraryKey(path);
  let best = "";
  for (const raw of libraries) {
    const library = normalizeLibraryKey(raw);
    if (!library) continue;
    if (target !== library && !target.startsWith(`${library}/`)) continue;
    if (library.length > best.length) best = library;
  }
  return normalizeLibraryKey(best || fallback);
}

/**
 * Paths under any of `roots`, each listed once. Identity roots may nest, so the
 * same file can match two roots — a scan that enqueued per root would hand the
 * same path to the lane twice.
 */
export function collectScanPaths(
  paths: readonly string[],
  roots: readonly string[],
): string[] {
  const scopes = roots.map((root) => normalizeLibraryKey(root)).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const path = normalizeLibraryKey(raw);
    if (!path || seen.has(path)) continue;
    if (!scopes.some((root) => path === root || path.startsWith(`${root}/`))) {
      continue;
    }
    seen.add(path);
    out.push(path);
  }
  return out;
}

export function fieldEmptyDefault(type: FieldType): string | string[] {
  return type === "multi-select" ? [] : "";
}

/**
 * Live display name. A chip axis follows its global rename (one name across
 * every page, edited in section 2); every other field carries its own label.
 */
export function fieldLabel(
  field: Pick<FieldDef, "id" | "label" | "key">,
  names?: PropertyDisplayNames | null,
): string {
  const builtin = builtinFieldDef(field.id);
  if (builtin && CHIP_AXIS_SET.has(builtin.id)) {
    return cardDisplayLabel(builtin.id, names ?? null, builtin.key);
  }
  if (builtin) return field.label.trim() || builtin.key;
  return field.label.trim() || field.key || field.id;
}

/** Short type mark for Book rows. */
export function fieldTypeMark(type: FieldType): string {
  if (type === "select") return "선택";
  if (type === "multi-select") return "여러 값";
  return "글";
}

/* -------------------------------------------------------------- the baseline */

function builtinField(
  def: BuiltinFieldDef,
  names?: PropertyDisplayNames | null,
): FieldDef {
  return {
    id: def.id,
    key: def.key,
    label: cardDisplayLabel(def.id, names ?? null, def.key),
    type: def.type,
    active: true,
    options: [],
  };
}

/**
 * The ordinary built-ins in the order 보기 already showed them, all active.
 * A previously unseen group gets exactly this — never a sibling's custom fields,
 * and never the routing field: `그룹` chose this list, it is not in it.
 */
export function migratedBuiltinBaseline(
  cardProperties: CardPropertyPref[] | undefined,
  names?: PropertyDisplayNames | null,
): FieldDef[] {
  const prefs = normalizeCardProperties(cardProperties);
  const fields: FieldDef[] = [];
  const seen = new Set<string>();
  for (const pref of prefs) {
    const def = builtinFieldDef(pref.id);
    if (!def || seen.has(def.id) || isRoutingFieldId(def.id)) continue;
    seen.add(def.id);
    fields.push(builtinField(def, names));
  }
  // Defensive: a truncated stored list still yields every ordinary built-in.
  for (const def of BUILTIN_FIELD_DEFS) {
    if (seen.has(def.id) || isRoutingFieldId(def.id)) continue;
    seen.add(def.id);
    fields.push(builtinField(def, names));
  }
  return fields;
}

/* ---------------------------------------------------------------- the resolver */

export function findGroupSchemaIndex(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  group: string,
): number {
  const lib = normalizeLibraryKey(library);
  const arc = normalizeArchiveKey(archive);
  const grp = normalizeGroupKey(group);
  return store.groupSchemas.findIndex(
    (record) =>
      normalizeLibraryKey(record.library) === lib &&
      normalizeArchiveKey(record.archive) === arc &&
      normalizeGroupKey(record.group) === grp,
  );
}

export function findGroupSchema(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  group: string,
): GroupSchemaRecord | null {
  const index = findGroupSchemaIndex(store, library, archive, group);
  return index < 0 ? null : (store.groupSchemas[index] ?? null);
}

/**
 * The single source. A persisted record wins (tombstones included); an unseen
 * group is lazily built from the migrated built-in baseline **in memory** — the
 * caller persists it on first Book open, first mutation, or card create.
 */
export function resolveGroupSchema(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  group: string,
): GroupSchemaRecord {
  const found = findGroupSchema(store, library, archive, group);
  if (found) return found;
  return {
    library: normalizeLibraryKey(library),
    archive: normalizeArchiveKey(archive),
    group: normalizeGroupKey(group),
    revision: 0,
    fields: migratedBuiltinBaseline(store.cardProperties, store.propertyDisplayNames),
  };
}

/** Display-ordered active fields. Inactive tombstones never reach a surface. */
export function effectiveActiveFields(schema: GroupSchemaRecord): FieldDef[] {
  return schema.fields.filter((field) => field.active);
}

/**
 * Internal tombstones. The UI does not list them; retaining the definitions
 * preserves scoped type/option vocabulary for migrations and data-layer tools.
 */
export function effectiveInactiveFields(schema: GroupSchemaRecord): FieldDef[] {
  return schema.fields.filter((field) => !field.active);
}

/** Every group that has a persisted schema in this library + archive. */
export function persistedGroupsForArchive(
  store: GroupSchemaStore,
  library: string,
  archive: string,
): string[] {
  const lib = normalizeLibraryKey(library);
  const arc = normalizeArchiveKey(archive);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const record of store.groupSchemas) {
    if (normalizeLibraryKey(record.library) !== lib) continue;
    if (normalizeArchiveKey(record.archive) !== arc) continue;
    const group = normalizeGroupKey(record.group);
    if (seen.has(group)) continue;
    seen.add(group);
    out.push(group);
  }
  return out;
}

/**
 * Move exactly one group's persisted schema inside a library + archive.
 * A destination record is a collision, never an invitation to merge fields.
 * When the source has only existed in notes, persist its resolved baseline at
 * the new identity so a rename cannot make the group lose its schema route.
 */
export function renameGroupScope(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  from: string,
  to: string,
): void {
  if (!normalizeGroupKey(from)) {
    throw new Error("기본은 그룹이 아니라서 이름을 바꿀 수 없어요.");
  }
  renameGroupRoute(store, library, archive, from, to);
}

/**
 * The same move, one route wider: `from` may be `""`.
 *
 * Naming the default route hands its stored property list to the new group and
 * leaves `""` with no record at all — which is correct, because the route that
 * catches a note with no `그룹` starts again from the built-in baseline.
 */
export function renameGroupRoute(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  from: string,
  to: string,
): void {
  const lib = normalizeLibraryKey(library);
  const arc = normalizeArchiveKey(archive);
  const prev = normalizeGroupKey(from);
  const next = normalizeGroupKey(to);
  if (!next) throw new Error("이름을 입력해 주세요.");
  if (prev === next) return;

  const collision = findGroupSchema(store, lib, arc, next);
  if (collision) throw new Error(`그룹 「${next}」가 이미 있어요.`);

  const source = findGroupSchema(store, lib, arc, prev);
  if (!source) {
    const baseline = resolveGroupSchema(store, lib, arc, prev);
    upsertGroupSchema(store, {
      ...baseline,
      group: next,
      revision: baseline.revision + 1,
    });
    return;
  }
  store.groupSchemas = store.groupSchemas.map((record) =>
    record === source
      ? {
          ...record,
          group: next,
          revision: record.revision + 1,
          fields: record.fields.map(cloneField),
        }
      : record,
  );
}

/**
 * Write a schema back into the array store (upsert by scope identity).
 * Call inside `commitSettings` — this mutates.
 */
export function upsertGroupSchema(
  store: GroupSchemaStore,
  record: GroupSchemaRecord,
): GroupSchemaRecord {
  const next: GroupSchemaRecord = {
    library: normalizeLibraryKey(record.library),
    archive: normalizeArchiveKey(record.archive),
    group: normalizeGroupKey(record.group),
    revision: Math.max(0, Math.floor(record.revision)),
    fields: record.fields.map(cloneField),
  };
  const index = findGroupSchemaIndex(store, next.library, next.archive, next.group);
  if (index < 0) store.groupSchemas = [...store.groupSchemas, next];
  else {
    const copy = [...store.groupSchemas];
    copy[index] = next;
    store.groupSchemas = copy;
  }
  return next;
}

/** Persist the lazy baseline for a scope if it has never been stored. */
export function ensureGroupSchema(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  group: string,
): GroupSchemaRecord {
  const found = findGroupSchema(store, library, archive, group);
  if (found) return found;
  return upsertGroupSchema(store, resolveGroupSchema(store, library, archive, group));
}

/**
 * Move every schema-side row of one archive onto a new archive name.
 *
 * Scoping is the whole difficulty. `groupSchemas` and `fieldKeyLedgers` carry
 * their library, so they are rewritten for this library only. A
 * `cardFieldVisibility` row carries **page + archive but no library**, so two
 * libraries holding an archive of the same name are indistinguishable here —
 * the caller must pass the gallery pages that resolve to `library`, and only
 * those rows move.
 *
 * Throws **before touching anything** when the destination already exists: a
 * merge would collide on `(library, archive, group)` and normalization keeps
 * only the first duplicate, silently dropping a group's fields.
 *
 * Mutates `store` — call inside one `commitSettings`, after the note writes
 * have succeeded.
 */
export function renameArchiveScope(
  store: GroupSchemaStore,
  library: string,
  from: string,
  to: string,
  pagePaths: readonly string[],
): void {
  const lib = normalizeLibraryKey(library);
  const prev = normalizeArchiveKey(from);
  const next = normalizeArchiveKey(to);
  if (prev === next) return;

  const pages = new Set(
    pagePaths.map((path) => normalizeLibraryKey(path)).filter(Boolean),
  );

  const schemaClash = store.groupSchemas.some(
    (record) =>
      normalizeLibraryKey(record.library) === lib &&
      normalizeArchiveKey(record.archive) === next,
  );
  const ledgerClash = store.fieldKeyLedgers.some(
    (ledger) =>
      normalizeLibraryKey(ledger.library) === lib &&
      normalizeArchiveKey(ledger.archive) === next,
  );
  const visibilityClash = store.cardFieldVisibility.some(
    (row) =>
      pages.has(normalizeLibraryKey(row.page)) &&
      normalizeArchiveKey(row.archive) === next,
  );
  const orderClash = store.cardFieldOrder.some(
    (row) =>
      pages.has(normalizeLibraryKey(row.page)) &&
      normalizeArchiveKey(row.archive) === next,
  );
  if (schemaClash || ledgerClash || visibilityClash || orderClash) {
    throw new Error(`아카이브 「${next}」가 이미 있어요`);
  }

  store.groupSchemas = store.groupSchemas.map((record) =>
    normalizeLibraryKey(record.library) === lib &&
    normalizeArchiveKey(record.archive) === prev
      ? { ...record, archive: next, fields: record.fields.map(cloneField) }
      : record,
  );
  store.fieldKeyLedgers = store.fieldKeyLedgers.map((ledger) =>
    normalizeLibraryKey(ledger.library) === lib &&
    normalizeArchiveKey(ledger.archive) === prev
      ? { ...ledger, archive: next, keys: [...ledger.keys] }
      : ledger,
  );
  store.cardFieldVisibility = store.cardFieldVisibility.map((row) =>
    pages.has(normalizeLibraryKey(row.page)) &&
    normalizeArchiveKey(row.archive) === prev
      ? { ...row, archive: next }
      : row,
  );
  // Keep legacy compatibility data internally coherent across archive renames.
  store.cardFieldOrder = store.cardFieldOrder.map((row) =>
    pages.has(normalizeLibraryKey(row.page)) &&
    normalizeArchiveKey(row.archive) === prev
      ? { ...row, archive: next, order: [...row.order] }
      : row,
  );
}

function cloneField(field: FieldDef): FieldDef {
  const next: FieldDef = {
    id: field.id,
    key: field.key,
    label: field.label,
    type: field.type,
    active: field.active,
    options: field.options.map((option) => ({ ...option })),
  };
  if (typeof field.optionSeq === "number") next.optionSeq = field.optionSeq;
  if (field.purge === true) next.purge = true;
  return next;
}

/** Same scope, one revision later. */
function bumped(
  schema: GroupSchemaRecord,
  fields: FieldDef[],
): GroupSchemaRecord {
  return {
    library: schema.library,
    archive: schema.archive,
    group: schema.group,
    revision: schema.revision + 1,
    fields,
  };
}

/* --------------------------------------------------------------- the allocator */

export function sanitizeFieldKey(label: string): string {
  const key = String(label ?? "")
    .trim()
    .replace(/[#[\]{}:>*&!,?%|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_");
  if (!key || key.startsWith("__") || RESERVED_KEYS.has(key)) {
    return FALLBACK_FIELD_KEY;
  }
  return key;
}

function findLedgerIndex(
  store: GroupSchemaStore,
  library: string,
  archive: string,
): number {
  const lib = normalizeLibraryKey(library);
  const arc = normalizeArchiveKey(archive);
  return store.fieldKeyLedgers.findIndex(
    (ledger) =>
      normalizeLibraryKey(ledger.library) === lib &&
      normalizeArchiveKey(ledger.archive) === arc,
  );
}

/** Ledger for a library+archive, created (with built-in keys seeded) on demand. */
function ensureLedger(
  store: GroupSchemaStore,
  library: string,
  archive: string,
): { ledger: FieldKeyLedger; index: number } {
  const index = findLedgerIndex(store, library, archive);
  const existing = index < 0 ? null : store.fieldKeyLedgers[index];
  if (existing) {
    const keys = [...existing.keys];
    // Built-ins are pre-seeded into every ledger on first use.
    for (const def of BUILTIN_FIELD_DEFS) {
      if (!keys.includes(def.key)) keys.push(def.key);
    }
    const ledger: FieldKeyLedger = {
      library: normalizeLibraryKey(existing.library),
      archive: normalizeArchiveKey(existing.archive),
      keys,
      nextFieldSeq: Math.max(1, Math.floor(existing.nextFieldSeq) || 1),
    };
    return { ledger, index };
  }
  const ledger: FieldKeyLedger = {
    library: normalizeLibraryKey(library),
    archive: normalizeArchiveKey(archive),
    keys: BUILTIN_FIELD_DEFS.map((def) => def.key),
    nextFieldSeq: 1,
  };
  return { ledger, index: -1 };
}

function writeLedger(
  store: GroupSchemaStore,
  ledger: FieldKeyLedger,
  index: number,
): void {
  if (index < 0) {
    store.fieldKeyLedgers = [...store.fieldKeyLedgers, ledger];
    return;
  }
  const copy = [...store.fieldKeyLedgers];
  copy[index] = ledger;
  store.fieldKeyLedgers = copy;
}

/** Every key this library+archive ever handed out, tombstones included. */
export function ledgerKeys(
  store: GroupSchemaStore,
  library: string,
  archive: string,
): string[] {
  return [...ensureLedger(store, library, archive).ledger.keys];
}

function uniqueLedgerKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/* ---------------------------------------------------------------- the mutators */

/**
 * Add one custom field to a group. Allocates a fresh field id and a ledger key
 * that no field in this library+archive has ever used. Mutates `store` — call
 * inside `commitSettings`, then reconcile the group's member notes.
 */
export function addCustomField(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  group: string,
  label: string,
  type: FieldType,
  observedKeys: readonly string[] = [],
): FieldDef | null {
  const name = String(label ?? "").trim();
  if (!name) return null;

  const { ledger, index } = ensureLedger(store, library, archive);
  // The ledger proves what this plugin allocated. Observed frontmatter also
  // reserves hand-written keys so a later property removal can never claim and
  // delete unrelated user data that happened to share the same label.
  const taken = new Set([...ledger.keys, ...observedKeys.map(String)]);
  const key = uniqueLedgerKey(sanitizeFieldKey(name), taken);
  const id = `f_${ledger.nextFieldSeq}`;
  writeLedger(
    store,
    {
      ...ledger,
      keys: [...ledger.keys, key],
      nextFieldSeq: ledger.nextFieldSeq + 1,
    },
    index,
  );

  const field: FieldDef = {
    id,
    key,
    label: name,
    type,
    active: true,
    options: [],
    ...(type === "text" ? {} : { optionSeq: 1 }),
  };
  const schema = resolveGroupSchema(store, library, archive, group);
  upsertGroupSchema(store, bumped(schema, [...schema.fields, field]));
  return field;
}

/** Display rename only — the YAML key never moves. */
export function renameField(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  group: string,
  fieldId: string,
  label: string,
): void {
  const name = String(label ?? "").trim();
  if (!name) return;
  const schema = resolveGroupSchema(store, library, archive, group);
  if (!schema.fields.some((field) => field.id === fieldId)) return;
  upsertGroupSchema(
    store,
    bumped(
      schema,
      schema.fields.map((field) =>
        field.id === fieldId ? { ...cloneField(field), label: name } : field,
      ),
    ),
  );
}

/** Why a retype was refused. `changed` is the only one that wrote. */
export type FieldRetypeResult =
  | "changed"
  | "unchanged"
  | "fixed-field"
  | "unknown-field";

/**
 * Change one field's type inside one scope — the only way `FieldDef.type` moves.
 *
 * Non-destructive by construction. The YAML key does not move, no note is
 * rewritten, and `options` are carried across untouched: switching to `text`
 * leaves the vocabulary dormant so switching back restores it verbatim. Only
 * the reading side changes, and `fieldValue` coerces whatever is stored to the
 * new type (a scalar reads as a singleton list; a list reads as joined text).
 *
 * `이름` and `그룹` are refused — see `canRetypeFieldId`. A no-op type does not
 * bump the revision, so an idempotent pick cannot churn every reader's cache.
 *
 * Mutates `store`; call inside `commitSettings`. Callers that would drop values
 * (multi-select → scalar) must run their own guard first: this function never
 * silently discards, but it also cannot see the member notes.
 */
export function retypeField(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  group: string,
  fieldId: string,
  type: FieldType,
): FieldRetypeResult {
  if (!canRetypeFieldId(fieldId)) return "fixed-field";
  const schema = resolveGroupSchema(store, library, archive, group);
  const target = schema.fields.find((field) => field.id === fieldId);
  if (!target) return "unknown-field";
  if (target.type === type) return "unchanged";
  const next = cloneField(target);
  next.type = type;
  // A field that has never had options still must not hand out an id twice
  // once it gains them, so seed the per-field seq past the dormant list.
  if (type !== "text" && typeof next.optionSeq !== "number") {
    next.optionSeq = Math.max(1, next.options.length + 1);
  }
  upsertGroupSchema(
    store,
    bumped(
      schema,
      schema.fields.map((field) =>
        field.id === fieldId ? next : cloneField(field),
      ),
    ),
  );
  return "changed";
}

/**
 * Remove = purge-marked tombstone. The immutable definition stays to prevent
 * key reuse, while the next exact-scope reconciliation removes the note key.
 * Locked identity fields are a no-op.
 */
export function deactivateField(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  group: string,
  fieldId: string,
): void {
  if (isLockedFieldId(fieldId)) return;
  const schema = resolveGroupSchema(store, library, archive, group);
  const target = schema.fields.find((field) => field.id === fieldId);
  if (!target || !target.active) return;
  upsertGroupSchema(
    store,
    bumped(
      schema,
      schema.fields.map((field) =>
        field.id === fieldId
          ? { ...cloneField(field), active: false, purge: true }
          : field,
      ),
    ),
  );
}

/**
 * Restore a tombstone into the active prefix (end of the visible list).
 * Locked built-ins are already active; a missing id is a no-op.
 */
export function activateField(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  group: string,
  fieldId: string,
): void {
  const schema = resolveGroupSchema(store, library, archive, group);
  const target = schema.fields.find((field) => field.id === fieldId);
  if (!target || target.active) return;
  const rest = schema.fields.filter((field) => field.id !== fieldId);
  upsertGroupSchema(
    store,
    bumped(schema, [
      ...rest.filter((field) => field.active).map(cloneField),
      { ...cloneField(target), active: true, purge: undefined },
      ...rest.filter((field) => !field.active).map(cloneField),
    ]),
  );
}

/** Actives in the given order form the array prefix; tombstones follow. */
export function reorderActiveFields(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  group: string,
  orderedIds: string[],
): void {
  const schema = resolveGroupSchema(store, library, archive, group);
  const actives = effectiveActiveFields(schema);
  const byId = new Map(actives.map((field) => [field.id, field]));
  const next: FieldDef[] = [];
  const used = new Set<string>();
  for (const id of orderedIds) {
    const field = byId.get(id);
    if (!field || used.has(id)) continue;
    used.add(id);
    next.push(field);
  }
  for (const field of actives) {
    if (used.has(field.id)) continue;
    used.add(field.id);
    next.push(field);
  }
  for (const field of schema.fields) {
    if (field.active) continue;
    next.push(field);
  }
  upsertGroupSchema(store, bumped(schema, next.map(cloneField)));
}

function patchFieldOptions(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  group: string,
  fieldId: string,
  patch: (field: FieldDef) => FieldDef | null,
): void {
  const schema = resolveGroupSchema(store, library, archive, group);
  const target = schema.fields.find((field) => field.id === fieldId);
  if (!target) return;
  const next = patch(cloneField(target));
  if (!next) return;
  upsertGroupSchema(
    store,
    bumped(
      schema,
      schema.fields.map((field) => (field.id === fieldId ? next : field)),
    ),
  );
}

/** Field-local option (custom select / multi-select). Ids are never reused. */
export function addFieldOption(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  group: string,
  fieldId: string,
  label: string,
): string | null {
  const name = String(label ?? "").trim();
  if (!name) return null;
  let created: string | null = null;
  patchFieldOptions(store, library, archive, group, fieldId, (field) => {
    if (field.type === "text") return null;
    const seq = nextFieldOptionSeq(field);
    created = `o_${seq}`;
    return {
      ...field,
      options: [...field.options, { id: created, label: name }],
      optionSeq: seq + 1,
    };
  });
  return created;
}

/** Next minted id, always beyond every numeric id the schema still knows. */
function nextFieldOptionSeq(
  field: Pick<FieldDef, "options" | "optionSeq">,
  extraIds: readonly string[] = [],
): number {
  let next = Math.max(1, Math.floor(field.optionSeq ?? 1));
  for (const id of [...field.options.map((option) => option.id), ...extraIds]) {
    const match = /^o_(\d+)$/.exec(id.trim());
    if (!match) continue;
    next = Math.max(next, Number(match[1]) + 1);
  }
  return next;
}

/** Restore one dormant id to a field-local picker without minting a new id. */
export function adoptFieldOption(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  group: string,
  fieldId: string,
  optionId: string,
  label = optionId,
): boolean {
  const id = String(optionId ?? "").trim();
  const name = String(label ?? "").trim() || id;
  if (!id) return false;
  let adopted = false;
  patchFieldOptions(store, library, archive, group, fieldId, (field) => {
    if (field.type === "text" || field.options.some((option) => option.id === id)) {
      return null;
    }
    adopted = true;
    return {
      ...field,
      options: [...field.options, { id, label: name }],
      optionSeq: nextFieldOptionSeq(field, [id]),
    };
  });
  return adopted;
}

export function renameFieldOption(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  group: string,
  fieldId: string,
  optionId: string,
  label: string,
): void {
  const name = String(label ?? "").trim();
  if (!name) return;
  patchFieldOptions(store, library, archive, group, fieldId, (field) => ({
    ...field,
    options: field.options.map((option) =>
      option.id === optionId ? { ...option, label: name } : option,
    ),
  }));
}

/** Drops the option from the picker. Note values keep the old id (dormant). */
export function removeFieldOption(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  group: string,
  fieldId: string,
  optionId: string,
): void {
  patchFieldOptions(store, library, archive, group, fieldId, (field) => ({
    ...field,
    // Bump the seq past the hole so the id cannot be handed out again.
    optionSeq: nextFieldOptionSeq(field, [optionId]),
    options: field.options.filter((option) => option.id !== optionId),
  }));
}

export function reorderFieldOptions(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  group: string,
  fieldId: string,
  orderedIds: string[],
): void {
  patchFieldOptions(store, library, archive, group, fieldId, (field) => {
    const byId = new Map(field.options.map((option) => [option.id, option]));
    const next: FieldOption[] = [];
    const used = new Set<string>();
    for (const id of orderedIds) {
      const option = byId.get(id);
      if (!option || used.has(id)) continue;
      used.add(id);
      next.push(option);
    }
    for (const option of field.options) {
      if (used.has(option.id)) continue;
      next.push(option);
    }
    return { ...field, options: next };
  });
}

/* ----------------------------------------------------------- the patch planner */

export interface NotePropertyPlan {
  /** Missing active keys and their type-correct empty values. */
  add: Record<string, unknown>;
  /** Schema-owned, explicitly purge-marked keys present on this note. */
  remove: string[];
  /** Full deterministic order after add/remove. */
  order: string[];
  /** True means applying this plan would not change content or key order. */
  clean: boolean;
}

/** Push a present key once into a target order. */
function pushOrderedKey(
  order: string[],
  used: Set<string>,
  present: Set<string>,
  key: string,
): void {
  if (!present.has(key) || used.has(key)) return;
  used.add(key);
  order.push(key);
}

/**
 * Plan one exact group's complete note-property reconciliation.
 *
 * The schema owns only its immutable field keys. Active keys are restored;
 * inactive keys are deleted only when the user-confirmed tombstone carries
 * `purge: true`; every unrelated key/value survives. Ordering is equally
 * conservative: existing metadata leads, active schema fields follow in their
 * visible order, unknown user keys keep their relative order, and cover/order
 * storage stays last.
 *
 * Returning a clean plan instead of `null` keeps `null` reserved for notes that
 * are not characters. Callers must skip `processFrontMatter` when `clean`.
 */
export function planNoteProperties(
  fm: Record<string, unknown> | null | undefined,
  fields: readonly Pick<FieldDef, "id" | "key" | "type" | "active" | "purge">[],
): NotePropertyPlan | null {
  if (!fm || typeof fm !== "object") return null;
  const kind = fm.kind;
  if (typeof kind !== "string" || kind.trim() !== CHARACTER_KIND) return null;

  const add: Record<string, unknown> = {};
  const remove: string[] = [];
  const activeKeys: string[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    const key = String(field?.key ?? "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (field.active) {
      if (RESERVED_KEYS.has(key)) continue;
      activeKeys.push(key);
      if (!Object.prototype.hasOwnProperty.call(fm, key)) {
        add[key] = fieldEmptyDefault(field.type);
      }
      continue;
    }
    if (
      field.purge === true &&
      !PURGE_PROTECTED_KEYS.has(key) &&
      !RESERVED_KEYS.has(key) &&
      Object.prototype.hasOwnProperty.call(fm, key)
    ) {
      remove.push(key);
    }
  }

  const removed = new Set(remove);
  const currentKeys = Object.keys(fm);
  const afterKeys = currentKeys.filter((key) => !removed.has(key));
  for (const key of Object.keys(add)) {
    if (!afterKeys.includes(key)) afterKeys.push(key);
  }
  const present = new Set(afterKeys);
  const trailing = new Set<string>(TRAILING_STORAGE_KEYS);
  const order: string[] = [];
  const used = new Set<string>();

  for (const key of LEADING_METADATA_KEYS) {
    pushOrderedKey(order, used, present, key);
  }
  for (const key of activeKeys) {
    pushOrderedKey(order, used, present, key);
  }
  // Unknown keys — including unmarked legacy tombstones — remain user data and
  // keep their relative order. Only position-only storage keys move behind them.
  for (const key of afterKeys) {
    if (trailing.has(key)) continue;
    pushOrderedKey(order, used, present, key);
  }
  for (const key of TRAILING_STORAGE_KEYS) {
    pushOrderedKey(order, used, present, key);
  }
  // Defensive: a future storage key or unusual own key must never disappear.
  for (const key of afterKeys) {
    pushOrderedKey(order, used, present, key);
  }

  const sameOrder =
    currentKeys.length === order.length &&
    currentKeys.every((key, index) => key === order[index]);
  return {
    add,
    remove,
    order,
    clean:
      Object.keys(add).length === 0 && remove.length === 0 && sameOrder,
  };
}

/** Apply a plan computed from this same, write-locked frontmatter object. */
export function applyNotePropertyPlan(
  fm: Record<string, unknown>,
  plan: NotePropertyPlan,
): void {
  if (plan.clean) return;
  for (const key of plan.remove) delete fm[key];
  for (const [key, value] of Object.entries(plan.add)) {
    if (Object.prototype.hasOwnProperty.call(fm, key)) continue;
    fm[key] = Array.isArray(value) ? [...value] : value;
  }

  const snapshot = new Map(Object.keys(fm).map((key) => [key, fm[key]]));
  const order = [
    ...plan.order,
    ...Object.keys(fm).filter((key) => !plan.order.includes(key)),
  ];
  for (const key of Object.keys(fm)) delete fm[key];
  for (const key of order) {
    if (!snapshot.has(key)) continue;
    fm[key] = snapshot.get(key);
  }
}

/**
 * The only keys a character note may gain automatically, for one group's
 * **active** field list. Inactive keys are neither restored nor deleted.
 *
 * Rules match `planCanonicalPropertyPatch` (the fixed built-in-baseline planner
 * in `propertySchema.ts`): non-character or missing `kind` → `null`; an existing
 * key keeps its value and type, wrong type included; nothing missing → `null`,
 * so the caller can skip `processFrontMatter`.
 *
 * Callers must resolve the active list at **run** time, not at enqueue time —
 * add→remove must not restore a key that is inactive now.
 */
export function planActivePropertyPatch(
  fm: Record<string, unknown> | null | undefined,
  activeFields: { key: string; type: FieldType }[],
): Record<string, unknown> | null {
  if (!fm || typeof fm !== "object") return null;
  const kind = (fm as Record<string, unknown>).kind;
  if (typeof kind !== "string" || kind.trim() !== CHARACTER_KIND) return null;

  const patch: Record<string, unknown> = {};
  const seen = new Set<string>();
  let missing = 0;
  for (const field of activeFields) {
    const key = String(field?.key ?? "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (RESERVED_KEYS.has(key)) continue;
    if (Object.prototype.hasOwnProperty.call(fm, key)) continue;
    patch[key] = fieldEmptyDefault(field.type);
    missing += 1;
  }
  return missing > 0 ? patch : null;
}

/* ------------------------------------------------------------------- values */

/** What `fieldValue` needs from a character record. */
export interface FieldValueRecord {
  title: string;
  이름: string;
  코드네임: string;
  본명: string;
  소속: string;
  그룹: string;
  상태: string;
  관계: string;
  인연: string;
  태그: string[];
  /** Every own frontmatter value except systemic keys (custom fields live here). */
  values?: Record<string, string | string[]>;
}

/** The record's own typed field for a built-in id. */
function builtinTypedValue(
  record: FieldValueRecord,
  id: string,
): string | string[] {
  switch (id) {
    case "name":
      return record.title;
    case "status":
      return record.상태;
    case "group":
      return record.그룹;
    case "relation":
      return record.관계;
    case "bond":
      return record.인연;
    case "codename":
      return record.코드네임;
    case "realName":
      return record.본명;
    case "affiliation":
      return record.소속;
    case "tags":
      return record.태그 ?? [];
    default:
      return "";
  }
}

/**
 * Read whatever is stored as the field's current type asks for it.
 *
 * Never lossy in the direction that matters: a scalar becomes a singleton list,
 * a list becomes its joined text. Nothing here writes, so a retype that reads
 * "wrong" is always recoverable by retyping back.
 */
function coerceFieldValue(raw: unknown, type: FieldType): string | string[] {
  if (type === "multi-select") {
    if (Array.isArray(raw)) {
      return raw.map((item) => String(item)).filter((item) => item.trim());
    }
    const single = String(raw ?? "").trim();
    return single ? [single] : [];
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item) => String(item))
      .filter((item) => item.trim())
      .join(", ");
  }
  return String(raw ?? "");
}

/**
 * The one value reader. Built-ins read their typed field; custom fields read
 * `values[key]`; both are coerced to `field.type`.
 *
 * A built-in carrying a scoped type override reads the note's **own** value
 * instead of the typed field, because `CharacterStore` flattens a YAML list
 * into text for those (`상태` and friends are declared `string`). Reading the
 * raw value first is what lets a `코드네임: [가, 나]` survive a multi-select
 * override instead of arriving pre-joined and coming back as one entry.
 */
export function fieldValue(
  record: FieldValueRecord,
  field: Pick<FieldDef, "id" | "key" | "type">,
): string | string[] {
  const builtin = builtinFieldDef(field.id);
  if (builtin) {
    // No override (and `이름`, which can never have one) → byte-for-byte the
    // value every surface read before types became mutable.
    if (builtin.type === field.type || isLockedFieldId(builtin.id)) {
      return builtinTypedValue(record, builtin.id);
    }
    const raw = record.values ? record.values[field.key] : undefined;
    return coerceFieldValue(
      raw === undefined ? builtinTypedValue(record, builtin.id) : raw,
      field.type,
    );
  }
  return coerceFieldValue(
    record.values ? record.values[field.key] : undefined,
    field.type,
  );
}

/**
 * Records that would lose data if `field` stopped holding a list.
 *
 * The guard for multi-select → text / select: those records hold more than one
 * entry, and a scalar has room for exactly one. Pure and record-shaped so the
 * caller can refuse *before* the mutation instead of apologising after it.
 */
export function multiValuedRecords<T extends FieldValueRecord>(
  records: readonly T[],
  field: Pick<FieldDef, "id" | "key">,
): T[] {
  const probe = { id: field.id, key: field.key, type: "multi-select" as const };
  return records.filter((record) => {
    const value = fieldValue(record, probe);
    return Array.isArray(value) && value.length > 1;
  });
}

/** Display string for any field (multi-select joins). */
export function fieldValueText(
  record: FieldValueRecord,
  field: Pick<FieldDef, "id" | "key" | "type">,
  optionLabel?: (id: string) => string,
): string {
  const value = fieldValue(record, field);
  const label = optionLabel ?? ((id: string) => id);
  if (Array.isArray(value)) {
    return value.map(label).filter(Boolean).join(", ");
  }
  return value.trim() ? label(value.trim()) : "";
}

/** Option label for a stored id; unknown ids show themselves (gray ghost). */
export function fieldOptionLabel(field: FieldDef, optionId: string): string {
  const id = optionId.trim();
  if (!id) return "";
  return field.options.find((option) => option.id === id)?.label ?? id;
}

/** Dormant field-local ids still stored by records, in first-seen order. */
export function leftoverFieldOptionIds(
  field: Pick<FieldDef, "key" | "options">,
  records: readonly FieldValueRecord[],
): string[] {
  const active = new Set(field.options.map((option) => option.id));
  const found = new Set<string>();
  for (const record of records) {
    const raw = record.values?.[field.key];
    const values = Array.isArray(raw) ? raw : [String(raw ?? "")];
    for (const value of values) {
      const id = String(value ?? "").trim();
      if (id && !active.has(id)) found.add(id);
    }
  }
  return [...found];
}

/* ---------------------------------------------------------- 보기 (visibility) */

/**
 * Fields 보기 lists for one gallery page + archive: the built-ins once, plus
 * every group's custom fields in that archive. Duplicate labels get a group
 * suffix so two groups' 「별명」 stay tellable apart.
 */
export interface UnionFieldEntry {
  fieldId: string;
  key: string;
  label: string;
  type: FieldType;
  /** Group that owns this field (`""` = 미분류). Empty string for built-ins. */
  group: string;
  builtin: boolean;
  visible: boolean;
}

/**
 * `observedGroups` are the groups the caller can actually see cards in. They
 * are unioned with the persisted schemas — including zero-member ones, whose
 * custom fields must stay listed — and each observed-but-unpersisted group
 * contributes its lazy built-in baseline. A field deactivated in group A can
 * therefore still appear because group B has it active.
 */
export function unionActiveFieldsForArchive(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  pagePath: string,
  observedGroups: readonly string[],
): UnionFieldEntry[] {
  const lib = normalizeLibraryKey(library);
  const arc = normalizeArchiveKey(archive);
  const names = store.propertyDisplayNames;

  const builtinRows: UnionFieldEntry[] = [];
  const customRows: UnionFieldEntry[] = [];
  const seen = new Set<string>();

  const schemas = store.groupSchemas.filter(
    (record) =>
      normalizeLibraryKey(record.library) === lib &&
      normalizeArchiveKey(record.archive) === arc,
  );
  const baseline: GroupSchemaRecord[] = [...schemas];
  const scoped = new Set(
    schemas.map((record) => normalizeGroupKey(record.group)),
  );
  for (const raw of observedGroups) {
    const group = normalizeGroupKey(raw);
    if (scoped.has(group)) continue;
    scoped.add(group);
    baseline.push(resolveGroupSchema(store, lib, arc, group));
  }
  // Nothing persisted and nothing observed → the built-in baseline still shows.
  if (baseline.length === 0) {
    baseline.push(resolveGroupSchema(store, lib, arc, ""));
  }

  for (const schema of baseline) {
    for (const field of effectiveActiveFields(schema)) {
      if (isRoutingFieldId(field.id)) continue; // routing is not a 보기 row
      if (seen.has(field.id)) continue;
      seen.add(field.id);
      const row: UnionFieldEntry = {
        fieldId: field.id,
        key: field.key,
        label: fieldLabel(field, names),
        type: field.type,
        group: isBuiltinFieldId(field.id) ? "" : normalizeGroupKey(schema.group),
        builtin: isBuiltinFieldId(field.id),
        visible: isFieldVisible(store, pagePath, arc, field.id),
      };
      if (row.builtin) builtinRows.push(row);
      else customRows.push(row);
    }
  }

  const rows = [...builtinRows, ...customRows];
  const labelCount = new Map<string, number>();
  for (const row of rows) {
    labelCount.set(row.label, (labelCount.get(row.label) ?? 0) + 1);
  }
  for (const row of rows) {
    if ((labelCount.get(row.label) ?? 0) < 2) continue;
    if (row.builtin) continue; // the built-in keeps the plain name
    row.label = `${row.label} (${groupDisplayName(row.group)})`;
  }
  return rows;
}

function findVisibilityIndex(
  store: GroupSchemaStore,
  page: string,
  archive: string,
  fieldId: string,
): number {
  const pagePath = normalizeLibraryKey(page);
  const arc = normalizeArchiveKey(archive);
  return store.cardFieldVisibility.findIndex(
    (row) =>
      normalizeLibraryKey(row.page) === pagePath &&
      normalizeArchiveKey(row.archive) === arc &&
      row.fieldId === fieldId,
  );
}

/**
 * Card eye state for one `(gallery page, archive, field)`.
 *
 * A scoped row is the only live source. With no row we fall back to the Notion
 * default — `name` and `status` on, every other built-in off, a custom field on
 * — and never to `cardProperties`: that list is a migration seed whose eyes
 * belong to no page, so reading it here would leak page A's answer into page B.
 * Rows written by `seedBuiltinVisibility` carry the migrated state.
 */
export function isFieldVisible(
  store: GroupSchemaStore,
  page: string,
  archive: string,
  fieldId: string,
): boolean {
  const index = findVisibilityIndex(store, page, archive, fieldId);
  const row = index < 0 ? null : store.cardFieldVisibility[index];
  if (row) return row.visible;
  return defaultFieldVisible(fieldId);
}

/** Missing-row default: name/status on, other built-ins off, custom on. */
export function defaultFieldVisible(fieldId: string): boolean {
  if (!isBuiltinFieldId(fieldId)) return true;
  return fieldId === "name" || fieldId === "status";
}

/**
 * 보기 writes visibility only — never order, and never `cardProperties`.
 * Eyes are scoped to one `(gallery page, archive)`; writing back to the legacy
 * global list would move every other page's cards too.
 */
export function setFieldVisibility(
  store: GroupSchemaStore,
  page: string,
  archive: string,
  fieldId: string,
  visible: boolean,
): void {
  const next: CardFieldVisibility = {
    page: normalizeLibraryKey(page),
    archive: normalizeArchiveKey(archive),
    fieldId,
    visible,
  };
  const index = findVisibilityIndex(store, page, archive, fieldId);
  if (index < 0) {
    store.cardFieldVisibility = [...store.cardFieldVisibility, next];
    return;
  }
  const copy = [...store.cardFieldVisibility];
  copy[index] = next;
  store.cardFieldVisibility = copy;
}

/* -------------------------------------- legacy 보기 order compatibility API */

function findOrderIndex(
  store: GroupSchemaStore,
  page: string,
  archive: string,
): number {
  const pagePath = normalizeLibraryKey(page);
  const arc = normalizeArchiveKey(archive);
  return store.cardFieldOrder.findIndex(
    (row) =>
      normalizeLibraryKey(row.page) === pagePath &&
      normalizeArchiveKey(row.archive) === arc,
  );
}

/** Legacy stored order for one page + archive, or `[]` when absent. */
export function storedFieldOrder(
  store: GroupSchemaStore,
  page: string,
  archive: string,
): string[] {
  const index = findOrderIndex(store, page, archive);
  const row = index < 0 ? null : store.cardFieldOrder[index];
  return row ? [...row.order] : [];
}

/**
 * Resolve a legacy presentation order for compatibility callers and tests.
 *
 * Stored ids come first, in stored sequence, minus the ones no reachable schema
 * offers any more (they stay in storage — a field restored later returns to its
 * slot instead of being appended). Then every candidate 보기 can see but the
 * stored row has not met yet, appended in the caller's deterministic order.
 * Product rendering no longer calls this function.
 */
export function resolveFieldOrder(
  store: GroupSchemaStore,
  page: string,
  archive: string,
  candidateIds: readonly string[],
): string[] {
  const candidates = new Set<string>();
  for (const id of candidateIds) {
    if (id && !isRoutingFieldId(id)) candidates.add(id);
  }
  const out: string[] = [];
  const used = new Set<string>();
  for (const id of storedFieldOrder(store, page, archive)) {
    if (!candidates.has(id) || used.has(id)) continue;
    used.add(id);
    out.push(id);
  }
  for (const id of candidateIds) {
    if (!candidates.has(id) || used.has(id)) continue;
    used.add(id);
    out.push(id);
  }
  return out;
}

/**
 * 보기 writes one order for the page + archive. Ids the caller did not mention
 * but the stored row already knew are kept **behind** the new order, so a field
 * hidden from this render (another archive's group, a tombstone) cannot lose its
 * slot because it happened not to be on screen.
 */
export function setFieldOrder(
  store: GroupSchemaStore,
  page: string,
  archive: string,
  orderedIds: readonly string[],
): void {
  const pagePath = normalizeLibraryKey(page);
  if (!pagePath) return;
  const arc = normalizeArchiveKey(archive);
  const order: string[] = [];
  const used = new Set<string>();
  for (const raw of orderedIds) {
    const id = String(raw ?? "").trim();
    if (!id || used.has(id) || isRoutingFieldId(id)) continue;
    used.add(id);
    order.push(id);
  }
  for (const id of storedFieldOrder(store, pagePath, arc)) {
    if (used.has(id)) continue;
    used.add(id);
    order.push(id);
  }
  const next: CardFieldOrder = { page: pagePath, archive: arc, order };
  const index = findOrderIndex(store, pagePath, arc);
  if (index < 0) {
    store.cardFieldOrder = [...store.cardFieldOrder, next];
    return;
  }
  const copy = [...store.cardFieldOrder];
  copy[index] = next;
  store.cardFieldOrder = copy;
}

export interface FieldProjectionOptions {
  /** Card surface: the eye also has to be open. */
  visible?: (fieldId: string) => boolean;
  /** Ids that ignore `visible` (the chip axis keeps its slot, e.g. `태그`). */
  alwaysVisible?: readonly string[];
  /** Ids this surface renders elsewhere (peek shows `이름` as the title). */
  skip?: readonly string[];
}
/**
 * **The** projection every surface shares: `order ∩ schema.active`, with the
 * card surface additionally applying the eyes.
 *
 * Card, peek and the public side panel all come through here, so a field can
 * never sit in two different places on two surfaces. Routing metadata is
 * excluded before anything else looks at the list.
 */
export function projectSchemaFields(
  order: readonly string[],
  schema: GroupSchemaRecord,
  opts: FieldProjectionOptions = {},
): FieldDef[] {
  const active = new Map<string, FieldDef>();
  for (const field of effectiveActiveFields(schema)) {
    if (isRoutingFieldId(field.id)) continue;
    active.set(field.id, field);
  }
  const skip = new Set(opts.skip ?? []);
  const always = new Set(opts.alwaysVisible ?? []);
  const ordered: FieldDef[] = [];
  const used = new Set<string>();
  for (const id of order) {
    const field = active.get(id);
    if (!field || used.has(id)) continue;
    used.add(id);
    ordered.push(field);
  }
  // A field the page order has never seen still renders — at the end, in schema
  // order, so a freshly added field appears instead of silently vanishing.
  for (const field of active.values()) {
    if (used.has(field.id)) continue;
    used.add(field.id);
    ordered.push(field);
  }
  return ordered.filter((field) => {
    if (skip.has(field.id)) return false;
    if (!opts.visible || always.has(field.id)) return true;
    return opts.visible(field.id);
  });
}

/* ---------------------------------------------------------- routing inventory */

/**
 * Every routing scope `그룹 · 속성 관리` shows for one archive, as peers.
 *
 * There is no second-class *visible* route here. `""` — displayed as `기본` —
 * becomes visible when a note actually lands there or the user customized its
 * schema. A mechanically seeded empty fallback is not a group the user added,
 * so the drawer does not synthesize a chip for it. `routes` is already in the
 * canonical order the caller resolved, which is the same order the gallery
 * sections use.
 */
export interface RouteInventory {
  /** Named groups, deduped, in canonical order. */
  named: string[];
  /** Every visible route; `""` is included only when the default is real. */
  routes: string[];
  /** At least one record in this archive carries no `그룹`. */
  hasUngrouped: boolean;
  /** The default schema differs from its mechanically seeded baseline. */
  defaultCustomized: boolean;
  /** More than one route exists. */
  switchable: boolean;
}

export function groupRouteInventory(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  opts: {
    /** Groups reachable in this archive (persisted schemas + observed cards). */
    namedGroups: readonly string[];
    /** At least one record in this archive carries no `그룹`. */
    hasUngroupedRecords: boolean;
    /**
     * Canonical route order (`""` allowed), as resolved by
     * `resolveGroupRouteOrder`. Routes it does not mention keep their caller
     * order after the ranked ones; an unranked default route stays last.
     */
    routeOrder?: readonly string[];
  },
): RouteInventory {
  const defaultCustomized = isDefaultSchemaCustomized(store, library, archive);
  const defaultVisible = opts.hasUngroupedRecords || defaultCustomized;
  const named: string[] = [];
  const reachable = new Set<string>();
  for (const raw of opts.namedGroups) {
    const group = normalizeGroupKey(raw);
    if (!group || reachable.has(group)) continue;
    reachable.add(group);
    named.push(group);
  }
  const routes: string[] = [];
  const placed = new Set<string>();
  for (const raw of opts.routeOrder ?? []) {
    const route = normalizeGroupKey(raw);
    if (placed.has(route)) continue;
    if (!route && !defaultVisible) continue;
    if (route && !reachable.has(route)) continue;
    placed.add(route);
    routes.push(route);
  }
  for (const group of named) {
    if (placed.has(group)) continue;
    placed.add(group);
    routes.push(group);
  }
  if (defaultVisible && !placed.has("")) routes.push("");
  return {
    named: routes.filter(Boolean),
    routes,
    hasUngrouped: opts.hasUngroupedRecords,
    defaultCustomized,
    switchable: routes.length > 1,
  };
}

/**
 * True when the default (`""`) schema differs from its normalized baseline in a
 * way the user could have caused: a field added, removed, renamed, retyped, or
 * given options. Persistence alone is not customization — opening the modal on a
 * zero-group archive seeds the record mechanically, and a seeded baseline is
 * nothing the user needs warning about before it is reset.
 */
export function isDefaultSchemaCustomized(
  store: GroupSchemaStore,
  library: string,
  archive: string,
): boolean {
  const record = findGroupSchema(store, library, archive, "");
  if (!record) return false;
  const baseline = migratedBuiltinBaseline(
    store.cardProperties,
    store.propertyDisplayNames,
  );
  const byId = new Map(baseline.map((field) => [field.id, field]));
  for (const field of record.fields) {
    const base = byId.get(field.id);
    if (!base) return true; // a custom field only a user can add
    if (!field.active) return true; // a built-in the user removed
    if (field.options.length > 0) return true;
    if (field.type !== base.type) return true; // a scoped type override
    if (field.label.trim() !== base.label.trim()) return true;
  }
  for (const field of baseline) {
    if (!record.fields.some((stored) => stored.id === field.id)) return true;
  }
  return false;
}

/** Field ids active in at least one schema reachable from this archive. */
export function reachableActiveFieldIds(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  observedGroups: readonly string[],
): Set<string> {
  const ids = new Set<string>();
  for (const row of unionActiveFieldsForArchive(
    store,
    library,
    archive,
    "",
    observedGroups,
  )) {
    ids.add(row.fieldId);
  }
  return ids;
}

/* ------------------------------------------------------------ group deletion */

/** Why a delete/reassign cannot run. `null` = the plan is executable. */
export type GroupDeletionBlock = "same-scope" | "unknown-target";

/** Safe, user-facing refusal raised before group deletion mutates anything. */
export class GroupDeletionBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroupDeletionBlockedError";
  }
}

/**
 * A group operation that failed with a message worth showing verbatim — a
 * partial trash run, a refused name, a settings commit that did not land. The
 * modal prints `message` instead of the generic save failure, so a count the
 * user needs ("노트 12개 중 9개") is never flattened into "저장하지 못했어요".
 */
export class GroupOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroupOperationError";
  }
}

export interface GroupDeletionMember {
  path: string;
  group: string;
}

export interface GroupDeletionPlan {
  library: string;
  archive: string;
  /** The route being removed (`""` = 기본, whose schema resets). */
  from: string;
  /** Destination scope: another named group, or `""` for 기본. */
  to: string;
  /** Member notes to rewrite, in input order. Empty = schema-only removal. */
  moves: string[];
  blocked: GroupDeletionBlock | null;
}

/**
 * Plan the whole rewrite before touching anything.
 *
 * A route may only disappear once every record that routes to it has an
 * explicit destination, so this returns the full member list up front: the
 * caller rewrites those notes, commits the schema/order removal, and — if any
 * step fails — rolls the rewritten notes back to `from`. Re-planning after a
 * partial run yields fewer moves and the same end state, which is what makes a
 * retry converge instead of double-moving a note.
 *
 * `from` may be `""`: the default route is a peer, and deleting it means
 * "hand its cards to another route and reset its property list". A destination
 * is required only when there is something to move — an empty route is a
 * schema-only removal, so it needs nowhere to go.
 */
export function planGroupDeletion(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  from: string,
  to: string,
  members: readonly GroupDeletionMember[],
  reachableGroups: readonly string[] = [],
): GroupDeletionPlan {
  const lib = normalizeLibraryKey(library);
  const arc = normalizeArchiveKey(archive);
  const source = normalizeGroupKey(from);
  const target = normalizeGroupKey(to);
  const plan: GroupDeletionPlan = {
    library: lib,
    archive: arc,
    from: source,
    to: target,
    moves: [],
    blocked: null,
  };
  const seen = new Set<string>();
  for (const member of members) {
    if (normalizeGroupKey(member.group) !== source) continue;
    const path = String(member.path ?? "").trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    plan.moves.push(path);
  }
  if (plan.moves.length === 0) return plan;
  if (source === target) {
    plan.blocked = "same-scope";
    return plan;
  }
  if (target) {
    const reachable = new Set(
      [
        ...reachableGroups,
        ...persistedGroupsForArchive(store, lib, arc),
      ].map((raw) => normalizeGroupKey(raw)),
    );
    reachable.delete(source);
    if (!reachable.has(target)) {
      plan.blocked = "unknown-target";
      return plan;
    }
  }
  return plan;
}

/**
 * Drop one route's schema record. Values are never touched: the note keeps
 * every key it had, dormant under the destination schema, and the ledger keeps
 * the keys so nothing can ever be handed out twice.
 *
 * `group` may be `""`. The default route cannot stop existing, so dropping its
 * record is a reset: the next read resolves the built-in baseline again.
 *
 * Mutates `store` — run inside the one `commitSettings` that also drops the
 * group-order entry, and only after the member notes were rewritten.
 */
export function applyGroupDeletion(
  store: GroupSchemaStore,
  library: string,
  archive: string,
  group: string,
): void {
  const lib = normalizeLibraryKey(library);
  const arc = normalizeArchiveKey(archive);
  const target = normalizeGroupKey(group);
  store.groupSchemas = store.groupSchemas.filter(
    (record) =>
      !(
        normalizeLibraryKey(record.library) === lib &&
        normalizeArchiveKey(record.archive) === arc &&
        normalizeGroupKey(record.group) === target
      ),
  );
}

/* ------------------------------------------------------------------ normalize */

function normalizeFieldType(raw: unknown): FieldType | null {
  if (raw === "text" || raw === "select" || raw === "multi-select") return raw;
  return null;
}

function normalizeOptions(raw: unknown): FieldOption[] {
  if (!Array.isArray(raw)) return [];
  const out: FieldOption[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const id = String((item as { id?: unknown }).id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = String((item as { label?: unknown }).label ?? "").trim();
    out.push({ id, label: label || id });
  }
  return out;
}

function normalizeField(raw: unknown): FieldDef | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const id = String(src.id ?? "").trim();
  if (!id) return null;
  // A legacy vault stored `그룹` as an ordinary row. Strip the definition; the
  // note keeps its `그룹` value, which is what routing reads.
  if (isRoutingFieldId(id)) return null;
  const builtin = builtinFieldDef(id);
  const key = builtin ? builtin.key : String(src.key ?? "").trim();
  if (!key || RESERVED_KEYS.has(key)) return null;
  const stored = normalizeFieldType(src.type);
  // A built-in's key is structure, but its type is a per-scope preference — so a
  // persisted override has to survive the reload that makes it authoritative.
  // `이름` is the exception: the card identity is always text.
  const type = builtin
    ? isLockedFieldId(id)
      ? builtin.type
      : (stored ?? builtin.type)
    : stored;
  if (!type) return null;
  const label = String(src.label ?? "").trim();
  const active = builtin && isLockedFieldId(id) ? true : src.active !== false;
  const field: FieldDef = {
    id,
    key,
    label: label || key,
    type,
    active,
    // Kept even for `text`: a dormant vocabulary is what makes a type change
    // reversible, so normalization must not be the thing that erases it.
    options: normalizeOptions(src.options),
  };
  if (!active && src.purge === true) field.purge = true;
  const seq = Number(src.optionSeq);
  if (Number.isFinite(seq) && seq > 0) field.optionSeq = Math.floor(seq);
  return field;
}

export function normalizeGroupSchemas(raw: unknown): GroupSchemaRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: GroupSchemaRecord[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const src = item as Record<string, unknown>;
    const library = normalizeLibraryKey(src.library);
    if (!library) continue;
    const archive = normalizeArchiveKey(src.archive);
    const group = normalizeGroupKey(src.group);
    const scope = `${library}\0${archive}\0${group}`;
    if (seen.has(scope)) continue;
    const fieldsRaw = Array.isArray(src.fields) ? src.fields : [];
    const fields: FieldDef[] = [];
    const ids = new Set<string>();
    const keys = new Set<string>();
    for (const fieldRaw of fieldsRaw) {
      const field = normalizeField(fieldRaw);
      if (!field || ids.has(field.id) || keys.has(field.key)) continue;
      ids.add(field.id);
      keys.add(field.key);
      fields.push(field);
    }
    // Only `이름` is required. A legacy record that never stored `상태` — or
    // stored `그룹`, which is now stripped — stays perfectly usable; a record
    // without the card identity is not, so the scope re-seeds from the baseline.
    if (LOCKED_FIELD_IDS.some((id) => !ids.has(id))) continue;
    const revision = Number(src.revision);
    seen.add(scope);
    out.push({
      library,
      archive,
      group,
      revision: Number.isFinite(revision) && revision > 0 ? Math.floor(revision) : 0,
      fields,
    });
  }
  return out;
}

export function normalizeFieldKeyLedgers(raw: unknown): FieldKeyLedger[] {
  if (!Array.isArray(raw)) return [];
  const out: FieldKeyLedger[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const src = item as Record<string, unknown>;
    const library = normalizeLibraryKey(src.library);
    if (!library) continue;
    const archive = normalizeArchiveKey(src.archive);
    const scope = `${library}\0${archive}`;
    if (seen.has(scope)) continue;
    seen.add(scope);
    const keys: string[] = [];
    if (Array.isArray(src.keys)) {
      for (const key of src.keys) {
        const value = String(key ?? "").trim();
        if (!value || keys.includes(value)) continue;
        keys.push(value);
      }
    }
    for (const def of BUILTIN_FIELD_DEFS) {
      if (!keys.includes(def.key)) keys.push(def.key);
    }
    const next = Number(src.nextFieldSeq);
    out.push({
      library,
      archive,
      keys,
      nextFieldSeq: Number.isFinite(next) && next > 0 ? Math.floor(next) : 1,
    });
  }
  return out;
}

export function normalizeCardFieldVisibility(raw: unknown): CardFieldVisibility[] {
  if (!Array.isArray(raw)) return [];
  const out: CardFieldVisibility[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const src = item as Record<string, unknown>;
    const page = normalizeLibraryKey(src.page);
    const fieldId = String(src.fieldId ?? "").trim();
    if (!page || !fieldId) continue;
    const archive = normalizeArchiveKey(src.archive);
    const scope = `${page}\0${archive}\0${fieldId}`;
    if (seen.has(scope)) continue;
    seen.add(scope);
    out.push({ page, archive, fieldId, visible: src.visible !== false });
  }
  return out;
}

export function normalizeCardFieldOrder(raw: unknown): CardFieldOrder[] {
  if (!Array.isArray(raw)) return [];
  const out: CardFieldOrder[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const src = item as Record<string, unknown>;
    const page = normalizeLibraryKey(src.page);
    if (!page) continue;
    const archive = normalizeArchiveKey(src.archive);
    // A space is valid in both halves, so it cannot delimit this tuple.
    const scope = `${page}\0${archive}`;
    if (seen.has(scope)) continue;
    const order: string[] = [];
    const used = new Set<string>();
    if (Array.isArray(src.order)) {
      for (const entry of src.order) {
        const id = String(entry ?? "").trim();
        // The routing field never held a slot, so a legacy row cannot keep one.
        if (!id || used.has(id) || isRoutingFieldId(id)) continue;
        used.add(id);
        order.push(id);
      }
    }
    if (order.length === 0) continue; // an empty row says nothing; drop it
    seen.add(scope);
    out.push({ page, archive, order });
  }
  return out;
}

/**
 * Migration: copy the legacy built-in eye state onto every `(gallery page,
 * archive)` pair we can see. These rows are the **only** carrier of a migrated
 * vault's eyes — a missing row now reads the Notion default, so a pair we never
 * seeded starts with name/status on and the rest off.
 */
export function seedBuiltinVisibility(
  rows: CardFieldVisibility[],
  pairs: { page: string; archive: string }[],
  cardProperties: CardPropertyPref[] | undefined,
): CardFieldVisibility[] {
  const prefs = normalizeCardProperties(cardProperties);
  const out = [...rows];
  const seen = new Set(
    out.map((row) => `${row.page}\0${row.archive}\0${row.fieldId}`),
  );
  for (const pair of pairs) {
    const page = normalizeLibraryKey(pair.page);
    if (!page) continue;
    const archive = normalizeArchiveKey(pair.archive);
    for (const pref of prefs) {
      const scope = `${page}\0${archive}\0${pref.id}`;
      if (seen.has(scope)) continue;
      seen.add(scope);
      out.push({ page, archive, fieldId: pref.id, visible: pref.visible });
    }
  }
  return out;
}
