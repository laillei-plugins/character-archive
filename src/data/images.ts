import { App, TFile, TFolder, normalizePath, getFrontMatterInfo, parseYaml } from "obsidian";
import type { CharacterRecord } from "./CharacterStore";
import { rewriteImageWikiLibraryPrefix } from "./libraryFolderRename";
import {
  COVER_NONE,
  canonicalRemoteUrl,
  isCoverNone,
  isImagePath,
  isRemoteCoverUrl,
  listEmbedIdentities,
  planEmbedInsert,
  planEmbedAppendMany,
  planEmbedReorder,
  planEmbedRemove,
  planEmbedRestore,
  type ImageRemoval,
  selectCoverCandidateKey,
  type EmbedSyntax,
  type VaultImageResolver,
} from "./imageEmbeds";

/** Serialize image mutations across views; a failed write never poisons the lane. */
const noteImageWrites = new WeakMap<TFile, Promise<unknown>>();
function withNoteImageWrite<T>(file: TFile, write: () => Promise<T>): Promise<T> {
  const previous = noteImageWrites.get(file) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(write);
  noteImageWrites.set(file, next);
  const release = () => { if (noteImageWrites.get(file) === next) noteImageWrites.delete(file); };
  void next.then(release, release);
  return next;
}

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
  if (!sanitizeCollapsedImageEmbeds(markdown).changed) return false;
  let changed = false;
  await app.vault.process(file, (latest) => {
    const result = sanitizeCollapsedImageEmbeds(latest);
    changed = result.changed;
    return result.text;
  });
  return changed;
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
  if (!restoreNaiEmphasisInPromptFences(markdown).changed) return false;
  let changed = false;
  await app.vault.process(file, (latest) => {
    const result = restoreNaiEmphasisInPromptFences(latest);
    changed = result.changed;
    return result.text;
  });
  return changed;
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
    if (!markdown.includes(`![[${from}/`)) continue;
    const next = rewriteImageWikiLibraryPrefix(markdown, from, to);
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

