/**
 * Structured character sheet (props / abilities / notes / prompt copy).
 *
 * Peek and share share this paint. Visibility differs:
 * - peek: literal H2 titles, source order, private-only suppress
 * - share: fail-closed allowlist + canonical titles
 *
 * Section boundaries, fences, and the private marker come from
 * `noteSections.ts`. A marker can no longer be swallowed by a section body.
 */

import { setIcon } from "obsidian";
import {
  classifyLines,
  extractPromptFences,
  scanNoteSections,
  sectionPrivacyKind,
  stripInlineChrome,
  type NoteLine,
} from "./noteSections";

export type DetailParseMode = "share" | "peek";

export interface DetailProp {
  label: string;
  value: string;
}

export interface DetailAbility {
  title: string;
  props: DetailProp[];
  notes: string[];
}

export interface DetailSection {
  title: string;
  kind: "props" | "abilities" | "notes";
  props: DetailProp[];
  abilities: DetailAbility[];
  notes: string[];
}

export type DetailBlock =
  | { type: "section"; section: DetailSection }
  | { type: "prompts"; title?: string; prompts: DetailProp[] };

export interface DetailDoc {
  meta: string[];
  blocks: DetailBlock[];
}

const ALLOWED_TITLES = new Set([
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
]);

/** Peek-hidden: author secrets / speech notes not in public HTML. */
const HIDDEN_TITLES = new Set(["메모", "말투"]);

/** Quiet dossier banner — its quote lines become sheet meta. */
const BANNER_RE = /PERSONNEL RECORD|CONFIDENTIAL/i;

/** Short dossier field labels. Longer prose stays as notes. */
const MAX_PLAIN_LABEL = 12;

function plainInline(text: string): string {
  return stripInlineChrome(text).replace(/\*\*/g, "").trim();
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.includes("|", 1);
}

function isTableSep(line: string): boolean {
  return /^\|?\s*:?-{3,}/.test(line.trim());
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => plainInline(c));
}

function parseLabeled(line: string): DetailProp | null {
  const t = line.trim().replace(/^[-*]\s+/, "");
  // Prefer explicit **출신:** value when present.
  const bold = t.match(/^\*\*([^*]+)\*\*\s*:?\s*(.*)$/);
  if (bold?.[1]) {
    const label = plainInline(bold[1].replace(/:$/, ""));
    const value = plainInline(bold[2] ?? "");
    if (!label || label === "구분" || label === "내용") return null;
    return { label, value };
  }
  // Plain `짧은라벨: 값` only — reject mid-sentence colons like `(이후 캐논: …)`.
  const plain = t.match(/^([^:]{1,16}):\s+(.+)$/);
  if (!plain?.[1]) return null;
  const label = plainInline(plain[1].replace(/:$/, ""));
  const value = plainInline(plain[2] ?? "");
  if (!label || label === "구분" || label === "내용") return null;
  if (label.length > MAX_PLAIN_LABEL) return null;
  if (/[()（）]/.test(label)) return null;
  if (/[.。!?…]/.test(label)) return null;
  // Multi-word Korean sentences are notes, not field rows.
  if (/\s/.test(label) && label.length > 6) return null;
  return { label, value };
}

function isAbilityTitle(line: string): boolean {
  const t = line.trim();
  return (
    /^\*\*\[[^\]]+\]\*\*$/.test(t) ||
    /^\[[^\]]+\]$/.test(t) ||
    (/^\*\*[^*]+\*\*$/.test(t) && t.length < 80)
  );
}

function abilityTitle(line: string): string {
  const t = line.trim();
  const bracket = t.match(/\[([^\]]+)\]/);
  if (bracket?.[1]) return plainInline(bracket[1]);
  return plainInline(t);
}

