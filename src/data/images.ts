import { App, TFile, TFolder, normalizePath } from "obsidian";
import type { CharacterRecord } from "./CharacterStore";
import {
  COVER_NONE,
  canonicalRemoteUrl,
  isCoverNone,
  isImagePath,
  isRemoteCoverUrl,
  listEmbedIdentities,
  planEmbedInsert,
  planEmbedReorder,
  type EmbedSyntax,
  type VaultImageResolver,
} from "./imageEmbeds";

/** Obsidian resize can write `![[img|0]]` — image vanishes at 0px width. */
const COLLAPSED_WIKI_SIZE =
  /(!\[\[([^\]|#]+)(?:#[^\]|]*)?)\|\s*0(\]\])/g;

export {
  COVER_NONE,
  canonicalRemoteUrl,
  isCoverNone,
  isImageLink,
  isImagePath,
  isRemoteCoverUrl,
} from "./imageEmbeds";

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

/** Embed target → vault image path, for the Obsidian-free embed layer. */
function vaultImageResolver(app: App, sourcePath: string): VaultImageResolver {
  return (target) => resolveLink(app, target, sourcePath)?.path ?? null;
}

/**
 * Selectable covers for a note: its body image embeds in document order, vault
 * and remote alike. This is the one inventory the picker, the image strip and
 * the reorder handle read, so removing an embed removes the choice even while
 * the file stays beside the note.
 */
export function listNoteCoverCandidates(
  app: App,
  file: TFile,
  markdown: string,
): CoverRef[] {
  const found: CoverRef[] = [];
  const identities = listEmbedIdentities(
    markdown,
    vaultImageResolver(app, file.path),
  );
  for (const identity of identities) {
    if (identity.kind === "remote") {
      found.push({ kind: "remote", url: identity.url });
      continue;
    }
    const image = app.vault.getAbstractFileByPath(identity.path);
    if (image instanceof TFile) found.push({ kind: "vault", file: image });
  }
  return found;
}

/** Vault image embeds in note body order (first = default cover). */
export function listEmbedImages(app: App, file: TFile, markdown: string): TFile[] {
  return listNoteCoverCandidates(app, file, markdown).flatMap((cover) =>
    cover.kind === "vault" ? [cover.file] : [],
  );
}

/**
 * Images next to the note (same folder) and/or legacy sibling `Name/` folder.
 *
 * Legacy display fallback only, for notes written before the note body owned the
 * inventory. It must never feed the picker, the image strip, a reorder or a
 * heal — a file beside the note is not a cover choice until the note embeds it.
 */
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

/**
 * Legacy display list: note embeds first (doc order), then folder extras.
 * Prefer `listNoteCoverCandidates` — anything selectable comes from the note.
 */
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

/** Stable candidate identity: resolved vault path or canonical remote URL. */
export function coverRefKey(cover: CoverRef): string {
  return cover.kind === "vault"
    ? cover.file.path
    : canonicalRemoteUrl(cover.url);
}

export function coverDisplaySrc(app: App, cover: CoverRef): string {
  if (cover.kind === "remote") return cover.url;
  return app.vault.getResourcePath(cover.file);
}

/**
 * Cover resolution:
 * 1) `cover: __none__` → no cover (images stay in the note)
 * 2) explicit `cover` frontmatter (vault wiki/path or https URL)
 * 3) first image embed in the note, in document order (vault wiki or https markdown)
 * 4) legacy fallback for un-migrated notes: first image next to the note
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
    // First candidate in real document order — vault or remote, whichever the
    // note embeds first.
    const first = listNoteCoverCandidates(app, record.file, text)[0];
    if (first) return first;
  } else if (record.autoCover) {
    return record.autoCover;
  } else {
    const cache = app.metadataCache.getFileCache(record.file);
    const embeds = cache?.embeds ?? [];
    for (const embed of embeds) {
      const link = (embed.link ?? "").trim();
      if (!link) continue;
      if (isRemoteCoverUrl(link)) {
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
  // Embed first, pin second: the note owns the inventory, so a cover must exist
  // in the body before frontmatter points at it.
  if (image) {
    await ensureCoverEmbed(app, file, {
      syntax: "wiki",
      target: wikiPathForEmbed(file, image),
    });
  }

  await app.fileManager.processFrontMatter(file, (fm) => {
    if (image) {
      fm.cover = `[[${wikiPathForEmbed(file, image)}]]`;
      fm.coverPosition = "50% 50%";
    } else {
      // Automatic default — first note embed via resolveCover.
      delete fm.cover;
      fm.cover = "";
    }
  });
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

/** Persist an https cover URL (e.g. Imgur) and embed it in the note body. */
export async function setCharacterCoverUrl(
  app: App,
  file: TFile,
  url: string,
): Promise<void> {
  const cleaned = url.trim();
  if (!isRemoteCoverUrl(cleaned)) {
    throw new Error("커버 URL은 https:// 로 시작해야 해요.");
  }
  // Same rule as a vault cover: embed first, then pin.
  await ensureCoverEmbed(app, file, { syntax: "md", target: cleaned });
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.cover = cleaned;
    fm.coverPosition = "50% 50%";
  });
}

/**
 * Add the embed after frontmatter unless the note already embeds that image.
 * `vault.process` re-reads inside the write, so a body typed while the cover
 * was picked survives.
 */
async function ensureCoverEmbed(
  app: App,
  file: TFile,
  embed: { syntax: EmbedSyntax; target: string },
): Promise<void> {
  const resolve = vaultImageResolver(app, file.path);
  const markdown = await app.vault.read(file);
  if (!planEmbedInsert(markdown, embed, resolve).changed) return;
  await app.vault.process(
    file,
    (data) => planEmbedInsert(data, embed, resolve).text,
  );
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
 * would store a string. Clearing every tag writes `태그: []`; the key belongs to
 * the fixed archive schema, so it is never deleted.
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
    fm.태그 = next;
  });
}

/**
 * Write a custom multi-select field as a YAML list. Same contract as
 * `setCharacterTags`: an empty selection writes `[]` (the key belongs to the
 * group schema, so it is never deleted), and ids are stored, never labels.
 */
export async function setCharacterList(
  app: App,
  file: TFile,
  key: string,
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
    fm[key] = next;
  });
}

/**
 * Normalize card fields after note edits / uploads: migrate legacy `언급` → `상태`.
 * Returns true when frontmatter changed.
 *
 * Healing never touches `cover`. An empty `cover` is the live “first note image”
 * default and `__none__` is a deliberate choice; pinning either one behind the
 * author's back is what used to make removed images come back.
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

  return changed;
}

function asKind(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Reorder the note's image embeds to match `orderedKeys` — candidate identities
 * (`coverRefKey`): vault paths and/or remote URLs. Only images the note already
 * embeds move, so a folder-only file is never written into the body, and
 * non-image content stays exactly where it is.
 */
export async function reorderNoteImages(
  app: App,
  file: TFile,
  orderedKeys: string[],
): Promise<void> {
  if (orderedKeys.length < 2) return;
  const resolve = vaultImageResolver(app, file.path);
  const markdown = await app.vault.read(file);
  if (!planEmbedReorder(markdown, orderedKeys, resolve).changed) return;
  await app.vault.process(
    file,
    (data) => planEmbedReorder(data, orderedKeys, resolve).text,
  );
}
