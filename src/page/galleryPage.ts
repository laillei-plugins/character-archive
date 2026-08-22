import { Notice, normalizePath, TFile, type App } from "obsidian";
import type CharinfoPlugin from "../main";
import {
  BUNDLED_CHARACTER_TEMPLATE,
  exampleCharacterBody,
  exampleCharacterRelPath,
  fillCharacterTemplate,
} from "../data/bundledTemplate";
import type {
  CharinfoSettings,
  FilterAxis,
  PrimaryFilterProperty,
} from "../settings";
import { normalizePrimaryFilterProperty, resolveFilterAxis } from "../settings";
import {
  applyNotePropertyPlan,
  planNoteProperties,
  resolveGroupSchema,
} from "../data/groupSchema";
import { GalleryView, VIEW_TYPE_CHARINFO_GALLERY } from "../views/GalleryView";
import { promptCharacterName } from "../ui/CharacterNameModal";
import {
  characterNameProblem,
  characterNameProblemMessage,
} from "../data/characterName";

/** User-facing product name (plugin list, tabs, settings). */
export const PLUGIN_DISPLAY_NAME = "Character Archive";
/** Entry note basename under the library folder. */
export const GALLERY_ENTRY_BASENAME = "Character Archive";
/**
 * Subfolder for pinned / custom gallery notes (not character storage).
 * Keeps `Archive.md` from colliding with `Archive/` in the file tree.
 */
export const GALLERY_PAGES_DIR = "_galleries";
/** Pre-rename entry note — still opens as the gallery. */
const LEGACY_GALLERY_ENTRY_BASENAME = "캐릭터 프롬프트";

/** Scope resolved from a gallery note's frontmatter. */
export interface GalleryScope {
  /** Vault folder scanned for `kind: character`. */
  library: string;
  /** Non-empty when FM `장르` pins this page to one archive. */
  pinnedArchive: string;
  pinned: boolean;
  /**
   * FM `primaryFilter` — this page's chip axis. Null = use the global setting.
   */
  primaryFilter: PrimaryFilterProperty | null;
  /**
   * FM `defaultChipFilter` — first-open chip for this page (`all` or an option
   * id). Null = fall through to the global remembered chip.
   */
  defaultChipFilter: string | null;
}

export function readGalleryScope(
  app: App,
  file: TFile | null | undefined,
  settings: CharinfoSettings,
): GalleryScope {
  const defaultLib = normalizePath(
    settings.libraryFolder.trim() || "Character Archive",
  );
  if (!file) {
    return {
      library: defaultLib,
      pinnedArchive: "",
      pinned: false,
      primaryFilter: null,
      defaultChipFilter: null,
    };
  }
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  const libraryRaw =
    typeof fm?.library === "string" ? fm.library.trim() : "";
  const library = normalizePath(libraryRaw || defaultLib);
  const pin = typeof fm?.장르 === "string" ? fm.장르.trim() : "";
  const filterRaw =
    typeof fm?.primaryFilter === "string" ? fm.primaryFilter.trim() : "";
  const chipRaw =
    typeof fm?.defaultChipFilter === "string"
      ? fm.defaultChipFilter.trim()
      : "";
  return {
    library,
    pinnedArchive: pin,
    pinned: Boolean(pin),
    // An unknown axis name would silently mean `status`; ignore it instead so
    // the page keeps following the global setting.
    primaryFilter: isFilterAxisName(filterRaw)
      ? normalizePrimaryFilterProperty(filterRaw)
      : null,
    defaultChipFilter: chipRaw || null,
  };
}

function isFilterAxisName(raw: string): boolean {
  return Boolean(raw) && normalizePrimaryFilterProperty(raw) === raw;
}

/**
 * Every library a gallery claims as its own **identity**: the default library
 * plus each `library` a `charinfo: gallery` note points at, whether or not that
 * gallery is open. Normalized and de-duplicated, but *not* collapsed — a nested
 * library keeps its own identity so `longestMatchingLibrary` can hand a note
 * under `Root/Sub` the `Root/Sub` schema scope.
 */