function normalizeSectionTitle(raw: string): string {
  const t = plainInline(raw)
    .replace(/^\d+\.\s*/, "")
    .replace(/\s*\(.*\)\s*$/, "")
    .trim();
  if (/신상/.test(t)) return "신상";
  if (/^외형/.test(t)) return "외형";
  if (/^성격/.test(t)) return "성격";
  if (/^특징|인상/.test(t)) return "특징";
  if (/^말투/.test(t)) return "말투"; // HTML 비노출 — peek skips
  if (/배경|심리/.test(t)) return "배경";
  if (/능력/.test(t)) return "능력";
  if (/^운용|^지침|운용\s*지침/.test(t)) return "운용";
  if (/추가\s*정보/.test(t)) return "추가 정보";
  if (/특이/.test(t)) return "특이사항";
  if (/^비고/.test(t)) return "비고";
  if (/리스크|반동/.test(t)) return "리스크";
  if (/설명|소개|요약/.test(t)) return "설명";
  if (/프롬프트/.test(t)) return "프롬프트";
  if (/메모|자유|노트/.test(t)) return "메모";
  return t;
}

function sectionKind(title: string): DetailSection["kind"] {
  if (title === "능력" || title === "리스크") return "abilities";
  if (title === "프롬프트") return "notes";
  return "props";
}

interface ParseState {
  current: DetailSection | null;
  ability: DetailAbility | null;
}

function flushAbility(state: ParseState): void {
  if (state.current && state.ability) {
    state.current.abilities.push(state.ability);
  }
  state.ability = null;
}

/** Always a new block — preserve source order, no distant merge. */
function ensureSection(
  doc: DetailDoc,
  state: ParseState,
  title: string,
  kindTitle = title,
): DetailSection {
  flushAbility(state);
  const section: DetailSection = {
    title,
    kind: sectionKind(kindTitle),
    props: [],
    abilities: [],
    notes: [],
  };
  doc.blocks.push({ type: "section", section });
  state.current = section;
  return section;
}

/**
 * Parse one region (preamble or a single H2 body) into the current section.
 * Never sees H2s or the private marker — the scanner removed both.
 */
function ingestRegion(doc: DetailDoc, state: ParseState, text: string): void {
  const lines: NoteLine[] = classifyLines(text.split(/\r?\n/));
  let i = 0;

  /** Raw interior lines of the fence starting at `i`; advances past it. */
  const consumeFence = (): string[] => {
    i += 1;
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.fence !== "close") {
      buf.push(lines[i]!.raw);
      i += 1;
    }
    if (i < lines.length) i += 1;
    return buf;
  };

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trimmed;

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Fenced code with no labelled owner never reaches share HTML.
    if (line.fence === "open") {
      consumeFence();
      continue;
    }

    // Confidential banner → quiet meta (any heading level below H2)
    if (/^#{1,6}\s+/.test(trimmed) && BANNER_RE.test(trimmed)) {
      i = ingestBannerQuotes(doc, lines, i + 1);
      continue;
    }

    // Table → props on current (or 신상)
    if (isTableRow(trimmed)) {
      const section = state.current ?? ensureSection(doc, state, "신상");
      while (i < lines.length && isTableRow(lines[i]!.trimmed)) {
        const row = lines[i]!.trimmed;
        i += 1;
        if (isTableSep(row)) continue;
        const cells = parseTableRow(row);
        if (cells.length >= 2 && cells[0] && cells[0] !== "구분") {
          section.props.push({ label: cells[0], value: cells[1] ?? "" });
        }
      }
      continue;
    }

    // Ability title inside 능력/리스크
    if (isAbilityTitle(trimmed) && state.current?.kind === "abilities") {
      flushAbility(state);
      state.ability = { title: abilityTitle(trimmed), props: [], notes: [] };
      i += 1;
      continue;
    }

    // Broken ****label:** patterns from export
    const fixed = trimmed.replace(/^\*{2,}/, "**").replace(/\*{2,}$/, "**");
    const labeled = parseLabeled(fixed) ?? parseLabeled(trimmed);

    if (labeled) {
      const section = state.current ?? ensureSection(doc, state, "배경");
      if (state.ability) {
        if (labeled.value) state.ability.props.push(labeled);
        else state.ability.notes.push(labeled.label);
      } else {
        section.props.push(labeled);
      }
      i += 1;
      // absorb following fenced block as value extension (메멘토 trauma etc.)
      while (i < lines.length && !lines[i]!.trimmed) i += 1;
      if (lines[i]?.fence === "open") {
        const extra = consumeFence()
          .map((raw) => plainInline(raw))
          .filter(Boolean)
          .join(" ");
        if (extra) {
          if (state.ability) {
            const last = state.ability.props[state.ability.props.length - 1];
            if (last && !last.value) last.value = extra;
            else state.ability.notes.push(extra);
          } else {
            const last = section.props[section.props.length - 1];
            if (last && !last.value) last.value = extra;
            else section.notes.push(extra);
          }
        }
      }
      continue;
    }

    if (trimmed.startsWith(">")) {
      const text = plainInline(trimmed.replace(/^>\s?/, ""));
      if (text) doc.meta.push(text);
      i += 1;
      continue;
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const note = plainInline(trimmed.replace(/^[-*]\s+/, ""));
      if (note) {
        if (state.ability) state.ability.notes.push(note);
        else if (state.current) state.current.notes.push(note);
      }
      i += 1;
      continue;
    }

    const note = plainInline(trimmed);
    if (note) {
      if (state.ability) state.ability.notes.push(note);
      else if (state.current) state.current.notes.push(note);
    }
    i += 1;
  }
}

