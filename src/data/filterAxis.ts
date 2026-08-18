import {
  normalizeSelectVocab,
  resolveStatus,
  type StatusDef,
} from "./status";
import { tagAxisOptions, type TagDef } from "./tags";
import {
  axisDisplayLabel,
  type PropertyDisplayNames,
} from "./propertyLabels";

/**
 * Which frontmatter property drives the gallery chip row.
 * One row = one axis; a gallery note may override the global default with FM
 * `primaryFilter`.
 */
export type PrimaryFilterProperty =
  | "status"
  | "relation"
  | "bond"
  | "affiliation"
  | "tags";

export const FILTER_AXIS_IDS: PrimaryFilterProperty[] = [
  "status",
  "relation",
  "bond",
  "affiliation",
  "tags",
];

/**
 * Axes whose vocabulary lives in `settings.selectVocab`
 * (status keeps `statuses`, tags keep `tagVocab`).
 */
export type SelectVocabProperty = Exclude<
  PrimaryFilterProperty,
  "status" | "tags"
>;

export const SELECT_VOCAB_PROPERTIES: SelectVocabProperty[] = [
  "relation",
  "bond",
  "affiliation",
];

export type SelectVocab = Record<SelectVocabProperty, StatusDef[]>;

const AXIS_META: Record<
  PrimaryFilterProperty,
  { fmKey: string; label: string }
> = {
  status: { fmKey: "상태", label: "상태" },
  relation: { fmKey: "관계", label: "관계" },
  bond: { fmKey: "인연", label: "인연" },
  affiliation: { fmKey: "소속", label: "소속" },
  tags: { fmKey: "태그", label: "태그" },
};

/** Minimal record shape an axis reads/writes. */
export interface AxisRecord {
  상태: string;
  관계: string;
  인연: string;
  소속: string;
  /** Multi-value axis — parsed ids, never a joined string. */
  태그: string[];
}

/** Settings slice the axis resolver needs (avoids a settings ↔ data cycle). */
export interface FilterAxisSource {
  primaryFilterProperty: PrimaryFilterProperty;
  statuses: StatusDef[];
  selectVocab: SelectVocab;
  tagVocab: TagDef[];
  propertyDisplayNames?: PropertyDisplayNames;
}

export interface FilterAxis {
  propertyId: PrimaryFilterProperty;
  /** Frontmatter key holding this axis' value. */
  fmKey: string;
  /** Korean UI label (상태 · 관계 · 인연 · 소속). */
  label: string;
  options: StatusDef[];
  /** Multi-value axis: a record can carry several options (tags). */
  multi: boolean;
  /** True when the configured axis had no options and we fell back to status. */
  fellBack: boolean;
  /** True when this axis is selected and has no official options. */
  empty: boolean;
}

export const DEFAULT_SELECT_VOCAB: SelectVocab = {
  relation: [],
  bond: [],
  affiliation: [],
};

export function axisLabel(
  propertyId: PrimaryFilterProperty,
  names?: PropertyDisplayNames | null,
): string {
  return axisDisplayLabel(propertyId, names);
}

export function axisFrontmatterKey(propertyId: PrimaryFilterProperty): string {
  return AXIS_META[propertyId].fmKey;
}

export function normalizePrimaryFilterProperty(
  raw: unknown,
): PrimaryFilterProperty {
  if (
    typeof raw === "string" &&
    (FILTER_AXIS_IDS as string[]).includes(raw)
  ) {
    return raw as PrimaryFilterProperty;
  }
  return "status";
}

export function normalizeSelectVocabMap(raw: unknown): SelectVocab {
  const src = (raw ?? {}) as Record<string, unknown>;
  return {
    relation: normalizeSelectVocab(src.relation),
    bond: normalizeSelectVocab(src.bond),
    affiliation: normalizeSelectVocab(src.affiliation),
  };
}