export function listGalleryLibraryIdentities(
  plugin: CharinfoPlugin,
): string[] {
  const identities = new Set<string>();
  identities.add(
    normalizePath(plugin.settings.libraryFolder.trim() || "Character Archive"),
  );
  for (const file of plugin.app.vault.getMarkdownFiles()) {
    const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || fm.charinfo !== "gallery") continue;
    const raw = typeof fm.library === "string" ? fm.library.trim() : "";
    if (!raw) continue;
    identities.add(normalizePath(raw));
  }
  return [...identities].filter(
    (root) => root && root !== "/" && root !== ".",
  );
}

/**
 * Gallery notes whose resolved library is this one. Card-eye rows carry a page
 * but no library, so an archive rename needs exactly this list to know which
 * rows it may touch.
 */
export function listGalleryPagePathsForLibrary(
  plugin: CharinfoPlugin,
  library: string,
): string[] {
  const want = normalizePath(library);
  const out: string[] = [];
  for (const file of plugin.app.vault.getMarkdownFiles()) {
    if (!isGalleryPage(file, plugin)) continue;
    const scope = readGalleryScope(plugin.app, file, plugin.settings);
    if (normalizePath(scope.library) !== want) continue;
    out.push(file.path);
  }
  return out;
}

/** Drop roots already contained in a shorter root, and empty/vault-root entries. */
export function dedupeOverlappingRoots(roots: string[]): string[] {
  const cleaned = [
    ...new Set(
      roots
        .map((root) => root.replace(/\/+$/, "").trim())
        .filter((root) => root && root !== "/" && root !== "."),
    ),
  ].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const out: string[] = [];
  for (const root of cleaned) {
    if (out.some((kept) => root === kept || root.startsWith(`${kept}/`))) {
      continue;
    }
    out.push(root);
  }
  return out;
}

/**
 * Chip axis for one gallery page: FM `primaryFilter` when set, else the global
 * setting. Every chip / filter / share path must resolve through this.
 */
export function getFilterAxisForPage(
  settings: CharinfoSettings,
  scope: Pick<GalleryScope, "primaryFilter">,
): FilterAxis {
  return resolveFilterAxis(
    settings,
    scope.primaryFilter ?? settings.primaryFilterProperty,
  );
}

/** Renders ```charinfo blocks on normal markdown pages. */
export function registerCharinfoCodeBlock(plugin: CharinfoPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor("charinfo", async (_source, el) => {
    el.empty();
    el.addClass("charinfo-embed");

    el.createDiv({ cls: "charinfo-embed__title", text: PLUGIN_DISPLAY_NAME });

    const library = plugin.settings.libraryFolder;
    const records = await plugin.characters.listCharacters(
      plugin.settings.sortMode,
      library,
    );
    const onCount = records.filter((r) => r.상태 === "On").length;
    const offCount = records.filter((r) => r.상태 === "Off").length;

    const meta = el.createDiv({
      cls: "charinfo-embed__meta",
      text: `${records.length} · On ${onCount} · Off ${offCount}`,
    });

    const actions = el.createDiv({ cls: "charinfo-embed__actions" });
    const openBtn = actions.createEl("button", {
      text: "갤러리",
      cls: "mod-cta",
    });
    openBtn.addEventListener("click", () => {
      const file = plugin.app.workspace.getActiveFile();
      void plugin.activateGalleryView({
        replaceActive: true,
        file: file ?? undefined,
      });
    });

    const linkBtn = actions.createEl("button", { text: "링크 복사" });
    linkBtn.addEventListener("click", () => {
      void (async () => {
        const file = await resolveGalleryPageFile(plugin);
        if (!file) {
          new Notice("갤러리 노트를 찾지 못했어요.");
          return;
        }
        await copyGalleryPageLink(plugin.app, file);
      })();
    });

    const refreshBtn = actions.createEl("button", { text: "새로고침" });
    refreshBtn.addEventListener("click", () => {
      void (async () => {
        const next = await plugin.characters.listCharacters(
          plugin.settings.sortMode,
          library,
        );
        meta.setText(
          `${next.length} · On ${next.filter((r) => r.상태 === "On").length} · Off ${next.filter((r) => r.상태 === "Off").length}`,
        );
      })();
    });
  });
}

