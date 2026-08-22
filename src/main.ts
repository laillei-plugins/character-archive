import {
  Plugin,
  Platform,
  TFile,
  WorkspaceLeaf,
  Notice,
  normalizePath,
  parseYaml,
} from "obsidian";
import {
  claimLegacyWebShareIfUnambiguous,
  DEFAULT_SETTINGS,
  migrateSettings,
  remapCharacterWebShareState,
  remapGalleryPageState,
  type CharinfoSettings,
} from "./settings";
import { CharacterStore } from "./data/CharacterStore";
import { healCollapsedImageEmbeds, healCharacterCardFields, healNaiPromptEmphasis } from "./data/images";
import {
  MAX_LANE_ATTEMPTS,
  PathWorkLane,
  parseFrontmatterBlock,
  type HealBit,
} from "./data/propertySchema";
import {
  applyNotePropertyPlan,
  collectScanPaths,
  ensureGroupSchema,
  findGroupSchema,
  longestMatchingLibrary,
  normalizeArchiveKey,
  normalizeGroupKey,
  normalizeLibraryKey,
  planNoteProperties,
  resolveGroupSchema,
} from "./data/groupSchema";
import { MediaService } from "./media/MediaService";
import {
  createCharacterNote,
  createGalleryPage,
  copyGalleryPageLink,
  copyTextToClipboard,
  dedupeOverlappingRoots,
  galleryPagePath,
  galleryWikiLink,
  ensureFolder,
  fileHasGalleryFrontmatter,
  isGalleryPage,
  listGalleryLibraryIdentities,
  readGalleryScope,
  registerCharinfoCodeBlock,
  resolveGalleryPageFile,
  resolveOrCreateGalleryPageForLibrary,
  resolveOrMigrateGalleryPage,
} from "./page/galleryPage";
import {
  sweepEmptyFolders,
  sweepOrphanGalleryPages,
} from "./page/orphanCleanup";
import { CharinfoSettingTab } from "./ui/SettingTab";
import { CreateGalleryModal } from "./ui/CreateGalleryModal";
import {
  commandById,
  hiddenCompatCheck,
  OPEN_GALLERY_NAME,
} from "./ui/commandSurface";
import { GalleryView, VIEW_TYPE_CHARINFO_GALLERY } from "./views/GalleryView";
import {
  AutoRevealRestoreError,
  LIBRARY_FOLDER_CHEVRON_SELECTOR,
  classifyLibraryFolderClick,
  decideGalleryOpenLeaf,
  decideRibbonOpen,
  pickGalleryLeafForLibrary,
  shouldRecordLastOpenedGallery,
  withAutoRevealSuppressed,
  type ExplorerViewLike,
} from "./ui/libraryFolderOpen";
import {
  basenameWithoutMarkdown,
  characterNameProblem,
  characterNameProblemMessage,
  hasPortablePathCollision,
  normalizeCharacterName,
  notePathForName,
  portablePathIdentity,
} from "./data/characterName";
import {
  UPDATE_NOTES_MARKDOWN,
  UPDATE_NOTES_VERSION,
  shouldOpenUpdateNotes,
  updateNotesPath,
} from "./data/updateNotes";

/** What one schema pass did to a note. Console telemetry only. */
type SchemaOutcome = "patched" | "clean" | "malformed";

interface SchemaTally {
  scanned: number;
  patched: number;
  malformed: number;
  failed: number;
}

export interface CharacterNameCommitResult {
  ok: boolean;
  name: string;
  path: string;
  error?: string;
}

export default class CharinfoPlugin extends Plugin {
  settings: CharinfoSettings = DEFAULT_SETTINGS;
  media!: MediaService;
  characters!: CharacterStore;
  /** Vault changed while gallery was idle — refresh when it becomes active. */
  private galleryNeedsRefresh = false;
  private galleryRefreshTimer: number | null = null;
  /**
   * Bumped by every dirty mark. A refresh acknowledges the version it started
   * from, so a slow older pass cannot clear a newer edit's dirty state.
   */
  private galleryDirtyVersion = 0;
  /** Paths marked dirty since the last acknowledgement (diagnostic scope). */
  private dirtyGalleryPaths = new Set<string>();
  /** Per-path debounce for note-body edits (peek patch, not full render). */
  private noteChangeTimers = new Map<string, number>();
  /**
   * One lane for every writer that touches a note (schema, `|0` embeds, NAI
   * prompts, card fields). Two whole-file read/modify cycles on one path can
   * never overwrite each other; different paths still run concurrently.
   */
  private healLane = new PathWorkLane((path, bits) => this.runHeal(path, bits));
  private healTimers = new Map<string, number>();
  private pendingHealBits = new Map<string, Set<HealBit>>();
  /** Notice deduplication: one failure message per path until it succeeds. */
  private healFailureNoticed = new Set<string>();
  /**
   * Two registries, on purpose.
   *
   * `identityRoots` is every library a gallery claims, undeduped: it decides
   * *which* schema scope a note belongs to (`longestMatchingLibrary`), so a
   * nested library must stay visible.
   *
   * `schemaRoots` is the same list with overlaps collapsed: it decides which
   * files the reconciler owns and which folders one scan pass walks.
   */
  private identityRoots: string[] = [];
  private schemaRoots: string[] = [];
  /** Collapsed roots already walked once. */
  private scannedScanRoots = new Set<string>();
  /** Identities already reconciled — a nested one appearing later gets its own pass. */
  private scannedIdentityRoots = new Set<string>();
  private schemaTally: SchemaTally | null = null;
  private schemaScanChain: Promise<void> = Promise.resolve();
  private knownLibraryFolder = "";
  private unloaded = false;
  /**
   * GalleryView still toggles this around local frontmatter writes.
   * Ignored by `markGalleriesDirty` — coalesced via dirty-version (Sol freeze).
   * Kept so peek/card code does not need a GalleryView rewrite (NUL bytes).
   */
  suppressGalleryRefresh = false;
  /** One-shot: next open of this path may load as Markdown (edit entry note). */
  private allowMarkdownOnce = new Set<string>();
  private openFileHookInstalled = false;
  /** Last observed canonical name, keyed by the stable TFile identity. */
  private characterNameBaseline = new WeakMap<TFile, string>();
  /** One name/filename transaction at a time for each note. */
  private characterNameLane = new WeakMap<TFile, Promise<unknown>>();
  /** Final path for a plugin-owned rename; intermediate case hops are ignored. */
  private internalCharacterRename = new WeakMap<TFile, string>();
  private characterRenameTempId = 0;
  /** Distinguishes an update from a first install before defaults are saved. */
  private hadStoredSettings = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.knownLibraryFolder = this.defaultLibraryRoot();
    // Coordinator + events only. The archive scan waits for layout ready.
    this.refreshSchemaRoots();
    this.media = new MediaService(this.app, () => this.settings);
    this.characters = new CharacterStore(this.app, () => this.settings.libraryFolder);

    this.registerView(
      VIEW_TYPE_CHARINFO_GALLERY,
      (leaf) => new GalleryView(leaf, this),
    );

    // Excalidraw-style: claim the entry note before Markdown opens.
    this.installGalleryOpenFileHook();

    registerCharinfoCodeBlock(this);