/** Append imported images in one note write, preserving every cover setting. */
export async function appendNoteImages(
  app: App,
  file: TFile,
  images: CoverRef[],
): Promise<number> {
  return withNoteImageWrite(file, async () => {
    if (images.length === 0) return 0;
    const embeds = images.map((image) =>
      image.kind === "vault"
        ? { syntax: "wiki" as const, target: wikiPathForEmbed(file, image.file) }
        : { syntax: "md" as const, target: image.url },
    );
    const resolve = vaultImageResolver(app, file.path);
    const before = await app.vault.read(file);
    if (!planEmbedAppendMany(before, embeds, resolve).changed) return 0;
    let added = 0;
    await app.vault.process(file, (markdown) => {
      const plan = planEmbedAppendMany(markdown, embeds, resolve);
      added = plan.added;
      return plan.text;
    });
    return added;
  });
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
 * Canonical key for a pinned `cover` value, or null when it does not resolve.
 * Vault pins use the same link resolution as note embeds, so `b.png` and
 * `Archive/Rin/b.png` share one key. Remote pins drop the fragment.
 */
export function pinnedCoverKey(
  app: App,
  notePath: string,
  raw: string,
): string | null {
  if (isRemoteCoverUrl(raw)) return canonicalRemoteUrl(raw);
  return resolveLink(app, raw, notePath)?.path ?? null;
}

/**
 * Cover resolution:
 * 1) `cover: __none__` → no cover (images stay in the note)
 * 2) When note markdown is supplied: candidates are body embeds in document
 *    order. A pinned cover is used only when its canonical candidate key is
 *    among them; otherwise the first candidate, or no cover. A same-folder
 *    image is not a fallback on this path, and the note is not read again.
 * 3) Without markdown (legacy): explicit `cover` frontmatter, then the first
 *    cached embed or `autoCover`, then the first image next to the note.
 */
export function resolveCover(
  app: App,
  record: CharacterRecord,
  markdown?: string,
): CoverRef | null {
  if (isCoverNone(record.cover)) return null;

  if (markdown != null) {
    const candidates = listNoteCoverCandidates(app, record.file, markdown);
    const raw = record.cover.trim();
    const pinKey = raw ? pinnedCoverKey(app, record.path, raw) : null;
    const chosenKey = selectCoverCandidateKey(
      candidates.map(coverRefKey),
      pinKey,
    );
    return candidates.find((candidate) => coverRefKey(candidate) === chosenKey) ?? null;
  }

  if (record.cover) {
    const raw = record.cover.trim();
    if (isRemoteCoverUrl(raw)) return { kind: "remote", url: raw };
    const fromCover = resolveLink(app, raw, record.path);
    if (fromCover) return { kind: "vault", file: fromCover };
  }

  if (record.autoCover) return record.autoCover;
  if (record.noteImagesKnown) return null;

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
  return withNoteImageWrite(file, async () => {
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
  });
}

/** Hide card cover without removing note images (`cover: __none__`). */
export async function setCharacterCoverNone(
  app: App,
  file: TFile,
): Promise<void> {
  return withNoteImageWrite(file, async () => {
    await app.fileManager.processFrontMatter(file, (fm) => {
      fm.cover = COVER_NONE;
    });
  });
}

/** Persist an https cover URL (e.g. Imgur) and embed it in the note body. */
export async function setCharacterCoverUrl(
  app: App,
  file: TFile,
  url: string,
): Promise<void> {
  return withNoteImageWrite(file, async () => {
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
  return withNoteImageWrite(file, async () => {
    if (orderedKeys.length < 2) return;
    const resolve = vaultImageResolver(app, file.path);
    const markdown = await app.vault.read(file);
    if (!planEmbedReorder(markdown, orderedKeys, resolve).changed) return;
    await app.vault.process(
      file,
      (data) => planEmbedReorder(data, orderedKeys, resolve).text,
    );
  });
}

/** Read the actual transaction's frontmatter, not an asynchronously updated cache. */
export function noteImageState(app: App, file: TFile, markdown: string) {
  const info = getFrontMatterInfo(markdown);
  const fm = info.exists ? parseYaml(info.frontmatter) : null;
  const raw = String(fm?.cover ?? "").trim();
  const cover = raw.replace(/^\[\[([^\]]+)\]\]$/, "$1").split("|")[0]?.trim() ?? "";
  const images = listNoteCoverCandidates(app, file, markdown);
  const key = isCoverNone(cover) ? null : selectCoverCandidateKey(
    images.map(coverRefKey), pinnedCoverKey(app, file.path, cover),
  );
  return { cover, images, key };
}

/** Cover protection is checked inside the atomic write, even after a note edit. */
export async function removeNoteImage(app: App, file: TFile, key: string): Promise<ImageRemoval | null> {
  return withNoteImageWrite(file, async () => {
    let removal: ImageRemoval | null = null;
    await app.vault.process(file, (markdown) => {
      const state = noteImageState(app, file, markdown);
      if (state.key === key) throw new Error("현재 커버예요. 먼저 다른 이미지를 커버로 골라 주세요.");
      const plan = planEmbedRemove(markdown, key, vaultImageResolver(app, file.path), state.key);
      removal = plan.removed.length ? plan : null;
      return plan.text;
    });
    return removal;
  });
}

export async function restoreNoteImage(app: App, file: TFile, removal: ImageRemoval): Promise<boolean> {
  return withNoteImageWrite(file, async () => {
    let appended = false;
    await app.vault.process(file, (markdown) => {
      const before = noteImageState(app, file, markdown);
      const plan = planEmbedRestore(markdown, removal, vaultImageResolver(app, file.path));
      const after = noteImageState(app, file, plan.text);
      if (!after.images.some((image) => coverRefKey(image) === removal.key)) {
        throw new Error("이미지 파일을 찾을 수 없어 복원하지 못했어요.");
      }
      // Restoring an old, currently missing pin must not unexpectedly replace
      // the user's present fallback cover after intervening frontmatter edits.
      if (before.key !== null && before.key !== after.key) {
        throw new Error("커버가 바뀌어 되돌리지 못했어요. 노트에서 이미지를 다시 넣어 주세요.");
      }
      appended = plan.appended;
      return plan.text;
    });
    return appended;
  });
}
