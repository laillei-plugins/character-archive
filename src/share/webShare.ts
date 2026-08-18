import { App, requestUrl } from "obsidian";
import type { CharacterRecord } from "../data/CharacterStore";
import { resolveCover, isRemoteCoverUrl } from "../data/images";
import {
  propertyLabel,
  propertyValue,
  visibleCardProperties,
  CARD_PROPERTY_DEFS,
  type CardPropertyPref,
} from "../data/cardProperties";
import { parseDetailDoc, type DetailProp } from "../ui/cleanBody";
import {
  DEFAULT_STATUSES,
  recordAxisValue,
  resolveAxisOption,
  resolveStatus,
  type PrimaryFilterProperty,
  type StatusDef,
  type TagDef,
} from "../settings";

const MAX_COVER_INPUT_BYTES = 12_000_000; // read up to 12MB, then compress
const MAX_COVER_DATA_URL_CHARS = 280_000; // ~210KB binary after base64
const SHARE_COVER_MAX_EDGE = 720;

export interface ShareBodySection {
  title: string;
  props: DetailProp[];
  notes: string[];
  abilities: { title: string; props: DetailProp[]; notes: string[] }[];
}

export interface ShareCard {
  id: string;
  title: string;
  status: string;
  /** Resolved primary-filter option id (equals `status` when axis = status). */
  filterValue: string;
  /** Tag ids from `태그` — display only; the public page has no tag filter. */
  tagIds: string[];
  group: string;
  coverDataUrl: string | null;
  coverPosition: string;
  /** Eye-visible properties for the card strip. */
  props: DetailProp[];
  /** Frontmatter properties for the side panel (when 「속성」 selected). */
  detailProps: DetailProp[];
  /** Whether the 「속성」 block should render (even if empty aside from status). */
  showAttrs: boolean;
  /** Body H2 sections selected for the side panel. */
  sections: ShareBodySection[];
  prompts: DetailProp[];
}

export interface SharePayload {
  title: string;
  genre: string;
  /**
   * Chip filter active in the plugin when published.
   * Informational — the public page renders every card in the payload.
   */
  chipFilter: string;
  /** Which property the card pill reflects (`status` · `relation` · …). */
  filterProperty: string;
  /** Vocabulary for the primary-filter pill (id / label / color token). */
  filterOptions: StatusDef[];
  /** Tag vocabulary (id → label) for rendering tag chips. */
  tagVocab: TagDef[];
  /** Render the tag cluster on cards (tag eye on, or tags is the axis). */
  showTags: boolean;
  /** Named group display order (empty/`미분류` last). */
  groupOrder: string[];
  /** Selected side-panel headers (「속성」 + note H2 titles). */
  panelHeaders: string[];
  /** Status vocabulary — always published for the 속성 panel row. */
  statuses: StatusDef[];
  exportedAt: string;
  cards: ShareCard[];
}

function mimeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "image/jpeg";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Shrink cover for self-contained share HTML (JPEG data URL). */
async function bytesToShareDataUrl(
  bytes: Uint8Array,
  mimeHint: string,
): Promise<string | null> {
  if (!bytes.byteLength) return null;
  const mime = mimeHint.startsWith("image/") ? mimeHint : "image/jpeg";

  // Tiny SVG/GIF: keep raw when already small.
  if (
    bytes.byteLength <= 80_000 &&
    (mime === "image/svg+xml" || mime === "image/gif")
  ) {
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
  }

  try {
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([ab], {
      type: mime === "image/svg+xml" ? "image/svg+xml" : mime,
    });
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(
      1,
      SHARE_COVER_MAX_EDGE / Math.max(bitmap.width, bitmap.height, 1),
    );
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      throw new Error("no canvas");
    }
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    let quality = 0.82;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > MAX_COVER_DATA_URL_CHARS && quality > 0.4) {
      quality -= 0.12;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    if (dataUrl.length > MAX_COVER_DATA_URL_CHARS * 1.35) return null;
    return dataUrl;
  } catch {
    // Fallback: embed raw only if small enough for the share host budget.
    if (bytes.byteLength <= 180_000) {
      return `data:${mime};base64,${bytesToBase64(bytes)}`;
    }
    return null;
  }
}

async function coverDataUrl(
  app: App,
  record: CharacterRecord,
  markdown: string,
): Promise<string | null> {
  const cover = resolveCover(app, record, markdown);
  if (!cover) return null;
  if (cover.kind === "remote") {
    if (!isRemoteCoverUrl(cover.url)) return null;
    try {
      const res = await requestUrl({ url: cover.url, method: "GET" });
      if (res.status >= 400) return null;
      const bytes = new Uint8Array(res.arrayBuffer);
      if (bytes.byteLength > MAX_COVER_INPUT_BYTES) return null;
      const mime =
        res.headers["content-type"]?.split(";")[0]?.trim() || "image/jpeg";
      return bytesToShareDataUrl(
        bytes,
        mime.startsWith("image/") ? mime : "image/jpeg",
      );
    } catch {
      return null;
    }
  }
  const file = cover.file;
  if (file.stat.size > MAX_COVER_INPUT_BYTES) return null;
  try {
    const buf = await app.vault.readBinary(file);
    return bytesToShareDataUrl(new Uint8Array(buf), mimeForPath(file.path));
  } catch {
    return null;
  }
}