    // Fallback if something still opens the entry as Markdown.
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file) return;
        void this.reclaimOpenedGalleryNote(file);
      }),
    );

    // File-tree: click library folder title → open gallery (no note click needed).
    this.registerLibraryFolderClick();

    // After plugin/app reload: if a gallery note tab fell back to Markdown, reclaim it.
    // Does not open a new tab — only restores tabs that already show a gallery page.
    this.app.workspace.onLayoutReady(() => {
      void this.claimLegacyWebShareAfterMetadata();
      this.seedCharacterNameBaselines();
      void (async () => {
        await this.reclaimGalleryLeaves();
        await this.openUpdateNotesIfNeeded();
      })().catch((error) => {
        console.error("[charinfo] 시작 작업 실패", error);
      });
      // LOCK (needs a vault; not covered by tests/property-schema.test.ts):
      // one non-blocking sequential archive scan per discovered root, with
      // zero gallery leaves open. Roots come from the metadata cache, which is
      // only trustworthy now — recompute before scanning.
      this.refreshSchemaRoots({ scanNew: true });
    });

    this.addRibbonIcon("layout-grid", OPEN_GALLERY_NAME, () => {
      this.openLastUsedOrDefaultGallery();
    });

    const openGallery = commandById("open-gallery")!;
    this.addCommand({
      id: openGallery.id,
      name: openGallery.name,
      callback: () => {
        this.openLastUsedOrDefaultGallery();
      },
    });

    const newGallery = commandById("new-gallery-page")!;
    this.addCommand({
      id: newGallery.id,
      name: newGallery.name,
      callback: () => {
        new CreateGalleryModal(this.app, this).open();
      },
    });

    const defaultOpen = commandById("new-gallery-page-default")!;
    this.addCommand({
      id: defaultOpen.id,
      name: defaultOpen.name,
      checkCallback: (checking) => {
        if (!hiddenCompatCheck(checking)) return false;
        void createGalleryPage(this).catch((error) => {
          console.error("[charinfo] 기본 갤러리 열기 실패", error);
          new Notice("갤러리를 열지 못했어요.");
        });
        return true;
      },
    });

    this.addCommand({
      id: "sweep-empty-folders",
      name: "남은 빈 폴더 치우기",
      callback: () => {
        void sweepEmptyFolders(this);
      },
    });

    this.addCommand({
      id: "sweep-orphan-gallery-pages",
      name: "남은 갤러리 창 치우기",
      callback: () => {
        void sweepOrphanGalleryPages(this);
      },
    });

    this.addCommand({
      id: "new-character",
      name: "캐릭터 노트 만들기",
      callback: () => {
        // Focused gallery decides where the card lands; no gallery open → globals.
        const view = this.getFocusedGalleryView();
        void createCharacterNote(
          this,
          view
            ? { library: view.pageLibrary(), genre: view.activeArchive() }
            : undefined,
        );
      },
    });

    this.addCommand({
      id: "toggle-edit-mode",
      name: "갤러리 편집 모드 전환",
      callback: () => {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHARINFO_GALLERY);
        for (const leaf of leaves) {
          const view = leaf.view;
          if (view instanceof GalleryView) {
            view.setEditMode(!view.editMode);
          }
        }
      },
    });

    this.addCommand({
      id: "refresh-gallery",
      name: "갤러리 새로고침",
      callback: () => {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHARINFO_GALLERY);
        for (const leaf of leaves) {
          const view = leaf.view;
          if (view instanceof GalleryView) {
            void view.refresh();
          }
        }
      },
    });

    const healImages = commandById("heal-library-image-links")!;
    this.addCommand({
      id: healImages.id,
      name: healImages.name,
      callback: () => {
        void (async () => {
          const { rewriteLibraryPathPrefix } = await import("./data/images");
          const to = normalizePath(
            this.settings.libraryFolder.trim() || "Character Archive",
          );
          // Common rename we already did + any leftover Korean path.
          const n = await rewriteLibraryPathPrefix(
            this.app,
            to,
            "캐릭터 프롬프트",
            to,
          );
          new Notice(
            n > 0
              ? `이미지 다시 연결됨 · 노트 ${n}개\n(옛 폴더 경로 → ${to})`
              : "고칠 깨진 경로가 없어요.\n이미 연결됐거나, 예전에 쓰던 폴더명이 남아 있지 않아요.",
          );
          if (n > 0) this.refreshOpenGalleries();
        })().catch((error) => {
          console.error("[charinfo] 예전 폴더 이미지 다시 연결 실패", error);
          new Notice("이미지를 다시 연결하지 못했어요.");
        });
      },
    });

    this.addCommand({
      id: "share-gallery-web",
      name: "갤러리 공유",
      callback: () => {
        const view = this.getFocusedGalleryView();
        if (!view) {
          new Notice("갤러리를 먼저 여세요.");
          return;
        }
        view.openWebShare();
      },
    });

    this.addCommand({
      id: "copy-gallery-page-link",
      name: "갤러리 앱 링크 복사",
      callback: () => {
        void (async () => {
          const file = await resolveGalleryPageFile(this);
          if (!file) {
            new Notice("갤러리 노트를 찾지 못했어요.");
            return;
          }
          await copyGalleryPageLink(this.app, file);
        })();
      },
    });

    this.addCommand({
      id: "copy-gallery-wikilink",
      name: "갤러리 노트 링크 복사",
      callback: () => {
        void (async () => {
          const file = await resolveGalleryPageFile(this);
          if (!file) {
            new Notice("갤러리 노트를 찾지 못했어요.");
            return;
          }
          const ok = await copyTextToClipboard(galleryWikiLink(file));
          new Notice(ok ? "노트 링크를 복사했어요" : "복사에 실패했어요");
        })();
      },
    });

    this.addSettingTab(new CharinfoSettingTab(this.app, this));

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        void this.observeCharacterNameProperty(file);
        // A gallery note may have just repointed `library` — new root, new scan.
        if (isGalleryPage(file, this)) this.refreshSchemaRoots({ scanNew: true });
        if (!this.fileTouchesAnyOpenGallery(file.path)) return;
        this.scheduleNoteChange(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        const newPath = file.path;
        const internalTarget = this.internalCharacterRename.get(file);
        this.remapCharacterPath(
          oldPath,
          newPath,
          file,
          !internalTarget || newPath === internalTarget,
        );
        void this.commitSettings((settings) => {
          remapGalleryPageState(settings, oldPath, newPath);
          remapCharacterWebShareState(settings, oldPath, newPath);
        }).catch((error) => {
          console.error("[charinfo] 이름 변경 경로 저장 실패", error);
        });
        this.observeCharacterFileRename(file, oldPath, newPath);
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile)) return;
        // LOCK (needs a vault): schema reconciliation is never gated on an open
        // gallery — any Markdown file under a discovered root enqueues it.
        if (this.isUnderSchemaRoot(file)) this.scheduleHeal(file.path, "schema");
        if (!this.fileTouchesAnyOpenGallery(file.path)) return;
        // Same per-path lane as the schema pass, so the two whole-file
        // read/modify cycles cannot overwrite each other.
        this.scheduleHeal(file.path, "content");
        // Body-only edits patch the open peek; only a card/frontmatter change
        // escalates to a full gallery render.
        this.scheduleNoteChange(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (!(file instanceof TFile)) return;
        if (!this.fileTouchesAnyOpenGallery(file.path)) return;
        // A new sibling image can affect legacy cover display, but it is not a
        // selectable cover until the character note embeds it.
        if (/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.path)) {
          const dir = file.path.includes("/")
            ? file.path.slice(0, file.path.lastIndexOf("/"))
            : "";
          if (!dir) return;
          const notes = this.app.vault.getMarkdownFiles().filter((note) => {
            const noteDir = note.path.includes("/")
              ? note.path.slice(0, note.path.lastIndexOf("/"))
              : "";
            if (noteDir !== dir) return false;
            return this.app.metadataCache.getFileCache(note)?.frontmatter?.kind === "character";
          });
          if (notes.length === 1) this.scheduleHeal(notes[0]!.path, "content");
        }
        this.markGalleriesDirty();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.refreshOpenGalleriesIfDirty();
        const view = this.app.workspace.activeLeaf?.view;
        if (view instanceof GalleryView && view.file) {
          this.recordLastOpenedGallery(view.file.path);
        }
      }),
    );

    // Live preview/reading: `|0` still paints 0-width until the file heals.
    this.registerMarkdownPostProcessor((el) => {
      el.querySelectorAll("img").forEach((img) => {
        if (!(img instanceof HTMLImageElement)) return;
        const w = img.getAttribute("width");
        if (w === "0" || img.width === 0) {
          img.removeAttribute("width");
          img.setCssStyles({ width: "", maxWidth: "100%" });
        }
      });
      el.querySelectorAll(".internal-embed, .image-embed").forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.style.width === "0px" || node.style.width === "0") {
          node.setCssStyles({ width: "", maxWidth: "100%" });
        }
      });
    });
  }

  /**
   * One note changed on disk. Coalesce per path so a burst of writes commits
   * once, then let each gallery decide the grain (peek patch vs full render).
   */
  private scheduleNoteChange(path: string): void {
    const prev = this.noteChangeTimers.get(path);
    if (prev != null) window.clearTimeout(prev);
    const timer = window.setTimeout(() => {
      this.noteChangeTimers.delete(path);
      void this.routeNoteChange(path);
    }, 200);
    this.noteChangeTimers.set(path, timer);
  }

  private async routeNoteChange(path: string): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(
      VIEW_TYPE_CHARINFO_GALLERY,
    )) {
      const view = leaf.view;
      if (!(view instanceof GalleryView)) continue;
      const root = normalizePath(view.pageLibrary());
      if (root && path !== root && !path.startsWith(`${root}/`)) continue;
      await view.handleNoteChanged(path);
    }
  }

  /**
   * Debounce then hand the path to the lane. Obsidian may write `|0` while the
   * resize handle is still moving, and a self-generated write comes back as one
   * more modify — both coalesce here instead of queueing runs.
   */
  private scheduleHeal(path: string, bit: HealBit): void {
    if (this.unloaded) return;
    const bits = this.pendingHealBits.get(path) ?? new Set<HealBit>();
    bits.add(bit);
    this.pendingHealBits.set(path, bits);

    const prev = this.healTimers.get(path);
    if (prev != null) window.clearTimeout(prev);
    const timer = window.setTimeout(() => {
      this.healTimers.delete(path);
      const queued = this.pendingHealBits.get(path);
      this.pendingHealBits.delete(path);
      if (!queued || this.unloaded) return;
      for (const queuedBit of queued) this.enqueueHeal(path, queuedBit);
    }, 450);
    this.healTimers.set(path, timer);
  }

  /**
   * Ask the one heal lane for a schema pass on this path. Public entry for
   * writers outside the plugin (a new card whose frontmatter write failed);
   * there is no second lane, so a concurrent edit on the same path still
   * serializes behind this.
   */
  queueSchemaHeal(path: string): void {
    this.enqueueHeal(path, "schema");
  }

  private enqueueHeal(path: string, bit: HealBit): void {
    if (this.unloaded) return;
    this.healLane.enqueue(path, bit).catch((error) => {
      if (this.schemaTally) this.schemaTally.failed += 1;
      this.reportHealFailure(path, error, MAX_LANE_ATTEMPTS);
    });
  }

  /** One lane pass for a path: schema keys first, then the body/media healers. */
  private async runHeal(path: string, bits: HealBit[]): Promise<void> {
    if (this.unloaded) return;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== "md") return;

    let malformed = false;
    if (bits.includes("schema")) {
      malformed = (await this.applySchemaPatch(file)) === "malformed";
      if (malformed) {
        // Not transient — preserve the file, say so once, and retry only on the
        // next modification or archive scan.
        this.reportHealFailure(path, new Error("frontmatter YAML 파싱 실패"), 1);
      }
    }
    if (bits.includes("content")) {
      await this.healCharacterNote(file);
    }
    // A clean pass reopens the Notice for this path.
    if (!malformed) this.healFailureNoticed.delete(path);
  }

  /**
   * Reconcile this note with its exact group schema: restore missing active
   * keys, purge only explicitly removed keys, and keep storage metadata last.
   * Preflight first: a clean fixpoint never calls `processFrontMatter`.
   *
   * The schema is resolved *here*, at run time — a note queued before a field
   * was removed must not restore that now-inactive key.
   */
  private async applySchemaPatch(file: TFile): Promise<SchemaOutcome> {
    if (this.schemaTally) this.schemaTally.scanned += 1;
    // Read the file, not the cache: right after a write the cache may still
    // hold the previous frontmatter.
    const text = await this.app.vault.cachedRead(file);
    const parsed = parseFrontmatterBlock(text, (raw) => parseYaml(raw));
    if (!parsed.ok) {
      if (parsed.reason !== "malformed") return "clean";
      if (this.schemaTally) this.schemaTally.malformed += 1;
      return "malformed";
    }

    const scope = this.characterScope(file.path, parsed.fm);
    // No stored schema yet → the migrated built-in baseline, i.e. today's
    // restore-all-nine for existing vaults.
    const schema = resolveGroupSchema(
      this.settings,
      scope.library,
      scope.archive,
      scope.group,
    );
    const plan = planNoteProperties(parsed.fm, schema.fields);
    if (!plan || plan.clean) return "clean";

    let changed = false;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      // Resolve scope and plan again under the write lock. A concurrent group
      // edit must never apply the old group's deletion set to this note.
      const currentScope = this.characterScope(
        file.path,
        fm as Record<string, unknown>,
      );
      const currentSchema = resolveGroupSchema(
        this.settings,
        currentScope.library,
        currentScope.archive,
        currentScope.group,
      );
      const currentPlan = planNoteProperties(
        fm as Record<string, unknown>,
        currentSchema.fields,
      );
      if (!currentPlan || currentPlan.clean) return;
      applyNotePropertyPlan(fm as Record<string, unknown>, currentPlan);
      changed = true;
    });
    if (!changed) return "clean";
    if (this.schemaTally) this.schemaTally.patched += 1;
    return "patched";
  }

  /**
   * Which schema a character note belongs to: the longest **identity** library
   * that contains it, plus its own `장르` / `그룹`. Identities are read undeduped
   * here on purpose — a note under a nested gallery's library belongs to that
   * gallery, not to the outer scan root. Empty `장르` reads as 미분류, the same
   * identity CharacterStore gives the card.
   */
  private characterScope(
    path: string,
    fm: Record<string, unknown>,
  ): { library: string; archive: string; group: string } {
    return {
      library: longestMatchingLibrary(
        path,
        this.identityRoots,
        this.defaultLibraryRoot(),
      ),
      archive: normalizeArchiveKey(this.frontmatterScopeText(fm.장르)),
      group: normalizeGroupKey(this.frontmatterScopeText(fm.그룹)),
    };
  }

  /** Match CharacterStore's scalar/list coercion before resolving a schema. */
  private frontmatterScopeText(value: unknown): string {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (Array.isArray(value)) {
      return value
        .map((item) => this.frontmatterScopeText(item))
        .filter(Boolean)
        .join(", ");
    }
    return String(value);
  }

  /**
   * Persist one group's schema (the lazy built-in baseline) before anything
   * writes notes against it. No-op once the scope is stored.
   */
  async persistGroupSchema(
    library: string,
    archive: string,
    group: string,
  ): Promise<void> {
    if (findGroupSchema(this.settings, library, archive, group)) return;
    await this.commitSettings((settings) => {
      ensureGroupSchema(settings, library, archive, group);
    });
  }

  /**
   * After a **successful** schema save: reconcile only that group's members.
   * A failed settings save must never reach here — the notes would be healed
   * against a schema that was rolled back.
   */
  reconcileGroupMembers(library: string, archive: string, group: string): void {
    if (this.unloaded) return;
    const root = normalizeLibraryKey(library);
    const wantArchive = normalizeArchiveKey(archive);
    const wantGroup = normalizeGroupKey(group);
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (root && file.path !== root && !file.path.startsWith(`${root}/`)) {
        continue;
      }
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || String(fm.kind ?? "") !== "character") continue;
      if (normalizeArchiveKey(fm.장르) !== wantArchive) continue;
      if (normalizeGroupKey(fm.그룹) !== wantGroup) continue;
      this.enqueueHeal(file.path, "schema");
    }
  }

  /** Undo `|0` embeds + migrate 언급→상태 + fill empty cover + restore NAI `::` in prompts. */
  private async healCharacterNote(file: TFile): Promise<void> {
    if (file.extension !== "md") return;
    const cache = this.app.metadataCache.getFileCache(file);
    const kind = cache?.frontmatter?.kind;
    // Still try heal when cache lags right after create.
    if (kind != null && kind !== "character") return;
    await healCollapsedImageEmbeds(this.app, file);
    await healNaiPromptEmphasis(this.app, file);
    await healCharacterCardFields(this.app, file);
  }

  /** Default library folder, normalized. */
  private defaultLibraryRoot(): string {
    return normalizePath(
      this.settings.libraryFolder.trim() || "Character Archive",
    );
  }

  /**
   * Rebuild both root registries: default library + every `library` a
   * `charinfo: gallery` note points at (identities), then the same list with
   * overlaps collapsed (scan roots). Optionally scan what is new.
   *
   * A newly added *nested* identity gets its own pass even when its outer scan
   * root was already walked: collapsing would leave the fresh list empty, and
   * the notes already sitting under `Root/Sub` would never be reconciled
   * against their new scope.
   */
  private refreshSchemaRoots(opts?: { scanNew?: boolean }): void {
    if (this.unloaded) return;
    this.identityRoots = listGalleryLibraryIdentities(this);
    this.schemaRoots = dedupeOverlappingRoots(this.identityRoots);
    if (!opts?.scanNew) return;
    const fresh: string[] = [];
    for (const root of this.schemaRoots) {
      if (this.scannedScanRoots.has(root)) continue;
      this.scannedScanRoots.add(root);
      fresh.push(root);
    }
    for (const identity of this.identityRoots) {
      if (this.scannedIdentityRoots.has(identity)) continue;
      this.scannedIdentityRoots.add(identity);
      // Already inside a root this same pass is about to walk.
      if (
        fresh.some(
          (root) => identity === root || identity.startsWith(`${root}/`),
        )
      ) {
        continue;
      }
      fresh.push(identity);
    }
    if (fresh.length) this.queueSchemaScan(fresh);
  }

  /** One archive scan at a time — a new root waits, it is never dropped. */
  private queueSchemaScan(roots: string[]): void {
    this.schemaScanChain = this.schemaScanChain
      .then(() => this.scanSchemaRoots(roots))
      .catch((error) => {
        console.error("[charinfo] 속성 스캔 중단", error);
      });
  }

  private isUnderSchemaRoot(file: TFile): boolean {
    if (file.extension !== "md") return false;
    return this.schemaRoots.some(
      (root) => file.path === root || file.path.startsWith(`${root}/`),
    );
  }

  /**
   * Sequential archive scan — one note at a time through the same lane, so a
   * concurrent edit on a scanned path can never race the scan's own write.
   * Nothing is persisted: this is cheap enough to redo every load.
   *
   * The tally is console diagnostics; edits made while the scan runs count
   * toward it too, which is fine — nothing reads these numbers back.
   */
  private async scanSchemaRoots(roots: string[]): Promise<void> {
    if (this.unloaded || roots.length === 0) return;

    // Nested roots can match the same file twice — unique the paths first so
    // one scan never hands the lane the same note two times.
    const paths = collectScanPaths(
      this.app.vault.getMarkdownFiles().map((file) => file.path),
      roots,
    );
    const tally: SchemaTally = {
      scanned: 0,
      patched: 0,
      malformed: 0,
      failed: 0,
    };
    this.schemaTally = tally;
    try {
      for (const path of paths) {
        if (this.unloaded) return;
        await this.healLane.enqueue(path, "schema").catch((error) => {
          tally.failed += 1;
          this.reportHealFailure(path, error, MAX_LANE_ATTEMPTS);
        });
      }
    } finally {
      this.schemaTally = null;
    }
    console.info(
      `[charinfo] 속성 스캔 · 폴더 ${roots.join(", ")} · 확인 ${tally.scanned} · 보정 ${tally.patched} · YAML 손상 ${tally.malformed} · 실패 ${tally.failed}`,
    );
  }

  /** One Notice per path until that path succeeds; console keeps the detail. */
  private reportHealFailure(
    path: string,
    error: unknown,
    attempts: number,
  ): void {
    console.error(
      `[charinfo] 속성 복구 실패 · ${path} · 시도 ${attempts}회`,
      error,
    );
    if (this.unloaded) return;
    if (this.healFailureNoticed.has(path)) return;
    this.healFailureNoticed.add(path);
    const basename = (path.split("/").pop() ?? path).replace(/\.md$/i, "");
    new Notice(`속성 복구 실패 · ${basename}`);
  }

  onunload(): void {
    // Cancel queued work first: a stale timer after reload would fire a Notice
    // (and a write) for a plugin instance that no longer owns the vault.
    this.unloaded = true;
    for (const timer of this.noteChangeTimers.values()) {
      window.clearTimeout(timer);
    }
    this.noteChangeTimers.clear();
    for (const timer of this.healTimers.values()) window.clearTimeout(timer);
    this.healTimers.clear();
    this.pendingHealBits.clear();
    this.cancelScheduledGalleryRefresh();
    // In-flight vault operations may finish; nothing new starts.
    this.healLane.dispose();
    // Do not detach gallery leaves — that wipes the tab on every plugin reload
    // (deploy). Obsidian demotes unknown views; onLayoutReady reclaim restores them.
  }

  /**
   * Turn Markdown (or empty) leaves that point at a gallery note back into
   * GalleryView. Safe after deploy reload; no-op when no gallery tab is open.
   */
  private async reclaimGalleryLeaves(): Promise<void> {
    const tasks: Promise<void>[] = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (this.isSidebarLeaf(leaf)) return;
      const state = leaf.getViewState();
      if (state.type === VIEW_TYPE_CHARINFO_GALLERY) return;
      const filePath =
        state.state && typeof (state.state as { file?: unknown }).file === "string"
          ? (state.state as { file: string }).file
          : "";
      if (!filePath) return;
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile) || !isGalleryPage(file, this)) return;
      if (this.allowMarkdownOnce.has(file.path)) return;
      tasks.push(
        leaf.setViewState({
          type: VIEW_TYPE_CHARINFO_GALLERY,
          state: { file: file.path },
          active: state.active,
        }),
      );
    });
    if (tasks.length) await Promise.all(tasks);
  }

  /**
   * Intercept leaf.openFile so gallery entry notes never flash Markdown
   * (same idea as Excalidraw claiming its own format).
   */
  private installGalleryOpenFileHook(): void {
    if (this.openFileHookInstalled) return;
    this.openFileHookInstalled = true;

    const proto = WorkspaceLeaf.prototype;
    const original = proto.openFile;
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- leaf hook needs the plugin instance
    const plugin = this;

    proto.openFile = async function (
      this: WorkspaceLeaf,
      file,
      openState,
    ) {
      try {
        if (
          file instanceof TFile &&
          !plugin.allowMarkdownOnce.has(file.path) &&
          !plugin.isSidebarLeaf(this) &&
          (await fileHasGalleryFrontmatter(plugin, file))
        ) {
          await this.setViewState(
            {
              type: VIEW_TYPE_CHARINFO_GALLERY,
              state: { file: file.path },
              active: openState?.active ?? true,
            },
            openState?.eState,
          );
          return;
        }
        if (file instanceof TFile) {
          plugin.allowMarkdownOnce.delete(file.path);
        }
      } catch (error) {
        console.error("Charinfo openFile hook failed; falling back", error);
      }
      return original.call(this, file, openState);
    };

    this.register(() => {
      proto.openFile = original;
      plugin.openFileHookInstalled = false;
    });
  }

  /** Open the gallery entry note as normal Markdown once (for rare edits). */
  async openGalleryPageAsMarkdown(file?: TFile | null): Promise<void> {
    const target = file ?? (await resolveGalleryPageFile(this));
    if (!target) {
      new Notice("갤러리 노트를 찾지 못했어요.");
      return;
    }
    this.allowMarkdownOnce.add(target.path);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({
      type: "markdown",
      state: { file: target.path },
      active: true,
    });
    this.app.workspace.revealLeaf(leaf);
  }

  /**
   * Clicking the library folder title opens that library's gallery only.
   * Chevron stays native expand. File-explorer auto-reveal is suppressed
   * so the bound entry note does not expand the folder again.
   */
  private registerLibraryFolderClick(): void {
    this.registerDomEvent(
      document,
      "click",
      (event: MouseEvent) => {
        if (event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
          return;
        }
        const target = event.target;
        if (!(target instanceof Element)) return;
        const title = target.closest(".nav-folder-title");
        const folderPath =
          title instanceof HTMLElement ? title.getAttribute("data-path") : null;
        const clicked = folderPath ? normalizePath(folderPath) : null;
        const kind = classifyLibraryFolderClick({
          isChevron: Boolean(target.closest(LIBRARY_FOLDER_CHEVRON_SELECTOR)),
          folderPath: clicked,
          libraryPaths: listGalleryLibraryIdentities(this),
        });
        if (kind !== "title" || !clicked) return;

        event.preventDefault();
        event.stopPropagation();
        void this.openLibraryFolderGallery(clicked).catch((error: unknown) => {
          console.error(error);
          if (error instanceof AutoRevealRestoreError) {
            new Notice("폴더 자동 열기 설정을 되돌리지 못했어요.");
            return;
          }
          new Notice("보관함 갤러리를 열지 못했어요.");
        });
      },
      true,
    );
  }

  /** Title-click path: matching gallery or activate, without expanding the folder. */
  private async openLibraryFolderGallery(lib: string): Promise<void> {
    const explorers: ExplorerViewLike[] = [];
    for (const leaf of this.app.workspace.getLeavesOfType("file-explorer")) {
      const view = leaf.view;
      if (
        view &&
        typeof view.getState === "function" &&
        typeof view.setState === "function"
      ) {
        explorers.push(view);
      }
    }

    await withAutoRevealSuppressed(explorers, async () => {
      const open = pickGalleryLeafForLibrary(
        this.app.workspace.getLeavesOfType(VIEW_TYPE_CHARINFO_GALLERY),
        lib,
        (leaf) =>
          leaf.view instanceof GalleryView ? leaf.view.pageLibrary() : null,
      );
      if (open) {
        await this.revealGalleryLeaf(open);
        return;
      }
      const file = await resolveOrCreateGalleryPageForLibrary(this, lib);
      if (!file) return;
      await this.activateGalleryView({ replaceActive: true, file });
    });
  }

  private async reclaimOpenedGalleryNote(file: TFile): Promise<void> {
    if (!(await fileHasGalleryFrontmatter(this, file))) return;
    if (this.allowMarkdownOnce.has(file.path)) {
      this.allowMarkdownOnce.delete(file.path);
      return;
    }
    const leaf = this.app.workspace.getMostRecentLeaf();
    if (!leaf || this.isSidebarLeaf(leaf)) return;
    if (
      leaf.view instanceof GalleryView &&
      leaf.view.file?.path === file.path
    ) {
      return;
    }
    if (leaf.view.getViewType() === VIEW_TYPE_CHARINFO_GALLERY) return;
    await this.activateGalleryView({ replaceActive: true, file });
  }

  /** Bring gallery leaf to front; on mobile, dismiss the Files drawer. */
  private async revealGalleryLeaf(leaf: WorkspaceLeaf): Promise<void> {
    await this.app.workspace.revealLeaf(leaf);
    if (Platform.isMobile) {
      this.app.workspace.leftSplit.collapse();
    }
  }

  /** True if path is under any open gallery's library (or default library). */
  private fileTouchesAnyOpenGallery(path: string): boolean {
    const roots = new Set<string>();
    roots.add(normalizePath(this.settings.libraryFolder));
    for (const leaf of this.app.workspace.getLeavesOfType(
      VIEW_TYPE_CHARINFO_GALLERY,
    )) {
      const view = leaf.view;
      if (view instanceof GalleryView) {
        roots.add(normalizePath(view.pageLibrary()));
      }
    }
    for (const root of roots) {
      if (!root) continue;
      if (path === root || path.startsWith(`${root}/`)) return true;
    }
    return false;
  }

  refreshOpenGalleries(): void {
    this.refreshGalleryLeaves({ activeOnly: false });
  }

  /** Prefer idle refresh — avoid re-rendering gallery on every note keystroke. */
  markGalleriesDirty(opts?: { schedule?: boolean; path?: string }): void {
    // No global suppression flag: with per-path healing running concurrently a
    // boolean would drop another path's edit. The dirty version + per-path
    // debounce already coalesce refreshes.
    this.galleryNeedsRefresh = true;
    this.galleryDirtyVersion += 1;
    if (opts?.path) this.dirtyGalleryPaths.add(opts.path);
    const schedule = opts?.schedule !== false;
    // Refresh any open gallery tab in the background so cards catch up
    // while the user edits a character note in another leaf.
    if (schedule && this.hasOpenGalleryLeaf()) {
      this.scheduleGalleryRefresh();
    } else {
      this.cancelScheduledGalleryRefresh();
    }
  }

  /** Token a refresh must acknowledge with (read before it starts reading). */
  galleryRefreshVersion(): number {
    return this.galleryDirtyVersion;
  }

  /**
   * Successful load/refresh consumed the pending dirty bit — but only if no
   * newer edit arrived while it ran. Without the version an older pass could
   * clear the flag and cancel the newer edit's scheduled refresh.
   */
  acknowledgeGalleryRefresh(version?: number): void {
    if (version != null && version !== this.galleryDirtyVersion) return;
    this.galleryNeedsRefresh = false;
    this.dirtyGalleryPaths.clear();
    this.cancelScheduledGalleryRefresh();
  }

  private refreshOpenGalleriesIfDirty(): void {
    if (!this.galleryNeedsRefresh) return;
    if (!this.hasOpenGalleryLeaf()) return;
    // Prefer active gallery; if none active, refresh all open ones.
    if (this.isAnyGalleryLeafActive()) {
      this.refreshGalleryLeaves({ activeOnly: true });
    } else {
      this.refreshGalleryLeaves({ activeOnly: false });
    }
  }

  private refreshGalleryLeaves(opts: { activeOnly: boolean }): void {
    this.galleryNeedsRefresh = false;
    this.cancelScheduledGalleryRefresh();
    const active = this.app.workspace.activeLeaf;
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHARINFO_GALLERY);
    for (const leaf of leaves) {
      if (opts.activeOnly && leaf !== active) continue;
      const view = leaf.view;
      if (view instanceof GalleryView) {
        void view.refresh();
      }
    }
  }

  private scheduleGalleryRefresh(): void {
    this.cancelScheduledGalleryRefresh();
    this.galleryRefreshTimer = window.setTimeout(() => {
      this.galleryRefreshTimer = null;
      this.refreshOpenGalleriesIfDirty();
    }, 280);
  }

  private cancelScheduledGalleryRefresh(): void {
    if (this.galleryRefreshTimer == null) return;
    window.clearTimeout(this.galleryRefreshTimer);
    this.galleryRefreshTimer = null;
  }

  /**
   * The gallery a command should act on: the one the user is looking at, else
   * the first open gallery, else none. Commands must never guess "first leaf"
   * while another gallery is focused — share credentials and new-card scope
   * both hang off this choice.
   */
  getFocusedGalleryView(): GalleryView | null {
    const active = this.app.workspace.getActiveViewOfType(GalleryView);
    if (active) return active;
    for (const leaf of this.app.workspace.getLeavesOfType(
      VIEW_TYPE_CHARINFO_GALLERY,
    )) {
      const view = leaf.view;
      if (view instanceof GalleryView) return view;
    }
    return null;
  }

  private isAnyGalleryLeafActive(): boolean {
    const active = this.app.workspace.activeLeaf;
    if (!active) return false;
    return active.view instanceof GalleryView;
  }

  private hasOpenGalleryLeaf(): boolean {
    return (
      this.app.workspace.getLeavesOfType(VIEW_TYPE_CHARINFO_GALLERY).length > 0
    );
  }

  /** Creation establishes a trustworthy baseline before cache events arrive. */
  trackCharacterName(file: TFile, name: string): void {
    this.characterNameBaseline.set(file, normalizeCharacterName(name));
  }

  /**
   * Gallery title edit → filename first, then the canonical property.
   * The filename is the durable authority: a failed property write never moves
   * a successfully renamed note back through another link-changing operation.
   */
  async renameCharacterFromGallery(
    file: TFile,
    rawName: string,
    expectedName: string,
  ): Promise<CharacterNameCommitResult> {
    const name = normalizeCharacterName(rawName);
    const problem = characterNameProblem(name);
    if (problem) {
      return {
        ok: false,
        name: expectedName,
        path: file.path,
        error: characterNameProblemMessage(problem),
      };
    }

    return this.enqueueCharacterNameWork(file, async () => {
      if (this.unloaded) {
        return { ok: false, name: expectedName, path: file.path, error: "플러그인이 닫혔어요." };
      }
      const observed = await this.readCharacterName(file);
      if (!observed || observed.name !== normalizeCharacterName(expectedName)) {
        return {
          ok: false,
          name: observed?.name ?? file.basename,
          path: file.path,
          error: "이름이 다른 곳에서 바뀌었어요. 다시 열고 시도해 주세요.",
        };
      }

      const targetPath = normalizePath(notePathForName(file.path, name));
      if (this.characterNameCollision(file.path, targetPath)) {
        return {
          ok: false,
          name: observed.name,
          path: file.path,
          error: characterNameProblemMessage("collision"),
        };
      }

      if (file.path !== targetPath) {
        this.internalCharacterRename.set(file, targetPath);
        try {
          await this.renameCharacterFile(file, targetPath);
        } catch (error) {
          this.internalCharacterRename.delete(file);
          return {
            ok: false,
            name: observed.name,
            path: file.path,
            error: `노트 이름을 바꾸지 못했어요: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      this.characterNameBaseline.set(file, name);
      let wrote = false;
      let conflict = false;
      const write = async () => {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          if (String(fm.kind ?? "").trim() !== "character") {
            conflict = true;
            return;
          }
          if (!Object.prototype.hasOwnProperty.call(fm, "이름")) {
            conflict = true;
            return;
          }
          const current = normalizeCharacterName(fm.이름);
          if (current !== observed.name && current !== name) {
            conflict = true;
            return;
          }
          fm.이름 = name;
          wrote = true;
        });
      };
      try {
        await write();
      } catch {
        // One bounded retry covers a transient frontmatter write failure.
        try {
          await write();
        } catch (error) {
          return {
            ok: false,
            name,
            path: file.path,
            error: `파일명은 바뀌었지만 이름 속성을 저장하지 못했어요: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
      if (conflict || !wrote) {
        return {
          ok: false,
          name,
          path: file.path,
          error: "파일명은 바뀌었지만 이름이 다시 수정됐어요. 최신 값을 확인해 주세요.",
        };
      }
      return { ok: true, name, path: file.path };
    });
  }

  private enqueueCharacterNameWork<T>(file: TFile, work: () => Promise<T>): Promise<T> {
    const previous = this.characterNameLane.get(file) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(work);
    this.characterNameLane.set(file, run.then(() => undefined, () => undefined));
    return run;
  }

  private seedCharacterNameBaselines(): void {
    for (const file of this.app.vault.getMarkdownFiles()) {
      const observed = this.cachedCharacterName(file);
      if (observed) this.characterNameBaseline.set(file, observed.name);
    }
  }

  private cachedCharacterName(
    file: TFile,
  ): { name: string } | null {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || String(fm.kind ?? "").trim() !== "character") return null;
    if (!Object.prototype.hasOwnProperty.call(fm, "이름")) return null;
    if (typeof fm.이름 !== "string") return null;
    return { name: normalizeCharacterName(fm.이름) };
  }

  /** Read through the vault so a just-edited property cannot lose to cache lag. */
  private async readCharacterName(file: TFile): Promise<{ name: string } | null> {
    try {
      const text = await this.app.vault.read(file);
      const parsed = parseFrontmatterBlock(text, (raw) => parseYaml(raw));
      if (
        !parsed.ok ||
        parsed.kind !== "character" ||
        !Object.prototype.hasOwnProperty.call(parsed.fm, "이름") ||
        typeof parsed.fm.이름 !== "string"
      ) {
        return null;
      }
      return { name: normalizeCharacterName(parsed.fm.이름) };
    } catch {
      return null;
    }
  }

  /** A direct Properties edit is intent only after a session baseline exists. */
  private async observeCharacterNameProperty(file: TFile): Promise<void> {
    let observed: { name: string } | null = null;
    try {
      const text = await this.app.vault.read(file);
      const parsed = parseFrontmatterBlock(text, (raw) => parseYaml(raw));
      if (
        parsed.ok &&
        parsed.kind === "character" &&
        Object.prototype.hasOwnProperty.call(parsed.fm, "이름") &&
        typeof parsed.fm.이름 === "string"
      ) {
        observed = { name: normalizeCharacterName(parsed.fm.이름) };
      }
    } catch {
      return;
    }
    if (!observed) return;
    const previous = this.characterNameBaseline.get(file);
    if (previous === undefined) {
      // Startup/import mismatch is ambiguous; remember it without mutating.
      this.characterNameBaseline.set(file, observed.name);
      return;
    }
    if (previous === observed.name) return;
    this.characterNameBaseline.set(file, observed.name);
    void this.syncFilenameFromProperty(file, observed.name);
  }

  private async syncFilenameFromProperty(file: TFile, candidate: string): Promise<void> {
    await this.enqueueCharacterNameWork(file, async () => {
      if (this.unloaded) return;
      const observed = await this.readCharacterName(file);
      if (!observed || observed.name !== candidate) return;
      if (file.basename === candidate) return;

      const problem = characterNameProblem(candidate);
      const targetPath = normalizePath(notePathForName(file.path, candidate));
      if (problem || this.characterNameCollision(file.path, targetPath)) {
        const message = problem
          ? characterNameProblemMessage(problem)
          : characterNameProblemMessage("collision");
        await this.restoreNameToFilename(file, candidate);
        new Notice(`${message} 파일명에 맞춰 이름을 되돌렸어요.`);
        return;
      }

      this.internalCharacterRename.set(file, targetPath);
      try {
        await this.renameCharacterFile(file, targetPath);
        this.characterNameBaseline.set(file, candidate);
        new Notice("이름과 노트 파일명을 바꿨어요.");
      } catch (error) {
        this.internalCharacterRename.delete(file);
        await this.restoreNameToFilename(file, candidate);
        new Notice(
          `노트 이름을 바꾸지 못해 이름 속성을 되돌렸어요: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }

  private async restoreNameToFilename(file: TFile, expected: string): Promise<void> {
    const fallback = file.basename;
    this.characterNameBaseline.set(file, fallback);
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        if (String(fm.kind ?? "").trim() !== "character") return;
        if (!Object.prototype.hasOwnProperty.call(fm, "이름")) return;
        if (normalizeCharacterName(fm.이름) !== expected) return;
        fm.이름 = fallback;
      });
    } catch (error) {
      console.error("[charinfo] 이름 속성 되돌리기 실패", error);
      new Notice("이름 속성을 되돌리지 못했어요. 파일명을 기준으로 다시 확인해 주세요.");
    }
  }

  /** Manual basename rename wins; a folder-only move only remaps paths. */
  private observeCharacterFileRename(file: TFile, oldPath: string, newPath: string): void {
    if (file.extension !== "md") return;
    const oldName = basenameWithoutMarkdown(oldPath);
    const newName = basenameWithoutMarkdown(newPath);
    const internalTarget = this.internalCharacterRename.get(file);
    if (internalTarget) {
      if (newPath === internalTarget) {
        this.internalCharacterRename.delete(file);
        this.characterNameBaseline.set(file, newName);
      }
      return;
    }
    if (oldName === newName) return;

    this.characterNameBaseline.set(file, newName);
    void this.enqueueCharacterNameWork(file, async () => {
      if (file.path !== newPath || this.unloaded) return;
      let changed = false;
      try {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          if (String(fm.kind ?? "").trim() !== "character") return;
          if (!Object.prototype.hasOwnProperty.call(fm, "이름")) return;
          if (normalizeCharacterName(fm.이름) === newName) return;
          fm.이름 = newName;
          changed = true;
        });
        if (changed) new Notice("노트 파일명에 맞춰 이름을 바꿨어요.");
      } catch (error) {
        console.error("[charinfo] 파일명 → 이름 동기화 실패", error);
        new Notice("파일명은 바뀌었지만 이름 속성을 저장하지 못했어요.");
      }
    });
  }

  private characterNameCollision(sourcePath: string, targetPath: string): boolean {
    if (sourcePath === targetPath) return false;
    const exact = this.app.vault.getAbstractFileByPath(targetPath);
    if (exact instanceof TFile && exact.path !== sourcePath) return true;
    return hasPortablePathCollision(
      this.app.vault.getMarkdownFiles().map((file) => file.path),
      sourcePath,
      targetPath,
    );
  }

  private async renameCharacterFile(file: TFile, targetPath: string): Promise<void> {
    const oldPath = file.path;
    if (oldPath === targetPath) return;
    if (portablePathIdentity(oldPath) !== portablePathIdentity(targetPath)) {
      await this.app.fileManager.renameFile(file, targetPath);
      return;
    }

    // Case/normalization-only changes need a unique sibling hop on common
    // case-insensitive filesystems. If the final hop fails, return to oldPath.
    const parent = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/")) : "";
    let tempPath = "";
    do {
      this.characterRenameTempId += 1;
      const tempName = `.charinfo-rename-${Date.now()}-${this.characterRenameTempId}.md`;
      tempPath = normalizePath(parent ? `${parent}/${tempName}` : tempName);
    } while (this.app.vault.getAbstractFileByPath(tempPath));

    await this.app.fileManager.renameFile(file, tempPath);
    try {
      await this.app.fileManager.renameFile(file, targetPath);
    } catch (error) {
      try {
        await this.app.fileManager.renameFile(file, oldPath);
      } catch (rollbackError) {
        console.error("[charinfo] 대소문자 이름 되돌리기 실패", rollbackError);
      }
      throw error;
    }
  }

  /** Rename events must repair every copied path before queued refreshes run. */
  private remapCharacterPath(
    oldPath: string,
    newPath: string,
    file: TFile,
    syncTitle: boolean,
  ): void {
    if (oldPath === newPath) return;

    const noteTimer = this.noteChangeTimers.get(oldPath);
    if (noteTimer != null) {
      window.clearTimeout(noteTimer);
      this.noteChangeTimers.delete(oldPath);
      this.scheduleNoteChange(newPath);
    }
    const healTimer = this.healTimers.get(oldPath);
    const pending = this.pendingHealBits.get(oldPath);
    if (healTimer != null) window.clearTimeout(healTimer);
    this.healTimers.delete(oldPath);
    this.pendingHealBits.delete(oldPath);
    if (pending) {
      for (const bit of pending) this.scheduleHeal(newPath, bit);
    }
    if (this.dirtyGalleryPaths.delete(oldPath)) this.dirtyGalleryPaths.add(newPath);
    if (this.healFailureNoticed.delete(oldPath)) this.healFailureNoticed.add(newPath);

    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHARINFO_GALLERY)) {
      const view = leaf.view;
      if (view instanceof GalleryView) {
        view.handleCharacterRenamed(oldPath, newPath, file, syncTitle);
      }
    }
  }

  async loadSettings(): Promise<void> {
    const stored = await this.loadData();
    this.hadStoredSettings = stored !== null && stored !== undefined;
    this.settings = migrateSettings(stored);
  }

  /** Open this release's Markdown note once for updates, never first installs. */
  private async openUpdateNotesIfNeeded(): Promise<void> {
    const installedVersion = this.manifest.version;
    if (!this.hadStoredSettings) {
      if (installedVersion === UPDATE_NOTES_VERSION) {
        await this.commitSettings((settings) => {
          settings.lastOpenedUpdateNotesVersion = UPDATE_NOTES_VERSION;
        });
      }
      return;
    }
    if (
      !shouldOpenUpdateNotes({
        installedVersion,
        seenVersion: this.settings.lastOpenedUpdateNotesVersion,
        hadStoredSettings: this.hadStoredSettings,
      })
    ) {
      return;
    }

    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const notePath = normalizePath(
          updateNotesPath(this.defaultLibraryRoot()),
        );
        const folderPath = notePath.slice(0, notePath.lastIndexOf("/"));
        await ensureFolder(this, folderPath);

        const existing = this.app.vault.getAbstractFileByPath(notePath);
        const file =
          existing instanceof TFile
            ? existing
            : await this.app.vault.create(notePath, UPDATE_NOTES_MARKDOWN);
        await this.app.workspace.getLeaf("tab").openFile(file, { active: true });
        await this.commitSettings((settings) => {
          settings.lastOpenedUpdateNotesVersion = UPDATE_NOTES_VERSION;
        });
        return;
      } catch (error) {
        lastError = error;
      }
    }
    console.error("[charinfo] 업데이트 안내 열기 실패", lastError);
    // A permanent path or permission error must not repeat on every launch.
    await this.commitSettings((settings) => {
      settings.lastOpenedUpdateNotesVersion = UPDATE_NOTES_VERSION;
    });
  }

  /** Metadata is reliable only after layout ready; never guess legacy ownership. */
  private async claimLegacyWebShareAfterMetadata(): Promise<void> {
    const galleryPaths = this.app.vault
      .getMarkdownFiles()
      .filter((file) => isGalleryPage(file, this))
      .map((file) => file.path);
    if (
      claimLegacyWebShareIfUnambiguous(
        this.settings,
        galleryPaths,
        galleryPagePath(this),
      )
    ) {
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    // Library folder moved → rebuild the root registry and scan what is new.
    const library = this.defaultLibraryRoot();
    if (library !== this.knownLibraryFolder) {
      this.knownLibraryFolder = library;
      this.refreshSchemaRoots({ scanNew: true });
    }
  }

  private settingsWrite: Promise<void> = Promise.resolve();

  /**
   * One vocab/settings mutation at a time. Re-reads nothing from disk;
   * on failure restores the snapshot taken before mutate.
   */
  async commitSettings(mutate: (s: CharinfoSettings) => void): Promise<void> {
    const run = this.settingsWrite.then(async () => {
      const snap = structuredClone(this.settings) as CharinfoSettings;
      try {
        mutate(this.settings);
        await this.saveSettings();
      } catch (error) {
        this.settings = snap;
        throw error;
      }
    });
    this.settingsWrite = run.catch(() => undefined);
    return run;
  }

  /** True when the leaf lives in left/right sidebar (file explorer, etc.). */
  private isSidebarLeaf(leaf: WorkspaceLeaf): boolean {
    const root = leaf.getRoot();
    return (
      root === this.app.workspace.leftSplit ||
      root === this.app.workspace.rightSplit
    );
  }

  recordLastOpenedGallery(path: string): void {
    if (!shouldRecordLastOpenedGallery(this.settings.lastOpenedGalleryPath, path)) {
      return;
    }
    void this.commitSettings((settings) => {
      settings.lastOpenedGalleryPath = path;
    }).catch((error) => {
      console.error("[charinfo] 최근 갤러리 경로 저장 실패", error);
    });
  }

  private openLastUsedOrDefaultGallery(): void {
    void this.activateLastUsedOrDefaultGallery().catch((error) => {
      console.error("[charinfo] 갤러리 열기 실패", error);
      new Notice("갤러리를 열지 못했어요.");
    });
  }

  async activateLastUsedOrDefaultGallery(): Promise<void> {
    const lastPath = this.settings.lastOpenedGalleryPath;
    const abstract = lastPath
      ? this.app.vault.getAbstractFileByPath(lastPath)
      : null;
    const file = abstract instanceof TFile ? abstract : null;
    const isGallery = file
      ? await fileHasGalleryFrontmatter(this, file)
      : false;
    if (
      decideRibbonOpen({
        lastPath,
        fileExists: Boolean(file),
        isGallery,
      }) === "last-used" &&
      file
    ) {
      await this.activateGalleryView({ file });
      return;
    }
    await this.activateGalleryView();
  }

  /**
   * Open the gallery as a FileView bound to the entry note.
   * Share/link plugins can then see `getActiveFile()` = that note.
   */
  async activateGalleryView(opts?: {
    replaceActive?: boolean;
    file?: TFile;
  }): Promise<void> {
    const { workspace } = this.app;
    let file = opts?.file ?? null;
    if (!file) {
      file = await resolveOrMigrateGalleryPage(this);
    }
    if (!file) {
      await createGalleryPage(this);
      return;
    }

    let sameFile: WorkspaceLeaf | null = null;
    for (const candidate of workspace.getLeavesOfType(VIEW_TYPE_CHARINFO_GALLERY)) {
      const view = candidate.view;
      if (view instanceof GalleryView && view.file?.path === file.path) {
        sameFile = candidate;
        break;
      }
    }

    const recent = workspace.getMostRecentLeaf();
    const decision = decideGalleryOpenLeaf({
      hasSameFileLeaf: Boolean(sameFile),
      replaceActive: Boolean(opts?.replaceActive),
      hasMostRecent: Boolean(recent),
      mostRecentIsSidebar: Boolean(recent && this.isSidebarLeaf(recent)),
      mostRecentIsGallery: Boolean(
        recent && recent.view.getViewType() === VIEW_TYPE_CHARINFO_GALLERY,
      ),
    });

    if (decision === "reveal-same-file" && sameFile) {
      await this.revealGalleryLeaf(sameFile);
      return;
    }

    let leaf: WorkspaceLeaf | null =
      decision === "reuse-recent" ? recent : workspace.getLeaf("tab");

    if (!leaf || this.isSidebarLeaf(leaf)) {
      leaf = workspace.getLeaf("tab");
    }
    if (
      leaf.view instanceof GalleryView &&
      leaf.view.file?.path &&
      leaf.view.file.path !== file.path
    ) {
      leaf = workspace.getLeaf("tab");
    }

    // Bind the file first so the workspace tab is titled from frame 1.
    // setViewState-only leaves a "New tab" → title swap that cracks the
    // active-tab underline (Minimal `.tabs-underline`).
    await leaf.openFile(file, { active: true });
    await this.revealGalleryLeaf(leaf);
  }
}
