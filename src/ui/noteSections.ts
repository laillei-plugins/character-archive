/**
 * Pure lexical note scanner — shared by the gallery peek and the share parser.
 *
 * Deliberately dependency-free (no `obsidian` import) so `node --test` can
 * exercise it directly.
 *
 * It owns three lexical facts both callers need:
 *  - where fenced code starts/ends, so fence interiors are structurally inert
 *  - which lines are real H2 section boundaries
 *  - which `<!-- charinfo:private -->` marker binds to which heading
 *
 * It does NOT own visibility policy. Peek shows literal titles; share keeps its
 * own fail-closed allowlist. Only the lexical layer is shared.
 */

/** Place on its own line immediately before an H2 to hide that section. */
export const PRIVATE_SECTION_MARKER = "<!-- charinfo:private -->";

export type FenceRole = "none" | "open" | "close";

export interface NoteLine {
  /** Line as authored (no trimming — fence interiors stay byte-ish). */
  raw: string;
  trimmed: string;
  /** Delimiter role for fenced code blocks. */
  fence: FenceRole;
  /** Inside a fenced block, delimiters included. */
  inFence: boolean;
  /** `## ` heading that actually opens a section (never inside a fence). */
  isH2: boolean;
  /** Standalone private marker outside fences. */
  isMarker: boolean;
}

export interface NoteSection {
  /** Literal heading text with inline chrome stripped. No alias rewrite. */
  title: string;
  /** Heading line as authored, e.g. `## **짜자잔**`. */
  rawHeading: string;
  /** Section body up to the next H2. Markers removed, fences untouched. */
  body: string;
  /** A marker (blank lines only in between) preceded this heading. */
  markedPrivate: boolean;
  /** 0-based line index of the heading, after frontmatter removal. */
  headingLine: number;
}

export interface NoteScan {
  /** Untitled block before the first H2 — callout / starter prose. */
  preamble: string;
  sections: NoteSection[];
}

export type SectionKind = "private" | "prompt" | "normal";

export interface PromptFence {
  label: string;
  value: string;
}

const FENCE_RE = /^(`{3,}|~{3,})(.*)$/;
const H2_RE = /^##(?!#)\s+/;

export function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "");
}

/** Strip inline emphasis / code / heading marks from a title or short line. */
export function stripInlineChrome(text: string): string {
  return text
    .replace(/ /g, " ")
    .replace(/\*{2,}/g, "**")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\u{1f512}\s*/u, "")
    .trim();
}

export function isImageLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("![[") || t.startsWith("![");
}

/** Fence-aware line classification. Input is already frontmatter-free. */
export function classifyLines(lines: string[]): NoteLine[] {
  const out: NoteLine[] = [];
  let openChar = "";
  let openLen = 0;

  for (const raw of lines) {
    const trimmed = raw.trim();
    const match = trimmed.match(FENCE_RE);
    let fence: FenceRole = "none";
    let inFence = openLen > 0;

    if (match?.[1]) {
      const char = match[1][0] ?? "";
      const len = match[1].length;
      const info = match[2] ?? "";
      if (openLen === 0) {
        fence = "open";
        inFence = true;
        openChar = char;
        openLen = len;
      } else if (char === openChar && len >= openLen && !info.trim()) {
        // A closing fence must be bare and at least as long as the opener.
        fence = "close";
        inFence = true;
        openChar = "";
        openLen = 0;
      }
    }

    out.push({
      raw,
      trimmed,
      fence,
      inFence,
      isH2: !inFence && H2_RE.test(trimmed),
      isMarker: !inFence && trimmed === PRIVATE_SECTION_MARKER,
    });
  }

  return out;
}

export function scanNoteLines(markdown: string): NoteLine[] {
  return classifyLines(stripFrontmatter(markdown).split(/\r?\n/));
}

/** H2 title without the marks. Literal text — callers may not rewrite it. */
export function h2Title(line: string): string {
  return stripInlineChrome(line.trim().replace(H2_RE, ""));
}

/** Title reduced for kind lookup only (numbering + trailing parens dropped). */
export function normalizeKindTitle(raw: string): string {
  return stripInlineChrome(raw)
    .replace(/^\d+\.\s*/, "")
    .replace(/\s*\(.*\)\s*$/, "")
    .trim();
}

/**
 * Kind is never a display title — only prompt chrome and privacy read it.
 * Legacy privacy is an exact match: `메모리` / `말투법` stay visible.
 */
export function sectionPrivacyKind(rawTitle: string): SectionKind {
  const t = normalizeKindTitle(rawTitle);
  if (t === "메모" || t === "말투") return "private";
  if (t.includes("프롬프트")) return "prompt";
  return "normal";
}

function isBlank(line: NoteLine): boolean {
  return line.trimmed.length === 0;
}

/** Drop marker lines and outer blank lines; report a marker left dangling. */
function collectRegion(region: NoteLine[]): {
  text: string;
  markerPending: boolean;
} {
  const kept: NoteLine[] = [];
  let markerPending = false;

  for (const line of region) {
    if (line.isMarker) {
      // A marker only binds forward; drop it from rendered text either way.
      markerPending = true;
      continue;
    }
    if (!isBlank(line)) markerPending = false;
    kept.push(line);
  }

  let start = 0;
  let end = kept.length;
  while (start < end && isBlank(kept[start]!)) start += 1;
  while (end > start && isBlank(kept[end - 1]!)) end -= 1;

  return {
    text: kept
      .slice(start, end)
      .map((line) => line.raw)
      .join("\n"),
    markerPending,
  };
}

/**
 * Split a note into an untitled preamble plus literal H2 sections.
 * Leading H1 / images / `### 프로필` chrome is dropped; fences are inert.
 */
export function scanNoteSections(markdown: string): NoteScan {
  const lines = scanNoteLines(markdown);
  let i = 0;

  // Skip the note title, cover embeds and the legacy `### 프로필` label.
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.inFence) break;
    if (
      !line.trimmed ||
      /^#\s+/.test(line.trimmed) ||
      isImageLine(line.trimmed) ||
      line.trimmed === "### 프로필"
    ) {
      i += 1;
      continue;
    }
    break;
  }

  const takeRegion = (): NoteLine[] => {
    const region: NoteLine[] = [];
    while (i < lines.length && !lines[i]!.isH2) {
      region.push(lines[i]!);
      i += 1;
    }
    return region;
  };

  const head = collectRegion(takeRegion());
  const scan: NoteScan = { preamble: head.text, sections: [] };
  let markerPending = head.markerPending;

  while (i < lines.length) {
    const heading = lines[i]!;
    const headingLine = i;
    i += 1;
    const region = collectRegion(takeRegion());
    scan.sections.push({
      title: h2Title(heading.trimmed),
      rawHeading: heading.raw,
      body: region.text,
      markedPrivate: markerPending,
      headingLine,
    });
    markerPending = region.markerPending;
  }

  return scan;
}