const HEADER_ORDER = [
  "속성",
  "설명",
  "신상",
  "배경",
  "외형",
  "성격",
  "특징",
  "능력",
  "리스크",
  "운용",
  "비고",
  "특이사항",
  "추가 정보",
  "프롬프트",
  "메모",
];

/** Side-panel header hierarchy for share advanced options. */
export const PANEL_HEADER_GROUPS: {
  id: string;
  label: string;
  headers: string[];
}[] = [
  { id: "attrs", label: "속성", headers: ["속성"] },
  {
    id: "profile",
    label: "프로필",
    headers: ["설명", "신상", "배경", "외형", "성격", "특징"],
  },
  { id: "power", label: "능력", headers: ["능력", "리스크"] },
  {
    id: "ops",
    label: "운용",
    headers: ["운용", "비고", "특이사항", "추가 정보"],
  },
  { id: "prompt", label: "프롬프트", headers: ["프롬프트"] },
  { id: "notes", label: "메모", headers: ["메모"] },
];

export interface PanelHeaderGroup {
  id: string;
  label: string;
  headers: string[];
}

/** Bucket available headers into dossier hierarchy groups. */
export function groupPanelHeaders(available: string[]): PanelHeaderGroup[] {
  const avail = new Set(available);
  const used = new Set<string>();
  const groups: PanelHeaderGroup[] = [];
  for (const def of PANEL_HEADER_GROUPS) {
    const headers = def.headers.filter((h) => avail.has(h));
    if (!headers.length) continue;
    for (const h of headers) used.add(h);
    groups.push({ id: def.id, label: def.label, headers });
  }
  const other = available.filter((h) => !used.has(h));
  if (other.length) {
    groups.push({ id: "other", label: "기타", headers: other });
  }
  return groups;
}

/** Discover side-panel header chips from selected character notes. */
export async function collectPanelHeaders(
  app: App,
  records: CharacterRecord[],
): Promise<string[]> {
  const found = new Set<string>(["속성"]);
  for (const record of records) {
    const markdown = await app.vault.cachedRead(record.file);
    const doc = parseDetailDoc(markdown);
    for (const block of doc.blocks) {
      if (block.type === "prompts") {
        found.add("프롬프트");
        continue;
      }
      const title = block.section.title.trim();
      if (!title) continue;
      found.add(title);
      if (title === "프롬프트") found.add("프롬프트");
    }
  }
  const ordered: string[] = [];
  for (const h of HEADER_ORDER) {
    if (found.has(h)) ordered.push(h);
  }
  for (const h of found) {
    if (!ordered.includes(h)) ordered.push(h);
  }
  return ordered;
}