function galleryPageBody(opts?: {
  library?: string;
  archive?: string;
  primaryFilter?: string;
  defaultChipFilter?: string;
}): string {
  const lines = ["---", "charinfo: gallery"];
  const library = opts?.library?.trim();
  const archive = opts?.archive?.trim();
  const primaryFilter = opts?.primaryFilter?.trim();
  const defaultChipFilter = opts?.defaultChipFilter?.trim();
  if (library) lines.push(`library: "${library.replace(/"/g, '\\"')}"`);
  if (archive) lines.push(`장르: "${archive.replace(/"/g, '\\"')}"`);
  if (primaryFilter) {
    lines.push(`primaryFilter: "${primaryFilter.replace(/"/g, '\\"')}"`);
  }
  if (defaultChipFilter) {
    lines.push(
      `defaultChipFilter: "${defaultChipFilter.replace(/"/g, '\\"')}"`,
    );
  }
  lines.push("---", "");
  return lines.join("\n");
}

/** Default entry note under the default library folder. */
export function galleryPagePath(plugin: CharinfoPlugin): string {
  return normalizePath(
    `${plugin.settings.libraryFolder}/${GALLERY_ENTRY_BASENAME}.md`,
  );
}

function legacyGalleryPagePath(plugin: CharinfoPlugin): string {
  return normalizePath(
    `${plugin.settings.libraryFolder}/${LEGACY_GALLERY_ENTRY_BASENAME}.md`,
  );
}

export function isDefaultGalleryEntry(
  file: TFile,
  plugin: CharinfoPlugin,
): boolean {
  if (file.path === galleryPagePath(plugin)) return true;
  if (file.path === legacyGalleryPagePath(plugin)) return true;
  const lib = normalizePath(plugin.settings.libraryFolder);
  const folderNote = normalizePath(`${lib}/${lib.split("/").pop()}.md`);
  return file.path === folderNote;
}

export function isGalleryPage(file: TFile, plugin: CharinfoPlugin): boolean {
  const cache = plugin.app.metadataCache.getFileCache(file);
  if (cache?.frontmatter?.charinfo === "gallery") return true;
  if (file.path === galleryPagePath(plugin)) return true;
  if (file.path === legacyGalleryPagePath(plugin)) return true;
  // Folder note for the default library folder (same name as folder).
  const lib = normalizePath(plugin.settings.libraryFolder);
  const folderNote = normalizePath(`${lib}/${lib.split("/").pop()}.md`);
  return file.path === folderNote;
}

/**
 * Prefer the new entry path; if only the legacy note exists, rename it once.
 */
export async function resolveOrMigrateGalleryPage(
  plugin: CharinfoPlugin,
): Promise<TFile | null> {
  const nextPath = galleryPagePath(plugin);
  const next = plugin.app.vault.getAbstractFileByPath(nextPath);
  if (next instanceof TFile) return next;

  const legacyPath = legacyGalleryPagePath(plugin);
  const legacy = plugin.app.vault.getAbstractFileByPath(legacyPath);
  if (legacy instanceof TFile) {
    await plugin.app.fileManager.renameFile(legacy, nextPath);
    const renamed = plugin.app.vault.getAbstractFileByPath(nextPath);
    if (renamed instanceof TFile) {
      new Notice(`갤러리 노트 → ${GALLERY_ENTRY_BASENAME}.md`);
      return renamed;
    }
  }
  return null;
}

/** Deep link that opens this vault note (Charinfo then swaps to the gallery). */
export function galleryObsidianUri(app: App, file: TFile): string {
  const vault = encodeURIComponent(app.vault.getName());
  const path = encodeURIComponent(file.path);
  return `obsidian://open?vault=${vault}&file=${path}`;
}

