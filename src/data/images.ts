import { App, TFile, TFolder, normalizePath } from "obsidian";
import type { CharacterRecord } from "./CharacterStore";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;
const WIKI_EMBED = /!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const MD_EMBED = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
/** Obsidian resize can write `![[img|0]]` — image vanishes at 0px width. */
const COLLAPSED_WIKI_SIZE =
  /(!\[\[([^\]|#]+)(?:#[^\]|]*)?)\|\s*0(\]\])/g;

/**
 * Frontmatter sentinel: card shows no cover while note images stay.
 * Empty `cover` still means “use first image automatically”.
 */
export const COVER_NONE = "__none__";

export function isCoverNone(raw: string | null | undefined): boolean {
  return (raw ?? "").trim() === COVER_NONE;
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXT.test(path);
}

/**
 * Wiki link target for an image relative to a note.
 * Same-folder → basename only (`cover.webp`) so library folder renames don't break embeds.
 */
export function wikiPathForEmbed(note: TFile, image: TFile): string {
  const noteDir = note.path.includes("/")
    ? note.path.slice(0, note.path.lastIndexOf("/"))
    : "";
  const imgDir = image.path.includes("/")
    ? image.path.slice(0, image.path.lastIndexOf("/"))
    : "";
  if (noteDir === imgDir) return image.name;
  return image.path;
}

export function wikiPathForEmbedPath(
  app: App,
  note: TFile,
  imagePath: string,
): string {
  const file = app.vault.getAbstractFileByPath(normalizePath(imagePath));
  if (file instanceof TFile) return wikiPathForEmbed(note, file);
  // Fallback: if path ends under the note's folder, use basename.
  const noteDir = note.path.includes("/")
    ? note.path.slice(0, note.path.lastIndexOf("/"))
    : "";
  const normalized = normalizePath(imagePath);
  if (noteDir && normalized.startsWith(`${noteDir}/`)) {
    return normalized.slice(noteDir.length + 1);
  }
  return normalized;
}

/**
 * Strip collapsed Obsidian image sizes (`|0`) that hide embeds in the note.
 * Returns the fixed markdown and whether anything changed.
 */
export function sanitizeCollapsedImageEmbeds(markdown: string): {
  text: string;
  changed: boolean;
} {
  const text = markdown.replace(COLLAPSED_WIKI_SIZE, "$1$3");
  return { text, changed: text !== markdown };
}

export async function healCollapsedImageEmbeds(
  app: App,
  file: TFile,
): Promise<boolean> {
  const markdown = await app.vault.read(file);
  const { text, changed } = sanitizeCollapsedImageEmbeds(markdown);
  if (!changed) return false;
  await app.vault.modify(file, text);
  return true;
}

/**
 * NAI strength syntax is `weight::text::`. Obsidian highlight `==text==`
 * (or mixed `::…==`) must not live inside ## 프롬프트 fenced blocks.
 *
 * HARD LOCK (plugin-only): never convert `::` → `==` anywhere in this
 * pipeline. This healer only restores wrong `==` back to `::`.
 */
export function restoreNaiEmphasisInPromptFences(markdown: string): {
  text: string;
  changed: boolean;
} {
  const lines = markdown.split("\n");
  let inPrompt = false;
  let inFence = false;
  let changed = false;
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const heading = trimmed.match(/^#{1,6}\s+(.*)$/);
    if (heading && !inFence) {
      inPrompt = /프롬프트/.test(heading[1] ?? "");
      out.push(line);
      continue;
    }
    if (inPrompt && trimmed.startsWith("```")) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inPrompt && inFence) {
      let next = line.replace(/==([^=]+?)==/g, "::$1::");
      next = next.replace(/::([^=]*?)==/g, "::$1::");
      next = next.replace(/==([^:]*?)::/g, "::$1::");
      if (next !== line) changed = true;
      out.push(next);
      continue;
    }
    out.push(line);
  }
  return { text: out.join("\n"), changed };
}

export async function healNaiPromptEmphasis(
  app: App,
  file: TFile,
): Promise<boolean> {
  const markdown = await app.vault.read(file);
  const { text, changed } = restoreNaiEmphasisInPromptFences(markdown);
  if (!changed) return false;
  await app.vault.modify(file, text);
  return true;
}

/**
 * Rewrite `fromPrefix/` → `toPrefix/` inside character notes under the library.
 * Used when the library folder is renamed so `![[old/.../cover.webp]]` keeps working.
 */
export async function rewriteLibraryPathPrefix(
  app: App,
  libraryFolder: string,
  fromPrefix: string,
  toPrefix: string,
): Promise<number> {
  const from = normalizePath(fromPrefix).replace(/\/+$/, "");
  const to = normalizePath(toPrefix).replace(/\/+$/, "");
  if (!from || !to || from === to) return 0;

  const root = normalizePath(libraryFolder);
  const files = app.vault.getMarkdownFiles().filter((file) => {
    if (!root) return true;
    return file.path === root || file.path.startsWith(`${root}/`);
  });

  let changedNotes = 0;
  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    if (cache?.frontmatter?.kind !== "character") continue;
    const markdown = await app.vault.read(file);
    if (!markdown.includes(from)) continue;
    // Path segment replace — keep trailing slash semantics for wiki targets.
    const next = markdown.split(`${from}/`).join(`${to}/`);
    if (next === markdown) continue;
    await app.vault.modify(file, next);
    changedNotes += 1;
  }
  return changedNotes;
}

function resolveLink(app: App, link: string, sourcePath: string): TFile | null {
  const cleaned = link.trim().split("|")[0]?.trim() ?? "";
  if (!cleaned) return null;
  const direct = app.vault.getAbstractFileByPath(normalizePath(cleaned));
  if (direct instanceof TFile && isImagePath(direct.path)) return direct;
  const dest = app.metadataCache.getFirstLinkpathDest(cleaned, sourcePath);
  return dest instanceof TFile && isImagePath(dest.path) ? dest : null;
}

/** Image embeds in note body order (first = default cover). */
export function listEmbedImages(app: App, file: TFile, markdown: string): TFile[] {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const found: TFile[] = [];
  const seen = new Set<string>();

  const push = (link: string) => {
    const f = resolveLink(app, link, file.path);
    if (!f || seen.has(f.path)) return;
    seen.add(f.path);
    found.push(f);
  };

  for (const match of body.matchAll(WIKI_EMBED)) {
    if (match[1]) push(match[1]);
  }
  for (const match of body.matchAll(MD_EMBED)) {
    if (match[1]) push(decodeURIComponent(match[1]));
  }
  return found;
}

/** Images next to the note (same folder) and/or legacy sibling `Name/` folder. */
export function listFolderImages(app: App, record: CharacterRecord): TFile[] {
  const candidates = new Set<string>();
  // Same directory as the note — folder-contained layout:
  // `Archive/Name/Name.md` + `Archive/Name/cover.png`
  const slash = record.path.lastIndexOf("/");
  if (slash > 0) {
    candidates.add(record.path.slice(0, slash));
  }
  // Legacy sibling folder: `Archive/Name.md` + `Archive/Name/`
  candidates.add(record.path.replace(/\.md$/i, ""));

  const seen = new Set<string>();
  const found: TFile[] = [];
  for (const folderPath of candidates) {
    const folder = app.vault.getAbstractFileByPath(normalizePath(folderPath));
    if (!(folder instanceof TFolder)) continue;
    for (const child of folder.children) {
      if (!(child instanceof TFile) || !isImagePath(child.path)) continue;
      if (seen.has(child.path)) continue;
      seen.add(child.path);
      found.push(child);
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** All candidate images: embeds first (doc order), then folder extras. */
export function listCharacterImages(
  app: App,
  record: CharacterRecord,
  markdown: string,
): TFile[] {
  const embeds = listEmbedImages(app, record.file, markdown);
  const seen = new Set(embeds.map((f) => f.path));
  const extras = listFolderImages(app, record).filter((f) => !seen.has(f.path));
  return [...embeds, ...extras];
}

export type CoverRef =
  | { kind: "vault"; file: TFile }
  | { kind: "remote"; url: string };

export function isRemoteCoverUrl(value: string): boolean {
  return /^https:\/\//i.test(value.trim());
}

/** True when a link looks like a displayable image (path or https URL). */
export function isImageLink(link: string): boolean {
  const raw = link.trim();
  if (!raw) return false;
  if (isRemoteCoverUrl(raw)) {
    // Imgur / CDN often ends with .png; also allow extension-less https images.
    return isImagePath(raw) || /^https:\/\/i\.imgur\.com\//i.test(raw);
  }
  return isImagePath(raw);
}

/**
 * First https image URL in markdown body embeds (`![](https://…)`).
 * Used when `cover` frontmatter is empty but the note already has a remote image.
 */
export function firstRemoteImageEmbed(markdown: string): string | null {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
  for (const match of body.matchAll(MD_EMBED)) {
    const raw = (match[1] ?? "").trim();
    if (!raw) continue;
    let url = raw;
    try {
      url = decodeURIComponent(raw);
    } catch {
      /* keep raw */
    }
    if (isRemoteCoverUrl(url) && isImageLink(url)) return url;
  }
  return null;
}

export function coverDisplaySrc(app: App, cover: CoverRef): string {
  if (cover.kind === "remote") return cover.url;
  return app.vault.getResourcePath(cover.file);
}

/**
 * Cover resolution:
 * 1) `cover: __none__` → no cover (images stay in the note)
 * 2) explicit `cover` frontmatter (vault wiki/path or https URL)
 * 3) first image embed in the note (vault wiki or https markdown)
 * 4) first image next to the note (same folder / legacy sibling folder)
 */
export function resolveCover(
  app: App,
  record: CharacterRecord,
  markdown?: string,
): CoverRef | null {
  if (isCoverNone(record.cover)) return null;

  if (record.cover) {
    const raw = record.cover.trim();
    if (isRemoteCoverUrl(raw)) return { kind: "remote", url: raw };
    const fromCover = resolveLink(app, raw, record.path);
    if (fromCover) return { kind: "vault", file: fromCover };
  }

  const text = markdown;
  if (text != null) {
    const remote = firstRemoteImageEmbed(text);
    if (remote) return { kind: "remote", url: remote };
    const embeds = listEmbedImages(app, record.file, text);
    if (embeds[0]) return { kind: "vault", file: embeds[0] };
  } else {
    const cache = app.metadataCache.getFileCache(record.file);
    const embeds = cache?.embeds ?? [];
    for (const embed of embeds) {
      const link = (embed.link ?? "").trim();
      if (!link) continue;
      if (isRemoteCoverUrl(link) && isImageLink(link)) {
        return { kind: "remote", url: link };
      }
      if (!isImagePath(link)) continue;
      const f = resolveLink(app, link, record.path);
      if (f) return { kind: "vault", file: f };
    }
  }

  const folder = listFolderImages(app, record)[0];
  return folder ? { kind: "vault", file: folder } : null;
}

/** @deprecated Prefer resolveCover — vault-only helper for callers that need TFile. */
export function resolveCoverFile(
  app: App,
  record: CharacterRecord,
  markdown?: string,
): TFile | null {
  const cover = resolveCover(app, record, markdown);
  return cover?.kind === "vault" ? cover.file : null;
}

export async function setCharacterCover(
  app: App,
  file: TFile,
  image: TFile | null,
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    if (image) {
      fm.cover = `[[${wikiPathForEmbed(file, image)}]]`;
      fm.coverPosition = "50% 50%";
    } else {
      // Automatic default — first embed/folder image via resolveCover.
      delete fm.cover;
      fm.cover = "";
    }
  });

  // Ensure the cover also appears as an embed so the image strip can see it.
  if (image) {
    await ensureCoverEmbed(app, file, wikiPathForEmbed(file, image));
  }
}

/** Hide card cover without removing note images (`cover: __none__`). */
export async function setCharacterCoverNone(
  app: App,
  file: TFile,
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.cover = COVER_NONE;
  });
}

/** Persist an https cover URL (e.g. Imgur). Does not embed into note body. */
export async function setCharacterCoverUrl(
  app: App,
  file: TFile,
  url: string,
): Promise<void> {
  const cleaned = url.trim();
  if (!isRemoteCoverUrl(cleaned)) {
    throw new Error("커버 URL은 https:// 로 시작해야 해요.");
  }
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.cover = cleaned;
    fm.coverPosition = "50% 50%";
  });
}

