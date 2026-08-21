/**
 * 공유 투영 — what a public page is allowed to show.
 *
 * Two surfaces, one schema. The active group schema decides which fields exist
 * at all; the 보기 eyes are a **card-preview** rule and never reach the side
 * panel. That split is the whole reason this module exists: `webShare.ts` needs
 * Obsidian to read notes and covers, so the decisions that must be provable —
 * tag visibility, chip-axis label resolution, panel-mode equivalence — live
 * here instead.
 *
 * This file imports nothing — `node --test` runs it straight from TypeScript
 * (see `tests/share-projection.test.ts`). Keep it that way: a relative import
 * without a `.ts` extension cannot load under Node's test runner.
 */

/** One entry of a vocabulary (chip axis option, or a field-local option). */
export interface ShareOption {
  id: string;
  label: string;
}

/** Field types, mirroring `groupSchema.FieldType`. */
export type ShareFieldType = "text" | "select" | "multi-select";

/**
 * Built-in ids whose vocabulary is the global chip axis, not field-local.
 * Must match `groupSchema.CHIP_AXIS_FIELD_IDS`.
 */
export const SHARE_CHIP_AXIS_IDS: readonly string[] = [
  "status",
  "relation",
  "bond",
  "affiliation",
  "tags",
];

/**
 * Fields the card chrome already owns: `name` is the title, `status` is the
 * pill, `tags` is the chip cluster. They are never published as property rows.
 */
export const SHARE_SURFACE_FIELD_IDS: readonly string[] = [
  "name",
  "status",
  "tags",
];

/** Chip-axis vocabularies, keyed by field id. Built via `axisFor` by the caller. */
export type ShareAxisOptions = Partial<Record<string, readonly ShareOption[]>>;

/** One publishable field, with its value already read through `fieldValue`. */
export interface ShareFieldInput {
  /** Field id. A chip-axis id resolves against the global vocabulary. */
  id: string;
  /** Display name (already resolved through `fieldLabel`). */
  label: string;
  type: ShareFieldType;
  /** Field-local options — custom select / multi-select only. */
  options: readonly ShareOption[];
  /** Stored value: option ids for select-ish fields, free text otherwise. */
  raw: string | string[];
  /** 보기 eye state for this `(page, archive, field)`. Cards only. */
  cardVisible: boolean;
}

export interface ShareProp {
  label: string;
  value: string;
}

export interface ShareCardProjection {
  /** Card strip: schema ∩ eyes. */
  props: ShareProp[];
  /** Side panel: schema only — eyes are a card rule. */
  detailProps: ShareProp[];
}

export interface ShareTagProjection {
  cardTagIds: string[];
  detailTagIds: string[];
}

export interface ShareStatusProjection {
  /** Keep the resolved id for consumers that do render status. */
  status: string;
  /** The 속성 panel may render its dedicated status row only when active. */
  showStatus: boolean;
  /** Status-axis card pill; empty prevents a dormant value from leaking. */
  filterValue: string;
}

/** Schema-gate the two dedicated status surfaces without deleting its value. */
export function projectShareStatus(args: {
  statusId: string;
  active: boolean;
}): ShareStatusProjection {
  const status = String(args.statusId ?? "").trim();
  return {
    status,
    showStatus: args.active,
    filterValue: args.active ? status : "",
  };
}

/**
 * Tag visibility on the two public surfaces.
 *
 * - `active: false` (tags removed from this group's schema) → neither surface;
 * - active + eye off → side panel only;
 * - active + eye on → both.
 *
 * The schema gates both surfaces; the eye gates the card alone.
 */
export function projectShareTags(args: {
  tagIds: readonly string[];
  active: boolean;
  cardVisible: boolean;
}): ShareTagProjection {
  if (!args.active) return { cardTagIds: [], detailTagIds: [] };
  const ids = args.tagIds.map((id) => String(id ?? "").trim()).filter(Boolean);
  return {
    cardTagIds: args.cardVisible ? [...ids] : [],
    detailTagIds: [...ids],
  };
}

/** Every tag id that reaches a public surface — the vocabulary to publish. */
export function publishedTagIds(
  projections: readonly ShareTagProjection[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const projection of projections) {
    for (const id of [...projection.cardTagIds, ...projection.detailTagIds]) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function isShareChipAxisField(fieldId: string): boolean {
  return SHARE_CHIP_AXIS_IDS.includes(fieldId);
}

/** True for the three fields the card chrome renders itself. */
export function isShareSurfaceField(fieldId: string): boolean {
  return SHARE_SURFACE_FIELD_IDS.includes(fieldId);
}

/**
 * Label for one stored id. A chip-axis field reads the global vocabulary, a
 * custom field its own options. An id missing from either vocabulary shows
 * itself — same rule as `resolveAxisOption` / `fieldOptionLabel`, so a renamed
 * option follows its rename and a removed one stays legible.
 */
export function projectShareOptionLabel(
  field: Pick<ShareFieldInput, "id" | "options">,
  optionId: string,
  axisOptions: ShareAxisOptions,
): string {
  const id = String(optionId ?? "").trim();
  if (!id) return "";
  const vocab = isShareChipAxisField(field.id)
    ? (axisOptions[field.id] ?? [])
    : field.options;
  return vocab.find((option) => option.id === id)?.label ?? id;
}

/**
 * Display text for one field. `text` fields publish their value as typed;
 * everything else resolves ids to labels so a public page never leaks `o_3`.
 */
export function projectShareFieldText(
  field: ShareFieldInput,
  axisOptions: ShareAxisOptions,
): string {
  const raw = field.raw;
  if (Array.isArray(raw)) {
    return raw
      .map((id) => projectShareOptionLabel(field, id, axisOptions))
      .filter(Boolean)
      .join(", ");
  }
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (field.type === "text" && !isShareChipAxisField(field.id)) return value;
  return projectShareOptionLabel(field, value, axisOptions);
}

/**
 * Card strip + side panel property rows for one card.
 *
 * `panelProps` keeps accepting the stored `"preview"` for compatibility, but
 * the side panel treats it exactly like `"all"`: card eyes are a card rule, so
 * the panel publishes every active field of this card's group.
 */
export function projectShareCard(args: {
  fields: readonly ShareFieldInput[];
  axisOptions: ShareAxisOptions;
  panelProps: "preview" | "all";
  /** False when the 「속성」 header chip is off — the panel block is skipped. */
  includeAttrs: boolean;
}): ShareCardProjection {
  const props: ShareProp[] = [];
  const detailProps: ShareProp[] = [];
  for (const field of args.fields) {
    if (isShareSurfaceField(field.id)) continue;
    const value = projectShareFieldText(field, args.axisOptions);
    if (!value) continue;
    const row: ShareProp = { label: field.label, value };
    if (field.cardVisible) props.push(row);
    if (args.includeAttrs) detailProps.push({ ...row });
  }
  return { props, detailProps };
}