export function galleryWikiLink(file: TFile): string {
  return `[[${file.path.replace(/\.md$/i, "")}]]`;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.addClass("charinfo-offscreen-clip");
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export async function copyGalleryPageLink(
  app: App,
  file: TFile,
): Promise<boolean> {
  const uri = galleryObsidianUri(app, file);
  const ok = await copyTextToClipboard(uri);
  new Notice(ok ? "앱 링크를 복사했어요" : "복사에 실패했어요");
  return ok;
}

export async function resolveGalleryPageFile(
  plugin: CharinfoPlugin,
): Promise<TFile | null> {
  // The gallery in front of the user wins over "whichever tab opened first".
  const focused = plugin.getFocusedGalleryView();
  if (focused?.file) return focused.file;
  const active = plugin.app.workspace.getActiveFile();
  if (active && isGalleryPage(active, plugin)) return active;
  const abs = plugin.app.vault.getAbstractFileByPath(galleryPagePath(plugin));
  if (abs instanceof TFile) return abs;
  const legacy = plugin.app.vault.getAbstractFileByPath(
    legacyGalleryPagePath(plugin),
  );
  return legacy instanceof TFile ? legacy : null;
}

export interface CreateGalleryPageOpts {
  /** Vault folder to scan (B). Default: settings.libraryFolder. */
  library?: string;
  /** Pin this archive (A). Empty = switcher. */
  archive?: string;
  /** FM `primaryFilter` for this page. Empty = follow the global setting. */
  primaryFilter?: string;
  /** FM `defaultChipFilter` for this page. Empty = follow the global chip. */
  defaultChipFilter?: string;
  /** Note basename without .md. Default: archive name or Character Archive. */
  title?: string;
  /** Parent folder for the note. Default: `library/_galleries` (pinned pages). */
  parentFolder?: string;
}

/**
 * Create (or open) a gallery note. With no opts → default library entry note.
 */
export async function createGalleryPage(
  plugin: CharinfoPlugin,
  opts?: CreateGalleryPageOpts,
): Promise<TFile | null> {
  const hasCustom =
    Boolean(opts?.library?.trim()) ||
    Boolean(opts?.archive?.trim()) ||
    Boolean(opts?.title?.trim()) ||
    Boolean(opts?.parentFolder?.trim()) ||
    Boolean(opts?.primaryFilter?.trim()) ||
    Boolean(opts?.defaultChipFilter?.trim());

  const library = normalizePath(
    (opts?.library ?? plugin.settings.libraryFolder).trim() ||
      "Character Archive",
  );
  const archive = opts?.archive?.trim() ?? "";

  await ensureFolder(plugin, library);

  if (!hasCustom) {
    let file = await resolveOrMigrateGalleryPage(plugin);
    if (!file) {
      const path = galleryPagePath(plugin);
      file = await plugin.app.vault.create(
        path,
        galleryPageBody({ library }),
      );
      await seedExampleGroupIfEmpty(plugin, library);
    }
    await plugin.app.workspace.getLeaf(false).openFile(file);
    await plugin.activateGalleryView({ replaceActive: true, file });
    new Notice(
      `갤러리: ${file.path}\n다시 열려면 리본 격자 아이콘 또는 «갤러리 열기»`,
    );
    return file;
  }

  const parent = normalizePath(
    (opts?.parentFolder ?? `${library}/${GALLERY_PAGES_DIR}`).trim() ||
      `${library}/${GALLERY_PAGES_DIR}`,
  );
  await ensureFolder(plugin, parent);

  const base =
    (opts?.title?.trim() ||
      archive ||
      parent.split("/").pop() ||
      GALLERY_ENTRY_BASENAME).replace(/[\\/]/g, "-");
  const path = normalizePath(`${parent}/${base}.md`);
  const existing = plugin.app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    // Same path already used — reopen instead of silently making "Name 2.md".
    if (isReusableGalleryPage(plugin, existing, { library, archive })) {
      await plugin.app.workspace.getLeaf(false).openFile(existing);
      await plugin.activateGalleryView({ replaceActive: true, file: existing });
      new Notice(`이미 있는 갤러리 페이지를 열었어요 · ${existing.path}`);
      return existing;
    }
    new Notice(
      `「${base}」 노트가 이미 있어요. 다른 페이지 이름을 정해 주세요.`,
    );
    return null;
  }

  const file = await plugin.app.vault.create(
    path,
    galleryPageBody({
      library,
      archive: archive || undefined,
      primaryFilter: opts?.primaryFilter?.trim() || undefined,
      defaultChipFilter: opts?.defaultChipFilter?.trim() || undefined,
    }),
  );

  await plugin.app.workspace.getLeaf(false).openFile(file);
  await plugin.activateGalleryView({ replaceActive: true, file });
  new Notice(
    [
      `갤러리: ${file.path}`,
      archive ? `아카이브 ${archive}` : "아카이브 전환 가능",
      library !== normalizePath(plugin.settings.libraryFolder)
        ? `폴더 ${library}`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  return file;
}

/** True when an existing note is the gallery page we meant to create. */
function isReusableGalleryPage(
  plugin: CharinfoPlugin,
  file: TFile,
  want: { library: string; archive: string },
): boolean {
  if (!isGalleryPage(file, plugin)) return false;
  const scope = readGalleryScope(plugin.app, file, plugin.settings);
  if (normalizePath(scope.library) !== normalizePath(want.library)) {
    return false;
  }
  return scope.pinnedArchive === want.archive.trim();
}

/**
 * One blank example card under `_starter/`.
 * Only when this library has no character notes yet — never writes into
 * existing archives.
 */
export async function seedExampleGroupIfEmpty(
  plugin: CharinfoPlugin,
  library: string,
): Promise<TFile | null> {
  const lib = normalizePath(library);
  const existing = plugin.app.vault.getMarkdownFiles().some((file) => {
    if (file.path === lib || !file.path.startsWith(`${lib}/`)) return false;
    const kind = plugin.app.metadataCache.getFileCache(file)?.frontmatter?.kind;
    return String(kind ?? "") === "character";
  });
  if (existing) return null;

  const rel = exampleCharacterRelPath(lib);
  const path = normalizePath(rel);
  const already = plugin.app.vault.getAbstractFileByPath(path);
  if (already instanceof TFile) return already;

  const parent = path.split("/").slice(0, -1).join("/");
  await ensureFolder(plugin, parent);
  const body = exampleCharacterBody();
  try {
    return await plugin.app.vault.create(path, body);
  } catch {
    return null;
  }
}

/** Create vault folders recursively (Obsidian createFolder is one level). */
export async function ensureFolder(
  plugin: CharinfoPlugin,
  folderPath: string,
): Promise<void> {
  const full = normalizePath(folderPath);
  if (plugin.app.vault.getAbstractFileByPath(full)) return;
  const parts = full.split("/").filter(Boolean);
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    if (!plugin.app.vault.getAbstractFileByPath(cur)) {
      await plugin.app.vault.createFolder(cur);
    }
  }
}

/**
 * Parent folder for a new character note, matching vault layout:
 * `library/{장르폴더}/{이름}/{이름}.md`
 *
 * Prefer the folder where same-group (and same-genre) siblings already live.
 */
function resolveGroupParentFolder(
  plugin: CharinfoPlugin,
  library: string,
  genre: string,
  group: string,
): string {
  const lib = normalizePath(library);
  const files = plugin.app.vault.getMarkdownFiles();

  const scoreSibling = (file: TFile): number => {
    if (file.path === lib || !file.path.startsWith(`${lib}/`)) return -1;
    const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || String(fm.kind ?? "") !== "character") return -1;
    const g = String(fm.그룹 ?? "").trim();
    const j = String(fm.장르 ?? "").trim();
    let score = 0;
    if (group && g === group) score += 2;
    if (genre && j === genre) score += 1;
    if (!group && !g) score += 1;
    return score;
  };

  let best: TFile | null = null;
  let bestScore = 0;
  for (const file of files) {
    const score = scoreSibling(file);
    if (score > bestScore) {
      bestScore = score;
      best = file;
    }
  }

  if (best && bestScore > 0) {
    const rel = best.path.slice(lib.length + 1);
    const parts = rel.split("/").filter(Boolean);
    if (parts.length >= 3) {
      return normalizePath(`${lib}/${parts.slice(0, -2).join("/")}`);
    }
    return lib;
  }

  if (genre) return normalizePath(`${lib}/${genre}`);
  if (group) return normalizePath(`${lib}/${group}`);
  return lib;
}