/** Prepend `![[path]]` after frontmatter if the note doesn't already embed it. */
async function ensureCoverEmbed(
  app: App,
  file: TFile,
  imagePath: string,
): Promise<void> {
  const markdown = await app.vault.read(file);
  const needle = imagePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`!\\[\\[${needle}(?:[|#][^\\]]*)?\\]\\]`).test(markdown)) {
    return;
  }
  const embed = `![[${imagePath}]]\n`;
  const fm = markdown.match(/^---\n[\s\S]*?\n---\n?/);
  if (fm) {
    await app.vault.modify(file, fm[0] + embed + markdown.slice(fm[0].length));
  } else {
    await app.vault.modify(file, embed + markdown);
  }
}

/** Notion-style cover crop anchor — stored as `coverPosition: "X% Y%"`. */
export async function setCoverPosition(
  app: App,
  file: TFile,
  position: string,
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.coverPosition = position;
  });
}

/** Write a single frontmatter field (상태 · 관계 · 인연 · 소속 …). */
export async function setCharacterField(
  app: App,
  file: TFile,
  key: string,
  value: string,
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm[key] = value;
    // Legacy key was `언급`; keep `상태` as the only status key.
    if (key === "상태" && "언급" in fm) delete fm.언급;
  });
}

/**
 * Write a character's tag ids. Dedicated array writer — `setCharacterField`
 * would store a string. An empty list removes the key instead of leaving `[]`.
 */