/** Quote lines right after a banner heading become sheet meta. */
function ingestBannerQuotes(
  doc: DetailDoc,
  lines: NoteLine[],
  start: number,
): number {
  let i = start;
  while (i < lines.length) {
    const q = lines[i]!;
    if (!q.trimmed) {
      i += 1;
      continue;
    }
    if (q.inFence || !q.trimmed.startsWith(">")) break;
    const text = plainInline(q.trimmed.replace(/^>\s?/, ""));
    if (text) {
      doc.meta.push(
        text.replace(/^보안 등급:\s*/, "보안 ").replace(/^소속:\s*/, ""),
      );
    }
    i += 1;
  }
  return i;
}

/** Parse messy Notion-export markdown into a clean detail document. */
export function parseDetailDoc(
  markdown: string,
  mode: DetailParseMode = "share",
): DetailDoc {
  const scan = scanNoteSections(markdown);
  const doc: DetailDoc = { meta: [], blocks: [] };
  const state: ParseState = { current: null, ability: null };
  const peek = mode === "peek";

  // Untitled lead-in: callout/quote meta, and tables that predate any heading.
  ingestRegion(doc, state, scan.preamble);

  for (const section of scan.sections) {
    // Fail-closed: a marked block is dropped whatever it claims to be titled.
    if (section.markedPrivate) continue;

    if (BANNER_RE.test(section.rawHeading)) {
      flushAbility(state);
      state.current = null;
      ingestBannerQuotes(doc, classifyLines(section.body.split(/\r?\n/)), 0);
      continue;
    }

    const kindTitle = normalizeSectionTitle(section.title);
    const displayTitle = peek ? section.title : kindTitle;
    if (!displayTitle || kindTitle === "프로필") continue;

    if (peek) {
      if (sectionPrivacyKind(section.title) === "private") continue;
    } else if (HIDDEN_TITLES.has(kindTitle) || !ALLOWED_TITLES.has(kindTitle)) {
      // Secret / freeform / unknown — share skips the whole block.
      continue;
    }

    if (kindTitle === "프롬프트" || sectionPrivacyKind(section.title) === "prompt") {
      flushAbility(state);
      state.current = null;
      const prompts: DetailProp[] = extractPromptFences(section.body).map(
        (prompt) => ({ label: prompt.label, value: prompt.value }),
      );
      if (prompts.length) {
        doc.blocks.push({
          type: "prompts",
          title: peek ? displayTitle : undefined,
          prompts,
        });
      } else if (peek) {
        // Keep the heading even when there is nothing to copy yet.
        ensureSection(doc, state, displayTitle, kindTitle);
      }
      continue;
    }

    ensureSection(doc, state, displayTitle, kindTitle);
    ingestRegion(doc, state, section.body);
  }

  flushAbility(state);
  return doc;
}

function appendText(el: HTMLElement, text: string): void {
  // Soft-emphasize [bracket] segments only — never leave raw **
  const parts = text.split(/(\[[^\]]+\])/g);
  for (const part of parts) {
    if (!part) continue;
    const m = part.match(/^\[([^\]]+)\]$/);
    if (m?.[1]) {
      el.createEl("strong", { text: m[1] });
    } else {
      el.appendText(part);
    }
  }
}

