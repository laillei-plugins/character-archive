import {
  FileView,
  Menu,
  Notice,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import type CharinfoPlugin from "../main";
import {
  CharacterStore,
  type CharacterRecord,
} from "../data/CharacterStore";
import {
  listCharacterImages,
  listEmbedImages,
  reorderNoteImages,
  resolveCover,
  coverDisplaySrc,
  setCharacterCover,
  setCharacterCoverUrl,
  setCharacterField,
  setCharacterTags,
  setCoverPosition,
} from "../data/images";
import { persistGenreOrder, renameGenre, resolveGroupOrder, moveInOrder, sortCharacters } from "../data/order";
import { EXAMPLE_ARCHIVE } from "../data/bundledTemplate";
import {
  propertyLabel,
  propertyValue,
  visibleCardProperties,
  CARD_PROPERTY_DEFS,
  type CardPropertyId,
} from "../data/cardProperties";
import {
  axisFor,
  getGalleryPageState,
  getGroupOrderFor,
  patchGalleryPageState,
  recordAxisValue,
  recordMatchesAxisChip,
  resolveAxisOption,
  setGroupOrderFor,
  setRecordAxisValue,
  statusColorClass,
  type ChipFilter,
  type FilterAxis,
  type PrimaryFilterProperty,
  type SortMode,
  type StatusDef,
} from "../settings";
import {
  countAxisOptionOccupants,
  occupiedAxisOptionIds,
} from "../data/filterAxis";
import { normalizeChipFilter } from "../data/status";
import { renderCleanBody } from "../ui/cleanBody";
import { CoverPickerModal } from "../ui/CoverPickerModal";
import { CreateGalleryModal } from "../ui/CreateGalleryModal";
import { RenameGenreModal } from "../ui/RenameGenreModal";
import { attachHoldDrag } from "../ui/holdDrag";
import { TagChecklistPopover } from "../ui/TagChecklistPopover";
import { ViewSettingsPopover } from "../ui/ViewSettingsPopover";
import {
  copyGalleryPageLink,
  copyTextToClipboard,
  createCharacterNote,
  galleryPagePath,
  galleryWikiLink,
  getFilterAxisForPage,
  readGalleryScope,
} from "../page/galleryPage";
import { ShareGalleryModal } from "../ui/ShareGalleryModal";
import { AttrManageModal } from "../ui/AttrManageModal";

export const VIEW_TYPE_CHARINFO_GALLERY = "charinfo-gallery";

const NARROW_PX = 720;
/** Tags shown on a card before collapsing the rest into `+n`. */
const CARD_TAG_LIMIT = 3;

/**
 * File-backed gallery — bound to `Character Archive.md` so share/link plugins
 * see a real note (`getActiveFile()`), while the UI is still the gallery.
 */
export class GalleryView extends FileView {
  plugin: CharinfoPlugin;
  store: CharacterStore;
  editMode = false;
  searchQuery = "";
  records: CharacterRecord[] = [];
  selected: CharacterRecord | null = null;
  private searchInput: HTMLInputElement | null = null;
  private searchTimer: number | null = null;
  private suppressClick = false;
  private viewMenu: ViewSettingsPopover | null = null;
  private tagMenu: TagChecklistPopover | null = null;
  /** Card path whose tag checklist is open (so the trigger can toggle it). */
  private tagMenuPath = "";
  private detailRequestId = 0;
  private resizeObserver: ResizeObserver | null = null;
  private isNarrow = false;
  private peekOpen = false;
  private tipTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: CharinfoPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.store = plugin.characters;
    this.editMode = plugin.settings.defaultEditMode;
    this.navigation = true;
  }

  get sortMode(): SortMode {
    return this.plugin.settings.sortMode;
  }

  private pageKey(): string {
    return this.file?.path ?? galleryPagePath(this.plugin);
  }

  private resolvePageScope() {
    return readGalleryScope(this.app, this.file, this.plugin.settings);
  }

  /** Vault folder this gallery scans. */
  pageLibrary(): string {
    return this.resolvePageScope().library;
  }

  private isArchivePinned(): boolean {
    return this.resolvePageScope().pinned;
  }

  /**
   * Active chip axis for this page: FM `primaryFilter` when the note sets one,
   * else the global setting. Falls back to status when the axis has no options.
   */
  private filterAxis(): FilterAxis {
    return getFilterAxisForPage(this.plugin.settings, this.resolvePageScope());
  }

  private propLabel(id: CardPropertyId): string {
    return propertyLabel(id, this.plugin.settings.propertyDisplayNames);
  }

  /**
   * Option ids with at least one card in the active archive. Chips outside this
   * set are hidden, so a remembered chip pointing at one reads as 「전체」.
   * Deliberately ignores `searchQuery` — typing must not move chip membership.
   */
  private occupiedOptions(axis: FilterAxis): Set<string> {
    return occupiedAxisOptionIds(axis, this.records, this.activeArchive());
  }

  /** Axis options that actually have cards here, in vocabulary order. */
  private visibleAxisOptions(
    axis: FilterAxis,
    occupied = this.occupiedOptions(axis),
  ): StatusDef[] {
    return axis.options.filter((option) => occupied.has(option.id));
  }

  /**
   * Chip value for this page, in precedence order:
   * remembered choice (same axis, still a live option) → page
   * `defaultChipFilter` → global remembered chip → `all`.
   *
   * Every step must also be *occupied* in this archive; an empty option reads as
   * 「전체」 without persisting, so returning to an archive that still has that
   * option restores the remembered chip.
   */
  get chipFilter(): ChipFilter {
    const axis = this.filterAxis();
    const occupied = this.occupiedOptions(axis);
    const usable = (id: string) => id === "all" || occupied.has(id);
    const page = getGalleryPageState(this.plugin.settings, this.pageKey());
    if (page.chipFilter && page.chipFilterProperty === axis.propertyId) {
      const remembered = normalizeChipFilter(page.chipFilter, axis.options);
      // A stale id (deleted option) or an empty one falls through to the
      // page/global default.
      if (remembered !== "all" && usable(remembered)) return remembered;
      if (page.chipFilter === "all") return "all";
    }
    const pageDefault = this.resolvePageScope().defaultChipFilter;
    if (pageDefault) {
      const fromPage = normalizeChipFilter(pageDefault, axis.options);
      if (fromPage !== "all" && usable(fromPage)) return fromPage;
      if (pageDefault === "all") return "all";
    }
    const global = normalizeChipFilter(
      this.plugin.settings.chipFilter,
      axis.options,
    );
    return usable(global) ? global : "all";
  }

  set chipFilter(value: ChipFilter) {
    patchGalleryPageState(this.plugin.settings, this.pageKey(), {
      chipFilter: value,
      chipFilterProperty: this.filterAxis().propertyId,
    });
    this.plugin.settings.chipFilter = value;
  }

  getViewType(): string {
    return VIEW_TYPE_CHARINFO_GALLERY;
  }

  getDisplayText(): string {
    if (this.file) return this.file.basename;
    const pin = this.resolvePageScope().pinnedArchive;
    if (pin) return pin;
    return "Character Archive";
  }

  getIcon(): string {
    return "layout-grid";
  }

  async onLoadFile(file: TFile): Promise<void> {
    await this.refresh();
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    this.selected = null;
    this.peekOpen = false;
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    menu.addItem((item) => {
      item
        .setTitle("갤러리 공유")
        .setIcon("globe")
        .onClick(() => {
          this.openWebShare();
        });
    });
    menu.addItem((item) => {
      item
        .setTitle("새 갤러리 페이지…")
        .setIcon("layout-grid")
        .onClick(() => {
          new CreateGalleryModal(this.app, this.plugin, {
            library: this.pageLibrary(),
            archive: this.activeArchive(),
          }).open();
        });
    });
  }

  openWebShare(): void {
    const title =
      this.activeArchive().trim() ||
      this.file?.basename ||
      "Character Archive";
    new ShareGalleryModal(this.plugin, this.records, title, {
      defaultArchive: this.activeArchive().trim(),
      pageFile: this.file,
    }).open();
  }

  async copyPageLink(): Promise<void> {
    if (!this.file) {
      new Notice("이 갤러리에 연결된 노트가 없어요.");
      return;
    }
    await copyGalleryPageLink(this.app, this.file);
  }

  async copyWikiLink(): Promise<void> {
    if (!this.file) {
      new Notice("이 갤러리에 연결된 노트가 없어요.");
      return;
    }
    const ok = await copyTextToClipboard(galleryWikiLink(this.file));
    new Notice(ok ? "노트 링크를 복사했어요" : "복사에 실패했어요");
  }

  private genres(): string[] {
    return this.store.listGenres(this.records);
  }

  /** Active archive for this page (pinned FM or page/global state). */
  activeArchive(): string {
    const scope = this.resolvePageScope();
    if (scope.pinned) return scope.pinnedArchive;
    const page = getGalleryPageState(this.plugin.settings, this.pageKey());
    if (page.activeGenre?.trim()) return page.activeGenre.trim();
    return this.plugin.settings.activeGenre.trim();
  }

  private ensureActiveGenre(): void {
    if (this.isArchivePinned()) return;
    const genres = this.genres();
    if (genres.length === 0) {
      if (this.activeArchive()) {
        patchGalleryPageState(this.plugin.settings, this.pageKey(), {
          activeGenre: "",
        });
        void this.plugin.saveSettings();
      }
      return;
    }
    const pagePick =
      getGalleryPageState(this.plugin.settings, this.pageKey()).activeGenre?.trim() ??
      "";
    if (pagePick && genres.includes(pagePick)) return;
    const global = this.plugin.settings.activeGenre.trim();
    const next =
      !pagePick && global && genres.includes(global) && global !== EXAMPLE_ARCHIVE
        ? global
        : this.preferredArchive(genres);
    if (!next || next === this.activeArchive()) return;
    patchGalleryPageState(this.plugin.settings, this.pageKey(), {
      activeGenre: next,
    });
    void this.plugin.saveSettings();
  }

  /** Prefer an archive that already has cards. Example is last if others exist. */
  private preferredArchive(genres: string[]): string {
    const counts = new Map<string, number>();
    for (const record of this.records) {
      const g = record.장르.trim();
      if (!g) continue;
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const populated = genres.filter((g) => (counts.get(g) ?? 0) > 0);
    const withoutExample = populated.filter((g) => g !== EXAMPLE_ARCHIVE);
    return withoutExample[0] ?? populated[0] ?? genres[0] ?? "";
  }

  async setActiveGenre(genre: string): Promise<void> {
    if (this.isArchivePinned()) return;
    patchGalleryPageState(this.plugin.settings, this.pageKey(), {
      activeGenre: genre,
    });
    await this.plugin.saveSettings();
    this.selected = null;
    this.render();
    this.leaf.setEphemeralState({ ...this.leaf.getEphemeralState() });
  }

  private async renameActiveGenre(from: string, to: string): Promise<void> {
    this.plugin.suppressGalleryRefresh = true;
    let count = 0;
    try {
      count = await renameGenre(this.app, this.records, from, to);
      if (this.activeArchive().trim() === from) {
        patchGalleryPageState(this.plugin.settings, this.pageKey(), {
          activeGenre: to,
        });
        this.plugin.settings.activeGenre = to;
        await this.plugin.saveSettings();
      }
      if (this.isArchivePinned() && this.file) {
        await this.app.fileManager.processFrontMatter(this.file, (fm) => {
          fm.장르 = to;
        });
      }
      const lib = this.pageLibrary();
      const order = getGroupOrderFor(this.plugin.settings, lib, from);
      if (order.length) {
        setGroupOrderFor(this.plugin.settings, lib, to, order);
        const byLib = { ...this.plugin.settings.groupOrderByLibrary[lib] };
        delete byLib[from];
        this.plugin.settings.groupOrderByLibrary = {
          ...this.plugin.settings.groupOrderByLibrary,
          [lib]: byLib,
        };
        await this.plugin.saveSettings();
      }
    } finally {
      this.plugin.suppressGalleryRefresh = false;
    }
    new Notice(
      count
        ? `아카이브 이름을 「${to}」로 바꿨어요 · 노트 ${count}개`
        : "이름을 바꿀 노트가 없어요",
    );
    await this.refresh();
    this.leaf.setEphemeralState({ ...this.leaf.getEphemeralState() });
  }

  async onOpen(): Promise<void> {
    this.registerDomEvent(this.containerEl, "keydown", (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (this.viewMenu) {
          this.viewMenu.close();
          event.preventDefault();
          return;
        }
        if (this.isNarrow && this.peekOpen) {
          event.preventDefault();
          this.closePeek();
          return;
        }
        if (this.editMode) {
          event.preventDefault();
          this.setEditMode(false);
        }
      }
      if (event.key === "/" && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        this.searchInput?.focus();
      }
    });
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const next = entry.contentRect.width < NARROW_PX;
      if (next === this.isNarrow) return;
      this.isNarrow = next;
      this.contentEl.toggleClass("is-narrow", next);
    });
    this.resizeObserver.observe(this.contentEl);
    // FileView loads the note via onLoadFile — only refresh here if already bound.
    if (this.file) await this.refresh();
  }

  async onClose(): Promise<void> {
    if (this.tipTimer != null) {
      window.clearTimeout(this.tipTimer);
      this.tipTimer = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.viewMenu?.close();
    this.viewMenu = null;
    this.closeTagMenu();
    this.contentEl.empty();
  }

  private closePeek(): void {
    this.closeTagMenu();
    this.selected = null;
    this.peekOpen = false;
    this.contentEl.toggleClass("is-peek-open", false);
    this.contentEl.querySelectorAll(".charinfo-card.is-selected").forEach((el) => {
      el.classList.remove("is-selected");
    });
    const detail = this.contentEl.querySelector(".charinfo-gallery__detail");
    if (detail instanceof HTMLElement) void this.renderDetail(detail);
  }

  private async setChipFilter(next: ChipFilter): Promise<void> {
    this.chipFilter = next;
    await this.plugin.saveSettings();
    this.syncChipFilters();
    this.renderBody();
  }

  private openAttrManage(): void {
    const scope = this.resolvePageScope();
    new AttrManageModal(this.plugin, {
      records: this.records,
      archive: this.activeArchive(),
      pageAxis: scope.primaryFilter,
      globalAxis: this.plugin.settings.primaryFilterProperty,
      file: this.file,
      onPageAxis: async (next) => {
        if (this.file) {
          await this.app.fileManager.processFrontMatter(this.file, (fm) => {
            if (next == null) delete fm.primaryFilter;
            else fm.primaryFilter = next;
          });
        }
        patchGalleryPageState(this.plugin.settings, this.pageKey(), {
          chipFilter: "all",
          chipFilterProperty:
            next ?? this.plugin.settings.primaryFilterProperty,
        });
        await this.plugin.saveSettings();
      },
      onChanged: () => {
        this.plugin.refreshOpenGalleries();
      },
    }).open();
  }

  setEditMode(enabled: boolean): void {
    const turningOn = enabled && !this.editMode;
    this.editMode = enabled;
    this.render();
    if (turningOn) {
      this.showGalleryTip(
        "위쪽 「표시 순서」에서 정렬을 고르고, 카드의 이미지 아이콘으로 커버를 바꿔 보세요.",
      );
    }
  }

  /** Short tip under the header — stays near the controls it refers to. */
  private showGalleryTip(message: string, durationMs = 4500): void {
    const root = this.contentEl.querySelector(".charinfo-gallery");
    if (!(root instanceof HTMLElement)) {
      new Notice(message, durationMs);
      return;
    }
    root.querySelector(".charinfo-gallery__tip")?.remove();
    if (this.tipTimer != null) {
      window.clearTimeout(this.tipTimer);
      this.tipTimer = null;
    }
    const tip = createDiv({
      cls: "charinfo-gallery__tip",
      text: message,
      attr: { role: "status" },
    });
    const header = root.querySelector(".charinfo-gallery__header");
    const body = root.querySelector(".charinfo-gallery__body");
    if (header && body) {
      root.insertBefore(tip, body);
    } else {
      root.appendChild(tip);
    }
    this.tipTimer = window.setTimeout(() => {
      tip.remove();
      this.tipTimer = null;
    }, durationMs);
  }

  async setSortMode(mode: SortMode): Promise<void> {
    this.plugin.settings.sortMode = mode;
    await this.plugin.saveSettings();
    this.records = sortCharacters(this.records, mode);
    this.render();
  }

  async refresh(): Promise<void> {
    this.records = await this.store.listCharacters(
      this.sortMode,
      this.pageLibrary(),
    );
    this.ensureActiveGenre();
    if (this.selected) {
      this.selected =
        this.records.find((r) => r.path === this.selected?.path) ?? null;
    }
    // Status chips stay settings-owned. Unknown note values still render as
    // gray ghost pills — we do not auto-add them back after the user deletes.
    this.plugin.acknowledgeGalleryRefresh();
    this.render();
  }

  private filtered(): CharacterRecord[] {
    const q = this.searchQuery.trim().toLowerCase();
    const genre = this.activeArchive().trim();
    const axis = this.filterAxis();
    const chip = this.chipFilter;
    return this.records.filter((record) => {
      if (genre && record.장르 !== genre) return false;
      if (chip !== "all" && !recordMatchesAxisChip(axis, record, chip)) {
        return false;
      }
      if (!q) return true;
      const hay = [record.title, record.이름, record.코드네임, record.장르, record.그룹]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  render(): void {
    const root = this.contentEl;
    this.viewMenu?.close();
    this.viewMenu = null;
    this.closeTagMenu();
    root.empty();
    root.addClass("charinfo-gallery");
    root.toggleClass("is-edit", this.editMode);
    root.toggleClass("is-fit-image", this.plugin.settings.cardFitImage);
    root.toggleClass("is-narrow", this.isNarrow);
    root.toggleClass("is-peek-open", this.peekOpen);
    root.tabIndex = 0;

    this.renderHeader(root);
    root.createDiv({ cls: "charinfo-gallery__body" });
    this.renderBody();
  }

  private renderBody(): void {
    const body = this.contentEl.querySelector(".charinfo-gallery__body");
    if (!(body instanceof HTMLElement)) return;
    body.empty();
    const main = body.createDiv({ cls: "charinfo-gallery__main" });
    const detail = body.createDiv({ cls: "charinfo-gallery__detail" });

    // Tap gallery chrome (not a card) → dismiss side panel.
    main.addEventListener("click", (event) => {
      if (!this.peekOpen) return;
      const target = event.target as HTMLElement;
      if (target.closest(".charinfo-card")) return;
      if (target.closest("button, a, input, textarea, select")) return;
      this.closePeek();
    });

    const filtered = this.filtered();
    if (filtered.length === 0) {
      this.renderEmpty(main);
    } else {
      this.renderGroups(main, filtered);
    }
    void this.renderDetail(detail);
  }

  /** Chip filter under archive name — options from the active axis vocabulary. */
  private renderChipFilters(parent: HTMLElement): void {
    const tokens = parent.createDiv({
      cls: "charinfo-gallery__filters",
      attr: { role: "group" },
    });
    this.fillChipFilters(tokens);
  }

  /**
   * Rebuild the chip row in place. Occupancy moves on every axis/tag write, so
   * the row is rebuilt (not just repainted) whenever records change.
   */
  private syncChipRow(): void {
    const tokens = this.contentEl.querySelector(".charinfo-gallery__filters");
    if (!(tokens instanceof HTMLElement)) return;
    const focused = document.activeElement;
    const focusedId =
      focused instanceof HTMLElement && tokens.contains(focused)
        ? focused.closest<HTMLElement>(".charinfo-status-filter")?.dataset
            .filter ?? ""
        : "";
    tokens.empty();
    this.fillChipFilters(tokens);
    if (!focusedId) return;
    // The focused chip may have just been hidden — land on 「전체」 instead.
    const next =
      tokens.querySelector(
        `.charinfo-status-filter[data-filter="${CSS.escape(focusedId)}"]`,
      ) ?? tokens.querySelector(".charinfo-status-filter.is-all");
    if (next instanceof HTMLElement) next.focus();
  }

  /** 「전체」 + every option with at least one card in this archive. */
  private fillChipFilters(tokens: HTMLElement): void {
    const axis = this.filterAxis();
    const active = this.chipFilter;
    tokens.setAttribute("aria-label", `${axis.label} 필터`);
    if (axis.empty) {
      tokens.createSpan({
        cls: "charinfo-gallery__filters-empty",
        text: "값을 먼저 추가하세요.",
      });
    }
    // Tags carry no color, so their chips drop the color dot.
    const isTagAxis = axis.propertyId === "tags";
    const options: { id: string; label: string; cls: string }[] = [
      { id: "all", label: "전체", cls: "is-all" },
      ...this.visibleAxisOptions(axis).map((s) => ({
        id: s.id,
        label: s.label,
        cls: isTagAxis ? "is-tag" : statusColorClass(s.color),
      })),
    ];
    for (const option of options) {
      const btn = tokens.createEl("button", {
        cls:
          "charinfo-status-filter" +
          ` ${option.cls}` +
          (active === option.id ? " is-active" : ""),
        attr: {
          type: "button",
          "data-filter": option.id,
          "aria-pressed": active === option.id ? "true" : "false",
        },
      });
      if (option.id !== "all" && !isTagAxis) {
        btn.createSpan({ cls: "charinfo-status__dot" });
      }
      btn.createSpan({ text: option.label });
      btn.addEventListener("click", () => {
        void this.setChipFilter(option.id);
      });
    }
  }

  private syncChipFilters(): void {
    const chip = this.chipFilter;
    this.contentEl.querySelectorAll(".charinfo-status-filter").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const active = el.dataset.filter === chip;
      el.toggleClass("is-active", active);
      el.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  private renderHeader(root: HTMLElement): void {
    const header = root.createDiv({ cls: "charinfo-gallery__header" });
    const left = header.createDiv({ cls: "charinfo-gallery__header-left" });

    const genres = this.genres();
    const active = this.activeArchive().trim();
    const pinned = this.isArchivePinned();

    if (genres.length === 0 && !pinned) {
      left.createEl("h2", {
        text: "아카이브 없음",
        cls: "charinfo-gallery__title",
      });
    } else {
      const genreRow = left.createDiv({ cls: "charinfo-gallery__genre-row" });
      const current = active || genres[0] || "";
      if (pinned) {
        genreRow.createEl("h2", {
          text: current || "아카이브",
          cls: "charinfo-gallery__title",
        });
      } else {
      // Notion-style: click opens full list (no type-to-filter field).
      const genreBtn = genreRow.createEl("button", {
        cls: "charinfo-gallery__genre",
        attr: {
          type: "button",
          title: "아카이브 바꾸기",
          "aria-label": "아카이브 선택",
          "aria-haspopup": "menu",
        },
      });
      genreBtn.createSpan({
        cls: "charinfo-gallery__genre-label",
        text: current || "아카이브",
      });
      const chevron = genreBtn.createSpan({ cls: "charinfo-gallery__genre-chevron" });
      setIcon(chevron, "chevron-down");
      genreBtn.addEventListener("click", (event) => {
        event.preventDefault();
        const menu = new Menu();
        for (const genre of genres) {
          menu.addItem((item) =>
            item
              .setTitle(genre)
              .setChecked(genre === current)
              .onClick(() => void this.setActiveGenre(genre)),
          );
        }
        if (active && !genres.includes(active)) {
          menu.addItem((item) =>
            item
              .setTitle(active)
              .setChecked(true)
              .onClick(() => void this.setActiveGenre(active)),
          );
        }
        menu.showAtMouseEvent(event);
      });
      }

      // Edit mode only — pencil is free here (mode toggle shows book-open while editing).
      if (this.editMode && current) {
        const renameBtn = genreRow.createEl("button", {
          cls: "clickable-icon charinfo-gallery__genre-rename",
          attr: {
            type: "button",
            title: "아카이브 이름 바꾸기",
            "aria-label": "아카이브 이름 바꾸기",
          },
        });
        setIcon(renameBtn, "type");
        renameBtn.addEventListener("click", () => {
          if (!current) return;
          new RenameGenreModal(this.app, current, (to) =>
            this.renameActiveGenre(current, to),
          ).open();
        });
      }
    }

    // Filter chips sit on their own row (below search when stacked).
    this.renderChipFilters(header);

    // Sort lives in the header only in edit; keep chips compact and labeled via aria.
    if (this.editMode) {
      const sort = header.createDiv({
        cls: "charinfo-gallery__sort",
        attr: { role: "group", "aria-label": "정렬" },
      });
      sort.createDiv({
        cls: "charinfo-gallery__sort-hint",
        text: "표시 순서",
        attr: {
          title: "왼쪽 핸들로 카드 순서를 바꿔 보세요",
        },
      });
      for (const option of [
        { id: "manual" as const, label: "자유" },
        { id: "name" as const, label: "이름순" },
      ]) {
        const btn = sort.createEl("button", {
          text: option.label,
          cls:
            "charinfo-chip" +
            (this.sortMode === option.id ? " is-active" : ""),
          attr: { type: "button" },
        });
        btn.addEventListener("click", () => {
          void this.setSortMode(option.id);
        });
      }
    }

    const searchWrap = header.createDiv({
      cls: "charinfo-gallery__search-wrap",
    });
    this.searchInput = searchWrap.createEl("input", {
      type: "search",
      cls: "charinfo-gallery__search",
      attr: {
        placeholder: "검색",
        "aria-label": "검색",
        spellcheck: "false",
      },
    });
    this.searchInput.value = this.searchQuery;
    this.searchInput.addEventListener("input", () => {
      this.searchQuery = this.searchInput?.value ?? "";
      if (this.searchTimer != null) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => {
        this.renderBody();
      }, 120);
    });

    const actions = header.createDiv({ cls: "charinfo-gallery__actions" });

    const toggleBtn = actions.createEl("button", {
      cls:
        "clickable-icon charinfo-gallery__icon-btn" +
        (this.editMode ? " is-active" : ""),
      attr: {
        type: "button",
        title: this.editMode
          ? "읽기 모드로"
          : "편집 모드 — 표시 순서를 바꿀 수 있어요",
        "aria-label": this.editMode ? "읽기 모드" : "편집 모드",
        "data-charinfo": "edit",
      },
    });
    setIcon(toggleBtn, "pencil");
    toggleBtn.addEventListener("click", () => this.setEditMode(!this.editMode));

    const attrBtn = actions.createEl("button", {
      cls:
        "clickable-icon charinfo-gallery__icon-btn" +
        (this.editMode ? "" : " is-locked"),
      attr: {
        type: "button",
        title: this.editMode
          ? "속성 관리 — 보이는 이름과 값"
          : "속성 관리 — 편집 모드에서 열려요",
        "aria-label": this.editMode
          ? "속성 관리"
          : "속성 관리 — 편집 모드에서 열려요",
        "aria-disabled": this.editMode ? "false" : "true",
      },
    });
    setIcon(attrBtn, "book");
    attrBtn.addEventListener("click", (event) => {
      event.preventDefault();
      if (!this.editMode) {
        new Notice("편집 모드(연필)를 켜면 속성 관리를 열 수 있어요.");
        toggleBtn.focus();
        return;
      }
      this.openAttrManage();
    });

    const viewBtn = actions.createEl("button", {
      cls: "clickable-icon charinfo-gallery__icon-btn",
      attr: {
        type: "button",
        "aria-label": "카드에 보일 항목",
        title: "카드에 보일 항목",
      },
    });
    setIcon(viewBtn, "sliders-horizontal");
    this.viewMenu = new ViewSettingsPopover(viewBtn, root, {
      getLabel: (id) => this.propLabel(id),
      getProperties: () => this.plugin.settings.cardProperties,
      setProperties: async (next) => {
        this.plugin.settings.cardProperties = next;
        await this.plugin.saveSettings();
      },
      getFitImage: () => this.plugin.settings.cardFitImage,
      setFitImage: async (fit) => {
        this.plugin.settings.cardFitImage = fit;
        await this.plugin.saveSettings();
      },
      onChange: () => {
        root.toggleClass("is-fit-image", this.plugin.settings.cardFitImage);
        this.renderBody();
      },
    });
    viewBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.viewMenu?.toggle();
    });

    const linkBtn = actions.createEl("button", {
      cls: "clickable-icon charinfo-gallery__icon-btn",
      attr: {
        type: "button",
        "aria-label": "공유",
        title: "공유",
      },
    });
    setIcon(linkBtn, "globe");
    linkBtn.addEventListener("click", () => {
      this.openWebShare();
    });

    if (this.editMode) {
      const refreshBtn = actions.createEl("button", {
        cls: "clickable-icon charinfo-gallery__icon-btn charinfo-gallery__icon-btn--quiet",
        attr: {
          type: "button",
          title: "새로고침",
          "aria-label": "새로고침",
        },
      });
      setIcon(refreshBtn, "refresh-cw");
      refreshBtn.addEventListener("click", () => void this.refresh());
    }
  }

  private renderEmpty(main: HTMLElement): void {
    const empty = main.createDiv({ cls: "charinfo-gallery__empty" });
    const icon = empty.createDiv({ cls: "charinfo-gallery__empty-icon" });
    setIcon(icon, "images");

    const axis = this.filterAxis();
    const chip = this.chipFilter;
    const filterDef =
      chip !== "all"
        ? (axis.options.find((o) => o.id === chip) ??
          resolveAxisOption(axis, chip))
        : null;
    const hasSearch = this.searchQuery.trim().length > 0;
    const genre = this.activeArchive().trim();
    const inArchive = this.records.filter(
      (r) => !genre || r.장르 === genre,
    );
    const allCount = inArchive.length;
    const counts = countAxisOptionOccupants(axis, this.records, genre);
    // Same occupancy source as the chip row — hidden options stay out of the copy.
    const visibleOptions = axis.options.filter(
      (option) => (counts.get(option.id) ?? 0) > 0,
    );

    let title = "캐릭터가 없어요.";
    let detail = "";

    if (this.records.length === 0) {
      title = "캐릭터가 없어요.";
      detail = "아래 버튼으로 첫 카드를 만드세요.";
    } else if (allCount === 0) {
      title = "이 아카이브에 카드가 없어요.";
      detail = genre
        ? `아카이브 “${genre}”에 아직 노트가 없습니다.`
        : "다른 아카이브를 고르거나 캐릭터를 추가하세요.";
    } else if (hasSearch && filterDef) {
      title = "검색 결과가 없어요.";
      detail = `검색 + ${filterDef.label} 필터 · 이 아카이브 ${allCount}명`;
    } else if (hasSearch) {
      title = "검색 결과가 없어요.";
      detail = `이 아카이브 ${allCount}명 중에서 찾지 못했어요.`;
    } else if (filterDef) {
      title = `${filterDef.label}인 캐릭터가 없어요.`;
      const others = visibleOptions
        .filter((s) => s.id !== filterDef.id)
        .map((s) => `${s.label} ${counts.get(s.id) ?? 0}`)
        .join(" · ");
      detail = others
        ? `이 아카이브 ${allCount}명 · 지금 ${filterDef.label} 필터 (${others})`
        : `이 아카이브 ${allCount}명 · 지금 ${filterDef.label} 필터`;
    } else {
      title = "표시할 카드가 없어요.";
    }

    empty.createEl("p", {
      cls: "charinfo-gallery__empty-title",
      text: title,
    });
    if (detail) {
      empty.createEl("p", {
        cls: "charinfo-gallery__empty-detail",
        text: detail,
      });
    }

    const actions = empty.createDiv({ cls: "charinfo-gallery__empty-actions" });

    const addCharacter = () => {
      void createCharacterNote(this.plugin, {
        genre: this.activeArchive().trim(),
        library: this.pageLibrary(),
      });
    };

    // Filter hiding cards that exist → recover first, then add.
    if (filterDef && allCount > 0 && !hasSearch) {
      const clear = actions.createEl("button", {
        text: "전체 보기",
        cls: "mod-cta",
        attr: { type: "button" },
      });
      clear.addEventListener("click", () => void this.setChipFilter("all"));

      for (const s of visibleOptions) {
        if (s.id === filterDef.id) continue;
        const btn = actions.createEl("button", {
          text: `${s.label}만 보기`,
          cls: "charinfo-gallery__empty-secondary",
          attr: { type: "button" },
        });
        btn.addEventListener("click", () => void this.setChipFilter(s.id));
      }

      const add = actions.createEl("button", {
        text: "캐릭터 추가",
        cls: "charinfo-gallery__empty-secondary",
        attr: { type: "button" },
      });
      add.addEventListener("click", addCharacter);
      return;
    }

    if (hasSearch && filterDef && allCount > 0) {
      const clearFilter = actions.createEl("button", {
        text: "필터 끄기 (전체)",
        cls: "mod-cta",
        attr: { type: "button" },
      });
      clearFilter.addEventListener("click", () =>
        void this.setChipFilter("all"),
      );
      const clearSearch = actions.createEl("button", {
        text: "검색 지우기",
        cls: "charinfo-gallery__empty-secondary",
        attr: { type: "button" },
      });
      clearSearch.addEventListener("click", () => {
        this.searchQuery = "";
        if (this.searchInput) this.searchInput.value = "";
        this.render();
      });
      return;
    }

    if (hasSearch) {
      const clearSearch = actions.createEl("button", {
        text: "검색 지우기",
        cls: "mod-cta",
        attr: { type: "button" },
      });
      clearSearch.addEventListener("click", () => {
        this.searchQuery = "";
        if (this.searchInput) this.searchInput.value = "";
        this.render();
      });
      return;
    }

    const add = actions.createEl("button", {
      text: "캐릭터 추가",
      cls: "mod-cta",
      attr: { type: "button" },
    });
    add.addEventListener("click", addCharacter);
  }

  private renderGroups(main: HTMLElement, records: CharacterRecord[]): void {
    // Section headers = non-empty `그룹` only (장르 is the top archive select).
    const present = [...new Set(records.map((r) => r.그룹.trim()))];
    const genre = this.activeArchive().trim();
    const preferred = resolveGroupOrder(
      getGroupOrderFor(this.plugin.settings, this.pageLibrary(), genre),
      present,
    );
    const groups = this.store.groupByGroup(records, preferred);

    for (const [label, list] of groups) {
      const section = main.createDiv({ cls: "charinfo-genre" });
      const rawGroup = list[0]?.그룹.trim() ?? "";
      section.dataset.group = label;
      section.dataset.groupRaw = rawGroup;

      if (rawGroup) {
        section.dataset.id = rawGroup;
        const heading = section.createDiv({ cls: "charinfo-genre__header" });
        const titleRow = heading.createDiv({ cls: "charinfo-genre__title-row" });

        if (this.editMode) {
          const handle = titleRow.createDiv({
            cls: "charinfo-genre__drag-handle",
            attr: {
              title: "드래그해서 그룹 순서 변경",
              "aria-label": "그룹 순서 변경",
            },
          });
          setIcon(handle, "grip-vertical");
        }

        titleRow.createEl("h3", {
          text: rawGroup,
          attr: { title: "그룹" },
        });
        titleRow.createSpan({
          cls: "charinfo-genre__count",
          text: String(list.length),
        });

        if (this.editMode) {
          heading.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.openGroupContextMenu(event, rawGroup, preferred);
          });
          attachHoldDrag(section, rawGroup, {
            canDrag: () => this.editMode,
            activation: "move",
            movePx: 4,
            handleSelector: ".charinfo-genre__drag-handle, .charinfo-genre__header",
            dropSelector: ".charinfo-genre[data-id]",
            ghostClass: "charinfo-genre-ghost",
            slotClass: "charinfo-genre-slot",
            onReorder: (fromId, toId, place) => {
              this.suppressClick = true;
              void this.handleGroupReorder(fromId, toId, place);
            },
          });
        }
      }

      const grid = section.createDiv({ cls: "charinfo-grid" });
      for (const record of list) {
        this.renderCard(grid, record);
      }
      if (this.editMode) {
        this.renderAddCard(grid, rawGroup);
      }
    }
  }

  private openGroupContextMenu(
    event: MouseEvent,
    group: string,
    order: string[],
  ): void {
    const menu = new Menu();
    const index = order.indexOf(group);
    if (index < 0) return;

    menu.addItem((item) => {
      item
        .setTitle("맨 위로")
        .setDisabled(index === 0)
        .onClick(() => {
          const first = order[0];
          if (!first) return;
          void this.persistGroupOrderForActive(
            moveInOrder(order, group, first, "before"),
          );
        });
    });
    menu.addItem((item) => {
      item
        .setTitle("위로")
        .setDisabled(index === 0)
        .onClick(() => {
          const above = order[index - 1];
          if (!above) return;
          void this.persistGroupOrderForActive(
            moveInOrder(order, group, above, "before"),
          );
        });
    });
    menu.addItem((item) => {
      item
        .setTitle("아래로")
        .setDisabled(index >= order.length - 1)
        .onClick(() => {
          const below = order[index + 1];
          if (!below) return;
          void this.persistGroupOrderForActive(
            moveInOrder(order, group, below, "after"),
          );
        });
    });
    menu.addItem((item) => {
      item
        .setTitle("맨 아래로")
        .setDisabled(index >= order.length - 1)
        .onClick(() => {
          const last = order[order.length - 1];
          if (!last) return;
          void this.persistGroupOrderForActive(
            moveInOrder(order, group, last, "after"),
          );
        });
    });
    menu.showAtMouseEvent(event);
  }

  private async handleGroupReorder(
    fromId: string,
    toId: string,
    place: "before" | "after",
  ): Promise<void> {
    const genre = this.activeArchive().trim();
    if (!genre || !fromId || !toId || fromId === toId) return;

    const filtered = this.records.filter((r) => r.장르 === genre);
    const present = [...new Set(filtered.map((r) => r.그룹.trim()))];
    const current = resolveGroupOrder(
      getGroupOrderFor(this.plugin.settings, this.pageLibrary(), genre),
      present,
    );
    const next = moveInOrder(current, fromId, toId, place);
    if (next.join("\0") === current.join("\0")) return;

    this.moveDomItem(
      `.charinfo-genre[data-id="${CSS.escape(fromId)}"]`,
      `.charinfo-genre[data-id="${CSS.escape(toId)}"]`,
      place,
    );
    await this.persistGroupOrderForActive(next, false);
  }

  private async persistGroupOrderForActive(
    order: string[],
    rerender = true,
  ): Promise<void> {
    const genre = this.activeArchive().trim();
    if (!genre) return;
    setGroupOrderFor(this.plugin.settings, this.pageLibrary(), genre, order);
    await this.plugin.saveSettings();
    if (rerender) this.render();
  }

  private renderAddCard(grid: HTMLElement, groupRaw: string): void {
    const card = grid.createEl("button", {
      cls: "charinfo-card charinfo-card--add",
      attr: {
        type: "button",
        "aria-label": "캐릭터 추가",
      },
    });
    // Same geometry as a real card (cover 2:3 + meta band); + floats centered.
    card.createDiv({ cls: "charinfo-card__cover" });
    const ghost = card.createDiv({
      cls: "charinfo-card__meta charinfo-card__meta--ghost",
      attr: { "aria-hidden": "true" },
    });
    ghost.createDiv({ cls: "charinfo-card__title", text: "\u00a0" });
    const center = card.createDiv({ cls: "charinfo-card__add-center" });
    const icon = center.createDiv({ cls: "charinfo-card__add-icon" });
    setIcon(icon, "plus");

    let creating = false;
    card.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (creating) return;
      creating = true;
      card.setAttr("aria-busy", "true");
      card.addClass("is-busy");
      void createCharacterNote(this.plugin, {
        genre: this.activeArchive().trim(),
        group: groupRaw,
        library: this.pageLibrary(),
      })
        .catch((error) => {
          console.error(error);
          new Notice(
            `추가 실패: ${error instanceof Error ? error.message : String(error)}`,
          );
        })
        .finally(() => {
          creating = false;
          card.removeAttribute("aria-busy");
          card.removeClass("is-busy");
        });
    });
  }

  private renderCard(grid: HTMLElement, record: CharacterRecord): void {
    const card = grid.createDiv({
      cls:
        "charinfo-card" +
        (this.selected?.path === record.path ? " is-selected" : "") +
        (this.editMode ? " is-editable" : ""),
    });
    card.dataset.path = record.path;
    card.addEventListener("click", () => {
      if (this.suppressClick) {
        this.suppressClick = false;
        return;
      }
      // Re-tap selected card closes the side panel.
      if (this.peekOpen && this.selected?.path === record.path) {
        this.closePeek();
        return;
      }
      this.selectCard(record);
    });

    if (this.editMode) {
      card.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openCardContextMenu(event, record);
      });

      const handle = card.createDiv({
        cls: "charinfo-card__drag-handle",
        attr: {
          title: "드래그해서 순서 변경",
          "aria-label": "순서 변경",
        },
      });
      setIcon(handle, "grip-vertical");
      attachHoldDrag(card, record.path, {
        canDrag: () => this.editMode,
        activation: "move",
        movePx: 2,
        // Handle or title band — cover stays free for pan / picker.
        handleSelector: ".charinfo-card__drag-handle, .charinfo-card__meta",
        ignoreSelector: ".charinfo-card__cover",
        onReorder: (fromPath, toPath, place) => {
          this.suppressClick = true;
          void this.handleReorder(fromPath, toPath, place);
        },
      });
    } else {
      // Read mode: still allow discovering cover change via context menu.
      card.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openReadCardContextMenu(event, record);
      });
    }

    const cover = card.createDiv({ cls: "charinfo-card__cover" });
    const coverRef = resolveCover(this.app, record);
    let coverImg: HTMLImageElement | null = null;
    if (coverRef) {
      coverImg = cover.createEl("img", {
        attr: {
          src: coverDisplaySrc(this.app, coverRef),
          alt: record.title,
          loading: "lazy",
        },
      });
      coverImg.draggable = false;
      coverImg.style.objectPosition = record.coverPosition || "50% 50%";
    } else {
      cover.createSpan({ text: "커버 없음", cls: "charinfo-card__cover-empty" });
    }

    if (this.editMode) {
      this.attachCoverEdit(cover, coverImg, record);
    }

    const meta = card.createDiv({ cls: "charinfo-card__meta" });
    this.renderViewProperties(meta, record, {
      interactiveStatus: this.editMode,
      surface: "card",
    });
  }

  /**
   * Card: only eye-visible properties.
   * Peek (side panel): every non-systemic property (CARD_PROPERTY_DEFS), ignoring eye toggles.
   */
  private renderViewProperties(
    parent: HTMLElement,
    record: CharacterRecord,
    opts: {
      interactiveStatus?: boolean;
      surface: "card" | "peek";
    },
  ): void {
    const primary = this.filterAxis();
    const status = axisFor(this.plugin.settings, "status");
    /** status always gets a pill; the primary axis gets one too. */
    const pillAxis = (id: CardPropertyId): FilterAxis | null => {
      if (id === "status") return status;
      if (id === primary.propertyId) return primary;
      return null;
    };

    if (opts.surface === "peek") {
      for (const def of CARD_PROPERTY_DEFS) {
        if (def.id === "name") continue; // title lives in peek header
        if (def.id === "tags") {
          // Multi-value: a chip cluster, not a pill. Hidden when empty in read.
          if (!record.태그.length && !opts.interactiveStatus) continue;
          const row = parent.createDiv({ cls: "charinfo-detail__prop" });
          row.createSpan({
            text: this.propLabel("tags"),
            cls: "charinfo-detail__prop-label",
          });
          this.renderTagCluster(row, record, {
            interactive: opts.interactiveStatus,
            surface: "peek",
          });
          continue;
        }
        const axis = pillAxis(def.id);
        if (axis) {
          // Peek always shows the pill, even when the value is unset.
          const row = parent.createDiv({ cls: "charinfo-detail__prop" });
          row.createSpan({
            text: this.propLabel(def.id),
            cls: "charinfo-detail__prop-label",
          });
          const chips = row.createDiv({ cls: "charinfo-card__chips" });
          this.renderAxisPill(chips, record, axis, {
            interactive: opts.interactiveStatus,
          });
          continue;
        }
        const value = propertyValue(record, def.id).trim();
        if (!value) continue;
        const row = parent.createDiv({ cls: "charinfo-detail__prop" });
        row.createSpan({
          text: this.propLabel(def.id),
          cls: "charinfo-detail__prop-label",
        });
        row.createSpan({ text: value });
      }
      return;
    }

    const prefs = visibleCardProperties(this.plugin.settings.cardProperties);
    // Tags drive the chip row on this page → always show them, eye or not.
    if (primary.propertyId === "tags" && !prefs.some((p) => p.id === "tags")) {
      prefs.push({ id: "tags", visible: true });
    }
    for (const pref of prefs) {
      if (pref.id === "name") {
        const title = propertyValue(record, "name");
        if (title) {
          parent.createDiv({ cls: "charinfo-card__title", text: title });
        }
        continue;
      }
      if (pref.id === "tags") {
        if (!record.태그.length && !opts.interactiveStatus) continue;
        this.renderTagCluster(parent, record, {
          interactive: opts.interactiveStatus,
          surface: "card",
        });
        continue;
      }
      const axis = pillAxis(pref.id);
      if (axis) {
        // Card pills follow the eye toggles. Unset non-status values stay hidden
        // in read mode; edit mode keeps the ghost so a value can be assigned.
        if (
          axis.propertyId !== "status" &&
          !opts.interactiveStatus &&
          !recordAxisValue(record, axis.propertyId).trim()
        ) {
          continue;
        }
        const chips = parent.createDiv({
          cls: "charinfo-card__chips",
        });
        this.renderAxisPill(chips, record, axis, {
          interactive: opts.interactiveStatus,
        });
        continue;
      }

      const value = propertyValue(record, pref.id).trim();
      if (!value) continue;
      parent.createDiv({
        cls: "charinfo-card__prop",
        text: value,
        attr: { "data-prop": pref.id },
      });
    }
  }

  /**
   * Tag chips for `태그`. Neutral style (no per-tag color in v1); ids missing
   * from `tagVocab` stay gray ghosts. Edit mode adds a trigger that opens the
   * checklist popover.
   */
  private renderTagCluster(
    parent: HTMLElement,
    record: CharacterRecord,
    opts: { interactive?: boolean; surface: "card" | "peek" },
  ): HTMLElement {
    const wrap = parent.createDiv({
      cls: "charinfo-tags",
      attr: { "data-prop": "tags" },
    });
    this.fillTagCluster(wrap, record, opts);
    return wrap;
  }

  private fillTagCluster(
    wrap: HTMLElement,
    record: CharacterRecord,
    opts: { interactive?: boolean; surface: "card" | "peek" },
  ): void {
    wrap.empty();
    const vocab = this.plugin.settings.tagVocab;
    const known = new Map(vocab.map((t) => [t.id, t.label]));
    const ids = record.태그;
    const shown = opts.surface === "card" ? ids.slice(0, CARD_TAG_LIMIT) : ids;
    for (const id of shown) {
      wrap.createSpan({
        cls: "charinfo-tag" + (known.has(id) ? "" : " is-ghost"),
        text: known.get(id) ?? id,
      });
    }
    const hidden = ids.length - shown.length;
    if (hidden > 0) {
      wrap.createSpan({
        cls: "charinfo-tag charinfo-tag--more",
        text: `+${hidden}`,
      });
    }
    if (!opts.interactive) return;

    const trigger = wrap.createEl("button", {
      cls: "charinfo-tag charinfo-tag--edit",
      text: ids.length ? "+" : "태그",
      attr: {
        type: "button",
        title: "태그 고르기",
        "aria-label": "태그 고르기",
      },
    });
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      // Second click on the same card closes it; a popover that already closed
      // itself (outside click, scroll, Escape) reopens.
      if (this.tagMenuPath === record.path && this.tagMenu?.isOpen()) {
        this.closeTagMenu();
        return;
      }
      // Anchor on the cluster, not the button: the button is re-rendered on
      // every toggle while the popover stays open.
      this.openTagChecklist(wrap, record);
    });
  }

  private openTagChecklist(anchor: HTMLElement, record: CharacterRecord): void {
    this.closeTagMenu();
    this.tagMenuPath = record.path;
    this.tagMenu = new TagChecklistPopover(
      anchor,
      this.contentEl,
      this.plugin.settings.tagVocab,
      {
        getSelected: () => [...record.태그],
        toggle: (id, next) => this.toggleRecordTag(record, id, next),
      },
    );
    this.tagMenu.open();
  }

  private closeTagMenu(): void {
    this.tagMenu?.close();
    this.tagMenu = null;
    this.tagMenuPath = "";
  }

  private async toggleRecordTag(
    record: CharacterRecord,
    id: string,
    next: boolean,
  ): Promise<void> {
    const current = record.태그;
    const ids = next
      ? current.includes(id)
        ? current
        : [...current, id]
      : current.filter((x) => x !== id);

    this.plugin.suppressGalleryRefresh = true;
    try {
      await setCharacterTags(this.app, record.file, ids);
    } catch (error) {
      new Notice(
        `태그 저장 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    } finally {
      this.plugin.suppressGalleryRefresh = false;
    }
    const axis = this.filterAxis();
    const onActiveAxis = axis.propertyId === "tags";
    // Read the pre-write chip/membership — both are derived from `records`.
    const chipBefore = onActiveAxis ? this.chipFilter : "all";
    const wasMatching = onActiveAxis
      ? recordMatchesAxisChip(axis, record, chipBefore)
      : true;

    record.태그 = ids;
    if (onActiveAxis) {
      // A tag may have gained its first occupant or lost its last one.
      this.syncChipRow();
      const chipAfter = this.chipFilter;
      const nowMatching = recordMatchesAxisChip(axis, record, chipAfter);
      if (chipAfter !== chipBefore || wasMatching !== nowMatching) {
        // This card just left the active chip — the grid has to change.
        this.closeTagMenu();
        this.renderBody();
        return;
      }
    }
    this.patchTagClustersInDom(record);
  }

  /** Repaint only this record's clusters (card + peek when it is selected). */
  private patchTagClustersInDom(record: CharacterRecord): void {
    const scopes: { el: HTMLElement; surface: "card" | "peek" }[] = [];
    const card = this.contentEl.querySelector(
      `.charinfo-card[data-path="${CSS.escape(record.path)}"]`,
    );
    if (card instanceof HTMLElement) scopes.push({ el: card, surface: "card" });
    if (this.selected?.path === record.path) {
      const detail = this.contentEl.querySelector(".charinfo-gallery__detail");
      if (detail instanceof HTMLElement) {
        scopes.push({ el: detail, surface: "peek" });
      }
    }
    for (const scope of scopes) {
      scope.el
        .querySelectorAll('.charinfo-tags[data-prop="tags"]')
        .forEach((el) => {
          if (!(el instanceof HTMLElement)) return;
          this.fillTagCluster(el, record, {
            interactive: this.editMode,
            surface: scope.surface,
          });
        });
    }
  }

  /** Notion-like pill from an axis vocabulary. Interactive only in edit. */
  private renderAxisPill(
    parent: HTMLElement,
    record: CharacterRecord,
    axis: FilterAxis,
    opts: { interactive?: boolean } = {},
  ): void {
    const option = resolveAxisOption(
      axis,
      recordAxisValue(record, axis.propertyId),
    );
    const colorCls = statusColorClass(option.color);
    if (!opts.interactive) {
      const tag = parent.createSpan({
        cls: `charinfo-status is-static ${colorCls}`,
        attr: { "aria-label": option.label, "data-prop": axis.propertyId },
      });
      tag.createSpan({ cls: "charinfo-status__dot" });
      tag.createSpan({
        cls: "charinfo-status__label",
        text: option.label,
      });
      return;
    }

    const tag = parent.createEl("button", {
      cls: `charinfo-status ${colorCls}`,
      attr: {
        type: "button",
        "aria-label": option.label,
        "data-prop": axis.propertyId,
        title: `${axis.label} 바꾸기`,
      },
    });
    tag.createSpan({ cls: "charinfo-status__dot" });
    tag.createSpan({
      cls: "charinfo-status__label",
      text: option.label,
    });

    const openMenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const menu = new Menu();
      for (const s of axis.options) {
        menu.addItem((item) =>
          item
            .setTitle(s.label)
            .setChecked(s.id === option.id)
            .onClick(() => {
              void this.setAxisValue(record, axis.propertyId, s.id);
            }),
        );
      }
      // Status is never blank (legacy Off default); other axes can be cleared.
      if (axis.propertyId !== "status") {
        menu.addItem((item) =>
          item
            .setTitle("없음")
            .setChecked(!option.id)
            .onClick(() => {
              void this.setAxisValue(record, axis.propertyId, "");
            }),
        );
      }
      menu.showAtMouseEvent(event);
    };
    tag.addEventListener("click", openMenu);
    tag.addEventListener("contextmenu", openMenu);
  }

  private async setAxisValue(
    record: CharacterRecord,
    propertyId: PrimaryFilterProperty,
    value: string,
  ): Promise<void> {
    const axis = axisFor(this.plugin.settings, propertyId);
    this.plugin.suppressGalleryRefresh = true;
    try {
      await setCharacterField(this.app, record.file, axis.fmKey, value);
    } finally {
      this.plugin.suppressGalleryRefresh = false;
    }
    const activeAxis = this.filterAxis();
    const onActiveAxis = propertyId === activeAxis.propertyId;
    // Read the pre-write chip/membership — both are derived from `records`.
    const chipBefore = onActiveAxis ? this.chipFilter : "all";
    const wasMatching = onActiveAxis
      ? recordMatchesAxisChip(activeAxis, record, chipBefore)
      : true;

    setRecordAxisValue(record, propertyId, value);
    this.patchPillInDom(record, axis);
    if (!onActiveAxis) return;

    // Occupancy just moved: the old option may be empty now, the new one new.
    this.syncChipRow();
    const chipAfter = this.chipFilter;
    const nowMatching = recordMatchesAxisChip(activeAxis, record, chipAfter);
    if (chipAfter !== chipBefore || wasMatching !== nowMatching) {
      this.renderBody();
    }
  }

  private patchPillInDom(record: CharacterRecord, axis: FilterAxis): void {
    const option = resolveAxisOption(
      axis,
      recordAxisValue(record, axis.propertyId),
    );
    const colorCls = statusColorClass(option.color);
    const colorTokens = [
      "is-green",
      "is-gray",
      "is-amber",
      "is-blue",
      "is-red",
      "is-violet",
      "is-cyan",
      "is-pink",
      "is-on",
      "is-off",
    ];
    const card = this.contentEl.querySelector(
      `.charinfo-card[data-path="${CSS.escape(record.path)}"]`,
    );
    const scopes: Element[] = [];
    if (card) scopes.push(card);
    const detail = this.contentEl.querySelector(".charinfo-gallery__detail");
    if (detail) scopes.push(detail);
    for (const scope of scopes) {
      scope
        .querySelectorAll(`.charinfo-status[data-prop="${axis.propertyId}"]`)
        .forEach((el) => {
          for (const c of colorTokens) el.classList.remove(c);
          el.classList.add(colorCls);
          const label = el.querySelector(".charinfo-status__label");
          if (label) label.setText(option.label);
          el.setAttribute("aria-label", option.label);
        });
    }
  }

  private selectCard(record: CharacterRecord): void {
    this.selected = record;
    this.peekOpen = true;
    this.contentEl.toggleClass("is-peek-open", true);
    this.contentEl.querySelectorAll(".charinfo-card.is-selected").forEach((el) => {
      el.classList.remove("is-selected");
    });
    const card = this.contentEl.querySelector(
      `.charinfo-card[data-path="${CSS.escape(record.path)}"]`,
    );
    card?.classList.add("is-selected");
    const detail = this.contentEl.querySelector(".charinfo-gallery__detail");
    if (detail instanceof HTMLElement) void this.renderDetail(detail);
  }

  /** Select a card by path after create/refresh. */
  selectByPath(path: string): void {
    const record = this.records.find((r) => r.path === path);
    if (record) this.selectCard(record);
  }

  /** After create: stay on the gallery, show the new card, open peek. */
  async revealNewCard(path: string): Promise<void> {
    await this.refresh();
    const record = this.records.find((r) => r.path === path);
    if (!record) return;
    const axis = this.filterAxis();
    if (
      this.chipFilter !== "all" &&
      !recordMatchesAxisChip(axis, record, this.chipFilter)
    ) {
      await this.setChipFilter("all");
    }
    this.selectByPath(path);
  }

  /** Read-mode card menu: open note / jump to cover edit. */
  private openReadCardContextMenu(
    event: MouseEvent,
    record: CharacterRecord,
  ): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("노트 열기")
        .setIcon("file-text")
        .onClick(() => {
          void this.openCharacterNote(record.file);
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("공유")
        .setIcon("globe")
        .onClick(() => {
          void this.shareCharacterNoteLink(record);
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("커버 바꾸기")
        .setIcon("image")
        .onClick(() => {
          this.editMode = true;
          this.render();
          void this.openCoverPicker(record);
        }),
    );
    menu.showAtMouseEvent(event);
  }

  /** Edit-mode card menu: open / cover / delete. */
  private openCardContextMenu(event: MouseEvent, record: CharacterRecord): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("노트 열기")
        .setIcon("file-text")
        .onClick(() => {
          void this.openCharacterNote(record.file);
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("공유")
        .setIcon("globe")
        .onClick(() => {
          void this.shareCharacterNoteLink(record);
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("커버 바꾸기")
        .setIcon("image")
        .onClick(() => {
          void this.openCoverPicker(record);
        }),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("삭제")
        .setIcon("trash")
        .setWarning(true)
        .onClick(() => {
          void this.deleteCharacter(record);
        }),
    );
    menu.showAtMouseEvent(event);
  }

  private async deleteCharacter(record: CharacterRecord): Promise<void> {
    const label = record.title || record.file.basename;
    const ok = window.confirm(
      `「${label}」 노트를 삭제할까요?\n휴지통으로 이동합니다.`,
    );
    if (!ok) return;

    const path = record.path;
    this.plugin.suppressGalleryRefresh = true;
    try {
      await this.app.fileManager.trashFile(record.file);
    } catch (error) {
      console.error(error);
      new Notice(
        `삭제 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    } finally {
      this.plugin.suppressGalleryRefresh = false;
    }

    this.records = this.records.filter((r) => r.path !== path);
    if (this.selected?.path === path) {
      this.closePeek();
    }
    new Notice(`「${label}」을(를) 삭제했어요`);
    // Losing a card can empty an option — reconcile the row in the same frame.
    this.syncChipRow();
    this.renderBody();
  }

  /**
   * Edit cover:
   * - hold-drag → reposition (no 위치 button)
   * - click / corner icon → replace popup
   */
  private attachCoverEdit(
    cover: HTMLElement,
    coverImg: HTMLImageElement | null,
    record: CharacterRecord,
  ): void {
    cover.addClass("is-editable-cover");

    const hint = cover.createDiv({
      cls: "charinfo-card__cover-hint",
      text: coverImg ? "드래그 · 위치" : "클릭 · 커버 추가",
    });

    const editBtn = cover.createEl("button", {
      cls: "charinfo-card__cover-edit is-always-on",
      attr: {
        type: "button",
        title: "커버 바꾸기",
        "aria-label": "커버 바꾸기",
      },
    });
    setIcon(editBtn, "image");
    editBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.openCoverPicker(record);
    });

    cover.addEventListener("contextmenu", (event) => {
      // Card-level menu (includes delete) — don't open picker on right-click.
      event.preventDefault();
      event.stopPropagation();
      this.openCardContextMenu(event, record);
    });

    if (!coverImg) {
      cover.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest(".charinfo-card__cover-edit")) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.suppressClick = true;
        void this.openCoverPicker(record);
        window.setTimeout(() => {
          this.suppressClick = false;
        }, 0);
      });
      return;
    }

    const MOVE_PX = 5;
    let pointerId = -1;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let dragging = false;
    let armed = false;
    let pos = this.parseCoverPos(record.coverPosition);

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest(".charinfo-card__cover-edit")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      pointerId = event.pointerId;
      startX = lastX = event.clientX;
      startY = lastY = event.clientY;
      dragging = false;
      armed = true;
      pos = this.parseCoverPos(record.coverPosition);
      try {
        cover.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    };

    const onMove = (event: PointerEvent) => {
      if (!armed || event.pointerId !== pointerId) return;
      const totalDx = event.clientX - startX;
      const totalDy = event.clientY - startY;
      if (!dragging) {
        if (totalDx * totalDx + totalDy * totalDy < MOVE_PX * MOVE_PX) return;
        dragging = true;
        cover.addClass("is-repositioning");
        hint.setText("놓는 중…");
        this.suppressClick = true;
      }
      event.preventDefault();
      const rect = cover.getBoundingClientRect();
      const stepX = ((event.clientX - lastX) / Math.max(rect.width, 1)) * 100;
      const stepY = ((event.clientY - lastY) / Math.max(rect.height, 1)) * 100;
      lastX = event.clientX;
      lastY = event.clientY;
      pos = {
        x: Math.max(0, Math.min(100, pos.x - stepX)),
        y: Math.max(0, Math.min(100, pos.y - stepY)),
      };
      coverImg.style.objectPosition = `${Math.round(pos.x)}% ${Math.round(pos.y)}%`;
    };

    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId && event.type !== "pointercancel") return;
      armed = false;
      try {
        cover.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }

      if (dragging) {
        cover.removeClass("is-repositioning");
        hint.setText("드래그 · 위치");
        const next = `${Math.round(pos.x)}% ${Math.round(pos.y)}%`;
        record.coverPosition = next;
        this.plugin.suppressGalleryRefresh = true;
        void setCoverPosition(this.app, record.file, next).finally(() => {
          this.plugin.suppressGalleryRefresh = false;
        });
        window.setTimeout(() => {
          this.suppressClick = false;
        }, 0);
      } else {
        this.suppressClick = true;
        event.preventDefault();
        event.stopPropagation();
        void this.openCoverPicker(record);
        window.setTimeout(() => {
          this.suppressClick = false;
        }, 0);
      }
      dragging = false;
      pointerId = -1;
    };

    cover.addEventListener("pointerdown", onDown);
    cover.addEventListener("pointermove", onMove);
    cover.addEventListener("pointerup", onUp);
    cover.addEventListener("pointercancel", onUp);
  }

  private parseCoverPos(raw: string | undefined): { x: number; y: number } {
    const m = (raw || "50% 50%").match(/(\d{1,3})%\s+(\d{1,3})%/);
    return {
      x: m ? Number(m[1]) : 50,
      y: m ? Number(m[2]) : 50,
    };
  }

  private async openCoverPicker(record: CharacterRecord): Promise<void> {
    const markdown = await this.app.vault.cachedRead(record.file);
    const images = listCharacterImages(this.app, record, markdown);

    new CoverPickerModal(
      this.app,
      this.plugin,
      record,
      images,
      async (pick) => {
        if (pick.kind === "default") {
          await this.changeCover(record, null, false);
        } else if (pick.kind === "remote") {
          await this.changeCoverRemote(record, pick.url, false);
        } else {
          await this.changeCover(record, pick.file, false);
        }
        // Refresh after modal closes — sync render while Modal is open crashes UI.
        window.setTimeout(() => {
          this.render();
          this.selectByPath(record.path);
        }, 0);
      },
    ).open();
  }

  private async changeCover(
    record: CharacterRecord,
    image: TFile | null,
    refresh = true,
  ): Promise<void> {
    this.plugin.suppressGalleryRefresh = true;
    try {
      await setCharacterCover(this.app, record.file, image);
      record.cover = image ? image.path : "";
      record.coverPosition = image ? "50% 50%" : record.coverPosition;
    } finally {
      this.plugin.suppressGalleryRefresh = false;
    }
    new Notice(
      image
        ? `커버를 「${image.basename}」으로 바꿨어요`
        : "노트 첫 이미지를 커버로 쓸게요",
    );
    if (refresh) this.render();
    else this.syncCoverPreview(record);
  }

  private async changeCoverRemote(
    record: CharacterRecord,
    url: string,
    refresh = true,
  ): Promise<void> {
    this.plugin.suppressGalleryRefresh = true;
    try {
      await setCharacterCoverUrl(this.app, record.file, url);
      record.cover = url;
      record.coverPosition = "50% 50%";
    } finally {
      this.plugin.suppressGalleryRefresh = false;
    }
    new Notice("원격 이미지로 커버를 바꿨어요");
    if (refresh) this.render();
    else this.syncCoverPreview(record);
  }

  private async handleImageReorder(
    record: CharacterRecord,
    fromPath: string,
    toPath: string,
    place: "before" | "after",
  ): Promise<void> {
    const markdown = await this.app.vault.read(record.file);
    let images = listEmbedImages(this.app, record.file, markdown).map(
      (f) => f.path,
    );
    // If embeds < 2, fall back to full candidate list written as embeds order only
    if (images.length < 2) {
      images = listCharacterImages(this.app, record, markdown).map((f) => f.path);
    }
    if (images.length < 2) {
      new Notice("순서를 바꿀 이미지가 아직 없어요")
      return;
    }

    const fromIndex = images.indexOf(fromPath);
    const toIndex = images.indexOf(toPath);
    if (fromIndex < 0 || toIndex < 0) return;

    const [moved] = images.splice(fromIndex, 1);
    if (!moved) return;
    let insertAt = images.indexOf(toPath);
    if (insertAt < 0) return;
    if (place === "after") insertAt += 1;
    images.splice(insertAt, 0, moved);

    this.plugin.suppressGalleryRefresh = true;
    try {
      await reorderNoteImages(this.app, record.file, images);
    } finally {
      this.plugin.suppressGalleryRefresh = false;
    }

    // Move thumbs in-place — no full gallery refresh.
    this.moveDomItem(
      `.charinfo-thumb[data-id="${CSS.escape(fromPath)}"]`,
      `.charinfo-thumb[data-id="${CSS.escape(toPath)}"]`,
      place,
    );
    this.syncCoverPreview(record, images);
    this.suppressClick = true;
  }

  /**
   * After a cover change without full `render()` (peek strip / reorder):
   * keep card face + strip badge in sync every time — not only the first write.
   */
  private syncCoverPreview(
    record: CharacterRecord,
    orderedPaths?: string[],
  ): void {
    const resolved = resolveCover(this.app, record);
    const resolvedVaultPath =
      resolved?.kind === "vault" ? resolved.file.path : null;

    const strip = this.contentEl.querySelector(".charinfo-image-strip__row");
    if (strip) {
      strip.querySelectorAll(".charinfo-thumb").forEach((thumb) => {
        if (!(thumb instanceof HTMLElement)) return;
        const id = thumb.dataset.id ?? "";
        const isCover =
          !!resolvedVaultPath &&
          (id === resolvedVaultPath ||
            resolvedVaultPath.endsWith(`/${id}`) ||
            id.endsWith(`/${resolvedVaultPath}`));
        thumb.classList.toggle("is-cover", isCover);
        thumb.querySelector(".charinfo-thumb__badge")?.remove();
        if (isCover) {
          thumb.setAttribute("title", "현재 커버");
        } else {
          thumb.removeAttribute("title");
        }
      });
    }

    const coverEl = this.contentEl.querySelector(
      `.charinfo-card[data-path="${CSS.escape(record.path)}"] .charinfo-card__cover`,
    );
    if (!(coverEl instanceof HTMLElement)) return;

    let cardImg = coverEl.querySelector("img");
    const applySrc = (src: string) => {
      if (!(cardImg instanceof HTMLImageElement)) {
        coverEl.querySelector(".charinfo-card__cover-empty")?.remove();
        cardImg = coverEl.createEl("img", {
          attr: { alt: record.title || record.이름 || "", draggable: "false" },
        });
        cardImg.draggable = false;
      }
      // Bust cached resource URLs so a second swap always paints.
      const joiner = src.includes("?") ? "&" : "?";
      cardImg.src = `${src}${joiner}v=${Date.now()}`;
      cardImg.style.objectPosition = record.coverPosition || "50% 50%";
    };

    if (resolved) {
      applySrc(coverDisplaySrc(this.app, resolved));
      return;
    }

    if (orderedPaths?.[0]) {
      const file = this.app.vault.getAbstractFileByPath(orderedPaths[0]);
      if (file instanceof TFile) {
        applySrc(this.app.vault.getResourcePath(file));
        return;
      }
    }

    if (cardImg instanceof HTMLImageElement) {
      cardImg.remove();
    }
    if (!coverEl.querySelector(".charinfo-card__cover-empty")) {
      coverEl.createSpan({ text: "커버 없음", cls: "charinfo-card__cover-empty" });
    }
  }

  private moveDomItem(
    fromSelector: string,
    toSelector: string,
    place: "before" | "after",
  ): void {
    const fromEl = this.contentEl.querySelector(fromSelector);
    const toEl = this.contentEl.querySelector(toSelector);
    if (!(fromEl instanceof HTMLElement) || !(toEl instanceof HTMLElement)) return;
    const parent = toEl.parentElement;
    if (!parent || fromEl.parentElement !== parent) {
      // Cross-container: append near target anyway
      if (place === "before") toEl.parentElement?.insertBefore(fromEl, toEl);
      else toEl.parentElement?.insertBefore(fromEl, toEl.nextSibling);
      return;
    }
    if (place === "before") parent.insertBefore(fromEl, toEl);
    else parent.insertBefore(fromEl, toEl.nextSibling);
  }

  private async handleReorder(
    fromPath: string,
    toPath: string,
    place: "before" | "after",
  ): Promise<void> {
    if (this.sortMode !== "manual") {
      this.plugin.settings.sortMode = "manual";
      await this.plugin.saveSettings();
      this.showGalleryTip("표시 순서를 「자유」로 맞춰 두고, 지금 자리를 저장해요");
    }

    const from = this.records.find((r) => r.path === fromPath);
    const to = this.records.find((r) => r.path === toPath);
    if (!from || !to) return;

    const genre = to.장르;
    const group = to.그룹;
    const genreChanged = from.장르 !== genre;
    const groupChanged = from.그룹 !== group;
    from.장르 = genre;
    from.그룹 = group;

    const inGenre = this.records.filter(
      (r) => r.장르 === genre && r.path !== fromPath,
    );
    const toIndex = inGenre.findIndex((r) => r.path === toPath);
    if (toIndex < 0) return;
    const insertAt = place === "before" ? toIndex : toIndex + 1;
    inGenre.splice(insertAt, 0, from);

    // Instant visual reorder — don't wait for disk.
    this.moveDomItem(
      `.charinfo-card[data-path="${CSS.escape(fromPath)}"]`,
      `.charinfo-card[data-path="${CSS.escape(toPath)}"]`,
      place,
    );
    this.syncGroupSectionChrome();

    this.records = sortCharacters(this.records, "manual");

    this.plugin.suppressGalleryRefresh = true;
    try {
      if (genreChanged || groupChanged) {
        await this.app.fileManager.processFrontMatter(from.file, (fm) => {
          if (genreChanged) fm.장르 = genre;
          if (groupChanged) fm.그룹 = group;
        });
      }
      await persistGenreOrder(this.app, inGenre);
    } finally {
      this.plugin.suppressGalleryRefresh = false;
    }
  }

  /** After cross-group DOM moves: drop empty sections. */
  private syncGroupSectionChrome(): void {
    this.contentEl.querySelectorAll(".charinfo-genre").forEach((section) => {
      if (!(section instanceof HTMLElement)) return;
      const grid = section.querySelector(".charinfo-grid");
      if (!(grid instanceof HTMLElement)) return;
      if (grid.childElementCount === 0) {
        section.remove();
      }
    });
  }

  private async renderDetail(detail: HTMLElement): Promise<void> {
    const requestId = ++this.detailRequestId;
    detail.empty();
    if (!this.selected) {
      this.peekOpen = false;
      this.contentEl.toggleClass("is-peek-open", false);
      return;
    }

    const record = this.selected;

    const head = detail.createDiv({ cls: "charinfo-detail__head" });
    const back = head.createEl("button", {
      cls: "charinfo-detail__back",
      attr: { type: "button", "aria-label": "닫기" },
    });
    setIcon(back, this.isNarrow ? "chevron-left" : "x");
    back.addEventListener("click", () => this.closePeek());

    const titleWrap = head.createDiv({ cls: "charinfo-detail__title-wrap" });
    titleWrap.createEl("h3", { text: record.title });

    const actions = head.createDiv({ cls: "charinfo-detail__actions" });
    const openBtn = actions.createEl("button", {
      cls: "clickable-icon charinfo-detail__icon-btn",
      attr: {
        type: "button",
        title: "노트 열기",
        "aria-label": "노트 열기",
      },
    });
    setIcon(openBtn, "file-text");
    openBtn.addEventListener("click", () => {
      void this.openCharacterNote(record.file);
    });
    const linkBtn = actions.createEl("button", {
      cls: "clickable-icon charinfo-detail__icon-btn",
      attr: {
        type: "button",
        title: "공유",
        "aria-label": "공유",
      },
    });
    setIcon(linkBtn, "globe");
    linkBtn.addEventListener("click", () => {
      void this.shareCharacterNoteLink(record);
    });

    // Side panel: all non-systemic properties (eye toggles are card-only).
    const props = detail.createDiv({ cls: "charinfo-detail__props" });
    props.createDiv({
      cls: "charinfo-detail__props-label",
      text: "속성",
    });
    this.renderViewProperties(props, record, {
      interactiveStatus: false,
      surface: "peek",
    });
    // Keep the section label even if only status remains; drop if truly empty.
    if (props.querySelectorAll(".charinfo-detail__prop").length === 0) {
      props.remove();
    }

    const markdown = await this.app.vault.cachedRead(record.file);
    if (requestId !== this.detailRequestId || this.selected?.path !== record.path) {
      return;
    }

    await this.renderImageStrip(detail, record, markdown);
    if (requestId !== this.detailRequestId || this.selected?.path !== record.path) {
      return;
    }

    const body = detail.createDiv({ cls: "charinfo-detail__body" });
    renderCleanBody(body, markdown);
  }

  /** Full-page note in this leaf. Gallery reloads (and refreshes) when you return. */
  private async openCharacterNote(file: TFile): Promise<void> {
    // Mark stale for return, but do not schedule work while leaving this leaf.
    this.plugin.markGalleriesDirty({ schedule: false });
    await this.leaf.openFile(file, { active: true });
  }

  /** Single-character web page — same share modal (scope locked). */
  private shareCharacterNoteLink(record: CharacterRecord): void {
    const title = record.title || record.이름 || record.file.basename;
    new ShareGalleryModal(this.plugin, [record], title, {
      selectionLocked: true,
      pageFile: this.file,
    }).open();
  }

  private async renderImageStrip(
    detail: HTMLElement,
    record: CharacterRecord,
    markdown: string,
  ): Promise<void> {
    const images = listCharacterImages(this.app, record, markdown);

    const strip = detail.createDiv({
      cls:
        "charinfo-image-strip" + (this.editMode ? " is-editable" : ""),
    });
    const head = strip.createDiv({ cls: "charinfo-image-strip__head" });
    head.createDiv({
      cls: "charinfo-image-strip__label",
      text: this.editMode ? "이미지 · 탭하면 커버" : "이미지",
    });

    if (images.length === 0) {
      strip.createDiv({
        cls: "charinfo-image-strip__empty",
        text: this.editMode
          ? "이미지가 없어요. 노트에 넣은 뒤 새로고침하세요."
          : "이미지 없음",
      });
      return;
    }

    const coverPath = record.cover
      .replace(/^\[\[|\]\]$/g, "")
      .split("|")[0]
      ?.trim();
    const row = strip.createDiv({ cls: "charinfo-image-strip__row" });

    for (const image of images) {
      const isCover =
        !!coverPath &&
        (image.path === coverPath ||
          image.path.endsWith("/" + coverPath) ||
          image.name === coverPath ||
          image.basename === coverPath);
      const thumb = row.createDiv({
        cls: "charinfo-thumb" + (isCover ? " is-cover" : ""),
        attr: isCover ? { title: "현재 커버" } : undefined,
      });
      thumb.dataset.id = image.path;
      const img = thumb.createEl("img", {
        attr: {
          src: this.app.vault.getResourcePath(image),
          alt: image.basename,
          loading: "lazy",
        },
      });
      img.draggable = false;

      thumb.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!this.editMode) return;
        // changeCover → syncCoverPreview updates card + strip every tap.
        void this.changeCover(record, image, false);
      });

      if (this.editMode && images.length > 1) {
        attachHoldDrag(thumb, image.path, {
          canDrag: () => this.editMode,
          activation: "hold",
          dropSelector: ".charinfo-thumb",
          ghostClass: "charinfo-thumb-ghost",
          slotClass: "charinfo-thumb-slot",
          onReorder: (fromId, toId, place) => {
            void this.handleImageReorder(record, fromId, toId, place);
          },
        });
      }
    }
  }
}
