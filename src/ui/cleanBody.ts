/**
 * Character detail display contract (gallery peek).
 *
 * Fixed kinds, free sequence (note heading order):
 * - Allowed H2 kinds (starter + profile notes):
 *   설명 / 신상 / 외형 / 성격 / 특징 / 능력 / 리스크 / 운용·비고 / 프롬프트
 * - 운용 aliases: 운용, 지침, 비고, 특이사항, 추가 정보
 * - Profile shape: 설명(인용) → 신상(소속·나이) → 외형 → 성격 → 특징 → 능력 → 프롬프트
 * - Some notes keep 배경 / 운용 labeled rows
 * - ## 메모 · ## 말투 (+ unknown) hidden from peek
 *
 * Hidden: H1 title, cover embeds, "### 프로필", raw **, table pipes.
 */

import { setIcon } from "obsidian";

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
  | { type: "prompts"; prompts: DetailProp[] };

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

/** Short dossier field labels. Longer prose stays as notes. */
const MAX_PLAIN_LABEL = 12;

function stripMd(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\*{2,}/g, "**")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^🔒\s*/, "")
    .trim();
}

function plainInline(text: string): string {
  return stripMd(text).replace(/\*\*/g, "").trim();
}

function isImageLine(line: string): boolean {
  const t = line.trim();
  return /^!\[\[/.test(t) || /^!\[/.test(t);
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+/.test(line.trim());
}

function headingText(line: string): string {
  return plainInline(line.trim().replace(/^#{1,6}\s+/, ""));
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

/** Parse messy Notion-export markdown into a clean detail document. */
export function parseDetailDoc(markdown: string): DetailDoc {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const lines = body.split(/\r?\n/);

  const doc: DetailDoc = { meta: [], blocks: [] };
  let i = 0;

  // Skip title / images / 프로필
  while (i < lines.length) {
    const t = (lines[i] ?? "").trim();
    if (!t || /^#\s+/.test(t) || isImageLine(t) || t === "### 프로필") {
      i += 1;
      continue;
    }
    break;
  }

  const state: {
    current: DetailSection | null;
    ability: DetailAbility | null;
  } = { current: null, ability: null };

  const flushAbility = () => {
    if (state.current && state.ability) {
      state.current.abilities.push(state.ability);
    }
    state.ability = null;
  };

  /** Always a new block — preserve source order, no distant merge. */
  const ensureSection = (title: string): DetailSection => {
    flushAbility();
    const section: DetailSection = {
      title,
      kind: sectionKind(title),
      props: [],
      abilities: [],
      notes: [],
    };
    doc.blocks.push({ type: "section", section });
    state.current = section;
    return section;
  };

  const skipUntilHeading = () => {
    while (i < lines.length && !isHeading(lines[i] ?? "")) i += 1;
  };

  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Confidential banner → quiet meta
    if (isHeading(trimmed) && /PERSONNEL RECORD|CONFIDENTIAL/i.test(trimmed)) {
      i += 1;
      while (i < lines.length) {
        const q = (lines[i] ?? "").trim();
        if (!q) {
          i += 1;
          continue;
        }
        if (!q.startsWith(">")) break;
        const text = plainInline(q.replace(/^>\s?/, ""));
        if (text) doc.meta.push(text.replace(/^보안 등급:\s*/, "보안 ").replace(/^소속:\s*/, ""));
        i += 1;
      }
      continue;
    }

    if (isHeading(trimmed)) {
      const title = normalizeSectionTitle(headingText(trimmed));
      if (!title || title === "프로필") {
        i += 1;
        continue;
      }
      if (HIDDEN_TITLES.has(title) || !ALLOWED_TITLES.has(title)) {
        // Secret / freeform / unknown — peek skips until next heading.
        i += 1;
        skipUntilHeading();
        continue;
      }

      if (title === "프롬프트") {
        flushAbility();
        state.current = null;
        i += 1;
        const prompts: DetailProp[] = [];
        while (i < lines.length && !isHeading(lines[i] ?? "")) {
          const t = (lines[i] ?? "").trim();
          if (!t) {
            i += 1;
            continue;
          }
          let label = "";
          if (isAbilityTitle(t) || /^\*\*/.test(t) || !t.startsWith("```")) {
            if (t.startsWith("```")) {
              i += 1;
              continue;
            }
            label = abilityTitle(t);
            i += 1;
            while (i < lines.length && !(lines[i] ?? "").trim()) i += 1;
          }
          if ((lines[i] ?? "").trim().startsWith("```")) {
            i += 1;
            const buf: string[] = [];
            while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
              buf.push(lines[i] ?? "");
              i += 1;
            }
            if ((lines[i] ?? "").trim().startsWith("```")) i += 1;
            prompts.push({
              label: label || "프롬프트",
              value: buf.join("\n").trim(),
            });
            continue;
          }
          if (label) {
            const buf: string[] = [];
            while (i < lines.length) {
              const n = (lines[i] ?? "").trim();
              if (!n || isHeading(n) || isAbilityTitle(n) || n.startsWith("```")) break;
              buf.push(plainInline(n));
              i += 1;
            }
            if (buf.length) prompts.push({ label, value: buf.join("\n") });
            continue;
          }
          i += 1;
        }
        if (prompts.length) doc.blocks.push({ type: "prompts", prompts });
        continue;
      }
      ensureSection(title);
      i += 1;
      continue;
    }

    // Table → props on current (or 신상)
    if (isTableRow(trimmed)) {
      const section = state.current ?? ensureSection("신상");
      while (i < lines.length && isTableRow(lines[i] ?? "")) {
        const row = lines[i] ?? "";
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
    if (isAbilityTitle(trimmed) && state.current && state.current.kind === "abilities") {
      flushAbility();
      state.ability = { title: abilityTitle(trimmed), props: [], notes: [] };
      i += 1;
      continue;
    }

    // Broken ****label:** patterns from export
    const fixed = trimmed.replace(/^\*{2,}/, "**").replace(/\*{2,}$/, "**");
    const labeled = parseLabeled(fixed) ?? parseLabeled(trimmed);

    if (labeled) {
      const section = state.current ?? ensureSection("배경");
      if (state.ability) {
        if (labeled.value) state.ability.props.push(labeled);
        else state.ability.notes.push(labeled.label);
      } else if (section.kind === "abilities") {
        // orphan labeled under abilities without title → notes on section
        section.props.push(labeled);
      } else {
        section.props.push(labeled);
      }
      i += 1;
      // absorb following fenced block as value extension (메멘토 trauma etc.)
      while (i < lines.length && !(lines[i] ?? "").trim()) i += 1;
      if ((lines[i] ?? "").trim().startsWith("```")) {
        i += 1;
        const buf: string[] = [];
        while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
          buf.push(plainInline(lines[i] ?? ""));
          i += 1;
        }
        if ((lines[i] ?? "").trim().startsWith("```")) i += 1;
        const extra = buf.filter(Boolean).join(" ");
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

    if (trimmed.startsWith("```")) {
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) i += 1;
      if ((lines[i] ?? "").trim().startsWith("```")) i += 1;
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

  flushAbility();
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
export function renderCleanBody(container: HTMLElement, markdown: string): void {
  container.empty();
  container.addClass("charinfo-sheet");

  const doc = parseDetailDoc(markdown);

  if (doc.meta.length) {
    const meta = container.createDiv({ cls: "charinfo-sheet__meta" });
    meta.setText(doc.meta.join(" · "));
  }

  for (const block of doc.blocks) {
    if (block.type === "prompts") {
      renderPromptBlock(container, block.prompts);
      continue;
    }
    const section = block.section;
    const empty =
      !section.props.length &&
      !section.abilities.length &&
      !section.notes.length;
    if (empty) continue;

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

function renderPromptBlock(container: HTMLElement, prompts: DetailProp[]): void {
  if (!prompts.length) return;
  const block = container.createDiv({ cls: "charinfo-sheet__block is-prompts" });
  block.createDiv({ cls: "charinfo-sheet__heading", text: "프롬프트" });

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
  const value = text.trim();
  const show = (icon: string, title: string) => {
    setIcon(button, icon);
    button.setAttr("title", title);
  };
  if (!value) {
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
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
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