export async function createCharacterNote(
  plugin: CharinfoPlugin,
  opts?: { genre?: string; group?: string; library?: string; name?: string },
): Promise<TFile | null> {
  const requestedName = opts?.name?.trim() || null;
  const title =
    requestedName ??
    (await promptCharacterName(plugin.app, {
      title: "새 캐릭터",
      initialName: "",
      submitText: "만들기",
      savingText: "준비 중…",
    }));
  if (!title) return null;
  const titleProblem = characterNameProblem(title);
  if (titleProblem) {
    new Notice(characterNameProblemMessage(titleProblem));
    return null;
  }

  const library = normalizePath(
    (opts?.library ?? plugin.settings.libraryFolder).trim() ||
      "Character Archive",
  );
  if (!plugin.app.vault.getAbstractFileByPath(library)) {
    await plugin.app.vault.createFolder(library);
  }

  const genre = (opts?.genre ?? plugin.settings.activeGenre).trim();
  const group = opts?.group?.trim() ?? "";
  const stamp = `${Date.now()}`;
  // The container is deliberately technical and stable. Renaming a character
  // changes only the note identity; image paths inside this folder stay put.
  const folderName = `캐릭터 ${stamp}`;

  const parent = resolveGroupParentFolder(plugin, library, genre, group);
  await ensureFolder(plugin, parent);
  const destFolder = normalizePath(`${parent}/${folderName}`);
  await ensureFolder(plugin, destFolder);
  const path = normalizePath(`${destFolder}/${title}.md`);

  let source = BUNDLED_CHARACTER_TEMPLATE;
  // Archive (`장르`) override wins over the global template, then the bundle.
  const templatePath = normalizePath(
    plugin.settings.characterTemplateByGenre[genre] ||
      plugin.settings.characterTemplatePath,
  );
  const templateFile = plugin.app.vault.getAbstractFileByPath(templatePath);
  if (templateFile instanceof TFile) {
    source = await plugin.app.vault.read(templateFile);
  }

  const body = fillCharacterTemplate(source, {
    title,
    genre,
    group: group || undefined,
  });

  // The destination group decides which fields this card is born with, so its
  // schema has to exist before the note does (lazy baseline → persisted).
  // A note created against a schema that was rolled back would be healed into
  // the wrong shape, so a failed save means no note at all.
  try {
    await plugin.persistGroupSchema(library, genre, group);
  } catch (error) {
    console.error("[charinfo] 그룹 속성 저장 실패", error);
    new Notice(
      `그룹 속성을 저장하지 못해 카드를 만들지 않았어요: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
  const schema = resolveGroupSchema(plugin.settings, library, genre, group);

  let file: TFile;
  try {
    file = await plugin.app.vault.create(path, body);
  } catch (error) {
    new Notice(
      `캐릭터 노트 생성 실패: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
  plugin.trackCharacterName(file, title);

  try {
    await plugin.app.fileManager.processFrontMatter(file, (fm) => {
      fm.kind = "character";
      fm.이름 = title;
      fm.상태 = plugin.settings.defaultStatusId || "Off";
      if (genre) fm.장르 = genre;
      if (group) fm.그룹 = group;
      else fm.그룹 = "";
      // Every active field is present before reveal, in the same deterministic
      // order the reconciler maintains for existing notes.
      const plan = planNoteProperties(
        fm as Record<string, unknown>,
        schema.fields,
      );
      if (plan && !plan.clean) {
        applyNotePropertyPlan(fm as Record<string, unknown>, plan);
      }
    });
  } catch (error) {
    // The note exists and holds the template body — deleting it would throw the
    // user's starting point away. Keep it, reveal it, and queue a best-effort
    // schema pass. A malformed or non-character template cannot be repaired by
    // the healer, so this promises a *try*, not a fix.
    console.error("[charinfo] 새 카드 속성 쓰기 실패", error);
    plugin.queueSchemaHeal(file.path);
    new Notice(
      `속성을 쓰지 못했어요. 노트는 남겨 두고 복구를 예약했어요 · ${file.basename}`,
    );
  }

  plugin.markGalleriesDirty({ schedule: false });

  let galleryLeaves = plugin.app.workspace.getLeavesOfType(
    VIEW_TYPE_CHARINFO_GALLERY,
  );
  if (galleryLeaves.length === 0) {
    await plugin.activateGalleryView();
    galleryLeaves = plugin.app.workspace.getLeavesOfType(
      VIEW_TYPE_CHARINFO_GALLERY,
    );
  }
  for (const leaf of galleryLeaves) {
    const view = leaf.view;
    if (view instanceof GalleryView) {
      await view.revealNewCard(file.path);
    }
  }

  const defaultStatus =
    plugin.settings.statuses.find(
      (s) => s.id === plugin.settings.defaultStatusId,
    )?.label ?? plugin.settings.defaultStatusId;

  new Notice(
    [
      genre ? `「${genre}」에 캐릭터를 추가했어요` : "캐릭터를 추가했어요",
      group ? `그룹 ${group}` : null,
      `상태 ${defaultStatus || "Off"}`,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  return file;
}