function renderProps(parent: HTMLElement, props: DetailProp[]): void {
  if (!props.length) return;
  const grid = parent.createDiv({ cls: "charinfo-sheet__props" });
  for (const prop of props) {
    const row = grid.createDiv({ cls: "charinfo-sheet__row" });
    row.createSpan({ cls: "charinfo-sheet__key", text: prop.label });
    const val = row.createSpan({ cls: "charinfo-sheet__val" });
    appendText(val, prop.value || "—");
  }
}

/** Render parsed detail doc into a Notion-quiet sheet (document order). */
export function renderCleanBody(
  container: HTMLElement,
  markdown: string,
  mode: DetailParseMode = "share",
): void {
  container.empty();
  container.addClass("charinfo-sheet");

  const doc = parseDetailDoc(markdown, mode);
  const keepEmpty = mode === "peek";

  if (doc.meta.length) {
    const meta = container.createDiv({ cls: "charinfo-sheet__meta" });
    meta.setText(doc.meta.join(" · "));
  }

  for (const block of doc.blocks) {
    if (block.type === "prompts") {
      renderPromptBlock(container, block.prompts, block.title);
      continue;
    }
    const section = block.section;
    const empty =
      !section.props.length &&
      !section.abilities.length &&
      !section.notes.length;
    if (empty && !keepEmpty) continue;

    const el = container.createDiv({ cls: "charinfo-sheet__block" });
    el.createDiv({ cls: "charinfo-sheet__heading", text: section.title });

    renderProps(el, section.props);

    for (const ability of section.abilities) {
      const card = el.createDiv({ cls: "charinfo-sheet__ability" });
      card.createDiv({ cls: "charinfo-sheet__ability-title", text: ability.title });
      renderProps(card, ability.props);
      for (const note of ability.notes) {
        const p = card.createEl("p", { cls: "charinfo-sheet__note" });
        appendText(p, note);
      }
    }

    for (const note of section.notes) {
      const p = el.createEl("p", { cls: "charinfo-sheet__note" });
      appendText(p, note);
    }
  }

  if (!container.querySelector(".charinfo-sheet__block, .charinfo-sheet__meta")) {
    container.createDiv({
      cls: "charinfo-sheet__empty",
      text: "표시할 프로필 본문이 없어요.",
    });
  }
}

function renderPromptBlock(
  container: HTMLElement,
  prompts: DetailProp[],
  title = "프롬프트",
): void {
  if (!prompts.length) return;
  const block = container.createDiv({ cls: "charinfo-sheet__block is-prompts" });
  block.createDiv({ cls: "charinfo-sheet__heading", text: title });

  for (const prompt of prompts) {
    const item = block.createDiv({ cls: "charinfo-sheet__prompt" });
    item.createDiv({ cls: "charinfo-sheet__prompt-label", text: prompt.label });

    const box = item.createDiv({ cls: "charinfo-sheet__prompt-box" });
    const pre = box.createEl("pre", { text: prompt.value });
    pre.addClass("charinfo-sheet__prompt-body");
    pre.setAttr("tabindex", "0");

    const btn = box.createEl("button", {
      cls: "clickable-icon charinfo-sheet__copy-icon is-in-box",
      attr: {
        type: "button",
        title: `${prompt.label} 복사`,
        "aria-label": `${prompt.label} 복사`,
      },
    });
    setIcon(btn, "copy");
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void copyText(prompt.value, btn);
    });

    pre.addEventListener("dblclick", (event) => {
      event.preventDefault();
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  }
}

async function copyText(text: string, button: HTMLElement): Promise<void> {
  // Byte-preserve fence contents — do not trim on copy.
  const value = text;
  const show = (icon: string, title: string) => {
    setIcon(button, icon);
    button.setAttr("title", title);
  };
  if (value.length === 0) {
    show("circle-alert", "비어 있음");
    window.setTimeout(() => show("copy", "복사"), 1000);
    return;
  }
  const ok = await writeClipboard(value);
  show(ok ? "check" : "x", ok ? "복사됨" : "실패");
  button.classList.toggle("is-copied", ok);
  window.setTimeout(() => {
    button.classList.remove("is-copied");
    show("copy", button.getAttr("aria-label") || "복사");
  }, 1200);
}

async function writeClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* Electron/Obsidian often needs the textarea fallback below */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.addClass("charinfo-offscreen-clip");
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, value.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
