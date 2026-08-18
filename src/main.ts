import { Plugin, TFile, WorkspaceLeaf, Notice, normalizePath } from "obsidian";
import { DEFAULT_SETTINGS, migrateSettings, type CharinfoSettings } from "./settings";
import { CharacterStore } from "./data/CharacterStore";
import { healCollapsedImageEmbeds, healCharacterCardFields, healNaiPromptEmphasis } from "./data/images";
import { MediaService } from "./media/MediaService";
import {
  createCharacterNote,
  createGalleryPage,
  copyGalleryPageLink,
  copyTextToClipboard,
  galleryWikiLink,
  isGalleryPage,
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

export default class CharinfoPlugin extends Plugin {
  settings: CharinfoSettings = DEFAULT_SETTINGS;
  media!: MediaService;
  characters!: CharacterStore;
  /** Skip gallery auto-refresh while writing order/frontmatter. */
  suppressGalleryRefresh = false;
  /** Vault changed while gallery was idle — refresh when it becomes active. */
  private galleryNeedsRefresh = false;
  private galleryRefreshTimer: number | null = null;
  /** Skip re-entry while healing `|0` image embeds. */
  private healingCollapsedEmbeds = false;
  private healEmbedTimers = new Map<string, number>();
  /** One-shot: next open of this path may load as Markdown (edit entry note). */
  private allowMarkdownOnce = new Set<string>();
  private openFileHookInstalled = false;

  async onload(): Promise<void> {
    await this.loadSettings();
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
      void this.reclaimGalleryLeaves();
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
        void createCharacterNote(this);
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
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHARINFO_GALLERY);
        for (const leaf of leaves) {
          const view = leaf.view;
          if (view instanceof GalleryView) {
            view.openWebShare();
            return;
          }
        }
        new Notice("갤러리를 먼저 여세요.");
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
        if (!this.fileTouchesAnyOpenGallery(file.path)) return;
        this.markGalleriesDirty();
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile)) return;
        if (!this.fileTouchesAnyOpenGallery(file.path)) return;
        this.scheduleHealCollapsedEmbeds(file);
        this.markGalleriesDirty();
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
          if (note instanceof TFile) this.scheduleHealCollapsedEmbeds(note);
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
          img.style.width = "";
          img.style.maxWidth = "100%";
        }
      });
      el.querySelectorAll(".internal-embed, .image-embed").forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.style.width === "0px" || node.style.width === "0") {
          node.style.width = "";
          node.style.maxWidth = "100%";
        }
      });
    });
  }

  /** Debounce: Obsidian may write `|0` while the resize handle is still moving. */
  private scheduleHealCollapsedEmbeds(file: TFile): void {
    const prev = this.healEmbedTimers.get(file.path);
    if (prev != null) window.clearTimeout(prev);
    const timer = window.setTimeout(() => {
      this.healEmbedTimers.delete(file.path);
      void this.healCharacterNote(file);
    }, 450);
    this.healEmbedTimers.set(file.path, timer);
  }

  /** Undo `|0` embeds + migrate 언급→상태 + fill empty cover + restore NAI `::` in prompts. */
  private async healCharacterNote(file: TFile): Promise<void> {
    if (this.healingCollapsedEmbeds) return;
    if (file.extension !== "md") return;
    const cache = this.app.metadataCache.getFileCache(file);
    const kind = cache?.frontmatter?.kind;
    // Still try heal when cache lags right after create.
    if (kind != null && kind !== "character") return;
    this.healingCollapsedEmbeds = true;
    this.suppressGalleryRefresh = true;
    try {
      await healCollapsedImageEmbeds(this.app, file);
      await healNaiPromptEmphasis(this.app, file);
      await healCharacterCardFields(this.app, file);
    } finally {
      this.healingCollapsedEmbeds = false;
      this.suppressGalleryRefresh = false;
    }
  }

  /** @deprecated name kept for call sites — use healCharacterNote. */
  private async healCharacterImageEmbeds(file: TFile): Promise<void> {
    await this.healCharacterNote(file);
  }

  onunload(): void {
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
    // eslint-disable-next-line @typescript-eslint/no-this-alias
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

        // Already showing gallery for this library — just reveal.
        const open = this.app.workspace
          .getLeavesOfType(VIEW_TYPE_CHARINFO_GALLERY)
          .find((leaf) => leaf.view instanceof GalleryView);
        if (open) {
          this.app.workspace.revealLeaf(open);
          return;
        }

        window.setTimeout(() => {
          void this.activateGalleryView({ replaceActive: true });
        }, 0);
      },
      true,
    );
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
  markGalleriesDirty(opts?: { schedule?: boolean }): void {
    if (this.suppressGalleryRefresh) return;
    this.galleryNeedsRefresh = true;
    const schedule = opts?.schedule !== false;
    // Refresh any open gallery tab in the background so cards catch up
    // while the user edits a character note in another leaf.
    if (schedule && this.hasOpenGalleryLeaf()) {
      this.scheduleGalleryRefresh();
    } else {
      this.cancelScheduledGalleryRefresh();
    }
  }

  /** Successful load/refresh consumed the pending dirty bit. */
  acknowledgeGalleryRefresh(): void {
    this.galleryNeedsRefresh = false;
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
    if (this.suppressGalleryRefresh) return;
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

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
    workspace.revealLeaf(leaf);
  }
}