export async function setCharacterTags(
  app: App,
  file: TFile,
  ids: string[],
): Promise<void> {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  await app.fileManager.processFrontMatter(file, (fm) => {
    if (next.length === 0) {
      delete fm.태그;
      return;
    }
    fm.태그 = next;
  });
}

/**
 * Normalize card fields after note edits / uploads:
 * - migrate legacy `언급` → `상태`
 * - if `cover` is empty, write the first image (remote URL or vault embed/folder)
 * Returns true when frontmatter changed.
 */
export async function healCharacterCardFields(
  app: App,
  file: TFile,
): Promise<boolean> {
  const cache = app.metadataCache.getFileCache(file);
  const fm0 = cache?.frontmatter;
  if (!fm0 || asKind(fm0.kind) !== "character") {
    // Fall through to body parse only when cache missing kind.
    const text0 = await app.vault.cachedRead(file);
    if (!/^---\n[\s\S]*?\nkind:\s*["']?character["']?/m.test(text0)) {
      return false;
    }
  } else if (String(fm0.kind) !== "character") {
    return false;
  }

  let changed = false;
  await app.fileManager.processFrontMatter(file, (fm) => {
    const current = String(fm.상태 ?? "").trim();
    const legacy = String(fm.언급 ?? "").trim();
    if (!current && legacy) {
      fm.상태 = legacy;
      changed = true;
    }
    if ("언급" in fm) {
      delete fm.언급;
      changed = true;
    }
  });

  const text = await app.vault.cachedRead(file);
  const coverNow = (() => {
    const m = text.match(/^---\n([\s\S]*?)\n---/);
    if (!m?.[1]) return "";
    const hit = m[1].match(/^cover:\s*(.*)$/m);
    if (!hit) return "";
    return (hit[1] ?? "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/^\[\[|\]\]$/g, "");
  })();

  // Intentional no-cover — never auto-fill from embeds/folder.
  if (isCoverNone(coverNow)) {
    return changed;
  }

  if (!coverNow) {
    const remote = firstRemoteImageEmbed(text);
    if (remote) {
      await setCharacterCoverUrl(app, file, remote);
      changed = true;
    } else {
      // Build a minimal record for folder/embed scan.
      const stub = {
        file,
        path: file.path,
        kind: "character",
        이름: "",
        코드네임: "",
        본명: "",
        소속: "",
        장르: "",
        작품: "",
        그룹: "",
        상태: "",
        관계: "",
        인연: "",
        태그: [] as string[],
        cover: "",
        coverPosition: "50% 50%",
        order: 0,
        title: file.basename,
      };
      const images = listCharacterImages(app, stub, text);
      if (images[0]) {
        await setCharacterCover(app, file, images[0]);
        changed = true;
      }
    }
  }

  return changed;
}

function asKind(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Reorder image embeds in the note body to match `orderedPaths`.
 * Swaps wiki/md image targets in document order; non-image content stays put.
 * Also moves the first embed to become the natural default cover when cover is cleared.
 */
export async function reorderNoteImages(
  app: App,
  file: TFile,
  orderedPaths: string[],
): Promise<void> {
  if (orderedPaths.length < 2) return;
  const markdown = await app.vault.read(file);
  const fmMatch = markdown.match(/^---\n[\s\S]*?\n---\n?/);
  const fm = fmMatch?.[0] ?? "";
  let body = fmMatch ? markdown.slice(fmMatch[0].length) : markdown;

  type Hit = { start: number; end: number; kind: "wiki" | "md"; raw: string };
  const hits: Hit[] = [];

  for (const match of body.matchAll(WIKI_EMBED)) {
    const link = match[1]?.trim() ?? "";
    if (!link || !isImagePath(link)) continue;
    const f = resolveLink(app, link, file.path);
    if (!f) continue;
    hits.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      kind: "wiki",
      raw: match[0],
    });
  }
  for (const match of body.matchAll(MD_EMBED)) {
    const link = match[1] ? decodeURIComponent(match[1]) : "";
    if (!link || !isImagePath(link)) continue;
    const f = resolveLink(app, link, file.path);
    if (!f) continue;
    hits.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      kind: "md",
      raw: match[0],
    });
  }

  hits.sort((a, b) => a.start - b.start);
  // Dedupe overlapping (prefer wiki)
  const unique: Hit[] = [];
  let lastEnd = -1;
  for (const hit of hits) {
    if (hit.start < lastEnd) continue;
    unique.push(hit);
    lastEnd = hit.end;
  }

  const n = Math.min(unique.length, orderedPaths.length);
  if (n < 2) return;

  // Rebuild from end so indices stay valid
  for (let i = n - 1; i >= 0; i -= 1) {
    const hit = unique[i];
    const path = orderedPaths[i];
    if (!hit || !path) continue;
    const embedTarget = wikiPathForEmbedPath(app, file, path);
    const next =
      hit.kind === "wiki"
        ? `![[${embedTarget}]]`
        : `![](${encodeURI(embedTarget)})`;
    body = body.slice(0, hit.start) + next + body.slice(hit.end);
  }

  await app.vault.modify(file, fm + body);
}
