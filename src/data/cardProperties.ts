import { cardDisplayLabel, type PropertyDisplayNames } from "./propertyLabels";

/** Gallery card property ids — mirrors character frontmatter fields. */
export type CardPropertyId =
  | "name"
  | "status"
  | "group"
  | "relation"
  | "bond"
  | "codename"
  | "realName"
  | "affiliation"
  | "tags";

export interface CardPropertyPref {
  id: CardPropertyId;
  visible: boolean;
}

export interface CardPropertyDef {
  id: CardPropertyId;
  label: string;
}

/** Minimal fields needed to render card property values. */
export interface CardPropertySource {
  title: string;
  상태: string;
  태그: string[];
  그룹: string;
  관계: string;
  인연: string;
  코드네임: string;
  본명: string;
  소속: string;
}

/**
 * Card / peek properties (보기 menu).
 * Systemic / storage-only — never listed: `kind`, `order`, `cover`, `coverPosition`, `장르`, `작품`.
 * Eye toggles control the card preview only; the side panel shows every listed property.
 * Gallery section headers always use `그룹` regardless of visibility.
 */
export const CARD_PROPERTY_DEFS: CardPropertyDef[] = [
  { id: "name", label: "이름" },
  { id: "status", label: "상태" },
  { id: "group", label: "그룹" },
  { id: "relation", label: "관계" },
  { id: "bond", label: "인연" },
  { id: "codename", label: "코드네임" },
  { id: "realName", label: "본명" },
  { id: "affiliation", label: "소속" },
  { id: "tags", label: "태그" },
];

/** Notion default: Name + Status on, everything else off. */
export const DEFAULT_CARD_PROPERTIES: CardPropertyPref[] = CARD_PROPERTY_DEFS.map(
  (def) => ({
    id: def.id,
    visible: def.id === "name" || def.id === "status",
  }),
);

const ID_SET = new Set(CARD_PROPERTY_DEFS.map((d) => d.id));
/** Dropped from view props — ignored on migrate. */
const LEGACY_PROP_IDS = new Set(["work", "genre"]);

export function normalizeCardProperties(raw: unknown): CardPropertyPref[] {
  const list: CardPropertyPref[] = [];
  const seen = new Set<CardPropertyId>();

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const id = (item as { id?: unknown }).id;
      if (typeof id !== "string") continue;
      if (LEGACY_PROP_IDS.has(id)) continue;
      if (!ID_SET.has(id as CardPropertyId)) continue;
      const pid = id as CardPropertyId;
      if (seen.has(pid)) continue;
      seen.add(pid);
      list.push({
        id: pid,
        visible: Boolean((item as { visible?: unknown }).visible),
      });
    }
  }

  for (const def of DEFAULT_CARD_PROPERTIES) {
    if (seen.has(def.id)) continue;
    list.push({ ...def });
  }

  return list;
}

export function propertyLabel(
  id: CardPropertyId,
  names?: PropertyDisplayNames | null,
): string {
  const fallback = CARD_PROPERTY_DEFS.find((d) => d.id === id)?.label ?? id;
  return cardDisplayLabel(id, names, fallback);
}

export function propertyValue(
  record: CardPropertySource,
  id: CardPropertyId,
): string {
  switch (id) {
    case "name":
      return record.title;
    case "status":
      return record.상태 || "Off";
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
      // Display-only join; the gallery/share render a chip cluster instead.
      return (record.태그 ?? []).join(", ");
    default:
      return "";
  }
}

/** Frontmatter key for editable card properties (status uses setCharacterStatus). */
export function propertyFrontmatterKey(
  id: CardPropertyId,
): string | null {
  switch (id) {
    case "name":
      return "이름";
    case "group":
      return "그룹";
    case "relation":
      return "관계";
    case "bond":
      return "인연";
    case "codename":
      return "코드네임";
    case "realName":
      return "본명";
    case "affiliation":
      return "소속";
    case "status":
      return null;
    case "tags":
      // Array field — written by `setCharacterTags`, not a string patch.
      return null;
    default:
      return null;
  }
}

export function applyPropertyToRecord(
  record: CardPropertySource & { 이름?: string; title?: string },
  id: CardPropertyId,
  value: string,
): void {
  switch (id) {
    case "name":
      (record as { 이름: string }).이름 = value;
      (record as { title: string }).title = value || (record as { 코드네임?: string }).코드네임 || "";
      break;
    case "group":
      (record as { 그룹: string }).그룹 = value;
      break;
    case "relation":
      (record as { 관계: string }).관계 = value;
      break;
    case "bond":
      (record as { 인연: string }).인연 = value;
      break;
    case "codename":
      (record as { 코드네임: string }).코드네임 = value;
      break;
    case "realName":
      (record as { 본명: string }).본명 = value;
      break;
    case "affiliation":
      (record as { 소속: string }).소속 = value;
      break;
    default:
      break;
  }
}

export function visibleCardProperties(
  prefs: CardPropertyPref[],
): CardPropertyPref[] {
  return prefs.filter((p) => p.visible);
}
