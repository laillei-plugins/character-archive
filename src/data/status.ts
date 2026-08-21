/**
 * Named preset color tokens for status chips. Painted by class, so a theme can
 * restyle them. The first eight are the tokens older vaults already persisted —
 * their spelling is a storage contract and must never change.
 */
export type StatusColorPreset =
  | "green"
  | "gray"
  | "amber"
  | "blue"
  | "red"
  | "violet"
  | "cyan"
  | "pink"
  | "olive"
  | "indigo"
  | "lime"
  | "yellow";

/** A user-picked color, canonical uppercase six-digit hex (`#7C3AED`). */
export type StatusCustomColor = `#${string}`;

/**
 * What a chip color may be: a named preset, or one canonical hex the user
 * chose. Everything reaching persistence or a stylesheet goes through
 * `normalizeStatusColor` first, so no other shape ever exists at rest.
 */
export type StatusColorToken = StatusColorPreset | StatusCustomColor;

export interface StatusDef {
  /** Stored in frontmatter `상태`. Stable id. */
  id: string;
  label: string;
  color: StatusColorToken;
}

export const STATUS_COLOR_TOKENS: {
  id: StatusColorPreset;
  label: string;
}[] = [
  { id: "green", label: "초록" },
  { id: "gray", label: "회색" },
  { id: "amber", label: "호박" },
  { id: "blue", label: "파랑" },
  { id: "red", label: "빨강" },
  { id: "violet", label: "보라" },
  { id: "cyan", label: "청록" },
  { id: "pink", label: "분홍" },
  { id: "olive", label: "올리브" },
  { id: "indigo", label: "남색" },
  { id: "lime", label: "라임" },
  { id: "yellow", label: "노랑" },
];

export const DEFAULT_STATUSES: StatusDef[] = [
  { id: "On", label: "On", color: "green" },
  { id: "Off", label: "Off", color: "gray" },
];

const COLOR_SET = new Set<string>(STATUS_COLOR_TOKENS.map((t) => t.id));

/** Only canonical `#RRGGBB` is accepted — no shorthand, alpha, or CSS names. */
const CANONICAL_HEX = /^#[0-9a-fA-F]{6}$/;

export function isStatusColorPreset(raw: unknown): raw is StatusColorPreset {
  return typeof raw === "string" && COLOR_SET.has(raw);
}

/** True for a user-picked hex, false for every named preset. */
export function isCustomStatusColor(color: StatusColorToken): boolean {
  return color.startsWith("#");
}

/**
 * The one gate every stored / rendered color passes through. A known preset
 * survives verbatim (old vaults keep their chips), a valid hex is canonicalized
 * to uppercase, and anything else — including CSS text someone tried to smuggle
 * in — collapses to `gray`.
 */
export function normalizeStatusColor(raw: unknown): StatusColorToken {
  if (typeof raw !== "string") return "gray";
  const value = raw.trim();
  if (COLOR_SET.has(value)) return value as StatusColorPreset;
  if (CANONICAL_HEX.test(value)) return value.toUpperCase() as StatusCustomColor;
  return "gray";
}

/** Shape-only parse. Keeps an empty list empty — no default injection. */
function parseOptionList(raw: unknown): StatusDef[] {
  const list: StatusDef[] = [];
  const seen = new Set<string>();

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const id =
        typeof (item as { id?: unknown }).id === "string"
          ? (item as { id: string }).id.trim()
          : "";
      if (!id || seen.has(id)) continue;
      const labelRaw = (item as { label?: unknown }).label;
      const label =
        typeof labelRaw === "string" && labelRaw.trim()
          ? labelRaw.trim()
          : id;
      list.push({
        id,
        label,
        color: normalizeStatusColor((item as { color?: unknown }).color),
      });
      seen.add(id);
    }
  }

  return list;
}

/**
 * Vocabulary for a non-status select axis (관계 / 인연 / 소속).
 * Unlike `normalizeStatuses`, an empty list stays empty — those axes start unset.
 */
export function normalizeSelectVocab(raw: unknown): StatusDef[] {
  return parseOptionList(raw);
}

export function normalizeStatuses(raw: unknown): StatusDef[] {
  const list = parseOptionList(raw);
  const seen = new Set(list.map((s) => s.id));

  if (list.length === 0) {
    return DEFAULT_STATUSES.map((s) => ({ ...s }));
  }

  // Ensure legacy On/Off exist if vault still uses them and user wiped defaults.
  for (const fallback of DEFAULT_STATUSES) {
    if (!seen.has(fallback.id)) {
      // Don't force-add if user intentionally removed — only when empty was handled above.
    }
  }

  return list;
}