/** Vocabulary for one axis, ignoring the empty-axis fallback. */
export function axisOptions(
  settings: FilterAxisSource,
  propertyId: PrimaryFilterProperty,
): StatusDef[] {
  if (propertyId === "status") return settings.statuses;
  if (propertyId === "tags") return tagAxisOptions(settings.tagVocab ?? []);
  return settings.selectVocab?.[propertyId] ?? [];
}

/** True for axes whose frontmatter value is a list. */
export function axisIsMulti(propertyId: PrimaryFilterProperty): boolean {
  return propertyId === "tags";
}

/** Axis descriptor for a specific property (no fallback). */
export function axisFor(
  settings: FilterAxisSource,
  propertyId: PrimaryFilterProperty,
): FilterAxis {
  const options = axisOptions(settings, propertyId);
  return {
    propertyId,
    fmKey: AXIS_META[propertyId].fmKey,
    label: axisDisplayLabel(propertyId, settings.propertyDisplayNames),
    options,
    multi: axisIsMulti(propertyId),
    fellBack: false,
    empty: propertyId !== "status" && options.length === 0,
  };
}

/**
 * Active chip axis. Empty non-status vocabulary stays empty (`empty: true`).
 */
export function getFilterAxis(settings: FilterAxisSource): FilterAxis {
  return resolveFilterAxis(settings, settings.primaryFilterProperty);
}

/**
 * Axis for an explicit request (a gallery page override, or the global default
 * when the page has none). Empty non-status vocabulary stays empty — never
 * silently swaps to status.
 */
export function resolveFilterAxis(
  settings: FilterAxisSource,
  requestedRaw: unknown,
): FilterAxis {
  return axisFor(settings, normalizePrimaryFilterProperty(requestedRaw));
}

export function recordAxisValue(
  record: AxisRecord,
  propertyId: PrimaryFilterProperty,
): string {
  switch (propertyId) {
    case "status":
      return record.상태;
    case "relation":
      return record.관계;
    case "bond":
      return record.인연;
    case "affiliation":
      return record.소속;
    case "tags":
      // Multi-value: use `recordAxisValues`. Joined text is display-only.
      return (record.태그 ?? []).join(", ");
    default:
      return "";
  }
}

/** Every raw value a record holds on this axis (scalar axes yield 0 or 1). */
export function recordAxisValues(
  record: AxisRecord,
  propertyId: PrimaryFilterProperty,
): string[] {
  if (propertyId === "tags") {
    return (record.태그 ?? []).filter((id) => id.trim());
  }
  const value = recordAxisValue(record, propertyId).trim();
  return value ? [value] : [];
}

/** In-memory record patch; frontmatter write is `setCharacterField`. */
export function setRecordAxisValue(
  record: AxisRecord,
  propertyId: PrimaryFilterProperty,
  value: string,
): void {
  switch (propertyId) {
    case "status":
      record.상태 = value;
      break;
    case "relation":
      record.관계 = value;
      break;
    case "bond":
      record.인연 = value;
      break;
    case "affiliation":
      record.소속 = value;
      break;
    case "tags":
      // Tags are written by `setCharacterTags` — never through a scalar patch.
      break;
    default:
      break;
  }
}

/**
 * Resolve a raw frontmatter value to a chip/pill definition.
 * Status keeps its legacy blank → `Off` behavior; other axes treat blank as
 * unset (id `""`, which matches no chip). Unknown values stay gray ghosts.
 */
export function resolveAxisOption(
  axis: Pick<FilterAxis, "propertyId" | "options">,
  value: string | undefined | null,
): StatusDef {
  if (axis.propertyId === "status") return resolveStatus(axis.options, value);
  const raw = (value ?? "").trim();
  if (!raw) return { id: "", label: "없음", color: "gray" };
  const hit = axis.options.find((o) => o.id === raw);
  return hit ?? { id: raw, label: raw, color: "gray" };
}

/** Resolved option for a record on a given axis (scalar axes only). */
export function resolveRecordAxisOption(
  axis: FilterAxis,
  record: AxisRecord,
): StatusDef {
  return resolveAxisOption(axis, recordAxisValue(record, axis.propertyId));
}

