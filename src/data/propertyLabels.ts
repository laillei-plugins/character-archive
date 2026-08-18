import type { CardPropertyId } from "./cardProperties";
import type { PrimaryFilterProperty } from "./filterAxis";

const AXIS_IDS: PrimaryFilterProperty[] = [
  "status",
  "relation",
  "bond",
  "affiliation",
  "tags",
];

/** Plugin-wide display names for the five chip properties. */
export type PropertyDisplayNames = Record<PrimaryFilterProperty, string>;

export const DEFAULT_PROPERTY_DISPLAY_NAMES: PropertyDisplayNames = {
  status: "상태",
  relation: "관계",
  bond: "인연",
  affiliation: "소속",
  tags: "태그",
};

const CARD_TO_AXIS: Partial<Record<CardPropertyId, PrimaryFilterProperty>> = {
  status: "status",
  relation: "relation",
  bond: "bond",
  affiliation: "affiliation",
  tags: "tags",
};

export function normalizePropertyDisplayNames(
  raw: unknown,
): PropertyDisplayNames {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_PROPERTY_DISPLAY_NAMES };
  for (const id of AXIS_IDS) {
    const value = src[id];
    if (typeof value === "string" && value.trim()) {
      out[id] = value.trim();
    }
  }
  return out;
}

export function axisDisplayLabel(
  propertyId: PrimaryFilterProperty,
  names?: PropertyDisplayNames | null,
): string {
  const label = names?.[propertyId]?.trim();
  return label || DEFAULT_PROPERTY_DISPLAY_NAMES[propertyId];
}

export function cardDisplayLabel(
  id: CardPropertyId,
  names?: PropertyDisplayNames | null,
  fallback?: string,
): string {
  const axis = CARD_TO_AXIS[id];
  if (axis) return axisDisplayLabel(axis, names);
  return fallback || id;
}