/** Resolve a frontmatter value to a known status (unknown → gray ghost). */
export function resolveStatus(
  statuses: StatusDef[],
  value: string | undefined | null,
): StatusDef {
  const raw = (value ?? "").trim() || "Off";
  const hit = statuses.find((s) => s.id === raw);
  if (hit) return hit;
  return { id: raw, label: raw, color: "gray" };
}

/** CSS custom property the chip rules read for a user-picked color. */
export const STATUS_CUSTOM_COLOR_VAR = "--charinfo-chip-ink";
/** Marker class for a chip painted from `STATUS_CUSTOM_COLOR_VAR`. */
export const STATUS_CUSTOM_COLOR_CLASS = "is-custom";

/** Every class `paintStatusColor` may own, including the legacy On/Off aliases. */
export const STATUS_COLOR_CLASSES: string[] = [
  ...STATUS_COLOR_TOKENS.map((token) => `is-${token.id}`),
  STATUS_CUSTOM_COLOR_CLASS,
  "is-on",
  "is-off",
];

export function statusColorClass(color: StatusColorToken): string {
  return isCustomStatusColor(color) ? STATUS_CUSTOM_COLOR_CLASS : `is-${color}`;
}

/**
 * Shared chip painter — the only place a color token becomes styling.
 *
 * A preset stays class-based so themes keep control. A custom color travels as
 * one validated CSS variable set through the CSSOM: no class name is built from
 * user text, and no stylesheet ever receives a raw value.
 */
export function paintStatusColor(el: HTMLElement, raw: unknown): void {
  const color = normalizeStatusColor(raw);
  for (const cls of STATUS_COLOR_CLASSES) el.classList.remove(cls);
  el.classList.add(statusColorClass(color));
  if (isCustomStatusColor(color)) {
    el.style.setProperty(STATUS_CUSTOM_COLOR_VAR, color);
  } else {
    el.style.removeProperty(STATUS_CUSTOM_COLOR_VAR);
  }
}

/** Suggest a unique id from a label. */
export function suggestStatusId(label: string, existing: StatusDef[]): string {
  const base =
    label
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^\w\uac00-\ud7a3-]+/g, "")
      .slice(0, 32) || "status";
  const ids = new Set(existing.map((s) => s.id));
  if (!ids.has(base)) return base;
  let n = 2;
  while (ids.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Guess a preset color when adopting a status typed directly in a note. */
export function guessStatusColor(idOrLabel: string): StatusColorPreset {
  const k = idOrLabel.trim().toLowerCase();
  if (!k) return "gray";
  if (k === "on" || k === "active" || k.includes("활성")) return "green";
  if (k === "off" || k.includes("archive") || k.includes("보관")) return "gray";
  if (
    k.includes("pend") ||
    k.includes("draft") ||
    k.includes("대기") ||
    k.includes("작성")
  ) {
    return "amber";
  }
  if (
    k.includes("upcom") ||
    k.includes("soon") ||
    k.includes("예정") ||
    k.includes("upcoming")
  ) {
    return "blue";
  }
  return "gray";
}

/**
 * Append unknown `상태` values found on character notes into the status list.
 * Returns null when nothing new — caller should persist only when non-null.
 */
export function adoptUnknownStatuses(
  statuses: StatusDef[],
  values: Iterable<string>,
): StatusDef[] | null {
  const next = statuses.map((s) => ({ ...s }));
  const known = new Set<string>();
  for (const s of next) {
    known.add(s.id);
    known.add(s.label);
  }
  let changed = false;
  for (const raw of values) {
    const value = raw.trim();
    if (!value || known.has(value)) continue;
    known.add(value);
    next.push({
      id: value,
      label: value,
      color: guessStatusColor(value),
    });
    changed = true;
  }
  return changed ? next : null;
}

/** Resolve a remembered chip filter against the active axis vocabulary. */
export function normalizeChipFilter(
  raw: unknown,
  options: StatusDef[],
): string {
  if (raw === "all" || raw == null || raw === "") return "all";
  if (typeof raw !== "string") return "all";
  const id = raw.trim();
  if (id === "all") return "all";
  if (options.some((s) => s.id === id)) return id;
  // Legacy filter values that still match an option label
  if (options.some((s) => s.label === id)) {
    return options.find((s) => s.label === id)!.id;
  }
  return "all";
}