export async function buildSharePayload(
  app: App,
  records: CharacterRecord[],
  opts: {
    title: string;
    genre: string;
    chipFilter: string;
    cardProperties: CardPropertyPref[];
    groupOrder?: string[];
    /** Side panel headers to include (「속성」, note H2s, 프롬프트…). */
    panelHeaders?: string[];
    /** When 「속성」 included: eyes vs all frontmatter. */
    panelProps?: "preview" | "all";
    statuses?: StatusDef[];
    /** Primary filter axis; card pills follow it. Defaults to status. */
    filterProperty?: PrimaryFilterProperty;
    filterOptions?: StatusDef[];
    /** Tag vocabulary for `태그` chips. */
    tagVocab?: TagDef[];
    propertyDisplayNames?: import("../data/propertyLabels").PropertyDisplayNames;
  },
): Promise<SharePayload> {
  const statuses =
    opts.statuses?.length
      ? opts.statuses
      : DEFAULT_STATUSES.map((s) => ({ ...s }));
  const filterProperty = opts.filterProperty ?? "status";
  const filterOptions =
    filterProperty === "status" ? statuses : (opts.filterOptions ?? []);
  const filterAxis = { propertyId: filterProperty, options: filterOptions };
  const panelHeaders = new Set(
    (opts.panelHeaders?.length
      ? opts.panelHeaders
      : ["속성", "프롬프트"]
    ).map((h) => h.trim()).filter(Boolean),
  );
  const panelProps = opts.panelProps === "preview" ? "preview" : "all";
  const includeAttrs = panelHeaders.has("속성");
  const includePrompts = panelHeaders.has("프롬프트");
  const visible = visibleCardProperties(opts.cardProperties);
  const tagVocab = opts.tagVocab ?? [];
  // Tags drive the chip row → always shown, matching the gallery.
  const showTags =
    filterProperty === "tags" || visible.some((p) => p.id === "tags");
  const cards: ShareCard[] = [];

  for (const record of records) {
    const markdown = await app.vault.cachedRead(record.file);
    const doc = parseDetailDoc(markdown);
    const prompts: DetailProp[] = [];
    const sections: ShareBodySection[] = [];

    for (const block of doc.blocks) {
      if (block.type === "prompts") {
        if (includePrompts) prompts.push(...block.prompts);
        continue;
      }
      const title = block.section.title.trim();
      if (!title || !panelHeaders.has(title)) continue;
      // 프롬프트 body section folds into prompts chip when present as notes.
      if (title === "프롬프트") {
        if (includePrompts) {
          for (const n of block.section.notes) {
            if (n.trim()) prompts.push({ label: "프롬프트", value: n });
          }
          for (const p of block.section.props) {
            if (p.value.trim()) prompts.push(p);
          }
        }
        continue;
      }
      sections.push({
        title,
        props: block.section.props.filter((p) => p.value.trim()),
        notes: block.section.notes.filter(Boolean).slice(0, 12),
        abilities: block.section.abilities.map((a) => ({
          title: a.title,
          props: a.props.filter((p) => p.value.trim()),
          notes: a.notes.filter(Boolean).slice(0, 8),
        })),
      });
    }

    // Card strip: always Obsidian eye toggles.
    const props: DetailProp[] = [];
    for (const pref of visible) {
      if (pref.id === "name" || pref.id === "status") continue;
      // Tags render as a chip cluster, not a text row.
      if (pref.id === "tags") continue;
      const value = propertyValue(record, pref.id).trim();
      if (!value) continue;
      props.push({
        label: propertyLabel(pref.id, opts.propertyDisplayNames),
        value,
      });
    }

    const detailProps: DetailProp[] = [];
    if (includeAttrs) {
      const panelSource =
        panelProps === "all" ? CARD_PROPERTY_DEFS : visible;
      for (const pref of panelSource) {
        const id = pref.id;
        if (id === "name" || id === "status" || id === "tags") continue;
        const value = propertyValue(record, id).trim();
        if (!value) continue;
        detailProps.push({
          label: propertyLabel(id, opts.propertyDisplayNames),
          value,
        });
      }
    }

    cards.push({
      id: `c${cards.length + 1}`,
      title: record.title,
      status: resolveStatus(statuses, record.상태).id,
      filterValue:
        filterProperty === "tags"
          ? // Multi-value axis has no single pill — the cluster carries it.
            ""
          : resolveAxisOption(
              filterAxis,
              recordAxisValue(record, filterProperty),
            ).id,
      tagIds: [...record.태그],
      group: record.그룹 || "미분류",
      coverDataUrl: await coverDataUrl(app, record, markdown),
      coverPosition: record.coverPosition || "50% 50%",
      props,
      detailProps,
      showAttrs: includeAttrs,
      sections,
      prompts,
    });
  }

  const usedStatusIds = new Set(cards.map((c) => c.status));
  const usedFilterIds = new Set(
    cards.map((c) => c.filterValue).filter(Boolean),
  );
  const usedTagIds = new Set(cards.flatMap((c) => c.tagIds));

  return {
    title: opts.title,
    genre: opts.genre,
    chipFilter: opts.chipFilter,
    filterProperty,
    filterOptions: filterOptions
      .filter((s) => usedFilterIds.has(s.id) || usedStatusIds.has(s.id))
      .map((s) => ({
        id: s.id,
        label: s.label,
        color: s.color,
      })),
    tagVocab: tagVocab
      .filter((t) => usedTagIds.has(t.id))
      .map((t) => ({ id: t.id, label: t.label })),
    showTags,
    groupOrder: opts.groupOrder ?? [],
    panelHeaders: [...panelHeaders],
    statuses: statuses
      .filter((s) => usedStatusIds.has(s.id))
      .map((s) => ({
        id: s.id,
        label: s.label,
        color: s.color,
      })),
    exportedAt: new Date().toISOString(),
    cards,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Bump when share page layout/tokens change — invalidates cached lastUrl. */
export const SHARE_HTML_VERSION = 8;

/** Self-contained read-only gallery HTML.
 * Visual language: Apple HIG (clarity / deference / depth) + Obsidian DESIGN.md tokens
 * (https://www.shadcn.io/design/obsidian — system-ui, violet accent, zinc surface ladder).
 */
export function renderShareHtml(payload: SharePayload): string {
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  const title = escapeHtml(payload.title || payload.genre || "Character Archive");

  return `<!DOCTYPE html>
<html lang="ko" data-charinfo-share="${SHARE_HTML_VERSION}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<meta name="color-scheme" content="light dark"/>
<meta name="generator" content="charinfo-share/${SHARE_HTML_VERSION}"/>
<title>${title}</title>
<style>
/* Tokens: Obsidian DESIGN.md surface ladder + app light theme */
:root {
  color-scheme: light dark;
  --canvas: #ffffff;
  --surface-1: #f7f7f7;
  --surface-2: #ffffff;
  --hairline: #e3e3e3;
  --hairline-strong: #d0d0d0;
  --ink: #1a1a1a;
  --ink-muted: #6b6b6b;
  --ink-subtle: #8a8a8a;
  --accent: #705dcf;
  --accent-soft: color-mix(in srgb, #705dcf 14%, transparent);
  --on: #2f6b4f;
  --on-bg: color-mix(in srgb, #2f6b4f 14%, #f7f7f7);
  --off: #6b6b6b;
  --off-bg: color-mix(in srgb, #6b6b6b 8%, #f7f7f7);
  --status-green: var(--on);
  --status-green-bg: var(--on-bg);
  --status-gray: var(--off);
  --status-gray-bg: var(--off-bg);
  --status-amber: #b45309;
  --status-amber-bg: color-mix(in srgb, #b45309 14%, #f7f7f7);
  --status-blue: #2563eb;
  --status-blue-bg: color-mix(in srgb, #2563eb 14%, #f7f7f7);
  --status-red: #b91c1c;
  --status-red-bg: color-mix(in srgb, #b91c1c 14%, #f7f7f7);
  --status-violet: #7c3aed;
  --status-violet-bg: color-mix(in srgb, #7c3aed 14%, #f7f7f7);
  --status-cyan: #0e7490;
  --status-cyan-bg: color-mix(in srgb, #0e7490 14%, #f7f7f7);
  --status-pink: #be185d;
  --status-pink-bg: color-mix(in srgb, #be185d 14%, #f7f7f7);
  --hover: rgba(0,0,0,0.04);
  --shadow-inspector: 0 0 0 1px color-mix(in srgb, #000 4%, transparent),
    0 8px 28px rgba(0,0,0,0.06);
  --radius-card: 8px;
  --radius-control: 6px;
  --peek: 22rem;
  --pad: 1.25rem;
  --font: ui-sans-serif, system-ui, -apple-system, "Apple SD Gothic Neo",
    "Segoe UI", Roboto, "Noto Sans KR", Helvetica, Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --canvas: #171717;
    --surface-1: #1e1e1e;
    --surface-2: #262626;
    --hairline: #2a2a2a;
    --hairline-strong: #404040;
    --ink: #e5e5e5;
    --ink-muted: #a3a3a3;
    --ink-subtle: #737373;
    --accent: #a78bfa;
    --accent-soft: color-mix(in srgb, #a78bfa 18%, transparent);
    --on: #5dba8a;
    --on-bg: color-mix(in srgb, #3d7a5a 22%, #1e1e1e);
    --off: #a3a3a3;
    --off-bg: color-mix(in srgb, #a3a3a3 10%, #1e1e1e);
    --status-green: var(--on);
    --status-green-bg: var(--on-bg);
    --status-gray: var(--off);
    --status-gray-bg: var(--off-bg);
    --status-amber: #f59e0b;
    --status-amber-bg: color-mix(in srgb, #b45309 22%, #1e1e1e);
    --status-blue: #60a5fa;
    --status-blue-bg: color-mix(in srgb, #2563eb 22%, #1e1e1e);
    --status-red: #f87171;
    --status-red-bg: color-mix(in srgb, #b91c1c 22%, #1e1e1e);
    --status-violet: #a78bfa;
    --status-violet-bg: color-mix(in srgb, #7c3aed 22%, #1e1e1e);
    --status-cyan: #22d3ee;
    --status-cyan-bg: color-mix(in srgb, #0e7490 22%, #1e1e1e);
    --status-pink: #f472b6;
    --status-pink-bg: color-mix(in srgb, #be185d 22%, #1e1e1e);
    --hover: rgba(255,255,255,0.06);
    --shadow-inspector: inset 1px 0 0 var(--hairline);
  }
}
*, *::before, *::after { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  font-family: var(--font);
  background: var(--canvas);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
button {
  font: inherit;
  color: inherit;
}
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
/* Clarity: one quiet title bar — chrome defers to content */
.topbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  min-height: 3.25rem;
  padding: 0.75rem var(--pad);
  border-bottom: 1px solid var(--hairline);
  background: color-mix(in srgb, var(--canvas) 92%, transparent);
  backdrop-filter: saturate(1.2) blur(12px);
  -webkit-backdrop-filter: saturate(1.2) blur(12px);
  position: sticky;
  top: 0;
  z-index: 4;
}
.topbar__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.2;
  text-wrap: balance;
}
.stage {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}
.app.is-open .stage {
  grid-template-columns: minmax(0, 1fr) var(--peek);
}
.gallery {
  overflow: auto;
  min-height: 0;
  padding: 1rem var(--pad) 2.5rem;
  scroll-behavior: smooth;
}
/* Depth: inspector as a distinct layer beside content */
.inspector {
  display: none;
  overflow: auto;
  min-height: 0;
  background: var(--surface-1);
  box-shadow: var(--shadow-inspector);
  padding: 0 0 2rem;
  user-select: text;
  -webkit-user-select: text;
}
.app.is-open .inspector { display: block; }
.section { margin-bottom: 2rem; }
.section__head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin: 0 0 0.85rem;
}
.section__title {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.section__count {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--ink-subtle);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
  gap: 1rem;
  align-items: start;
}
.card {
  display: flex;
  flex-direction: column;
  width: 100%;
  margin: 0;
  padding: 0;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-card);
  overflow: hidden;
  background: var(--surface-2);
  cursor: pointer;
  text-align: left;
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}
.card:hover {
  border-color: var(--hairline-strong);
  box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 8px 20px rgba(0,0,0,0.05);
}
.card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.card.is-selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent), 0 8px 22px color-mix(in srgb, var(--accent) 18%, transparent);
}
.card:active { transform: scale(0.985); }
.card__cover {
  aspect-ratio: 2 / 3;
  background: var(--surface-1);
  overflow: hidden;
}
.card__cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  outline: 1px solid oklch(0 0 0 / 0.08);
  outline-offset: -1px;
}
.card__meta {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.65rem 0.7rem 0.75rem;
}
.card__name {
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card__props {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.card__prop {
  font-size: 0.75rem;
  line-height: 1.35;
  color: var(--ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem;
}
.tag {
  display: inline-flex;
  align-items: center;
  height: 1.25rem;
  padding: 0 0.4rem;
  border-radius: 4px;
  background: var(--surface-2, rgba(0,0,0,0.05));
  color: var(--ink-muted);
  font-size: 0.6875rem;
  line-height: 1;
  white-space: nowrap;
}
.tag.is-ghost { opacity: 0.6; }
.status {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  height: 1.35rem;
  padding: 0 0.45rem 0 0.35rem;
  border-radius: 4px;
  font-size: 0.6875rem;
  font-weight: 500;
  width: fit-content;
}
.status__dot {
  width: 0.35rem;
  height: 0.35rem;
  border-radius: 50%;
  flex-shrink: 0;
}
.status.is-green, .status.is-on { background: var(--status-green-bg); color: var(--status-green); font-weight: 600; }
.status.is-green .status__dot, .status.is-on .status__dot { background: var(--status-green); }
.status.is-gray, .status.is-off { background: var(--status-gray-bg); color: var(--status-gray); }
.status.is-gray .status__dot, .status.is-off .status__dot { background: var(--status-gray); opacity: 0.7; }
.status.is-amber { background: var(--status-amber-bg); color: var(--status-amber); font-weight: 600; }
.status.is-amber .status__dot { background: var(--status-amber); }
.status.is-blue { background: var(--status-blue-bg); color: var(--status-blue); font-weight: 600; }
.status.is-blue .status__dot { background: var(--status-blue); }
.status.is-red { background: var(--status-red-bg); color: var(--status-red); font-weight: 600; }
.status.is-red .status__dot { background: var(--status-red); }
.status.is-violet { background: var(--status-violet-bg); color: var(--status-violet); font-weight: 600; }
.status.is-violet .status__dot { background: var(--status-violet); }
.status.is-cyan { background: var(--status-cyan-bg); color: var(--status-cyan); font-weight: 600; }
.status.is-cyan .status__dot { background: var(--status-cyan); }
.status.is-pink { background: var(--status-pink-bg); color: var(--status-pink); font-weight: 600; }
.status.is-pink .status__dot { background: var(--status-pink); }
.inspector__bar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 3.25rem;
  padding: 0.85rem 1.1rem 0.75rem;
  background: var(--surface-1);
  border-bottom: 1px solid var(--hairline);
}
.inspector__back {
  display: none;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
  flex-shrink: 0;
}
.inspector__back:hover { background: var(--hover); color: var(--ink); }
.inspector__back:active { transform: scale(0.96); }
.inspector__back svg { width: 18px; height: 18px; }
.inspector__title {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.25;
  text-wrap: balance;
  min-width: 0;
  flex: 1;
}
.inspector__body { padding: 1rem 1.1rem 0; }
.props {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-card);
  background: var(--surface-2);
  padding: 0.45rem 0.75rem 0.55rem;
  margin: 0 0 1.25rem;
}
.props__label {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-subtle);
  margin: 0 0 0.2rem;
}
.prop {
  display: grid;
  grid-template-columns: 4rem minmax(0, 1fr);
  gap: 0.55rem;
  align-items: center;
  padding: 0.4rem 0;
  border-bottom: 1px solid color-mix(in srgb, var(--hairline) 80%, transparent);
  font-size: 0.8125rem;
}
.prop:last-child { border-bottom: none; }
.prop__k { color: var(--ink-muted); font-size: 0.75rem; }
.prop__v { min-width: 0; overflow-wrap: anywhere; line-height: 1.4; }
.prompts { display: flex; flex-direction: column; gap: 1rem; }
.prompts__label {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-subtle);
  margin: 0;
}
.notes {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin-top: 1.25rem;
}
.notes__label {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-subtle);
  margin: 0;
}
.notes__item {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--ink);
}
.section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0 0 1.25rem;
}
.section__label {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-subtle);
  margin: 0;
}
.props--nested {
  margin: 0;
}
.ability {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-card);
  background: var(--surface-2);
}
.ability__name {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--ink);
}
.prompt { display: flex; flex-direction: column; gap: 0.35rem; }
.prompt__name {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--ink-muted);
}
.prompt__box { position: relative; }
.prompt__box pre {
  margin: 0;
  padding: 0.7rem 2.4rem 0.7rem 0.75rem;
  border-radius: var(--radius-card);
  border: 1px solid var(--hairline);
  background: var(--surface-2);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--mono);
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--ink);
  user-select: text;
  -webkit-user-select: text;
}
.copy {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
  width: 1.85rem;
  height: 1.85rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--surface-1) 88%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: var(--ink-muted);
  cursor: pointer;
}
.copy:hover { color: var(--ink); background: var(--canvas); }
.copy.is-ok { color: var(--accent); }
.copy:active { transform: scale(0.96); }
.copy svg { width: 15px; height: 15px; }
@media (max-width: 760px) {
  :root { --pad: 1rem; }
  .app.is-open .stage { grid-template-columns: 1fr; }
  .app.is-open .gallery { display: none; }
  .app.is-open .inspector {
    display: block;
    box-shadow: none;
    background: var(--canvas);
  }
  .inspector__back { display: inline-flex; }
  .grid {
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    gap: 0.75rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .card, .copy, .inspector__back { transition: none; }
  .card:active, .copy:active, .inspector__back:active { transform: none; }
}
</style>
</head>
<body>
<div class="app" id="root">
  <header class="topbar"><h1 class="topbar__title">${title}</h1></header>
  <div class="stage">
    <main class="gallery" id="main"></main>
    <aside class="inspector" id="detail" aria-live="polite"></aside>
  </div>
</div>
<script>
const DATA = ${json};
const root = document.getElementById("root");
const main = document.getElementById("main");
const detail = document.getElementById("detail");
const ICON_COPY = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const ICON_CHECK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const ICON_BACK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function groupCards(cards) {
  const map = new Map();
  for (const card of cards) {
    const key = card.group || "미분류";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(card);
  }
  const order = Array.isArray(DATA.groupOrder) ? DATA.groupOrder : [];
  const rank = new Map();
  order.forEach(function (name, i) {
    if (name) rank.set(name, i);
  });
  return new Map(
    [...map.entries()].sort(function (a, b) {
      var ka = a[0], kb = b[0];
      var unlabeledA = !ka || ka === "미분류";
      var unlabeledB = !kb || kb === "미분류";
      if (unlabeledA && !unlabeledB) return 1;
      if (!unlabeledA && unlabeledB) return -1;
      var ra = rank.has(ka) ? rank.get(ka) : Number.MAX_SAFE_INTEGER;
      var rb = rank.has(kb) ? rank.get(kb) : Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return String(ka).localeCompare(String(kb), "ko");
    })
  );
}

function resolveShareStatus(status) {
  var list = DATA.statuses || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === status || list[i].label === status) return list[i];
  }
  return { id: status || "Off", label: status || "Off", color: "gray" };
}

function makeStatus(status) {
  var def = resolveShareStatus(status);
  var el = document.createElement("span");
  el.className = "status is-" + (def.color || "gray");
  el.innerHTML = '<span class="status__dot"></span>' + esc(def.label || status || "Off");
  return el;
}

/** Card pill follows the plugin's primary filter axis (status by default). */
function makeFilterPill(value) {
  var list = DATA.filterOptions || DATA.statuses || [];
  var def = null;
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === value || list[i].label === value) { def = list[i]; break; }
  }
  if (!def) {
    if ((DATA.filterProperty || "status") !== "status" && !value) return null;
    def = { id: value || "Off", label: value || "Off", color: "gray" };
  }
  var el = document.createElement("span");
  el.className = "status is-" + (def.color || "gray");
  el.innerHTML = '<span class="status__dot"></span>' + esc(def.label);
  return el;
}

function tagLabel(id) {
  var list = DATA.tagVocab || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return { label: list[i].label, known: true };
  }
  return { label: id, known: false };
}

/** Neutral tag chips — display only; the public page has no tag filter. */
function makeTagCluster(ids, limit) {
  var list = (ids || []).filter(Boolean);
  if (!list.length) return null;
  var wrap = document.createElement("div");
  wrap.className = "tags";
  var shown = limit > 0 ? list.slice(0, limit) : list;
  shown.forEach(function (id) {
    var def = tagLabel(id);
    var el = document.createElement("span");
    el.className = "tag" + (def.known ? "" : " is-ghost");
    el.textContent = def.label;
    wrap.appendChild(el);
  });
  var hidden = list.length - shown.length;
  if (hidden > 0) {
    var more = document.createElement("span");
    more.className = "tag";
    more.textContent = "+" + hidden;
    wrap.appendChild(more);
  }
  return wrap;
}

function render() {
  main.replaceChildren();
  for (const [group, list] of groupCards(DATA.cards)) {
    const section = document.createElement("section");
    section.className = "section";
    const head = document.createElement("div");
    head.className = "section__head";
    const h = document.createElement("h2");
    h.className = "section__title";
    h.textContent = group;
    head.appendChild(h);
    if (list.length) {
      const count = document.createElement("span");
      count.className = "section__count";
      count.textContent = String(list.length);
      head.appendChild(count);
    }
    section.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "grid";
    for (const card of list) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "card";
      btn.dataset.id = card.id;
      btn.setAttribute("aria-pressed", "false");

      const cover = document.createElement("div");
      cover.className = "card__cover";
      if (card.coverDataUrl) {
        const img = document.createElement("img");
        img.alt = "";
        img.decoding = "async";
        img.src = card.coverDataUrl;
        img.style.objectPosition = card.coverPosition || "50% 50%";
        cover.appendChild(img);
      }
      btn.appendChild(cover);

      const meta = document.createElement("div");
      meta.className = "card__meta";
      const name = document.createElement("div");
      name.className = "card__name";
      name.textContent = card.title || "";
      meta.appendChild(name);
      var pill = makeFilterPill(card.filterValue != null ? card.filterValue : card.status);
      if (pill) meta.appendChild(pill);
      if (DATA.showTags) {
        var tagCluster = makeTagCluster(card.tagIds, 3);
        if (tagCluster) meta.appendChild(tagCluster);
      }

      const props = (card.props || []).filter(function (p) { return p && p.value; });
      if (props.length) {
        const propWrap = document.createElement("div");
        propWrap.className = "card__props";
        for (const p of props) {
          const row = document.createElement("div");
          row.className = "card__prop";
          row.textContent = p.value;
          propWrap.appendChild(row);
        }
        meta.appendChild(propWrap);
      }
      btn.appendChild(meta);
      btn.addEventListener("click", function () { select(card.id); });
      grid.appendChild(btn);
    }
    section.appendChild(grid);
    main.appendChild(section);
  }
  if (DATA.cards.length === 1) select(DATA.cards[0].id);
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    button.classList.add("is-ok");
    button.innerHTML = ICON_CHECK;
  } catch (e) {
    button.innerHTML = ICON_COPY;
    return;
  }
  setTimeout(function () {
    button.classList.remove("is-ok");
    button.innerHTML = ICON_COPY;
  }, 1100);
}

function closePeek() {
  root.classList.remove("is-open");
  detail.replaceChildren();
  document.querySelectorAll(".card.is-selected").forEach(function (el) {
    el.classList.remove("is-selected");
    el.setAttribute("aria-pressed", "false");
  });
}

function select(id) {
  const card = DATA.cards.find(function (c) { return c.id === id; });
  if (!card) return;
  var current = document.querySelector('.card.is-selected[data-id="' + CSS.escape(id) + '"]');
  if (current && root.classList.contains("is-open")) {
    closePeek();
    return;
  }
  document.querySelectorAll(".card.is-selected").forEach(function (el) {
    el.classList.remove("is-selected");
    el.setAttribute("aria-pressed", "false");
  });
  var selected = document.querySelector('.card[data-id="' + CSS.escape(id) + '"]');
  if (selected) {
    selected.classList.add("is-selected");
    selected.setAttribute("aria-pressed", "true");
  }
  root.classList.add("is-open");

  detail.replaceChildren();
  const bar = document.createElement("div");
  bar.className = "inspector__bar";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "inspector__back";
  back.setAttribute("aria-label", "닫기");
  back.innerHTML = ICON_BACK;
  back.addEventListener("click", function (e) {
    e.stopPropagation();
    closePeek();
  });
  const titleEl = document.createElement("h2");
  titleEl.className = "inspector__title";
  titleEl.textContent = card.title || "";
  bar.appendChild(back);
  bar.appendChild(titleEl);
  detail.appendChild(bar);

  const body = document.createElement("div");
  body.className = "inspector__body";

  const detailProps = card.detailProps || [];
  if (card.showAttrs) {
    const props = document.createElement("div");
    props.className = "props";
    const propsLabel = document.createElement("div");
    propsLabel.className = "props__label";
    propsLabel.textContent = "속성";
    props.appendChild(propsLabel);

    const statusRow = document.createElement("div");
    statusRow.className = "prop";
    statusRow.innerHTML = '<div class="prop__k">상태</div>';
    const statusVal = document.createElement("div");
    statusVal.className = "prop__v";
    statusVal.appendChild(makeStatus(card.status));
    statusRow.appendChild(statusVal);
    props.appendChild(statusRow);

    var peekTags = makeTagCluster(card.tagIds, 0);
    if (peekTags) {
      const tagRow = document.createElement("div");
      tagRow.className = "prop";
      tagRow.innerHTML = '<div class="prop__k">태그</div>';
      const tagVal = document.createElement("div");
      tagVal.className = "prop__v";
      tagVal.appendChild(peekTags);
      tagRow.appendChild(tagVal);
      props.appendChild(tagRow);
    }

    for (const p of detailProps) {
      if (!p || !p.value) continue;
      const row = document.createElement("div");
      row.className = "prop";
      row.innerHTML = '<div class="prop__k">' + esc(p.label) + '</div><div class="prop__v">' + esc(p.value) + "</div>";
      props.appendChild(row);
    }
    body.appendChild(props);
  }

  const sections = card.sections || [];
  for (const sec of sections) {
    if (!sec || !sec.title) continue;
    const hasProps = (sec.props || []).some(function (p) { return p && p.value; });
    const hasNotes = (sec.notes || []).some(Boolean);
    const hasAbilities = (sec.abilities || []).some(function (a) {
      return a && ((a.props || []).length || (a.notes || []).length);
    });
    if (!hasProps && !hasNotes && !hasAbilities) continue;

    const wrap = document.createElement("div");
    wrap.className = "section";
    const label = document.createElement("div");
    label.className = "section__label";
    label.textContent = sec.title;
    wrap.appendChild(label);

    if (hasProps) {
      const box = document.createElement("div");
      box.className = "props props--nested";
      for (const p of sec.props) {
        if (!p || !p.value) continue;
        const row = document.createElement("div");
        row.className = "prop";
        row.innerHTML = '<div class="prop__k">' + esc(p.label) + '</div><div class="prop__v">' + esc(p.value) + "</div>";
        box.appendChild(row);
      }
      wrap.appendChild(box);
    }

    for (const ab of sec.abilities || []) {
      if (!ab) continue;
      const item = document.createElement("div");
      item.className = "ability";
      const name = document.createElement("div");
      name.className = "ability__name";
      name.textContent = ab.title || "";
      item.appendChild(name);
      for (const p of ab.props || []) {
        if (!p || !p.value) continue;
        const row = document.createElement("div");
        row.className = "prop";
        row.innerHTML = '<div class="prop__k">' + esc(p.label) + '</div><div class="prop__v">' + esc(p.value) + "</div>";
        item.appendChild(row);
      }
      for (const n of ab.notes || []) {
        if (!n) continue;
        const p = document.createElement("p");
        p.className = "notes__item";
        p.textContent = n;
        item.appendChild(p);
      }
      wrap.appendChild(item);
    }

    for (const n of sec.notes || []) {
      if (!n) continue;
      const p = document.createElement("p");
      p.className = "notes__item";
      p.textContent = n;
      wrap.appendChild(p);
    }
    body.appendChild(wrap);
  }

  const prompts = (card.prompts || []).filter(function (p) { return p && p.value; });
  if (prompts.length) {
    const wrap = document.createElement("div");
    wrap.className = "prompts";
    const label = document.createElement("div");
    label.className = "prompts__label";
    label.textContent = "프롬프트";
    wrap.appendChild(label);
    for (const p of prompts) {
      const item = document.createElement("div");
      item.className = "prompt";
      const name = document.createElement("div");
      name.className = "prompt__name";
      name.textContent = p.label || "";
      const box = document.createElement("div");
      box.className = "prompt__box";
      const pre = document.createElement("pre");
      pre.textContent = p.value;
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "copy";
      copyBtn.setAttribute("aria-label", "복사");
      copyBtn.innerHTML = ICON_COPY;
      copyBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        copyText(p.value, copyBtn);
      });
      box.appendChild(pre);
      box.appendChild(copyBtn);
      item.appendChild(name);
      item.appendChild(box);
      wrap.appendChild(item);
    }
    body.appendChild(wrap);
  }

  detail.appendChild(body);
}

render();
</script>
</body>
</html>`;
}