function isAbilityTitle(trimmed: string): boolean {
  return (
    /^\*\*\[[^\]]+\]\*\*$/.test(trimmed) ||
    /^\[[^\]]+\]$/.test(trimmed) ||
    (/^\*\*[^*]+\*\*$/.test(trimmed) && trimmed.length < 80)
  );
}

function labelOf(trimmed: string): string {
  const bracket = trimmed.match(/\[([^\]]+)\]/);
  if (bracket?.[1]) return stripInlineChrome(bracket[1]);
  return stripInlineChrome(trimmed);
}

/**
 * Labelled fenced blocks inside a prompt section.
 * Fence interiors are never trimmed or rewritten — NAI `weight::text::` must
 * survive the round trip into the copy button.
 */
export function extractPromptFences(sectionBody: string): PromptFence[] {
  const lines = classifyLines(sectionBody.split(/\r?\n/));
  const prompts: PromptFence[] = [];
  let i = 0;

  const consumeFence = (): string => {
    i += 1; // opening delimiter
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.fence !== "close") {
      buf.push(lines[i]!.raw);
      i += 1;
    }
    if (i < lines.length) i += 1; // closing delimiter
    const value = buf.join("\n");
    return value.endsWith("\n") ? value.slice(0, -1) : value;
  };

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trimmed) {
      i += 1;
      continue;
    }

    if (line.fence === "open") {
      prompts.push({ label: "프롬프트", value: consumeFence() });
      continue;
    }

    const label = labelOf(line.trimmed);
    i += 1;
    while (i < lines.length && !lines[i]!.trimmed) i += 1;

    if (lines[i]?.fence === "open") {
      prompts.push({ label: label || "프롬프트", value: consumeFence() });
      continue;
    }

    if (!label) continue;

    // No fence followed — treat the trailing prose as the prompt value.
    const buf: string[] = [];
    while (i < lines.length) {
      const next = lines[i]!;
      if (!next.trimmed || next.fence === "open" || isAbilityTitle(next.trimmed)) {
        break;
      }
      buf.push(stripInlineChrome(next.trimmed));
      i += 1;
    }
    if (buf.length) prompts.push({ label, value: buf.join("\n") });
  }

  return prompts;
}