/**
 * Every option a record resolves to on this axis. Scalar axes keep their
 * existing single-value semantics (status blank still reads as `Off`); a
 * multi-value axis drops unset entries.
 */
export function resolveRecordAxisOptions(
  axis: Pick<FilterAxis, "propertyId" | "options">,
  record: AxisRecord,
): StatusDef[] {
  if (axis.propertyId === "tags") {
    return recordAxisValues(record, "tags")
      .map((value) => resolveAxisOption(axis, value))
      .filter((option) => option.id);
  }
  return [resolveAxisOption(axis, recordAxisValue(record, axis.propertyId))];
}

/** Does this record match a chip value on the given axis? */
export function recordMatchesAxisChip(
  axis: Pick<FilterAxis, "propertyId" | "options">,
  record: AxisRecord,
  chip: string,
): boolean {
  if (chip === "all") return true;
  return resolveRecordAxisOptions(axis, record).some((o) => o.id === chip);
}

/** A record as the occupancy scan reads it: axis values plus its archive. */
export type ArchiveScopedRecord = AxisRecord & { 장르?: string };

/**
 * Occupants per axis option, counted with the same predicate the grid filters
 * by. `records` is already library-scoped by the caller; `archiveGenre` narrows
 * to one archive (empty = every record passed in). Search never reaches here —
 * chip membership must not move as the user types.
 */
export function countAxisOptionOccupants(
  axis: Pick<FilterAxis, "propertyId" | "options">,
  records: ArchiveScopedRecord[],
  archiveGenre = "",
): Map<string, number> {
  const genre = archiveGenre.trim();
  const counts = new Map<string, number>();
  for (const option of axis.options) counts.set(option.id, 0);
  for (const record of records) {
    if (genre && (record.장르 ?? "").trim() !== genre) continue;
    for (const option of axis.options) {
      if (recordMatchesAxisChip(axis, record, option.id)) {
        counts.set(option.id, (counts.get(option.id) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** Raw stored ids on a record (status blank counts as Off). */
export function rawAxisIds(
  record: AxisRecord,
  propertyId: PrimaryFilterProperty,
): string[] {
  if (propertyId === "status") {
    return [(record.상태 ?? "").trim() || "Off"];
  }
  return recordAxisValues(record, propertyId);
}

/** How many records store this official or leftover option id. */
export function countRawAxisOccupants(
  propertyId: PrimaryFilterProperty,
  optionId: string,
  records: ArchiveScopedRecord[],
  archiveGenre = "",
): number {
  const genre = archiveGenre.trim();
  const id = optionId.trim();
  if (!id) return 0;
  let n = 0;
  for (const record of records) {
    if (genre && (record.장르 ?? "").trim() !== genre) continue;
    if (rawAxisIds(record, propertyId).includes(id)) n += 1;
  }
  return n;
}

/** Stored ids in this archive that are not on the official option list. */
export function leftoverAxisIds(
  axis: Pick<FilterAxis, "propertyId" | "options">,
  records: ArchiveScopedRecord[],
  archiveGenre = "",
): string[] {
  const official = new Set(axis.options.map((o) => o.id));
  const seen = new Set<string>();
  const leftover: string[] = [];
  const genre = archiveGenre.trim();
  for (const record of records) {
    if (genre && (record.장르 ?? "").trim() !== genre) continue;
    for (const id of rawAxisIds(record, axis.propertyId)) {
      if (!id || official.has(id) || seen.has(id)) continue;
      seen.add(id);
      leftover.push(id);
    }
  }
  return leftover;
}

/** Option ids with at least one occupant in this archive. */
export function occupiedAxisOptionIds(
  axis: Pick<FilterAxis, "propertyId" | "options">,
  records: ArchiveScopedRecord[],
  archiveGenre = "",
): Set<string> {
  const occupied = new Set<string>();
  for (const [id, count] of countAxisOptionOccupants(
    axis,
    records,
    archiveGenre,
  )) {
    if (count > 0) occupied.add(id);
  }
  return occupied;
}
