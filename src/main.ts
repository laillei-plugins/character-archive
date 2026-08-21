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
  isGalleryPage,
  listGalleryLibraryIdentities,
  readGalleryScope,
  registerCharinfoCodeBlock,
  resolveGalleryPageFile,
  resolveOrMigrateGalleryPage,
} from "./page/galleryPage";
import {
  sweepEmptyFolders,
  sweepOrphanGalleryPages,
} from "./page/orphanCleanup";
import { CharinfoSettingTab } from "./ui/SettingTab";
import { CreateGalleryModal } from "./ui/CreateGalleryModal";
import { GalleryView, VIEW_TYPE_CHARINFO_GALLERY } from "./views/GalleryView";

/** What one schema pass did to a note. Console telemetry only. */
type SchemaOutcome = "patched" | "clean" | "malformed";

interface SchemaTally {
  scanned: number;
  patched: number;
  malformed: number;
  failed: number;
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
        if (!file || !isGalleryPage(file, this)) return;
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
        void this.activateGalleryView({ replaceActive: true, file });
      }),
    );

    // File-tree: click library folder title → open gallery (no note click needed).
    this.registerLibraryFolderClick();

    // After plugin/app reload: if a gallery note tab fell back to Markdown, reclaim it.
    // Does not open a new tab — only restores tabs that already show a gallery page.
    this.app.workspace.onLayoutReady(() => {
      void this.claimLegacyWebShareAfterMetadata();
      void this.reclaimGalleryLeaves();
      // LOCK (needs a vault; not covered by tests/property-schema.test.ts):
      // one non-blocking sequential archive scan per discovered root, with
      // zero gallery leaves open. Roots come from the metadata cache, which is
      // only trustworthy now — recompute before scanning.
      this.refreshSchemaRoots({ scanNew: true });
    });

    this.addRibbonIcon("layout-grid", "Character Archive 열기", () => {
      void this.activateGalleryView();
    });

    this.addCommand({
      id: "open-gallery",
      name: "갤러리 열기",
      callback: () => {
        void this.activateGalleryView();
      },
    });

    this.addCommand({
      id: "new-gallery-page",
      name: "새 갤러리 창",
      callback: () => {
        new CreateGalleryModal(this.app, this).open();
      },
    });

    this.addCommand({
      id: "new-gallery-page-default",
      name: "기본 갤러리 열기",
      callback: () => {
        void createGalleryPage(this);
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

    this.addCommand({
      id: "heal-library-image-links",
      name: "깨진 이미지 다시 연결",
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
        })();
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
        // A gallery note may have just repointed `library` — new root, new scan.
        if (isGalleryPage(file, this)) this.refreshSchemaRoots({ scanNew: true });
        if (!this.fileTouchesAnyOpenGallery(file.path)) return;
        this.scheduleNoteChange(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        const galleryChanged = remapGalleryPageState(
          this.settings,
          oldPath,
          file.path,
        );
        const characterChanged = remapCharacterWebShareState(
          this.settings,
          oldPath,
          file.path,
        );
        if (galleryChanged || characterChanged) void this.saveSettings();
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
        // Image dropped next to a character note → fill empty cover on that note.
        if (/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.path)) {
          const dir = file.path.includes("/")
            ? file.path.slice(0, file.path.lastIndexOf("/"))
            : "";
          const base = dir.split("/").pop() ?? "";
          if (!dir || !base) return;
          const notePath = `${dir}/${base}.md`;
          const note = this.app.vault.getAbstractFileByPath(notePath);
          if (note instanceof TFile) this.scheduleHeal(note.path, "content");
        }
        this.markGalleriesDirty();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.refreshOpenGalleriesIfDirty();
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
          isGalleryPage(file, plugin) &&
          !plugin.allowMarkdownOnce.has(file.path) &&
          !plugin.isSidebarLeaf(this)
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
   * Clicking the library folder in the file explorer opens the gallery
   * (bound to the entry note) without requiring the folder note.
   *
   * Mobile: Obsidian drills into the folder inside the Files drawer unless we
   * stop the event; after opening, collapse the drawer so the gallery is visible.
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
        // Let expand/collapse chevron behave normally.
        if (
          target.closest(
            ".nav-folder-collapse-indicator, .collapse-icon, .tree-item-icon",
          )
        ) {
          return;
        }
        const title = target.closest(".nav-folder-title");
        if (!(title instanceof HTMLElement)) return;
        const folderPath = title.getAttribute("data-path");
        if (!folderPath) return;
        const lib = normalizePath(this.settings.libraryFolder.trim() || "Character Archive");
        if (normalizePath(folderPath) !== lib) return;

        // Title = open gallery; chevron = expand. Stop mobile folder drill-in.
        event.preventDefault();
        event.stopPropagation();

        // Already showing gallery for this library — reveal + close Files drawer.
        const open = this.app.workspace
          .getLeavesOfType(VIEW_TYPE_CHARINFO_GALLERY)
          .find((leaf) => leaf.view instanceof GalleryView);
        if (open) {
          void this.revealGalleryLeaf(open);
          return;
        }

        window.setTimeout(() => {
          void this.activateGalleryView({ replaceActive: true });
        }, 0);
      },
      true,
    );
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

  async loadSettings(): Promise<void> {
    this.settings = migrateSettings(await this.loadData());
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

    let leaf: WorkspaceLeaf | null = null;

    if (opts?.replaceActive) {
      leaf = workspace.getMostRecentLeaf();
      // Clicking the file tree makes the explorer the "most recent" leaf —
      // never swap a sidebar pane into the gallery.
      if (leaf && this.isSidebarLeaf(leaf)) {
        leaf = null;
      }
    }

    if (!leaf) {
      for (const candidate of workspace.getLeavesOfType(VIEW_TYPE_CHARINFO_GALLERY)) {
        const view = candidate.view;
        if (view instanceof GalleryView && view.file?.path === file.path) {
          leaf = candidate;
          break;
        }
      }
    }

    if (!leaf) {
      // Prefer the main-area active leaf; fall back to a new tab.
      const active = workspace.getMostRecentLeaf();
      if (
        opts?.replaceActive &&
        active &&
        !this.isSidebarLeaf(active) &&
        active.view.getViewType() !== VIEW_TYPE_CHARINFO_GALLERY
      ) {
        leaf = active;
      } else {
        leaf = workspace.getLeaf(opts?.replaceActive ? false : "tab");
      }
    }

    if (leaf && this.isSidebarLeaf(leaf)) {
      leaf = workspace.getLeaf(false);
    }

    await leaf.setViewState({
      type: VIEW_TYPE_CHARINFO_GALLERY,
      state: { file: file.path },
      active: true,
    });
    await this.revealGalleryLeaf(leaf);
  }
}
