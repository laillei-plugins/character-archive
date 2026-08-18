import type { StatusDef } from "./status";

/**
 * Tag vocabulary entry. No color in v1 — every tag uses one neutral chip style
 * (`.charinfo-tag`), so `StatusDef.color` is a placeholder when tags become the
 * primary filter axis.
 */
export interface TagDef {
  id: string;
  label: string;
}

/** Frontmatter key holding a character's tag ids. */
export const TAG_FRONTMATTER_KEY = "태그";

/** Settings-owned vocabulary. Shape-only parse; an empty list stays empty. */
export function normalizeTagVocab(raw: unknown): TagDef[] {
  const list: TagDef[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(raw)) return list;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const idRaw = (item as { id?: unknown }).id;
    const id = typeof idRaw === "string" ? idRaw.trim() : "";
    if (!id || seen.has(id)) continue;
    const labelRaw = (item as { label?: unknown }).label;
    const label =
      typeof labelRaw === "string" && labelRaw.trim() ? labelRaw.trim() : id;
    list.push({ id, label });
    seen.add(id);
  }
  return list;
}

/**
 * Frontmatter `태그` → stable id list.
 * A YAML list is the only format we write; a lone scalar reads as one tag
 * (never comma-split — that would make commas in a label ambiguous).
 */
export function parseTagIds(raw: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown): void => {
    if (typeof value !== "string" && typeof value !== "number") return;
    const id = String(value).trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  if (Array.isArray(raw)) {
    for (const item of raw) push(item);
  } else {
    push(raw);
  }
  return out;
}

/** Vocabulary as axis options — neutral token; `.charinfo-tag` overrides visuals. */
export function tagAxisOptions(vocab: TagDef[]): StatusDef[] {
  return vocab.map((t) => ({ id: t.id, label: t.label, color: "gray" as const }));
}
