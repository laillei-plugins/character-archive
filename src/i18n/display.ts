// @ts-expect-error TS5097: explicit extension also supports the native Node TS tests.
import { ko, t, type TranslationKey } from "./index.ts";

const BUILTIN_KEYS = {
  name: "name", status: "status", group: "group", relation: "relationship",
  bond: "bond", codename: "codename", realName: "realName",
  affiliation: "affiliation", tags: "tags",
} as const satisfies Record<string, TranslationKey>;

type BuiltinId = keyof typeof BUILTIN_KEYS;

/** UI-only adapter. Raw definitions and the labels seeded into schemas stay unchanged. */
export function displayPropertyLabel(id: string, label?: string | null): string {
  if (!Object.prototype.hasOwnProperty.call(BUILTIN_KEYS, id)) return label?.trim() || id;
  const key = BUILTIN_KEYS[id as BuiltinId];
  const custom = label?.trim();
  return custom && custom !== ko[key] ? custom : t(key);
}

/** Use in UI in place of groupSchema.fieldLabel; public share keeps that raw helper. */
export function displayFieldLabel(
  field: { id: string; key: string; label: string },
  names?: Partial<Record<string, string>> | null,
): string {
  const axes = ["status", "relation", "bond", "affiliation", "tags"];
  if (axes.includes(field.id)) return displayPropertyLabel(field.id, names?.[field.id]);
  return displayPropertyLabel(field.id, field.label || field.key);
}

const COLOR_KEYS = {
  green: "green", gray: "gray", amber: "amber", blue: "blue", red: "red",
  violet: "violet", cyan: "cyan", pink: "pink", olive: "olive", indigo: "indigo",
  lime: "lime", yellow: "yellow",
} as const satisfies Record<string, TranslationKey>;

export function displayColorLabel(id: string, fallback: string): string {
  if (!Object.prototype.hasOwnProperty.call(COLOR_KEYS, id)) return fallback;
  return t(COLOR_KEYS[id as keyof typeof COLOR_KEYS]);
}

/** Built-in On/Off labels are already bilingual; preserve user-renamed options. */
export function displayStatusLabel(option: { id: string; label: string }): string {
  if (option.id === "On" && option.label === "On") return t("statusOn");
  if (option.id === "Off" && option.label === "Off") return t("statusOff");
  return option.label;
}
