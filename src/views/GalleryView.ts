import {
  FileView,
  Menu,
  Notice,
  TFile,
  WorkspaceLeaf,
  setIcon,
  Component,
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
  setCharacterCoverNone,
  setCharacterField,
  setCharacterList,
  setCharacterTags,
  setCoverPosition,
  COVER_NONE,
  isCoverNone,
} from "../data/images";
import {
  commitOrderValues,
  planCardReorder,
  renameGenre,
  ReorderLane,
  resolveGroupRouteOrder,
  moveInOrder,
  sortCharacters,
  writeOrderValues,
} from "../data/order";
import { EXAMPLE_ARCHIVE } from "../data/bundledTemplate";
import type { CardPropertyId } from "../data/cardProperties";
import {
  applyGroupDeletion,
  effectiveActiveFields,
  ensureGroupSchema,
  GroupDeletionBlockedError,
  GroupOperationError,
  fieldLabel,
  fieldOptionLabel,
  fieldValue,
  isBuiltinFieldId,
  isChipAxisField,
  isFieldVisible,
  normalizeArchiveKey,
  normalizeGroupKey,
  normalizeLibraryKey,
  persistedGroupsForArchive,
  planGroupDeletion,
  projectSchemaFields,
  reachableActiveFieldIds,
  renameArchiveScope,
  renameGroupRoute,
  renameGroupScope,
  resolveGroupSchema,
  setFieldVisibility,
  unionActiveFieldsForArchive,
  type FieldDef,
  type FieldOption,
  type GroupSchemaRecord,
  type GroupSchemaStore,
} from "../data/groupSchema";
import {
  BatchGroupMoveError,
  BatchMoveConflictError,
  BatchRefreshFreeze,
  MODAL_INERT_REGIONS,
  batchEscapeAction,
  batchInertActive,
  batchModeSurface,
  batchMoveFailureMessage,
  batchMoveSuccessMessage,
  batchNoticeLift,
  describeDestinations,
  disposeBatchDialog,
  executeBatchGroupMove,
  normalizeMoveGroup,
  planBatchGroupMove,
  reconcileBatchSelection,
  runBatchTransaction,
  type BatchModeSurface,
  type BatchMoveEntry,
  type BatchMoveOutcome,
  type BatchMovePlan,
  type BatchWriteResult,
} from "../data/batchGroupMove";
import {
  FILTER_AXIS_IDS,
  axisFor,
  axisLabel,
  getGalleryPageState,
  getGroupOrderFor,
  getGroupRouteOrderFor,
  patchGalleryPageState,
  removeGroupFromOrder,
  renameGroupRouteInOrder,
  recordAxisValue,
  recordMatchesAxisChip,
  resolveAxisOption,
  setGroupOrderFor,
  setGroupRouteOrderFor,
  setRecordAxisValue,
  paintStatusColor,
  type ChipFilter,
  type FilterAxis,
  type PrimaryFilterProperty,
  type SortMode,
  type StatusColorToken,
  type StatusDef,
} from "../settings";
import {
  countAxisOptionOccupants,
  occupiedAxisOptionIds,
} from "../data/filterAxis";
import { normalizeChipFilter } from "../data/status";
import { renderLivePeekBody } from "../ui/livePeekBody";
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
  listGalleryPagePathsForLibrary,
  readGalleryScope,
} from "../page/galleryPage";
import { ShareGalleryModal } from "../ui/ShareGalleryModal";
import { AttrManageModal } from "../ui/AttrManageModal";
import { BatchGroupMoveDialog } from "../ui/BatchGroupMoveDialog";
import { GroupRenameDialog } from "../ui/GroupRenameDialog";
import {
  groupAddProblem,
  groupRenameErrorMessage,
  groupRenameProblem,
  groupRenameSuccessMessage,
  normalizeRenameInput,
} from "../data/groupRename";

export const VIEW_TYPE_CHARINFO_GALLERY = "charinfo-gallery";

const NARROW_PX = 720;
/** Tags shown on a card before collapsing the rest into `+n`. */
const CARD_TAG_LIMIT = 3;
/** Peek placeholder for an unset field — a muted em dash, not “비어 있음”. */
const EMPTY_FIELD_MARK = "—";
/** Narrow bottom-sheet snap heights, as a fraction of the viewport. */
const SHEET_SNAPS = { low: 0.4, mid: 0.55, tall: 0.88 } as const;
type SheetSnap = keyof typeof SHEET_SNAPS;
const SHEET_SNAP_VH: Record<SheetSnap, string> = {
  low: "40vh",
  mid: "55vh",
  tall: "88vh",
};
/**
 * Batch Notice lifetime. The narrow batch bar is raised for exactly this long
 * so it never sits under the native Notice (see `.is-batch-notice`).
 */
const BATCH_NOTICE_MS = 6000;

/**
 * True when a note edit changed anything a card or the property chrome shows.
 * Body-only edits answer false — those only patch the side panel.
 */
function cardProjectionChanged(
  a: CharacterRecord,
  b: CharacterRecord,
): boolean {
  return (
    a.kind !== b.kind ||
    a.이름 !== b.이름 ||
    a.코드네임 !== b.코드네임 ||
    a.본명 !== b.본명 ||
    a.소속 !== b.소속 ||
    a.장르 !== b.장르 ||
    a.작품 !== b.작품 ||
    a.그룹 !== b.그룹 ||
    a.상태 !== b.상태 ||
    a.관계 !== b.관계 ||
    a.인연 !== b.인연 ||
    a.cover !== b.cover ||
    a.coverPosition !== b.coverPosition ||
    a.order !== b.order ||
    a.title !== b.title ||
    a.태그.length !== b.태그.length ||
    a.태그.some((tag, index) => tag !== b.태그[index]) ||
    // Custom group fields live in `values`; an edit made in Obsidian's own
    // Properties panel has to reach the card too.
    customValuesChanged(a, b)
  );
}

/** Any own frontmatter value (custom fields included) that differs. */
function customValuesChanged(a: CharacterRecord, b: CharacterRecord): boolean {
  const keys = new Set([...Object.keys(a.values), ...Object.keys(b.values)]);
  for (const key of keys) {
    const left = a.values[key];
    const right = b.values[key];
    if (Array.isArray(left) || Array.isArray(right)) {
      const one = Array.isArray(left) ? left : left == null ? [] : [left];
      const two = Array.isArray(right) ? right : right == null ? [] : [right];
      if (one.length !== two.length) return true;
      if (one.some((item, index) => item !== two[index])) return true;
      continue;
    }
    if ((left ?? "") !== (right ?? "")) return true;
  }
  return false;
}

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
  /** Field ids some reachable schema still lists — cached per painted scope. */
  private reachableCache: { key: string; ids: Set<string> } | null = null;
  /** Disposable Markdown render host for the side-panel body. */
  private peekBodyChild: Component | null = null;
  /** Monotonic token for note-region patches — stale reads must not commit. */
  private noteRefreshGeneration = 0;
  /** Image strip identity of the painted panel; only a change rebuilds it. */
  private peekStripFingerprint = "";
  private resizeObserver: ResizeObserver | null = null;
  private isNarrow = false;
  private peekOpen = false;
  /** Narrow sheet height — remembered for this view session only. */
  private sheetSnap: SheetSnap = "mid";
  private sheetDrag: {
    pointerId: number;
    startY: number;
    startH: number;
  } | null = null;
  private tipTimer: number | null = null;
  /**
   * 여러 캐릭터 그룹 이동 — one explicit mode with a **captured** scope.
   *
   * The scope is captured on entry and never re-read: search, a chip, or a
   * repaint may hide a selected card, but only a real archive change ends the
   * mode. `batchSelection` therefore holds paths, not records, and survives
   * every repaint that does not change the archive.
   */
  private batchMode = false;
  private batchScope: { library: string; archive: string } | null = null;
  private batchSelection = new Set<string>();
  private batchDialog: BatchGroupMoveDialog | null = null;
  /** True from the first schema write until the transaction settles. */
  private batchSaving = false;
  /** Real per-view transaction guard — `suppressGalleryRefresh` is not one. */
  private batchFreeze = new BatchRefreshFreeze();
  private batchNoticeTimer: number | null = null;
  private groupRenameDialog: GroupRenameDialog | null = null;
  private groupRenameSaving = false;
  private groupRenameSource = "";
  /**
   * Bumped by `onUnloadFile` / `onClose`. A storage callback that outlives its
   * generation may still finish its writes, but must not touch this DOM.
   */
  private uiGeneration = 0;
  private viewClosed = false;
  /**
   * Reorder persistence, serialized per view.
   *
   * A drop is already committed to `records` and to the DOM before anything is
   * queued here, so the lane only has to keep gesture order and to hold the
   * refresh guard for exactly as long as this view's own `order` writes are
   * still settling. `orderFreeze` is that guard: while the lane is active every
   * refresh request collapses into one deferred bit, which is flushed on drain
   * — the moment the vault finally agrees with what the screen already showed.
   */
  private orderFreeze = new BatchRefreshFreeze();
  private orderLane = new ReorderLane({
    onActivate: () => this.orderFreeze.freeze(),
    onDrain: (outcome) => this.settleOrderLane(outcome.failed),
  });
  /** Invalidates a vault scan that began before a newer local drop. */
  private reorderRevision = 0;
  /** Newest gesture's UI generation — what the drain is allowed to repaint. */
  private orderLaneGeneration = 0;
  /** Serialize cover writes per character so rapid strip taps don't race. */
  private coverWriteChain = new Map<string, Promise<void>>();
  /** Latest cover intent per path (coalesce while a write is in flight). */
  private coverLatest = new Map<
    string,
    | { kind: "vault"; file: TFile }
    | { kind: "remote"; url: string }
    | { kind: "default" }
    | { kind: "none" }
  >();

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

  /**
   * The one question every ordinary card handler asks: reorder, cover edit,
   * detail open, property edit, context menu, add tile.
   *
   * Selection mode borrows the whole card, so these must be mutually exclusive
   * with it — a single predicate is the only way that cannot drift apart.
   */
  private get cardEditActive(): boolean {
    return this.batchSurface().cardEditActive;
  }

  /** The whole exclusion table for this mode pair — see `batchModeSurface`. */
  private batchSurface(): BatchModeSurface {
    return batchModeSurface({
      editMode: this.editMode,
      batchMode: this.batchMode,
    });
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
   *
   * A field no reachable schema lists any more is not a filterable axis, so the
   * chip row falls back at **runtime** to the first axis this archive can
   * actually answer. Page frontmatter and settings are left alone — only an
   * explicit choice in 보기 may persist a replacement.
   */
  private filterAxis(): FilterAxis {
    const requested = getFilterAxisForPage(
      this.plugin.settings,
      this.resolvePageScope(),
    );
    if (this.axisReachable(requested.propertyId)) return requested;
    const reachable = this.reachableFieldIds();
    for (const id of FILTER_AXIS_IDS) {
      if (!reachable.has(id)) continue;
      const axis = axisFor(this.plugin.settings, id);
      if (axis.options.length > 0) return axis;
    }
    // Nothing to filter on: keep the requested axis. Occupancy is schema-aware,
    // so the row collapses to 「전체」 instead of offering dormant values.
    return requested;
  }

  /** Drop the per-render projection memo. */
  private invalidateProjectionCaches(): void {
    this.reachableCache = null;
  }

  /** Field ids at least one reachable schema still lists, memoized per scope. */
  private reachableFieldIds(): Set<string> {
    const key = `${this.pageLibrary()} ${normalizeArchiveKey(this.activeArchive())}`;
    const cached = this.reachableCache;
    if (cached && cached.key === key) return cached.ids;
    const ids = reachableActiveFieldIds(
      this.plugin.settings,
      this.pageLibrary(),
      normalizeArchiveKey(this.activeArchive()),
      this.observedGroups(),
    );
    this.reachableCache = { key, ids };
    return ids;
  }

  /** True when at least one reachable schema still lists this axis' field. */
  private axisReachable(fieldId: string): boolean {
    return this.reachableFieldIds().has(fieldId);
  }

  /** True when this record's own schema lists the axis field as active. */
  private recordHasAxis(record: CharacterRecord, fieldId: string): boolean {
    return effectiveActiveFields(this.recordSchema(record)).some(
      (field) => field.id === fieldId,
    );
  }

  /**
   * Records whose schema actually carries this axis. Chip membership and the
   * grid filter both read through it, so a value left dormant by a schema edit
   * can never make a card match — or keep a chip alive.
   */
  private axisScopedRecords(axis: FilterAxis): CharacterRecord[] {
    return this.records.filter((record) =>
      this.recordHasAxis(record, axis.propertyId),
    );
  }

  /**
   * Option ids with at least one card in the active archive. Chips outside this
   * set are hidden, so a remembered chip pointing at one reads as 「전체」.
   * Deliberately ignores `searchQuery` — typing must not move chip membership.
   */
  private occupiedOptions(axis: FilterAxis): Set<string> {
    return occupiedAxisOptionIds(
      axis,
      this.axisScopedRecords(axis),
      this.activeArchive(),
    );
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
    // A write already in flight keeps its storage guarantee; it just loses the
    // right to paint. Bumping the generation is what revokes that right.
    this.uiGeneration += 1;
    this.closeGroupRenameDialog();
    this.teardownBatchMode();
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
    // The captured batch scope belongs to the archive we are leaving.
    this.teardownBatchMode();
    patchGalleryPageState(this.plugin.settings, this.pageKey(), {
      activeGenre: genre,
    });
    await this.plugin.saveSettings();
    this.selected = null;
    this.render();
    this.leaf.setEphemeralState({ ...this.leaf.getEphemeralState() });
  }

  /**
   * Gallery notes whose library is this one, plus this page. Card-eye rows carry
   * a page but no library, so this list is the only way an archive rename can
   * tell *its* rows apart from a same-named archive in another library.
   */
  private libraryPagePaths(library: string): string[] {
    const paths = new Set(
      listGalleryPagePathsForLibrary(this.plugin, library),
    );
    paths.add(this.pageKey());
    return [...paths].filter(Boolean);
  }

  /** Schema-side copy for a dry-run collision check. Never persisted. */
  private schemaSnapshot(): GroupSchemaStore {
    const s = this.plugin.settings;
    return {
      cardProperties: s.cardProperties.map((pref) => ({ ...pref })),
      propertyDisplayNames: s.propertyDisplayNames,
      groupSchemas: s.groupSchemas.map((record) => ({
        ...record,
        fields: record.fields.map((field) => ({ ...field })),
      })),
      fieldKeyLedgers: s.fieldKeyLedgers.map((ledger) => ({
        ...ledger,
        keys: [...ledger.keys],
      })),
      cardFieldVisibility: s.cardFieldVisibility.map((row) => ({ ...row })),
      cardFieldOrder: s.cardFieldOrder.map((row) => ({
        ...row,
        order: [...row.order],
      })),
    };
  }

  /**
   * Rename one archive: reject a collision, rewrite the notes, then commit
   * every archive-scoped setting in **one** save.
   *
   * A merge into an existing archive is refused outright — rewritten records
   * would collide on `(library, archive, group)` and normalization keeps only
   * the first duplicate, so a group would silently lose its fields. The check
   * runs on a copy of the schema store, before any note is touched.
   */
  private async renameActiveGenre(from: string, to: string): Promise<void> {
    const library = this.pageLibrary();
    const prev = normalizeArchiveKey(from);
    const next = normalizeArchiveKey(to);
    if (prev === next) return;

    const pagePaths = this.libraryPagePaths(library);
    if (
      this.genres().some((genre) => normalizeArchiveKey(genre) === next)
    ) {
      new Notice(
        `아카이브 「${next}」가 이미 있어요. 다른 이름을 정해 주세요.`,
      );
      return;
    }
    try {
      renameArchiveScope(this.schemaSnapshot(), library, prev, next, pagePaths);
    } catch (error) {
      new Notice(
        `${error instanceof Error ? error.message : String(error)} · 다른 이름을 정해 주세요.`,
      );
      return;
    }

    this.plugin.suppressGalleryRefresh = true;
    let count = 0;
    try {
      count = await renameGenre(this.app, this.records, prev, next);
      if (this.isArchivePinned() && this.file) {
        try {
          await this.app.fileManager.processFrontMatter(this.file, (fm) => {
            fm.장르 = next;
          });
        } catch (error) {
          // Put the cards back so the vault never holds two names at once.
          await renameGenre(this.app, this.records, next, prev).catch(
            (rollbackError) => {
              console.error(
                "[charinfo] 아카이브 이름 되돌리기 실패",
                rollbackError,
              );
            },
          );
          throw error;
        }
      }
    } catch (error) {
      // Notes are back where they started (best effort) — leave every
      // archive-scoped setting untouched so nothing points at a name that
      // does not exist.
      console.error("[charinfo] 아카이브 이름 바꾸기 실패", error);
      new Notice(
        `아카이브 이름을 바꾸지 못했어요 · ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    } finally {
      this.plugin.suppressGalleryRefresh = false;
    }

    try {
      await this.plugin.commitSettings((settings) => {
        renameArchiveScope(settings, library, prev, next, pagePaths);
        const order = getGroupOrderFor(settings, library, prev);
        if (order.length) {
          setGroupOrderFor(settings, library, next, order);
          const byLib = { ...(settings.groupOrderByLibrary[library] ?? {}) };
          delete byLib[prev];
          settings.groupOrderByLibrary = {
            ...settings.groupOrderByLibrary,
            [library]: byLib,
          };
          if (library === normalizeLibraryKey(settings.libraryFolder)) {
            const legacy = { ...settings.groupOrderByGenre };
            delete legacy[prev];
            legacy[next] = [...order];
            settings.groupOrderByGenre = legacy;
          }
        }
        for (const path of pagePaths) {
          const state = getGalleryPageState(settings, path);
          const genre = state.activeGenre?.trim() ?? "";
          if (!genre || normalizeArchiveKey(genre) !== prev) continue;
          patchGalleryPageState(settings, path, { activeGenre: next });
        }
        if (normalizeArchiveKey(settings.activeGenre) === prev) {
          settings.activeGenre = next;
        }
        // Copy, never move: another library may still hold an archive of the
        // old name that depends on this template.
        const template = settings.characterTemplateByGenre[prev];
        if (template && !settings.characterTemplateByGenre[next]) {
          settings.characterTemplateByGenre = {
            ...settings.characterTemplateByGenre,
            [next]: template,
          };
        }
      });
    } catch (error) {
      console.error("[charinfo] 아카이브 설정 저장 실패", error);
      new Notice(
        `노트는 「${next}」로 바꿨지만 설정 저장에 실패했어요 · ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    new Notice(
      count
        ? `아카이브 이름을 「${next}」로 바꿨어요 · 노트 ${count}개`
        : "이름을 바꿀 노트가 없어요",
    );
    await this.refresh();
    this.leaf.setEphemeralState({ ...this.leaf.getEphemeralState() });
  }

  async onOpen(): Promise<void> {
    this.viewClosed = false;
    this.registerDomEvent(this.containerEl, "keydown", (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Batch owns Escape first, in exactly this order: a running write
        // swallows the key, then the destination dialog, then selection mode.
        const batch = batchEscapeAction({
          saving: this.batchSaving,
          dialogOpen: this.batchDialog?.isOpen ?? false,
          selecting: this.batchMode,
        });
        if (batch === "consume") {
          event.preventDefault();
          return;
        }
        if (batch === "close-dialog") {
          event.preventDefault();
          this.closeBatchDialog({ restoreFocus: true });
          return;
        }
        if (batch === "exit-selection") {
          event.preventDefault();
          this.setBatchMode(false);
          return;
        }
        if (this.groupRenameSaving) {
          event.preventDefault();
          return;
        }
        if (this.groupRenameDialog?.isOpen) {
          event.preventDefault();
          this.closeGroupRenameDialog({ restoreFocus: true });
          return;
        }
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
      if (this.peekOpen) this.syncPeekChrome();
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
    this.viewClosed = true;
    this.uiGeneration += 1;
    this.closeGroupRenameDialog();
    this.teardownBatchMode();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.viewMenu?.close();
    this.viewMenu = null;
    this.closeTagMenu();
    this.contentEl.empty();
  }

  /**
   * Crossing 720px with peek open swaps the sheet for the side panel (or back).
   * Only the affordances differ, so re-point them instead of rebuilding.
   */
  private syncPeekChrome(): void {
    this.applySheetSnap();
    this.syncGalleryInert();
    const back = this.contentEl.querySelector(".charinfo-detail__back");
    if (!(back instanceof HTMLElement)) return;
    back.empty();
    setIcon(back, this.isNarrow ? "chevron-left" : "x");
  }

  /**
   * Narrow overlay: gallery chrome + grid must not take pointer or keyboard
   * while the sheet is open (freeze: inert underneath).
   */
  private syncGalleryInert(): void {
    // The destination dialog is modal on every width, so it freezes the same
    // regions the narrow sheet does — plus the batch bar that opened it.
    const on = batchInertActive({
      isNarrow: this.isNarrow,
      peekOpen: this.peekOpen,
      dialogOpen:
        (this.batchDialog?.isOpen ?? false) ||
        (this.groupRenameDialog?.isOpen ?? false),
    });
    for (const sel of MODAL_INERT_REGIONS) {
      const el = this.contentEl.querySelector(sel);
      if (!(el instanceof HTMLElement)) continue;
      if (on) el.setAttribute("inert", "");
      else el.removeAttribute("inert");
    }
  }

  /** Viewport basis for the `vh` snaps, so drag math matches what CSS paints. */
  private sheetBasis(): number {
    return window.innerHeight || this.contentEl.clientHeight || 640;
  }

  private applySheetSnap(): void {
    this.contentEl.style.setProperty(
      "--charinfo-sheet-h",
      SHEET_SNAP_VH[this.sheetSnap],
    );
  }

  private nearestSnap(px: number): SheetSnap {
    const basis = this.sheetBasis();
    let best: SheetSnap = "mid";
    let bestGap = Number.POSITIVE_INFINITY;
    for (const snap of Object.keys(SHEET_SNAPS) as SheetSnap[]) {
      const gap = Math.abs(SHEET_SNAPS[snap] * basis - px);
      if (gap < bestGap) {
        bestGap = gap;
        best = snap;
      }
    }
    return best;
  }

  /**
   * Height drag starts on the grip handle only — head buttons and the image
   * strip keep their own gestures (freeze: handle-only drag start).
   */
  private attachSheetDrag(handle: HTMLElement, sheet: HTMLElement): void {
    const endDrag = (event: PointerEvent) => {
      const drag = this.sheetDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      this.sheetDrag = null;
      handle.releasePointerCapture?.(event.pointerId);
      this.contentEl.removeClass("is-sheet-dragging");
      this.sheetSnap = this.nearestSnap(sheet.getBoundingClientRect().height);
      this.applySheetSnap();
    };
    handle.addEventListener("pointerdown", (event) => {
      if (!this.isNarrow || !this.peekOpen) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      this.sheetDrag = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startH: sheet.getBoundingClientRect().height,
      };
      handle.setPointerCapture?.(event.pointerId);
      this.contentEl.addClass("is-sheet-dragging");
    });
    handle.addEventListener("pointermove", (event) => {
      const drag = this.sheetDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const basis = this.sheetBasis();
      const min = SHEET_SNAPS.low * basis;
      const max = Math.min(
        SHEET_SNAPS.tall * basis,
        this.contentEl.clientHeight,
      );
      const next = Math.min(
        Math.max(min, drag.startH + (drag.startY - event.clientY)),
        Math.max(min, max),
      );
      this.contentEl.style.setProperty(
        "--charinfo-sheet-h",
        `${Math.round(next)}px`,
      );
    });
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
  }

  private unloadPeekBody(): void {
    if (this.peekBodyChild) {
      this.removeChild(this.peekBodyChild);
      this.peekBodyChild = null;
    }
  }

  private closePeek(): void {
    this.closeTagMenu();
    this.sheetDrag = null;
    this.contentEl.removeClass("is-sheet-dragging");
    this.applySheetSnap();
    this.selected = null;
    this.peekOpen = false;
    this.contentEl.toggleClass("is-peek-open", false);
    this.syncGalleryInert();
    this.contentEl.querySelectorAll(".charinfo-card.is-selected").forEach((el) => {
      el.classList.remove("is-selected");
    });
    this.unloadPeekBody();
    const detail = this.contentEl.querySelector(".charinfo-gallery__detail");
    if (detail instanceof HTMLElement) void this.renderDetail(detail);
  }

  private async setChipFilter(next: ChipFilter): Promise<void> {
    this.chipFilter = next;
    await this.plugin.saveSettings();
    this.syncChipFilters();
    this.renderBody();
  }

  /**
   * Every card in the active archive, **before** search and chip filtering.
   * Anything that decides whether a group or a field exists reads this — a chip
   * must never make a section or a 보기 row disappear.
   */
  private archiveRecords(): CharacterRecord[] {
    const archive = normalizeArchiveKey(this.activeArchive());
    return this.records.filter(
      (record) => normalizeArchiveKey(record.장르) === archive,
    );
  }

  /** Groups that actually hold a card in this archive (unfiltered). */
  private observedGroups(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const record of this.archiveRecords()) {
      const group = normalizeGroupKey(record.그룹);
      if (seen.has(group)) continue;
      seen.add(group);
      out.push(group);
    }
    return out;
  }

  /**
   * Persisted groups of this archive that hold no card at all. Pencil mode
   * renders them so a group created in Book stays reachable before its first
   * card exists; read mode and filter/search-empty results never invent one.
   *
   * 미분류 is excluded — it has no header of its own, so an empty one would be
   * a stray add tile with nothing naming it.
   */
  private emptyPersistedGroups(): string[] {
    const members = new Set(this.observedGroups());
    const out: string[] = [];
    for (const group of persistedGroupsForArchive(
      this.plugin.settings,
      this.pageLibrary(),
      normalizeArchiveKey(this.activeArchive()),
    )) {
      if (!group || members.has(group)) continue;
      out.push(group);
    }
    return out;
  }

  /**
   * Named routes of this archive, in the stable section order: the group order
   * the user arranged, then persisted schemas and observed cards. `""` is never
   * in here — whether 기본 is a real route is the inventory's question.
   */
  private namedGroups(): string[] {
    const archive = normalizeArchiveKey(this.activeArchive());
    // Every route that exists: a persisted schema, or a card carrying the name.
    const existing = new Set<string>();
    for (const group of persistedGroupsForArchive(
      this.plugin.settings,
      this.pageLibrary(),
      archive,
    )) {
      const name = normalizeGroupKey(group);
      if (name) existing.add(name);
    }
    for (const record of this.archiveRecords()) {
      const name = normalizeGroupKey(record.그룹);
      if (name) existing.add(name);
    }
    const groups: string[] = [];
    const seen = new Set<string>();
    const push = (raw: string) => {
      const group = normalizeGroupKey(raw);
      if (!group || seen.has(group) || !existing.has(group)) return;
      seen.add(group);
      groups.push(group);
    };
    // The order the user arranged the sections in wins; the rest follows. The
    // default route is decoded away here — this list is named groups only.
    for (const group of getGroupRouteOrderFor(
      this.plugin.settings,
      this.pageLibrary(),
      this.activeArchive().trim(),
    )) {
      push(group);
    }
    for (const group of existing) push(group);
    return groups;
  }

  /**
   * The canonical route order of this archive: every reachable route, `""`
   * included at its own rank.
   *
   * One list, read by both surfaces. The drawer's chips and the gallery's
   * sections rank by exactly this, computed from the **unfiltered** archive, so
   * a search or a chip can never reorder anything and the two can never
   * disagree after a reload.
   */
  private routeOrder(): string[] {
    return resolveGroupRouteOrder(
      getGroupRouteOrderFor(
        this.plugin.settings,
        this.pageLibrary(),
        this.activeArchive().trim(),
      ),
      [...this.namedGroups(), ...this.emptyPersistedGroups()],
    );
  }

  /** Cards routing to one group in this archive (`""` = the default route). */
  private groupMemberCount(group: string): number {
    const want = normalizeGroupKey(group);
    return this.archiveRecords().filter(
      (record) => normalizeGroupKey(record.그룹) === want,
    ).length;
  }

  private openAttrManage(): void {
    new AttrManageModal(this.plugin, {
      records: this.records,
      archive: normalizeArchiveKey(this.activeArchive()),
      library: this.pageLibrary(),
      selectedGroup: this.selected ? this.selected.그룹.trim() : null,
      namedGroups: () => this.namedGroups(),
      hasUngrouped: () => this.groupMemberCount("") > 0,
      memberCount: (group) => this.groupMemberCount(group),
      routeOrder: () => this.routeOrder(),
      reorderRoutes: (order) => this.persistRouteOrder(order),
      createGroup: (name) => this.createGroupRoute(name),
      renameGroup: (from, to) => this.renameGroupRouteFromDrawer(from, to),
      deleteGroup: (from, to) => this.deleteGroupWithReassign(from, to),
      trashGroup: (from) => this.trashGroupRoute(from),
      onSchemaSaved: (group) => {
        this.plugin.reconcileGroupMembers(
          this.pageLibrary(),
          normalizeArchiveKey(this.activeArchive()),
          group,
        );
      },
      onChanged: () => {
        this.plugin.refreshOpenGalleries();
      },
    }).open();
  }

  /** Persist a route order the drawer arranged, then repaint every gallery. */
  private async persistRouteOrder(order: readonly string[]): Promise<void> {
    const genre = this.activeArchive().trim();
    if (!genre) return;
    await this.plugin.commitSettings((settings) => {
      setGroupRouteOrderFor(settings, this.pageLibrary(), genre, order);
    });
  }

  /**
   * Create one group: persist its schema and append it at the canonical end of
   * the route order, in one commit. Nothing is written to any note — a group
   * with no cards is a real, reachable route.
   */
  private async createGroupRoute(name: string): Promise<void> {
    const library = this.pageLibrary();
    const archiveName = this.activeArchive().trim();
    const archive = normalizeArchiveKey(this.activeArchive());
    const target = normalizeGroupKey(name);
    const problem = groupAddProblem({
      name: target,
      existing: this.namedGroups(),
      defaultRouteVisible: true,
    });
    if (problem) throw new GroupOperationError(groupRenameErrorMessage(problem));
    const order = [...this.routeOrder(), target];
    await this.plugin.commitSettings((settings) => {
      ensureGroupSchema(settings, library, archive, target);
      if (archiveName) {
        setGroupRouteOrderFor(settings, library, archiveName, order);
      }
    });
    this.invalidateProjectionCaches();
  }

  /**
   * Rename one route from the drawer. `from` may be `""`: naming the default
   * route moves every note that carried no `그룹` onto the new name, and the
   * schema identity travels with them.
   */
  private async renameGroupRouteFromDrawer(
    from: string,
    to: string,
  ): Promise<void> {
    if (this.groupRenameSaving) {
      throw new GroupOperationError("이름 바꾸기가 아직 진행 중이에요.");
    }
    const source = normalizeGroupKey(from);
    const target = normalizeRenameInput(to);
    const problem = groupRenameProblem({
      from: source,
      to: target,
      existing: this.namedGroups(),
      allowDefaultSource: true,
      defaultRouteVisible: true,
    });
    if (problem) throw new GroupOperationError(groupRenameErrorMessage(problem));
    this.groupRenameSaving = true;
    try {
      const notes = await this.applyGroupRouteRename(source, target);
      new Notice(groupRenameSuccessMessage(source, target, notes));
    } finally {
      this.groupRenameSaving = false;
    }
  }

  /**
   * Send every member note of one route to the trash, then drop the route.
   *
   * Deliberately not atomic, and it never claims to be: a file already in the
   * trash stays there. So a partial run keeps the schema and the rank exactly as
   * they were and reports the count that actually completed — the group is still
   * there to try again, and the notes that moved follow Obsidian's own recovery
   * setting.
   */
  private async trashGroupRoute(from: string): Promise<void> {
    const library = this.pageLibrary();
    const archiveName = this.activeArchive().trim();
    const archive = normalizeArchiveKey(this.activeArchive());
    const source = normalizeGroupKey(from);
    const members = this.archiveRecords().filter(
      (record) => normalizeGroupKey(record.그룹) === source,
    );
    const total = members.length;
    const trashed = new Set<string>();
    const forget = () => {
      if (trashed.size === 0) return;
      this.records = this.records.filter((record) => !trashed.has(record.path));
      this.invalidateProjectionCaches();
    };

    this.plugin.suppressGalleryRefresh = true;
    try {
      for (const record of members) {
        const file = this.app.vault.getAbstractFileByPath(record.path);
        if (!(file instanceof TFile)) {
          throw new Error(`노트를 찾지 못했어요: ${record.path}`);
        }
        await this.app.fileManager.trashFile(file);
        trashed.add(record.path);
      }
    } catch (error) {
      console.error("[charinfo] 그룹 노트 휴지통 이동 실패", error);
      forget();
      this.plugin.markGalleriesDirty();
      throw new GroupOperationError(
        `노트 ${total}개 중 ${trashed.size}개만 휴지통으로 보냈어요 · 그룹은 그대로 있어요`,
      );
    } finally {
      this.plugin.suppressGalleryRefresh = false;
    }

    try {
      await this.plugin.commitSettings((settings) => {
        applyGroupDeletion(settings, library, archive, source);
        if (archiveName) {
          removeGroupFromOrder(settings, library, archiveName, source);
        }
      });
    } catch (error) {
      console.error("[charinfo] 그룹 삭제 저장 실패", error);
      forget();
      this.plugin.markGalleriesDirty();
      throw new GroupOperationError(
        `노트 ${trashed.size}개는 휴지통으로 보냈지만 그룹 설정을 지우지 못했어요 · 다시 시도해 주세요`,
      );
    }
    forget();
  }

  /**
   * Delete one named group by reassigning its records first.
   *
   * Order is the whole contract: plan every rewrite, apply them, then drop the
   * schema and the group-order entry in **one** settings commit. If a note write
   * or that commit fails, the notes already rewritten are rolled back to the
   * source group and the schema/order are left untouched — so the group is
   * either gone with its members moved, or exactly as it was. Retrying is safe:
   * a re-plan sees only the members that still carry the old group.
   *
   * Group reassignment is deliberately different from explicit property
   * removal: stored values are never deleted. A key the destination schema does
   * not list simply stays dormant on the moved note.
   */
  private async deleteGroupWithReassign(
    from: string,
    to: string,
  ): Promise<void> {
    const library = this.pageLibrary();
    const archive = normalizeArchiveKey(this.activeArchive());
    const plan = planGroupDeletion(
      this.plugin.settings,
      library,
      archive,
      from,
      to,
      this.archiveRecords().map((record) => ({
        path: record.path,
        group: normalizeGroupKey(record.그룹),
      })),
      this.namedGroups(),
    );
    if (plan.blocked) {
      throw new GroupDeletionBlockedError(
        plan.blocked === "same-scope"
          ? "다른 위치를 골라 주세요."
          : "옮길 위치를 찾지 못했어요.",
      );
    }

    const rewritten: string[] = [];
    const write = async (
      path: string,
      expected: string,
      next: string,
    ): Promise<void> => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        throw new Error(`노트를 찾지 못했어요: ${path}`);
      }
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        const current = normalizeGroupKey(
          typeof fm.그룹 === "string" ? fm.그룹 : "",
        );
        if (current !== expected) {
          throw new Error(`그룹이 다른 곳에서 바뀌었어요: ${file.basename}`);
        }
        fm.그룹 = next;
      });
    };
    /** Best-effort return trip; reverse order and report anything stranded. */
    const rollback = async (): Promise<number> => {
      let failed = 0;
      for (const path of [...rewritten].reverse()) {
        try {
          await write(path, plan.to, plan.from);
        } catch (error) {
          failed += 1;
          console.error("[charinfo] 그룹 되돌리기 실패", path, error);
        }
      }
      return failed;
    };
    const stranded = (failed: number): string =>
      failed ? ` · 되돌리지 못한 노트 ${failed}개` : "";

    this.plugin.suppressGalleryRefresh = true;
    try {
      for (const path of plan.moves) {
        await write(path, plan.from, plan.to);
        rewritten.push(path);
      }
    } catch (error) {
      const failed = await rollback();
      this.plugin.markGalleriesDirty();
      throw new GroupOperationError(
        `그룹을 지우지 못했어요${stranded(failed)} · ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.plugin.suppressGalleryRefresh = false;
    }

    try {
      await this.plugin.commitSettings((settings) => {
        // Destination creation belongs to this final transaction. Seeding it
        // before note rewrites would leave settings changed when the first
        // write fails, violating the delete operation's all-or-nothing promise.
        if (plan.moves.length > 0) {
          ensureGroupSchema(settings, library, archive, plan.to);
        }
        applyGroupDeletion(settings, library, archive, plan.from);
        removeGroupFromOrder(
          settings,
          library,
          this.activeArchive().trim(),
          plan.from,
        );
      });
    } catch (error) {
      this.plugin.suppressGalleryRefresh = true;
      let failed = 0;
      try {
        failed = await rollback();
      } finally {
        this.plugin.suppressGalleryRefresh = false;
      }
      this.plugin.markGalleriesDirty();
      throw new GroupOperationError(
        `설정을 저장하지 못했어요${stranded(failed)} · ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    for (const record of this.records) {
      if (!plan.moves.includes(record.path)) continue;
      record.그룹 = plan.to;
      record.values.그룹 = plan.to;
    }
    if (plan.moves.length > 0) {
      this.plugin.reconcileGroupMembers(library, archive, plan.to);
    }
    this.invalidateProjectionCaches();
  }

  private openGroupRenameDialog(group: string): void {
    if (
      !this.cardEditActive ||
      this.batchDialog?.isOpen ||
      this.batchSaving ||
      this.groupRenameSaving
    ) {
      return;
    }
    const source = normalizeGroupKey(group);
    if (!source) return;
    this.closeGroupRenameDialog();
    const dialog = new GroupRenameDialog({
      host: this.contentEl,
      group: source,
      existing: this.namedGroups(),
      onCancel: () =>
        this.closeGroupRenameDialog({ restoreFocus: true, group: source }),
      onSubmit: (next) => void this.runGroupRename(source, next),
    });
    this.groupRenameDialog = dialog;
    this.groupRenameSource = source;
    dialog.open();
    this.syncGalleryInert();
  }

  private closeGroupRenameDialog(
    opts: { restoreFocus?: boolean; group?: string } = {},
  ): void {
    const dialog = this.groupRenameDialog;
    if (!dialog) return;
    const restoreGroup = opts.group ?? this.groupRenameSource;
    this.groupRenameDialog = null;
    this.groupRenameSource = "";
    dialog.close();
    this.syncGalleryInert();
    if (opts.restoreFocus && restoreGroup) this.focusGroupRenamePencil(restoreGroup);
  }

  private focusGroupRenamePencil(group: string): void {
    const button = this.contentEl.querySelector(
      `.charinfo-genre__rename[data-group="${CSS.escape(group)}"]`,
    );
    if (button instanceof HTMLElement) button.focus();
  }

  /** Rename one group without ever merging schemas or leaving half-written notes. */
  private async runGroupRename(from: string, rawTo: string): Promise<void> {
    if (this.groupRenameSaving) return;
    const dialog = this.groupRenameDialog;
    if (!dialog) return;
    const to = normalizeRenameInput(rawTo);
    const problem = groupRenameProblem({
      from,
      to,
      existing: this.namedGroups(),
    });
    if (problem) {
      dialog.showProblem(problem);
      return;
    }
    if (normalizeGroupKey(from) === normalizeGroupKey(to)) {
      this.closeGroupRenameDialog({ restoreFocus: true, group: from });
      return;
    }

    const generation = this.uiGeneration;
    const library = this.pageLibrary();
    const archive = normalizeArchiveKey(this.activeArchive());
    const source = normalizeGroupKey(from);
    const target = normalizeGroupKey(to);
    try {
      renameGroupScope(this.schemaSnapshot(), library, archive, source, target);
    } catch (error) {
      const duplicate = this.namedGroups().some(
        (group) => normalizeGroupKey(group) === target,
      );
      if (duplicate) dialog.showProblem("duplicate");
      else new Notice(error instanceof Error ? error.message : String(error));
      return;
    }

    this.groupRenameSaving = true;
    dialog.beginSaving();
    let notes = 0;
    try {
      notes = await this.applyGroupRouteRename(source, target);
    } catch (error) {
      this.groupRenameSaving = false;
      if (this.uiAlive(generation)) {
        dialog.endSaving();
        new Notice(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    this.groupRenameSaving = false;
    if (!this.uiAlive(generation)) {
      this.plugin.markGalleriesDirty();
      return;
    }
    this.closeGroupRenameDialog();
    await this.refresh();
    this.focusGroupRenamePencil(target);
    new Notice(groupRenameSuccessMessage(source, target, notes));
  }

  /**
   * The one identity move, shared by the gallery's pencil and the drawer.
   *
   * Rewrite every member note, then move the schema identity and the order slot
   * in a single commit. `from` may be `""`. A failure at either step rolls the
   * already-written notes back to `from` and throws a message the caller can
   * show verbatim, so the vault is either fully renamed or exactly as it was.
   * Returns how many notes were rewritten.
   */
  private async applyGroupRouteRename(
    from: string,
    to: string,
  ): Promise<number> {
    const library = this.pageLibrary();
    const archiveName = this.activeArchive().trim();
    const archive = normalizeArchiveKey(archiveName);
    const source = normalizeGroupKey(from);
    const target = normalizeGroupKey(to);
    const paths = this.archiveRecords()
      .filter((record) => normalizeGroupKey(record.그룹) === source)
      .map((record) => record.path);
    const rewritten: string[] = [];
    const write = async (path: string, expected: string, next: string) => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new Error(`노트를 찾지 못했어요: ${path}`);
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        const current = normalizeGroupKey(
          typeof fm.그룹 === "string" ? fm.그룹 : "",
        );
        if (current !== expected) {
          throw new Error(`그룹이 다른 곳에서 바뀌었어요: ${file.basename}`);
        }
        fm.그룹 = next;
      });
    };
    const rollback = async (): Promise<number> => {
      let failed = 0;
      for (const path of [...rewritten].reverse()) {
        try {
          await write(path, target, source);
        } catch (error) {
          failed += 1;
          console.error("[charinfo] 그룹 이름 되돌리기 실패", path, error);
        }
      }
      return failed;
    };
    const stranded = (failed: number): string =>
      failed ? ` · 되돌리지 못한 노트 ${failed}개` : "";

    this.plugin.suppressGalleryRefresh = true;
    try {
      for (const path of paths) {
        await write(path, source, target);
        rewritten.push(path);
      }
    } catch (error) {
      const failed = await rollback();
      this.plugin.markGalleriesDirty();
      throw new GroupOperationError(
        `그룹 이름을 바꾸지 못했어요${stranded(failed)} · ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.plugin.suppressGalleryRefresh = false;
    }

    try {
      await this.plugin.commitSettings((settings) => {
        renameGroupRoute(settings, library, archive, source, target);
        if (archiveName) {
          renameGroupRouteInOrder(settings, library, archiveName, source, target);
        }
      });
    } catch (error) {
      this.plugin.suppressGalleryRefresh = true;
      const failed = await rollback();
      this.plugin.suppressGalleryRefresh = false;
      this.plugin.markGalleriesDirty();
      throw new GroupOperationError(
        `설정을 저장하지 못했어요${stranded(failed)} · ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    for (const record of this.records) {
      if (!paths.includes(record.path)) continue;
      record.그룹 = target;
      record.values.그룹 = target;
    }
    this.invalidateProjectionCaches();
    return paths.length;
  }

  // ── 여러 캐릭터 그룹 이동 ────────────────────────────────────────────────
  //
  // Mode, captured scope, selection, the destination dialog, and the write
  // transaction. Everything below assumes exactly one invariant: selection mode
  // may exist only while `editMode` is true, and the header icon's active state
  // is its only visible exit.

  /**
   * Enter or leave selection mode.
   *
   * Entering closes the detail panel and every popover — a card cannot be both
   * a door and a checkbox — and captures `{ library, archive }`. Leaving is the
   * idempotent teardown, so an already-torn-down mode is not an error.
   */
  private setBatchMode(enabled: boolean): void {
    // A running transaction owns the mode until it settles.
    if (this.batchSaving || this.groupRenameSaving) return;
    if (enabled === this.batchMode) return;
    if (enabled) {
      if (!this.editMode) return;
      this.closeGroupRenameDialog();
      this.viewMenu?.close();
      this.viewMenu = null;
      this.closeTagMenu();
      if (this.peekOpen || this.selected) this.closePeek();
      this.batchScope = {
        library: this.pageLibrary(),
        archive: normalizeArchiveKey(this.activeArchive()),
      };
      this.batchSelection = new Set();
      this.batchMode = true;
    } else {
      this.teardownBatchMode();
    }
    this.render();
    this.focusBatchHeaderButton();
  }

  /** Idempotent teardown — safe from Escape, edit exit, unload, and close. */
  private teardownBatchMode(): void {
    this.closeBatchDialog();
    this.clearBatchNoticeRaise();
    this.batchMode = false;
    this.batchScope = null;
    this.batchSelection.clear();
  }

  /**
   * Keep the captured scope honest after any records change.
   *
   * An archive change ends the mode outright; anything else only intersects the
   * selection with what the archive still holds. Cards hidden by search or a
   * chip are still in that list, so typing can never drop a selection.
   */
  private reconcileBatchScope(): void {
    if (!this.batchMode) return;
    const verdict = reconcileBatchSelection(
      this.batchScope,
      {
        library: this.pageLibrary(),
        archive: normalizeArchiveKey(this.activeArchive()),
      },
      this.batchSelection,
      this.archiveRecords().map((record) => record.path),
    );
    if (verdict.teardown) {
      this.teardownBatchMode();
      return;
    }
    this.batchSelection = new Set(verdict.selection);
  }

  /** Selected cards of the captured archive, in the archive's stable order. */
  private selectedBatchRecords(): CharacterRecord[] {
    return this.archiveRecords().filter((record) =>
      this.batchSelection.has(record.path),
    );
  }

  private toggleBatchPick(path: string): void {
    if (!this.batchMode || this.batchSaving) return;
    if (this.batchSelection.has(path)) this.batchSelection.delete(path);
    else this.batchSelection.add(path);
    // Patch in place: a re-render here would take the focused card with it.
    this.syncBatchCard(path);
    this.syncBatchBar();
  }

  private clearBatchSelection(): void {
    if (!this.batchMode || this.batchSaving) return;
    const paths = [...this.batchSelection];
    this.batchSelection.clear();
    for (const path of paths) this.syncBatchCard(path);
    this.syncBatchBar();
    // 선택 해제 disables itself at zero, so focus lands on the mode exit —
    // the one control that is always live in selection mode.
    this.focusBatchHeaderButton();
  }

  private syncBatchCard(path: string): void {
    const card = this.contentEl.querySelector(
      `.charinfo-card[data-path="${CSS.escape(path)}"]`,
    );
    if (!(card instanceof HTMLElement)) return;
    const picked = this.batchSelection.has(path);
    card.toggleClass("is-picked", picked);
    card.setAttribute("aria-checked", picked ? "true" : "false");
  }

  private renderBatchBar(root: HTMLElement): void {
    const bar = root.createDiv({
      cls: "charinfo-batch-bar",
      attr: { role: "group", "aria-label": "선택한 캐릭터" },
    });
    bar.createDiv({
      cls: "charinfo-batch-bar__count",
      text: `${this.batchSelection.size}명 선택`,
      attr: { role: "status" },
    });
    const actions = bar.createDiv({ cls: "charinfo-batch-bar__actions" });
    const clear = actions.createEl("button", {
      cls: "charinfo-text-btn charinfo-batch-bar__clear",
      text: "선택 해제",
      attr: { type: "button" },
    });
    clear.disabled = this.batchSelection.size === 0;
    clear.addEventListener("click", () => this.clearBatchSelection());
    const move = actions.createEl("button", {
      cls: "charinfo-text-btn mod-cta charinfo-batch-bar__move",
      text: "그룹 이동",
      attr: { type: "button" },
    });
    move.disabled = this.batchSelection.size === 0;
    move.addEventListener("click", () => this.openBatchDialog());
  }

  /** Count + disabled state only — the bar itself never rebuilds on a toggle. */
  private syncBatchBar(): void {
    const bar = this.contentEl.querySelector(".charinfo-batch-bar");
    if (!(bar instanceof HTMLElement)) return;
    const count = bar.querySelector(".charinfo-batch-bar__count");
    if (count instanceof HTMLElement) {
      count.setText(`${this.batchSelection.size}명 선택`);
    }
    const empty = this.batchSelection.size === 0;
    for (const selector of [
      ".charinfo-batch-bar__clear",
      ".charinfo-batch-bar__move",
    ]) {
      const button = bar.querySelector(selector);
      if (button instanceof HTMLButtonElement) button.disabled = empty;
    }
  }

  private focusBatchHeaderButton(): void {
    const button = this.contentEl.querySelector(
      '.charinfo-gallery__icon-btn[data-charinfo="batch"]',
    );
    if (button instanceof HTMLElement) button.focus();
  }

  private focusBatchMoveButton(): void {
    const button = this.contentEl.querySelector(".charinfo-batch-bar__move");
    if (button instanceof HTMLElement) button.focus();
  }

  private openBatchDialog(): void {
    if (!this.batchMode || this.batchSaving) return;
    const selected = this.selectedBatchRecords();
    if (selected.length === 0) return;
    this.closeBatchDialog();
    const rows = describeDestinations(
      this.namedGroups(),
      selected.map((record) => normalizeGroupKey(record.그룹)),
      (group) => this.groupMemberCount(group),
    );
    const dialog = new BatchGroupMoveDialog({
      host: this.contentEl,
      selectedCount: selected.length,
      rows,
      onCancel: () => this.closeBatchDialog({ restoreFocus: true }),
      onConfirm: (destination) => void this.runBatchGroupMove(destination),
    });
    this.batchDialog = dialog;
    dialog.open();
    this.syncGalleryInert();
  }

  private closeBatchDialog(opts: { restoreFocus?: boolean } = {}): void {
    const dialog = this.batchDialog;
    if (!dialog) return;
    this.batchDialog = null;
    // The opener lives inside the batch bar, which is inert while the dialog
    // is mounted. Remove the modal and inert state before returning focus.
    disposeBatchDialog({
      dispose: () => dialog.close(),
      releaseInert: () => this.syncGalleryInert(),
      restoreFocus: opts.restoreFocus
        ? () => this.focusBatchMoveButton()
        : null,
    });
  }

  /**
   * The whole transaction, in the only order that cannot leave a half-move:
   *
   * 1. freeze this view's refresh — an external repaint must not land mid-write;
   * 2. persist the destination schema through the **throwing** path, so a
   *    settings failure aborts with zero note mutations;
   * 3. write the notes sequentially, each one validated against the group the
   *    plan read, rolling back in reverse on the first failure;
   * 4. patch records and reconcile **only** after every write succeeded;
   * 5. thaw, and flush exactly one refresh if anything was deferred or touched.
   *
   * The storage guarantee outlives the UI: if the leaf goes away mid-write, the
   * writes still finish or roll back — they just stop painting.
   */
  private async runBatchGroupMove(destination: string): Promise<void> {
    if (!this.batchMode || this.batchSaving) return;
    const scope = this.batchScope;
    const dialog = this.batchDialog;
    if (!scope || !dialog) return;

    const plan = this.planBatchMove(destination);
    if (!plan || plan.total === 0) return;

    const generation = this.uiGeneration;
    this.batchSaving = true;
    dialog.beginSaving();

    await runBatchTransaction({
      freeze: () => this.batchFreeze.freeze(),
      perform: async () => {
        // Preflight, not the swallow-and-continue wrapper: a destination whose
        // schema failed to save must never receive a note.
        await this.plugin.persistGroupSchema(
          scope.library,
          scope.archive,
          plan.destination,
        );
        if (plan.moves.length === 0) {
          return {
            outcome: { changed: 0, applied: [], attempted: 0 },
            touchedDisk: false,
          };
        }
        return {
          outcome: await executeBatchGroupMove(
            plan,
            (entry) => this.writeBatchGroup(entry, scope),
            (entry, previousGroup) =>
              this.rollbackBatchGroup(entry, previousGroup),
          ),
          touchedDisk: true,
        };
      },
      thaw: () => this.batchFreeze.thaw(),
      settle: () => {
        this.batchSaving = false;
      },
      commit: (outcome: BatchMoveOutcome) => {
        for (const move of outcome.applied) {
          const record = this.records.find((item) => item.path === move.path);
          if (!record) continue;
          record.그룹 = plan.destination;
          record.values.그룹 = plan.destination;
        }
        if (outcome.changed > 0) {
          this.plugin.reconcileGroupMembers(
            scope.library,
            scope.archive,
            plan.destination,
          );
        }
        this.invalidateProjectionCaches();
      },
      uiAlive: () => this.uiAlive(generation),
      markDirty: () => this.plugin.markGalleriesDirty(),
      closeDialog: () => this.closeBatchDialog(),
      exitSelection: () => this.teardownBatchMode(),
      refresh: () => this.refresh(),
      render: () => this.render(),
      reportFailure: (failure: unknown) => {
        this.reportBatchFailure(failure);
        this.focusBatchMoveButton();
      },
      reportSuccess: (outcome: BatchMoveOutcome) => {
        new Notice(
          batchMoveSuccessMessage(outcome.changed, plan.destination),
          BATCH_NOTICE_MS,
        );
        this.focusBatchHeaderButton();
      },
    });
  }

  /**
   * Re-read the selection off `records` and plan against it. Every path is
   * revalidated at write time too, so this is the plan, not the promise.
   */
  private planBatchMove(destination: string): BatchMovePlan | null {
    try {
      return planBatchGroupMove(
        this.selectedBatchRecords().map((record) => ({
          path: record.path,
          group: normalizeGroupKey(record.그룹),
        })),
        normalizeMoveGroup(destination),
      );
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /** One error Notice, plus the paths a rollback could not restore. */
  private reportBatchFailure(failure: unknown): void {
    let notice: Notice;
    if (failure instanceof BatchGroupMoveError) {
      for (const item of failure.rollbackFailures) {
        console.error("[charinfo] 그룹 되돌리기 실패", item.path, item.error);
      }
      notice = new Notice(batchMoveFailureMessage(failure), BATCH_NOTICE_MS);
    } else {
      console.error("[charinfo] 그룹 이동 실패", failure);
      notice = new Notice(
        `그룹을 바꾸지 못했어요 · ${failure instanceof Error ? failure.message : String(failure)}`,
        BATCH_NOTICE_MS,
      );
    }
    this.raiseBatchBarForNotice(notice);
  }

  /**
   * Narrow screens stack the native Notice at the bottom, exactly where the
   * batch bar lives. Raise the bar for the Notice's lifetime so the two keep
   * their 12px separation instead of overlapping.
   */
  private raiseBatchBarForNotice(notice: Notice): void {
    this.clearBatchNoticeRaise();
    if (!this.batchMode) return;
    this.contentEl.addClass("is-batch-notice");
    window.requestAnimationFrame(() => {
      if (!this.batchMode || !notice.noticeEl.isConnected) return;
      const lift = batchNoticeLift({
        galleryBottom: this.contentEl.getBoundingClientRect().bottom,
        noticeTop: notice.noticeEl.getBoundingClientRect().top,
      });
      this.contentEl.style.setProperty(
        "--charinfo-batch-notice-lift",
        `${lift}px`,
      );
    });
    this.batchNoticeTimer = window.setTimeout(() => {
      this.batchNoticeTimer = null;
      this.contentEl.removeClass("is-batch-notice");
      this.contentEl.style.removeProperty("--charinfo-batch-notice-lift");
    }, BATCH_NOTICE_MS);
  }

  private clearBatchNoticeRaise(): void {
    if (this.batchNoticeTimer != null) {
      window.clearTimeout(this.batchNoticeTimer);
      this.batchNoticeTimer = null;
    }
    this.contentEl.removeClass("is-batch-notice");
    this.contentEl.style.removeProperty("--charinfo-batch-notice-lift");
  }

  /** True while this DOM is still the DOM the transaction started against. */
  private uiAlive(generation: number): boolean {
    return !this.viewClosed && this.uiGeneration === generation;
  }

  /** True when this path still belongs to the captured library root. */
  private withinBatchLibrary(path: string, library: string): boolean {
    const root = normalizeLibraryKey(library);
    if (!root) return true;
    return path === root || path.startsWith(`${root}/`);
  }

  /**
   * Write one note's `그룹`, refusing anything the plan did not read.
   *
   * Revalidation is against the **captured** library, archive, and source group,
   * so a note that moved out from under the selection is a conflict, never an
   * overwrite. Three outcomes, no fourth: already-there is a no-op,
   * expected-group is a write, anything else is a conflict. `order` is never
   * touched — the card keeps its position value and the section sorts it.
   */
  private async writeBatchGroup(
    entry: BatchMoveEntry,
    scope: { library: string; archive: string },
  ): Promise<BatchWriteResult> {
    const file = this.app.vault.getAbstractFileByPath(entry.path);
    if (!(file instanceof TFile)) {
      throw new BatchMoveConflictError(
        entry.path,
        `노트를 찾지 못했어요 · ${entry.path}`,
      );
    }
    if (!this.withinBatchLibrary(entry.path, scope.library)) {
      throw new BatchMoveConflictError(
        entry.path,
        `「${file.basename}」이(가) 이 서재 밖으로 옮겨졌어요.`,
      );
    }
    const written: string[] = [];
    // Collected, not thrown from inside the callback: the frontmatter writer
    // owns that boundary, and a swallowed throw would read as a silent no-op.
    const conflicts: BatchMoveConflictError[] = [];
    const seen: string[] = [];
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (normalizeArchiveKey(fm.장르) !== scope.archive) {
        conflicts.push(
          new BatchMoveConflictError(
            entry.path,
            `「${file.basename}」의 아카이브가 그 사이에 바뀌었어요.`,
          ),
        );
        return;
      }
      const current = normalizeMoveGroup(fm.그룹);
      seen.push(current);
      if (current === entry.destination) return;
      if (current !== entry.expectedGroup) {
        conflicts.push(
          new BatchMoveConflictError(
            entry.path,
            `「${file.basename}」의 그룹이 그 사이에 바뀌었어요.`,
          ),
        );
        return;
      }
      fm.그룹 = entry.destination;
      written.push(current);
    });
    const conflict = conflicts[0];
    if (conflict) throw conflict;
    return {
      changed: written.length > 0,
      previousGroup: seen[0] ?? entry.expectedGroup,
    };
  }

  /**
   * Put one note back. Only our own value may be undone: if the group diverged
   * again the write belongs to someone else, so it is reported, not overwritten.
   */
  private async rollbackBatchGroup(
    entry: BatchMoveEntry,
    previousGroup: string,
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(entry.path);
    if (!(file instanceof TFile)) {
      throw new BatchMoveConflictError(
        entry.path,
        `노트를 찾지 못해 되돌리지 못했어요 · ${entry.path}`,
      );
    }
    const diverged: string[] = [];
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const current = normalizeMoveGroup(fm.그룹);
      if (current !== entry.destination) {
        diverged.push(current);
        return;
      }
      fm.그룹 = previousGroup;
    });
    if (diverged.length > 0) {
      throw new BatchMoveConflictError(
        entry.path,
        `되돌리기 전에 그룹이 또 바뀌었어요 · ${entry.path}`,
      );
    }
  }

  /**
   * One command for 보기’s page-filter chips: FM first, then settings.
   * A settings-save failure rolls the frontmatter back.
   */
  private async setPageFilter(
    next: PrimaryFilterProperty | null,
  ): Promise<void> {
    let prev = this.resolvePageScope().primaryFilter;
    if (this.file) {
      await this.app.fileManager.processFrontMatter(this.file, (fm) => {
        const raw =
          typeof fm.primaryFilter === "string"
            ? fm.primaryFilter.trim()
            : "";
        prev = FILTER_AXIS_IDS.includes(raw as PrimaryFilterProperty)
          ? (raw as PrimaryFilterProperty)
          : null;
        if (next == null) delete fm.primaryFilter;
        else fm.primaryFilter = next;
      });
    }
    try {
      patchGalleryPageState(this.plugin.settings, this.pageKey(), {
        chipFilter: "all",
        chipFilterProperty:
          next ?? this.plugin.settings.primaryFilterProperty,
      });
      await this.plugin.saveSettings();
    } catch (error) {
      if (this.file) {
        await this.app.fileManager.processFrontMatter(this.file, (fm) => {
          if (prev == null) delete fm.primaryFilter;
          else fm.primaryFilter = prev;
        });
      }
      throw error;
    }
  }

  setEditMode(enabled: boolean): void {
    // Selection owns the Gallery Edit surface. This guard is deliberately at
    // the public entry point, not only on the pencil, because the global
    // command palette calls the same method. Saving can never be cancelled;
    // while merely selecting, the active selection icon remains the sole exit.
    if (this.groupRenameSaving) {
      new Notice("그룹 이름 변경이 끝난 뒤 편집 모드를 바꿀 수 있어요.");
      return;
    }
    if (this.batchMode) {
      new Notice(
        this.batchSaving
          ? "그룹 이동이 끝난 뒤 편집 모드를 바꿀 수 있어요."
          : "여러 선택을 끝낸 뒤 편집 모드를 바꿀 수 있어요.",
      );
      return;
    }
    const turningOn = enabled && !this.editMode;
    // Selection mode exists only inside Gallery Edit — leaving takes it down.
    if (!enabled) this.teardownBatchMode();
    if (!enabled) this.closeGroupRenameDialog();
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
    // A scan can outlive the FileView that started it. Closed views no longer
    // own a DOM, so they must neither start nor finish a render pass.
    if (this.viewClosed) return;
    const generation = this.uiGeneration;
    // A batch write is running: record the request and paint nothing. Scanning
    // here would rebuild `records` from a half-written vault, and rendering
    // would tear down the dialog the transaction is still holding.
    if (this.batchFreeze.capture()) return;
    // Our own `order` writes are still settling: the vault would answer with a
    // half-written arrangement, and the screen already holds the finished one.
    if (this.orderFreeze.capture()) return;
    // Read the dirty version first: an edit landing during the scan below must
    // stay pending instead of being acknowledged away by this older pass.
    const version = this.plugin.galleryRefreshVersion();
    const reorderRevision = this.reorderRevision;
    const records = await this.store.listCharacters(
      this.sortMode,
      this.pageLibrary(),
    );
    if (!this.uiAlive(generation)) return;
    // The scan may have started before a drop and resumed afterward. Re-check
    // the guards before committing its snapshot; otherwise old metadata can
    // replace the synchronously committed order even though the entry check
    // above passed. A revision mismatch after a fast drain starts one clean
    // follow-up scan instead of accepting the stale result.
    if (this.batchFreeze.capture()) return;
    if (this.orderFreeze.capture()) return;
    if (reorderRevision !== this.reorderRevision) {
      if (this.uiAlive(generation)) void this.refresh();
      return;
    }
    this.records = records;
    this.ensureActiveGenre();
    this.reconcileBatchScope();
    if (this.selected) {
      this.selected =
        this.records.find((r) => r.path === this.selected?.path) ?? null;
    }
    // Status chips stay settings-owned. Unknown note values still render as
    // gray ghost pills — we do not auto-add them back after the user deletes.
    this.plugin.acknowledgeGalleryRefresh(version);
    this.render();
  }

  /**
   * A note under this gallery changed on disk (after Obsidian persisted it).
   * Body-only edits patch the note-derived side-panel regions in place; a
   * card/frontmatter projection change asks for a full gallery render.
   * Returns true when a full refresh was requested.
   */
  async handleNoteChanged(path: string): Promise<boolean> {
    // Our own transaction is writing these notes. Patching a card now would
    // paint an intermediate group value that may still be rolled back.
    if (this.batchFreeze.capture()) return false;
    // Same for a drop's own writes — `order` is part of the card projection, so
    // every note the lane touches comes back here asking for a repaint.
    if (this.orderFreeze.capture()) return false;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      this.plugin.markGalleriesDirty({ path });
      return true;
    }

    const known = this.records.find((record) => record.path === path) ?? null;
    let next: CharacterRecord | null = null;
    try {
      next = await this.store.readCharacter(file);
    } catch {
      // Keep last-good state; the next modify or manual refresh retries.
      return false;
    }

    if (!known || !next || cardProjectionChanged(known, next)) {
      this.plugin.markGalleriesDirty({ path });
      return true;
    }

    if (this.selected?.path !== path) return false;
    await this.refreshNoteRegions(known);
    return false;
  }

  /** Cover + embedded/folder image identity of the panel's image strip. */
  private imageFingerprint(
    record: CharacterRecord,
    markdown: string,
  ): string {
    const images = listCharacterImages(this.app, record, markdown);
    return `${record.cover}\0${images.map((f) => f.path).join("\0")}`;
  }

  /**
   * Patch only the note-derived regions of the open panel: body always, image
   * strip when its fingerprint moved. The new body is staged hidden inside the
   * panel and swapped in atomically, so a failed read or render leaves the last
   * good DOM (and the sheet chrome) untouched.
   */
  private async refreshNoteRegions(record: CharacterRecord): Promise<void> {
    const detail = this.contentEl.querySelector(".charinfo-gallery__detail");
    if (!(detail instanceof HTMLElement)) return;
    const liveBody = detail.querySelector(".charinfo-detail__body");
    if (!(liveBody instanceof HTMLElement)) {
      // The panel never finished painting — rebuild it wholesale.
      await this.renderDetail(detail);
      return;
    }

    const generation = ++this.noteRefreshGeneration;
    const stale = () =>
      generation !== this.noteRefreshGeneration ||
      this.selected?.path !== record.path ||
      !liveBody.isConnected;

    let markdown: string;
    try {
      markdown = await this.app.vault.read(record.file);
    } catch {
      return;
    }
    if (stale()) return;

    const stagedChild = new Component();
    const staged = detail.createDiv({ cls: "charinfo-detail__body is-staging" });
    this.addChild(stagedChild);
    const discard = () => {
      this.removeChild(stagedChild);
      staged.remove();
    };

    try {
      await renderLivePeekBody(
        this.app,
        stagedChild,
        staged,
        markdown,
        record.path,
      );
    } catch {
      discard();
      return;
    }
    if (stale()) {
      discard();
      return;
    }

    this.unloadPeekBody();
    liveBody.replaceWith(staged);
    staged.removeClass("is-staging");
    this.peekBodyChild = stagedChild;

    const fingerprint = this.imageFingerprint(record, markdown);
    if (fingerprint !== this.peekStripFingerprint) {
      this.peekStripFingerprint = fingerprint;
      const holder = document.createElement("div");
      await this.renderImageStrip(holder, record, markdown);
      const nextStrip = holder.firstElementChild;
      const oldStrip = detail.querySelector(".charinfo-image-strip");
      if (nextStrip instanceof HTMLElement) {
        if (oldStrip instanceof HTMLElement) oldStrip.replaceWith(nextStrip);
        else detail.insertBefore(nextStrip, staged);
      }
    }
  }

  private filtered(): CharacterRecord[] {
    const q = this.searchQuery.trim().toLowerCase();
    const genre = this.activeArchive().trim();
    const axis = this.filterAxis();
    const chip = this.chipFilter;
    return this.records.filter((record) => {
      if (genre && record.장르 !== genre) return false;
      if (chip !== "all") {
        // A record whose schema dropped the axis must not match it by a value
        // left dormant on the note.
        if (!this.recordHasAxis(record, axis.propertyId)) return false;
        if (!recordMatchesAxisChip(axis, record, chip)) return false;
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
    this.invalidateProjectionCaches();
    this.viewMenu?.close();
    this.viewMenu = null;
    this.closeTagMenu();
    // A repaint invalidates the destination list (counts, group inventory), and
    // `root.empty()` would orphan the dialog's DOM anyway. It cannot survive.
    this.closeBatchDialog();
    this.closeGroupRenameDialog();
    root.empty();
    root.addClass("charinfo-gallery");
    root.toggleClass("is-edit", this.editMode);
    root.toggleClass("is-batch", this.batchMode);
    root.toggleClass("is-fit-image", this.plugin.settings.cardFitImage);
    root.toggleClass("is-narrow", this.isNarrow);
    root.toggleClass("is-peek-open", this.peekOpen);
    root.tabIndex = 0;
    this.applySheetSnap();

    this.renderHeader(root);
    this.syncGalleryInert();
    root.createDiv({ cls: "charinfo-gallery__body" });
    this.renderBody();
    // The bar lives outside the body so search and chip repaints leave it be.
    if (this.batchMode) this.renderBatchBar(root);
  }

  private renderBody(): void {
    const body = this.contentEl.querySelector(".charinfo-gallery__body");
    if (!(body instanceof HTMLElement)) return;
    this.invalidateProjectionCaches();
    body.empty();
    const main = body.createDiv({ cls: "charinfo-gallery__main" });
    // Narrow only: dim layer under the sheet, above the (inert) grid.
    const scrim = body.createDiv({
      cls: "charinfo-gallery__scrim",
      attr: { "aria-hidden": "true" },
    });
    scrim.addEventListener("click", () => {
      if (this.peekOpen) this.closePeek();
    });
    const detail = body.createDiv({ cls: "charinfo-gallery__detail" });

    // Tap gallery chrome (not a card) → dismiss side panel.
    main.addEventListener("click", (event) => {
      if (!this.peekOpen) return;
      const target = event.target as HTMLElement;
      if (target.closest(".charinfo-card")) return;
      if (
        target.closest(
          "button, a, input, textarea, select, .charinfo-status-filter",
        )
      )
        return;
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
    /** `cls` for the colorless chips; `color` for the ones that carry a dot. */
    const options: {
      id: string;
      label: string;
      cls: string;
      color: StatusColorToken | null;
    }[] = [
      { id: "all", label: "전체", cls: "is-all", color: null },
      ...this.visibleAxisOptions(axis).map((s) => ({
        id: s.id,
        label: s.label,
        cls: isTagAxis ? "is-tag" : "",
        color: isTagAxis ? null : s.color,
      })),
    ];
    for (const option of options) {
      // Span (not <button>) so Obsidian default button chrome can't paint a grey tray.
      const chip = tokens.createEl("span", {
        cls:
          "charinfo-status-filter" +
          (option.cls ? ` ${option.cls}` : "") +
          (active === option.id ? " is-active" : ""),
        attr: {
          role: "button",
          tabindex: "0",
          "data-filter": option.id,
          "aria-pressed": active === option.id ? "true" : "false",
        },
      });
      if (option.color) {
        paintStatusColor(chip, option.color);
        chip.createSpan({ cls: "charinfo-status__dot" });
      }
      chip.createSpan({ text: option.label });
      const activate = () => void this.setChipFilter(option.id);
      chip.addEventListener("click", activate);
      chip.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        activate();
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
      if (this.cardEditActive && current) {
        const renameBtn = genreRow.createEl("button", {
          cls: "clickable-icon charinfo-icon-btn charinfo-gallery__genre-rename",
          attr: {
            type: "button",
            title: "아카이브 이름 바꾸기",
            "aria-label": "아카이브 이름 바꾸기",
          },
        });
        setIcon(renameBtn, "pencil");
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
    if (this.cardEditActive) {
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

    // Selection mode locks the pencil: the selection icon is the only exit.
    const surface = this.batchSurface();
    const toggleBtn = actions.createEl("button", {
      cls:
        "clickable-icon charinfo-gallery__icon-btn" +
        (this.editMode ? " is-active" : "") +
        (surface.editToggleEnabled ? "" : " is-locked"),
      attr: {
        type: "button",
        title: this.batchMode
          ? "여러 선택을 끝내면 읽기 모드로 바꿀 수 있어요"
          : this.editMode
            ? "읽기 모드로"
            : "편집 모드 — 표시 순서를 바꿀 수 있어요",
        "aria-label": this.batchMode
          ? "읽기 모드 — 여러 선택을 끝내면 바꿀 수 있어요"
          : this.editMode
            ? "읽기 모드"
            : "편집 모드",
        "aria-disabled": this.batchMode ? "true" : "false",
        "data-charinfo": "edit",
      },
    });
    toggleBtn.disabled = !surface.editToggleEnabled;
    setIcon(toggleBtn, "pencil");
    toggleBtn.addEventListener("click", () => this.setEditMode(!this.editMode));

    // Directly after the pencil: selection is a mode *inside* Gallery Edit, and
    // its active state is the only visible way back out.
    const batchLabel = this.batchMode
      ? "여러 캐릭터 선택 끝내기"
      : "여러 캐릭터 선택";
    const batchBtn = actions.createEl("button", {
      cls:
        "clickable-icon charinfo-gallery__icon-btn" +
        (this.batchMode ? " is-active" : "") +
        (this.editMode ? "" : " is-locked"),
      attr: {
        type: "button",
        title: this.editMode
          ? batchLabel
          : "여러 캐릭터 선택 — 편집 모드에서 열려요",
        "aria-label": this.editMode
          ? batchLabel
          : "여러 캐릭터 선택 — 편집 모드에서 열려요",
        "aria-pressed": this.batchMode ? "true" : "false",
        "aria-disabled": this.editMode ? "false" : "true",
        "data-charinfo": "batch",
      },
    });
    setIcon(batchBtn, "list-checks");
    batchBtn.addEventListener("click", (event) => {
      event.preventDefault();
      if (!this.editMode) {
        new Notice("편집 모드(연필)를 켜면 여러 캐릭터를 고를 수 있어요.");
        toggleBtn.focus();
        return;
      }
      this.setBatchMode(!this.batchMode);
    });

    const attrBtn = actions.createEl("button", {
      cls:
        "clickable-icon charinfo-gallery__icon-btn" +
        (this.cardEditActive ? "" : " is-locked"),
      attr: {
        type: "button",
        title: this.cardEditActive
          ? "속성 관리 — 이 그룹의 항목"
          : this.batchMode
            ? "여러 선택을 끝내면 속성을 관리할 수 있어요"
            : "속성 관리 — 편집 모드에서 열려요",
        "aria-label": this.cardEditActive
          ? "속성 관리"
          : this.batchMode
            ? "속성 관리 — 여러 선택을 끝내면 열려요"
            : "속성 관리 — 편집 모드에서 열려요",
        "aria-disabled": this.cardEditActive ? "false" : "true",
      },
    });
    setIcon(attrBtn, "book");
    attrBtn.addEventListener("click", (event) => {
      event.preventDefault();
      if (!this.cardEditActive) {
        if (this.batchMode) {
          new Notice("여러 선택을 끝내면 속성 관리를 열 수 있어요.");
          batchBtn.focus();
        } else {
          new Notice("편집 모드(연필)를 켜면 속성 관리를 열 수 있어요.");
          toggleBtn.focus();
        }
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
    this.viewMenu = new ViewSettingsPopover(viewBtn, {
      // Union of the archive's active fields in deterministic schema order.
      // Observed groups come from the *unfiltered* archive: a chip or a search
      // must not remove a row from 보기.
      getFields: () => {
        const rows = unionActiveFieldsForArchive(
          this.plugin.settings,
          this.pageLibrary(),
          normalizeArchiveKey(this.activeArchive()),
          this.pageKey(),
          this.observedGroups(),
        );
        return rows.map((entry) => ({
          fieldId: entry.fieldId,
          label: entry.label,
          visible: entry.visible,
        }));
      },
      setVisible: async (fieldId, visible) => {
        const page = this.pageKey();
        const archive = normalizeArchiveKey(this.activeArchive());
        await this.plugin.commitSettings((settings) => {
          setFieldVisibility(settings, page, archive, fieldId, visible);
        });
      },
      getFitImage: () => this.plugin.settings.cardFitImage,
      setFitImage: async (fit) => {
        this.plugin.settings.cardFitImage = fit;
        await this.plugin.saveSettings();
      },
      getPageAxis: () => this.resolvePageScope().primaryFilter,
      getGlobalAxis: () => this.plugin.settings.primaryFilterProperty,
      axisName: (id) =>
        axisLabel(id, this.plugin.settings.propertyDisplayNames),
      axisReachable: (id) => this.axisReachable(id),
      axisOptions: (id) =>
        axisFor(this.plugin.settings, id).options.map(
          (option) => option.label,
        ),
      setPageAxis: (next) => this.setPageFilter(next),
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
    // Adding a card is an edit action, and it reveals the new card in peek.
    // Selection mode keeps the recovery routes and drops this one.
    const canAdd = this.batchSurface().addCardVisible;

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

      if (canAdd) {
        const add = actions.createEl("button", {
          text: "캐릭터 추가",
          cls: "charinfo-gallery__empty-secondary",
          attr: { type: "button" },
        });
        add.addEventListener("click", addCharacter);
      }
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

    if (!canAdd) return;
    const add = actions.createEl("button", {
      text: "캐릭터 추가",
      cls: "mod-cta",
      attr: { type: "button" },
    });
    add.addEventListener("click", addCharacter);
  }

  private renderGroups(main: HTMLElement, records: CharacterRecord[]): void {
    // Section headers = non-empty `그룹` only (장르 is the top archive select).
    const genre = this.activeArchive().trim();
    // Pencil mode also shows a group the user made but has not filled yet.
    // Membership is read from the unfiltered archive, so a chip or a search can
    // never invent an "empty" section for cards it merely hid.
    const emptyGroups = this.editMode ? this.emptyPersistedGroups() : [];
    // One ranking authority: the canonical route order, 기본 included. The
    // default section is no longer pinned last — it holds whatever rank the
    // group drawer gave it, and an unranked route still lands at the end.
    const routeOrder = this.routeOrder();
    const rank = new Map<string, number>();
    routeOrder.forEach((route, index) => {
      if (!rank.has(route)) rank.set(route, index);
    });
    const groups = this.store.groupByGroup(records, routeOrder.filter(Boolean));
    const sections: { group: string; list: CharacterRecord[] }[] = [];
    const rendered = new Set<string>();
    for (const list of groups.values()) {
      const group = list[0]?.그룹.trim() ?? "";
      rendered.add(group);
      sections.push({ group, list });
    }
    for (const group of emptyGroups) {
      if (rendered.has(group)) continue;
      rendered.add(group);
      sections.push({ group, list: [] });
    }
    const unranked = routeOrder.length;
    sections.sort(
      (a, b) => (rank.get(a.group) ?? unranked) - (rank.get(b.group) ?? unranked),
    );

    for (const { group: rawGroup, list } of sections) {
      const section = main.createDiv({ cls: "charinfo-genre" });
      section.dataset.group = rawGroup;
      section.dataset.groupRaw = rawGroup;

      if (rawGroup) {
        section.dataset.id = rawGroup;
        const heading = section.createDiv({ cls: "charinfo-genre__header" });
        const titleRow = heading.createDiv({ cls: "charinfo-genre__title-row" });

        if (this.cardEditActive) {
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
          attr: { title: rawGroup },
        });
        titleRow.createSpan({
          cls: "charinfo-genre__count",
          text: String(list.length),
        });

        if (this.cardEditActive) {
          const rename = titleRow.createEl("button", {
            cls: "clickable-icon charinfo-icon-btn charinfo-genre__rename",
            attr: {
              type: "button",
              title: "그룹 이름 바꾸기",
              "aria-label": `「${rawGroup}」 그룹 이름 바꾸기`,
              "data-group": rawGroup,
            },
          });
          setIcon(rename, "pencil");
          rename.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.openGroupRenameDialog(rawGroup);
          });
          heading.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.openGroupContextMenu(event, rawGroup, routeOrder);
          });
          attachHoldDrag(section, rawGroup, {
            canDrag: () => this.cardEditActive,
            activation: "move",
            movePx: 4,
            handleSelector: ".charinfo-genre__drag-handle",
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
      if (this.cardEditActive) {
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

    // The canonical order, so a rank the drawer gave 기본 survives a section
    // drag that only ever moves named headers.
    const current = this.routeOrder();
    const next = moveInOrder(current, fromId, toId, place);
    if (next.join("\0") === current.join("\0")) return;

    this.moveDomItem(
      `.charinfo-genre[data-id="${CSS.escape(fromId)}"]`,
      `.charinfo-genre[data-id="${CSS.escape(toId)}"]`,
      place,
    );
    await this.persistGroupOrderForActive(next, false);
  }

  /** Persist a route order (`""` allowed) and repaint unless the DOM moved. */
  private async persistGroupOrderForActive(
    order: string[],
    rerender = true,
  ): Promise<void> {
    const genre = this.activeArchive().trim();
    if (!genre) return;
    setGroupRouteOrderFor(this.plugin.settings, this.pageLibrary(), genre, order);
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
    // One table decides every handler below, so no branch here can drift out of
    // step with selection mode.
    const surface = this.batchSurface();
    const picked = surface.cardPick && this.batchSelection.has(record.path);
    const card = grid.createDiv({
      cls:
        "charinfo-card" +
        (this.selected?.path === record.path ? " is-selected" : "") +
        (surface.cardEditActive ? " is-editable" : "") +
        (surface.cardPick ? " charinfo-card--pick" : "") +
        (picked ? " is-picked" : ""),
    });
    card.dataset.path = record.path;

    if (surface.cardPick) {
      // The card *is* the checkbox: no detail, no drag, no cover edit, no
      // property control, no context menu. One meaning at a time.
      card.setAttribute("role", "checkbox");
      card.setAttribute("aria-checked", picked ? "true" : "false");
      card.setAttribute("aria-label", `${record.title} 선택`);
      card.tabIndex = 0;
      const mark = card.createDiv({
        cls: "charinfo-card__pick",
        attr: { "aria-hidden": "true" },
      });
      setIcon(mark, "check");
      card.addEventListener("click", (event) => {
        event.preventDefault();
        this.toggleBatchPick(record.path);
      });
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        this.toggleBatchPick(record.path);
      });
    } else {
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
    }

    if (surface.cardEditMenu) {
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
        canDrag: () => this.cardEditActive,
        activation: "move",
        movePx: 2,
        // Cards may move between subgroup grids while the gallery is editing.
        // Other attachHoldDrag consumers keep their local-container behavior.
        dropRootSelector: ".charinfo-gallery__main",
        // Handle or title band — cover stays free for pan / picker.
        handleSelector: ".charinfo-card__drag-handle, .charinfo-card__meta",
        ignoreSelector: ".charinfo-card__cover",
        onReorder: (fromPath, toPath, place) => {
          this.suppressClick = true;
          void this.handleReorder(fromPath, toPath, place);
        },
      });
    } else if (surface.cardReadMenu) {
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

    if (surface.cardCoverEdit) {
      this.attachCoverEdit(cover, coverImg, record);
    }

    const meta = card.createDiv({ cls: "charinfo-card__meta" });
    this.renderViewProperties(meta, record, {
      interactiveStatus: surface.interactiveStatus,
      surface: "card",
    });
  }

  /** This card's group schema — the one source cards, peek and heal share. */
  private recordSchema(record: CharacterRecord): GroupSchemaRecord {
    return resolveGroupSchema(
      this.plugin.settings,
      this.pageLibrary(),
      record.장르,
      record.그룹,
    );
  }

  private fieldDisplayLabel(field: FieldDef): string {
    return fieldLabel(field, this.plugin.settings.propertyDisplayNames);
  }

  /**
   * Card and peek project the record's own group-schema order, with the card
   * surface additionally applying 보기's eyes. Reordering in `속성 관리`
   * therefore changes every presentation of that group, while 보기 only hides.
   *
   * Peek drops `이름` (the title owns it) and keeps empty rows — an empty row is
   * the door for filling it in.
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
    const editable = Boolean(opts.interactiveStatus);
    const schema = this.recordSchema(record);
    const order = effectiveActiveFields(schema).map((field) => field.id);

    if (opts.surface === "peek") {
      const fields = projectSchemaFields(order, schema, { skip: ["name"] });
      for (const field of fields) {
        const row = parent.createDiv({ cls: "charinfo-detail__prop" });
        row.createSpan({
          text: this.fieldDisplayLabel(field),
          cls: "charinfo-detail__prop-label",
        });
        // `field.type` decides the control; being a chip axis decides only
        // where the vocabulary comes from. A built-in carrying a scoped type
        // override therefore gets the control its type asks for, still reading
        // the global list — it never falls back to its default shape.
        if (field.id === "tags" && field.type === "multi-select") {
          if (!record.태그.length && !editable) {
            this.paintEmptyField(row);
            continue;
          }
          this.renderTagCluster(row, record, {
            interactive: editable,
            surface: "peek",
          });
          continue;
        }
        if (isChipAxisField(field) && field.type === "select") {
          // Built-in chip axis → the shared pill, vocabulary from settings.
          const axis = axisFor(
            this.plugin.settings,
            field.id as PrimaryFilterProperty,
          );
          const unset =
            axis.propertyId !== "status" &&
            !recordAxisValue(record, axis.propertyId).trim();
          if (unset) {
            const empty = this.paintEmptyField(row, {
              editable,
              action: `${axis.label} 바꾸기`,
            });
            if (editable && empty instanceof HTMLButtonElement) {
              this.bindAxisMenu(empty, record, axis, "");
            }
            continue;
          }
          const chips = row.createDiv({ cls: "charinfo-card__chips" });
          this.renderAxisPill(chips, record, axis, { interactive: editable });
          continue;
        }
        if (field.type === "select") {
          this.renderFieldSelect(row, record, field, editable);
          continue;
        }
        if (field.type === "multi-select") {
          this.renderFieldCluster(row, record, field, editable);
          continue;
        }
        this.renderFieldText(row, record, field, editable);
      }
      return;
    }

    const pageKey = this.pageKey();
    const archive = normalizeArchiveKey(this.activeArchive());
    // Tags driving the chip row keep their eye exception — but they hold their
    // persisted slot rather than being appended to the end of the strip.
    const shown = projectSchemaFields(order, schema, {
      visible: (fieldId) =>
        isFieldVisible(this.plugin.settings, pageKey, archive, fieldId),
      alwaysVisible: primary.propertyId === "tags" ? ["tags"] : [],
    });
    for (const field of shown) {
      if (field.id === "name") {
        const title = record.title;
        if (title) {
          parent.createDiv({ cls: "charinfo-card__title", text: title });
        }
        continue;
      }
      if (field.id === "tags" && field.type === "multi-select") {
        if (!record.태그.length && !editable) continue;
        this.renderTagCluster(parent, record, {
          interactive: editable,
          surface: "card",
        });
        continue;
      }
      const axis = field.type === "select" && isBuiltinFieldId(field.id)
        ? pillAxis(field.id as CardPropertyId)
        : null;
      if (axis) {
        // Card pills follow the eye toggles. Unset non-status values stay hidden
        // in read mode; edit mode keeps the ghost so a value can be assigned.
        if (
          axis.propertyId !== "status" &&
          !editable &&
          !recordAxisValue(record, axis.propertyId).trim()
        ) {
          continue;
        }
        const chips = parent.createDiv({
          cls: "charinfo-card__chips",
        });
        this.renderAxisPill(chips, record, axis, {
          interactive: editable,
        });
        continue;
      }

      // Everything else reads as text on a card; peek is the fill door.
      const value = this.fieldText(record, field);
      if (!value) continue;
      parent.createDiv({
        cls: "charinfo-card__prop",
        text: value,
        attr: { "data-prop": field.id },
      });
    }
  }

  /**
   * Display text for one field (option labels resolved, lists joined).
   *
   * A chip-axis built-in stores an option **id**, so it has to resolve through
   * its axis vocabulary — otherwise a renamed 관계 / 인연 / 소속 keeps showing
   * the raw id on the card. Unknown ids still show themselves.
   */
  private fieldText(record: CharacterRecord, field: FieldDef): string {
    const raw = fieldValue(record, field);
    if (Array.isArray(raw)) {
      const labels =
        field.id === "tags"
          ? raw.map((id) => this.tagLabel(id))
          : isChipAxisField(field)
            ? raw.map((id) => this.axisOptionLabel(field.id, id))
            : raw.map((id) => fieldOptionLabel(field, id));
      return labels.filter(Boolean).join(", ");
    }
    const value = raw.trim();
    if (!value) return "";
    if (isChipAxisField(field)) return this.axisOptionLabel(field.id, value);
    // Field-local vocabulary, built-in or custom: a non-chip built-in retyped to
    // select owns its options like any other field. With no matching option the
    // resolver returns the stored id, which is what a plain text field wants.
    return fieldOptionLabel(field, value);
  }

  /** Chip-axis option label — the same resolver the chips and pills use. */
  private axisOptionLabel(fieldId: string, optionId: string): string {
    return resolveAxisOption(
      axisFor(this.plugin.settings, fieldId as PrimaryFilterProperty),
      optionId,
    ).label;
  }

  /**
   * The list this field offers, wherever it lives.
   *
   * A built-in chip axis keeps its global vocabulary even under a scoped type
   * override — a 상태 turned multi-select still offers the archive's statuses,
   * not an empty list. Everything else (custom fields, and a non-chip built-in
   * retyped into a select) owns its options in its own `FieldDef`.
   */
  private fieldVocabulary(field: FieldDef): FieldOption[] {
    if (isChipAxisField(field)) {
      return axisFor(
        this.plugin.settings,
        field.id as PrimaryFilterProperty,
      ).options.map((option) => ({ id: option.id, label: option.label }));
    }
    return field.options.map((option) => ({ ...option }));
  }

  /** One stored id as this field's vocabulary names it. */
  private fieldVocabLabel(field: FieldDef, optionId: string): string {
    if (field.id === "tags") return this.tagLabel(optionId);
    if (isChipAxisField(field)) return this.axisOptionLabel(field.id, optionId);
    return fieldOptionLabel(field, optionId);
  }

  private tagLabel(id: string): string {
    return this.plugin.settings.tagVocab.find((tag) => tag.id === id)?.label ?? id;
  }

  /**
   * Peek text value: click to edit when the pencil is on, muted placeholder
   * when empty. `그룹` moves the card, so it commits through the move path.
   */
  private renderFieldText(
    row: HTMLElement,
    record: CharacterRecord,
    field: FieldDef,
    editable: boolean,
  ): void {
    const value = this.fieldText(record, field);
    if (!editable) {
      if (value) row.createSpan({ text: value });
      else this.paintEmptyField(row);
      return;
    }
    // `그룹` does not fill a value — it moves the card to another section.
    const action =
      field.id === "group"
        ? "다른 그룹으로 옮기기"
        : `${this.fieldDisplayLabel(field)} 채우기`;
    const btn = row.createEl("button", {
      cls: "charinfo-detail__prop-btn" + (value ? "" : " is-empty"),
      text: value || EMPTY_FIELD_MARK,
      attr: {
        type: "button",
        title: action,
        "aria-label": action,
      },
    });
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const input = row.createEl("input", {
        type: "text",
        cls: "charinfo-detail__prop-input",
        attr: { spellcheck: "false" },
      });
      input.value = value;
      btn.remove();
      let done = false;
      const finish = (commit: boolean) => {
        if (done) return;
        done = true;
        const next = input.value.trim();
        input.remove();
        if (commit && next !== value) {
          void this.commitFieldText(record, field, next);
          return;
        }
        this.renderFieldText(row, record, field, editable);
      };
      input.addEventListener("keydown", (event2) => {
        if (event2.key === "Enter") {
          event2.preventDefault();
          finish(true);
        }
        if (event2.key === "Escape") {
          event2.preventDefault();
          finish(false);
        }
      });
      input.addEventListener("blur", () => finish(true));
      input.focus();
      input.select();
    });
  }

  private async commitFieldText(
    record: CharacterRecord,
    field: FieldDef,
    value: string,
  ): Promise<void> {
    if (field.id === "group") {
      await this.commitGroupChange(record, value);
      return;
    }
    this.plugin.suppressGalleryRefresh = true;
    try {
      await setCharacterField(this.app, record.file, field.key, value);
    } catch (error) {
      new Notice(
        `저장 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    } finally {
      this.plugin.suppressGalleryRefresh = false;
    }
    this.applyFieldToRecord(record, field, value);
    this.repaintCardAndPeek(record);
  }

  /**
   * Moving a card by typing its group: YAML first, then the destination schema
   * (persist + reconcile), then repaint. Source-only keys stay dormant.
   */
  private async commitGroupChange(
    record: CharacterRecord,
    group: string,
  ): Promise<void> {
    const next = group.trim();
    if (next === record.그룹.trim()) {
      this.repaintCardAndPeek(record);
      return;
    }
    this.plugin.suppressGalleryRefresh = true;
    try {
      await setCharacterField(this.app, record.file, "그룹", next);
    } catch (error) {
      new Notice(
        `그룹 저장 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.plugin.markGalleriesDirty({ path: record.path });
      return;
    } finally {
      this.plugin.suppressGalleryRefresh = false;
    }
    record.그룹 = next;
    record.values.그룹 = next;
    await this.adoptDestinationSchema(record.장르, next);
    this.renderBody();
    const detail = this.contentEl.querySelector(".charinfo-gallery__detail");
    if (detail instanceof HTMLElement) void this.renderDetail(detail);
  }

  /**
   * Destination group's schema must exist before its members are reconciled.
   *
   * `library` may be passed in by a caller whose work outlives the gesture that
   * started it: reading the page scope late would answer with the default
   * library once the leaf has let go of its file.
   */
  private async adoptDestinationSchema(
    archive: string,
    group: string,
    library = this.pageLibrary(),
    options: { propagateFailure?: boolean } = {},
  ): Promise<void> {
    try {
      await this.plugin.persistGroupSchema(library, archive, group);
    } catch (error) {
      console.error("[charinfo] 그룹 속성 저장 실패", error);
      // Reorder persistence owns one consolidated failure Notice and durable
      // reload. Other callers keep the existing best-effort behavior.
      if (options.propagateFailure) throw error;
      return;
    }
    this.plugin.reconcileGroupMembers(library, archive, group);
  }

  /** Keep the in-memory record in step with the write we just made. */
  private applyFieldToRecord(
    record: CharacterRecord,
    field: FieldDef,
    value: string | string[],
  ): void {
    if (Array.isArray(value)) {
      if (field.id === "tags") {
        record.태그 = [...value];
        return;
      }
      record.values[field.key] = [...value];
      // A built-in retyped to multi-select still owns a `string` typed field —
      // `CharacterStore` flattens a YAML list the same way — so keep it in step
      // or the title fallback and every text reader go stale until a reload.
      this.syncTypedBuiltin(record, field.id, value.join(", "));
      return;
    }
    record.values[field.key] = value;
    this.syncTypedBuiltin(record, field.id, value);
  }

  /** Mirror one scalar write onto the built-in's own typed field. */
  private syncTypedBuiltin(
    record: CharacterRecord,
    fieldId: string,
    value: string,
  ): void {
    switch (fieldId) {
      case "name":
        record.이름 = value;
        record.title = value || record.코드네임 || record.file.basename;
        break;
      case "group":
        record.그룹 = value;
        break;
      case "codename":
        record.코드네임 = value;
        record.title = record.이름 || value || record.file.basename;
        break;
      case "realName":
        record.본명 = value;
        break;
      case "affiliation":
        record.소속 = value;
        break;
      case "relation":
        record.관계 = value;
        break;
      case "bond":
        record.인연 = value;
        break;
      case "status":
        record.상태 = value;
        break;
      default:
        break;
    }
  }

  /** Repaint one card's property strip in place (no full grid render). */
  private repaintCard(record: CharacterRecord): void {
    const card = this.contentEl.querySelector(
      `.charinfo-card[data-path="${CSS.escape(record.path)}"]`,
    );
    if (!(card instanceof HTMLElement)) return;
    const meta = card.querySelector(".charinfo-card__meta");
    if (!(meta instanceof HTMLElement)) return;
    meta.empty();
    this.renderViewProperties(meta, record, {
      interactiveStatus: this.cardEditActive,
      surface: "card",
    });
  }

  /** Repaint the peek property block (only when this record is selected). */
  private repaintPeekProps(record: CharacterRecord): void {
    if (this.selected?.path !== record.path) return;
    const props = this.contentEl.querySelector(".charinfo-detail__props");
    if (!(props instanceof HTMLElement)) return;
    props.empty();
    props.createDiv({ cls: "charinfo-detail__props-label", text: "속성" });
    this.renderViewProperties(props, record, {
      interactiveStatus: this.cardEditActive,
      surface: "peek",
    });
  }

  private repaintCardAndPeek(record: CharacterRecord): void {
    this.repaintCard(record);
    this.repaintPeekProps(record);
  }

  /** Any select: the shared pill shape, over whichever list the field offers. */
  private renderFieldSelect(
    row: HTMLElement,
    record: CharacterRecord,
    field: FieldDef,
    editable: boolean,
  ): void {
    const raw = fieldValue(record, field);
    const stored = Array.isArray(raw) ? (raw[0] ?? "") : raw.trim();
    // Unknown ids show themselves, so a removed option stays legible.
    const label = stored ? this.fieldVocabLabel(field, stored) : EMPTY_FIELD_MARK;
    const action = `${this.fieldDisplayLabel(field)} 바꾸기`;
    if (!stored) {
      const empty = this.paintEmptyField(row, {
        editable,
        action,
      });
      if (editable && empty instanceof HTMLButtonElement) {
        const openMenu = (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          this.openFieldSelectMenu(event, record, field, stored);
        };
        empty.addEventListener("click", openMenu);
        empty.addEventListener("contextmenu", openMenu);
      }
      return;
    }
    const chips = row.createDiv({ cls: "charinfo-card__chips" });
    if (!editable) {
      const tag = chips.createSpan({
        cls: "charinfo-status is-static is-gray",
        attr: { "aria-label": label, "data-prop": field.id },
      });
      tag.createSpan({ cls: "charinfo-status__dot" });
      tag.createSpan({ cls: "charinfo-status__label", text: label });
      return;
    }
    const tag = chips.createEl("button", {
      cls: "charinfo-status is-gray",
      attr: {
        type: "button",
        "aria-label": label,
        "data-prop": field.id,
        title: action,
      },
    });
    tag.createSpan({ cls: "charinfo-status__dot" });
    tag.createSpan({ cls: "charinfo-status__label", text: label });
    const openMenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.openFieldSelectMenu(event, record, field, stored);
    };
    tag.addEventListener("click", openMenu);
    tag.addEventListener("contextmenu", openMenu);
  }

  private openFieldSelectMenu(
    event: MouseEvent,
    record: CharacterRecord,
    field: FieldDef,
    stored: string,
  ): void {
    const menu = new Menu();
    const vocabulary = this.fieldVocabulary(field);
    for (const option of vocabulary) {
      menu.addItem((item) =>
        item
          .setTitle(option.label)
          .setChecked(option.id === stored)
          .onClick(() => {
            // The option **id** is stored, so a later rename keeps the value.
            void this.commitFieldValue(record, field, option.id);
          }),
      );
    }
    if (vocabulary.length === 0) {
      menu.addItem((item) =>
        item.setTitle("고를 값이 없어요 · 책에서 추가").setDisabled(true),
      );
    }
    menu.addItem((item) =>
      item
        .setTitle("없음")
        .setChecked(!stored)
        .onClick(() => {
          void this.commitFieldValue(record, field, "");
        }),
    );
    menu.showAtMouseEvent(event);
  }

  private async commitFieldValue(
    record: CharacterRecord,
    field: FieldDef,
    value: string,
  ): Promise<void> {
    this.plugin.suppressGalleryRefresh = true;
    try {
      await setCharacterField(this.app, record.file, field.key, value);
    } catch (error) {
      new Notice(
        `저장 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    } finally {
      this.plugin.suppressGalleryRefresh = false;
    }
    this.applyFieldToRecord(record, field, value);
    this.repaintCardAndPeek(record);
  }

  /** Any multi-select: the tag cluster shape, over the field's own list. */
  private renderFieldCluster(
    row: HTMLElement,
    record: CharacterRecord,
    field: FieldDef,
    editable: boolean,
  ): void {
    const wrap = row.createDiv({
      cls: "charinfo-tags",
      attr: { "data-prop": field.id },
    });
    this.fillFieldCluster(wrap, record, field, editable);
  }

  /**
   * Refill one cluster. The popover anchors on the wrap, not the button, so the
   * wrap must survive every toggle. The vocabulary is resolved once here, so a
   * built-in retyped to multi-select offers its global list instead of nothing.
   */
  private fillFieldCluster(
    wrap: HTMLElement,
    record: CharacterRecord,
    field: FieldDef,
    editable: boolean,
  ): void {
    wrap.empty();
    const vocabulary = this.fieldVocabulary(field);
    const raw = fieldValue(record, field);
    const ids = Array.isArray(raw) ? raw : raw.trim() ? [raw.trim()] : [];
    for (const id of ids) {
      const known = vocabulary.some((option) => option.id === id);
      wrap.createSpan({
        cls: "charinfo-tag" + (known ? "" : " is-ghost"),
        text: this.fieldVocabLabel(field, id),
      });
    }
    if (!editable) {
      if (ids.length === 0) this.paintEmptyField(wrap);
      return;
    }
    if (ids.length === 0) {
      const empty = this.paintEmptyField(wrap, {
        editable: true,
        action: `${this.fieldDisplayLabel(field)} 고르기`,
      });
      empty.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const menuKey = `${record.path}#${field.id}`;
        if (this.tagMenuPath === menuKey && this.tagMenu?.isOpen()) {
          this.closeTagMenu();
          return;
        }
        this.closeTagMenu();
        this.tagMenuPath = menuKey;
        this.tagMenu = new TagChecklistPopover(
          wrap,
          vocabulary,
          {
            getSelected: () => {
              const current = fieldValue(record, field);
              return Array.isArray(current) ? [...current] : [];
            },
            toggle: (id, next) => this.toggleFieldOption(record, field, id, next),
          },
        );
        this.tagMenu.open();
      });
      return;
    }
    const trigger = wrap.createEl("button", {
      cls: "charinfo-tag charinfo-tag--edit",
      text: "+",
      attr: {
        type: "button",
        title: `${this.fieldDisplayLabel(field)} 고르기`,
        "aria-label": `${this.fieldDisplayLabel(field)} 고르기`,
      },
    });
    const menuKey = `${record.path}#${field.id}`;
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.tagMenuPath === menuKey && this.tagMenu?.isOpen()) {
        this.closeTagMenu();
        return;
      }
      this.closeTagMenu();
      this.tagMenuPath = menuKey;
      this.tagMenu = new TagChecklistPopover(
        wrap,
        vocabulary,
        {
          getSelected: () => {
            const current = fieldValue(record, field);
            return Array.isArray(current) ? [...current] : [];
          },
          toggle: (id, next) => this.toggleFieldOption(record, field, id, next),
        },
      );
      this.tagMenu.open();
    });
  }

  private async toggleFieldOption(
    record: CharacterRecord,
    field: FieldDef,
    id: string,
    next: boolean,
  ): Promise<void> {
    const current = fieldValue(record, field);
    const ids = Array.isArray(current) ? [...current] : [];
    const wanted = next
      ? ids.includes(id)
        ? ids
        : [...ids, id]
      : ids.filter((item) => item !== id);
    this.plugin.suppressGalleryRefresh = true;
    try {
      await setCharacterList(this.app, record.file, field.key, wanted);
    } catch (error) {
      new Notice(
        `저장 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    } finally {
      this.plugin.suppressGalleryRefresh = false;
    }
    this.applyFieldToRecord(record, field, wanted);
    this.repaintCard(record);
    // Patch the cluster in place — a full peek repaint would drop the anchor
    // the open checklist popover is positioned against.
    const detail = this.contentEl.querySelector(".charinfo-gallery__detail");
    if (!(detail instanceof HTMLElement)) return;
    detail
      .querySelectorAll(`.charinfo-tags[data-prop="${CSS.escape(field.id)}"]`)
      .forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        this.fillFieldCluster(el, record, field, this.cardEditActive);
      });
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
    if (!opts.interactive) {
      if (opts.surface === "peek" && ids.length === 0) {
        this.paintEmptyField(wrap);
      }
      return;
    }

    if (opts.surface === "peek" && ids.length === 0) {
      const empty = this.paintEmptyField(wrap, {
        editable: true,
        action: "태그 고르기",
      });
      empty.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.tagMenuPath === record.path && this.tagMenu?.isOpen()) {
          this.closeTagMenu();
          return;
        }
        this.openTagChecklist(wrap, record);
      });
      return;
    }

    const trigger = wrap.createEl("button", {
      cls: "charinfo-tag charinfo-tag--edit",
      text: "+",
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
            interactive: this.cardEditActive,
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
    if (!opts.interactive) {
      const tag = parent.createSpan({
        cls: "charinfo-status is-static",
        attr: { "aria-label": option.label, "data-prop": axis.propertyId },
      });
      paintStatusColor(tag, option.color);
      tag.createSpan({ cls: "charinfo-status__dot" });
      tag.createSpan({
        cls: "charinfo-status__label",
        text: option.label,
      });
      return;
    }

    const tag = parent.createEl("button", {
      cls: "charinfo-status",
      attr: {
        type: "button",
        "aria-label": option.label,
        "data-prop": axis.propertyId,
        title: `${axis.label} 바꾸기`,
      },
    });
    paintStatusColor(tag, option.color);
    tag.createSpan({ cls: "charinfo-status__dot" });
    tag.createSpan({
      cls: "charinfo-status__label",
      text: option.label,
    });
    this.bindAxisMenu(tag, record, axis, option.id);
  }

  private bindAxisMenu(
    tag: HTMLElement,
    record: CharacterRecord,
    axis: FilterAxis,
    selectedId: string,
  ): void {
    const openMenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const menu = new Menu();
      for (const s of axis.options) {
        menu.addItem((item) =>
          item
            .setTitle(s.label)
            .setChecked(s.id === selectedId)
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
            .setChecked(!selectedId)
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

  /** Quiet `-` for an unset peek field. Pencil mode keeps it clickable. */
  private paintEmptyField(
    parent: HTMLElement,
    opts?: { editable?: boolean; action?: string },
  ): HTMLElement {
    if (!opts?.editable) {
      return parent.createSpan({
        cls: "charinfo-detail__prop-empty",
        text: EMPTY_FIELD_MARK,
      });
    }
    return parent.createEl("button", {
      cls: "charinfo-detail__prop-btn is-empty",
      text: EMPTY_FIELD_MARK,
      attr: {
        type: "button",
        title: opts.action ?? "",
        "aria-label": opts.action || EMPTY_FIELD_MARK,
      },
    });
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
    } catch (error) {
      // The note kept its old value — so must the record and the DOM. Painting
      // the new pill here would leave the card lying until the next refresh.
      new Notice(
        `${axis.label} 저장 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
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
          if (!(el instanceof HTMLElement)) return;
          paintStatusColor(el, option.color);
          const label = el.querySelector(".charinfo-status__label");
          if (label) label.setText(option.label);
          el.setAttribute("aria-label", option.label);
        });
    }
  }

  private selectCard(record: CharacterRecord): void {
    // Selection mode owns the card. This is the single door to the detail
    // panel, so refusing here closes every indirect route (create-and-reveal
    // included) without each caller having to know about the mode.
    if (this.batchMode) return;
    this.selected = record;
    this.peekOpen = true;
    this.applySheetSnap();
    this.contentEl.toggleClass("is-peek-open", true);
    this.syncGalleryInert();
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
        if (pick.kind === "none") {
          await this.applyCoverIntent(record, { kind: "none" }, { quiet: false });
        } else if (pick.kind === "default") {
          await this.applyCoverIntent(record, { kind: "default" }, { quiet: false });
        } else if (pick.kind === "remote") {
          await this.applyCoverIntent(
            record,
            { kind: "remote", url: pick.url },
            { quiet: false },
          );
        } else {
          await this.applyCoverIntent(
            record,
            { kind: "vault", file: pick.file },
            { quiet: false },
          );
        }
        // Peek strip only — avoid full gallery re-render while peek stays open.
        window.setTimeout(() => {
          const detail = this.contentEl.querySelector(".charinfo-gallery__detail");
          if (detail instanceof HTMLElement && this.selected?.path === record.path) {
            void this.renderDetail(detail);
          }
        }, 0);
      },
    ).open();
  }

  /**
   * Optimistic cover paint + serialized vault write.
   * Strip taps use `quiet` so every tap feels instant without Notice spam.
   */
  private async applyCoverIntent(
    record: CharacterRecord,
    intent:
      | { kind: "vault"; file: TFile }
      | { kind: "remote"; url: string }
      | { kind: "default" }
      | { kind: "none" },
    opts?: { quiet?: boolean },
  ): Promise<void> {
    const quiet = opts?.quiet === true;
    const path = record.path;
    const snapshot = {
      cover: record.cover,
      coverPosition: record.coverPosition,
    };

    this.coverLatest.set(path, intent);
    if (intent.kind === "vault") {
      record.cover = intent.file.path;
      record.coverPosition = "50% 50%";
    } else if (intent.kind === "remote") {
      record.cover = intent.url;
      record.coverPosition = "50% 50%";
    } else if (intent.kind === "none") {
      record.cover = COVER_NONE;
    } else {
      record.cover = "";
    }
    this.syncCoverPreview(record);

    if (!quiet) {
      if (intent.kind === "vault") {
        new Notice(`커버를 「${intent.file.basename}」으로 바꿨어요`);
      } else if (intent.kind === "remote") {
        new Notice("원격 이미지로 커버를 바꿨어요");
      } else if (intent.kind === "none") {
        new Notice("카드 커버를 숨겼어요");
      } else {
        new Notice("노트 첫 이미지를 커버로 쓸게요");
      }
    }

    const prev = this.coverWriteChain.get(path) ?? Promise.resolve();
    const chain = prev.catch(() => undefined).then(async () => {
      // Drain until the latest intent is persisted (coalesce rapid taps).
      for (;;) {
        const latest = this.coverLatest.get(path);
        if (!latest) return;
        this.plugin.suppressGalleryRefresh = true;
        try {
          if (latest.kind === "vault") {
            await setCharacterCover(this.app, record.file, latest.file);
          } else if (latest.kind === "remote") {
            await setCharacterCoverUrl(this.app, record.file, latest.url);
          } else if (latest.kind === "none") {
            await setCharacterCoverNone(this.app, record.file);
          } else {
            await setCharacterCover(this.app, record.file, null);
          }
        } catch (error) {
          console.error("Cover write failed", error);
          // Rollback only if this failed intent is still the latest.
          if (this.coverLatest.get(path) === latest) {
            record.cover = snapshot.cover;
            record.coverPosition = snapshot.coverPosition;
            this.syncCoverPreview(record);
            new Notice("커버 변경에 실패했어요");
            this.coverLatest.delete(path);
          }
          return;
        } finally {
          this.plugin.suppressGalleryRefresh = false;
        }
        if (this.coverLatest.get(path) === latest) {
          this.coverLatest.delete(path);
          return;
        }
        // Newer tap arrived while we wrote — loop with the new intent.
      }
    });
    this.coverWriteChain.set(path, chain);
    await chain;
    if (this.coverWriteChain.get(path) === chain) {
      this.coverWriteChain.delete(path);
    }
  }

  private async changeCover(
    record: CharacterRecord,
    image: TFile | null,
    refresh = true,
    opts?: { quiet?: boolean },
  ): Promise<void> {
    const intent = image
      ? ({ kind: "vault" as const, file: image })
      : ({ kind: "default" as const });
    await this.applyCoverIntent(record, intent, { quiet: opts?.quiet ?? !refresh });
    if (refresh) this.render();
  }

  /** Hide card cover; keep note images (`cover: __none__`). */
  private async clearCoverNone(
    record: CharacterRecord,
    refresh = true,
  ): Promise<void> {
    await this.applyCoverIntent(record, { kind: "none" }, { quiet: false });
    if (refresh) this.render();
  }

  private async changeCoverRemote(
    record: CharacterRecord,
    url: string,
    refresh = true,
  ): Promise<void> {
    await this.applyCoverIntent(
      record,
      { kind: "remote", url },
      { quiet: !refresh },
    );
    if (refresh) this.render();
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
    const none = isCoverNone(record.cover);
    const resolved = none ? null : resolveCover(this.app, record);
    const resolvedVaultPath =
      resolved?.kind === "vault" ? resolved.file.path : null;

    const strip = this.contentEl.querySelector(".charinfo-image-strip__row");
    if (strip) {
      strip.querySelectorAll(".charinfo-thumb").forEach((thumb) => {
        if (!(thumb instanceof HTMLElement)) return;
        const id = thumb.dataset.id ?? "";
        const isCover =
          !none &&
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

    // Automatic default only — never paint first image when cover is `__none__`.
    if (!none && orderedPaths?.[0]) {
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

  /**
   * A dropped card is authoritative before storage hears about it.
   *
   * Everything down to the first `await` is the commit: the record's own
   * 장르/그룹, the normalized `order` values the new arrangement implies, the
   * re-sorted `records`, and the DOM move. That order is the fix — the manual
   * sort reads `record.order`, so ranking before assigning let any repaint
   * rebuild the pre-drop arrangement until the frontmatter writes landed.
   *
   * Storage then catches up inside `orderLane`, silently and in gesture order,
   * behind a refresh guard scoped to exactly that window. A cross-group drop
   * writes its 장르/그룹 and adopts the destination schema in the *same* lane
   * task, ahead of its own ranks, so the two can never interleave with the next
   * gesture's writes. Success says nothing; only failure speaks, once, on drain.
   */
  private handleReorder(
    fromPath: string,
    toPath: string,
    place: "before" | "after",
  ): Promise<void> {
    const plan = planCardReorder(this.records, fromPath, toPath, place);
    // No target, or the card landed back where it was: nothing to write.
    if (!plan) return Promise.resolve();

    const { from, genre, group, genreChanged, groupChanged, moved } = plan;
    this.reorderRevision += 1;
    let sortModeChanged = false;
    if (this.sortMode !== "manual") {
      // Freezing the arrangement the user is looking at *is* the drop, so the
      // mode flips with it. The settings write is storage's problem, not the
      // gesture's — it rides the lane with everything else.
      this.plugin.settings.sortMode = "manual";
      sortModeChanged = true;
      this.showGalleryTip("표시 순서를 「자유」로 맞춰 두고, 지금 자리를 저장해요");
    }

    if (moved) {
      from.장르 = genre;
      from.그룹 = group;
      from.values.그룹 = group;
      if (genre) from.values.장르 = genre;
    }

    const writes = commitOrderValues(plan.ordered);
    this.records = sortCharacters(this.records, "manual");
    this.moveDomItem(
      `.charinfo-card[data-path="${CSS.escape(fromPath)}"]`,
      `.charinfo-card[data-path="${CSS.escape(toPath)}"]`,
      place,
    );
    this.syncGroupSectionChrome();
    if (moved) this.invalidateProjectionCaches();

    // Captured with the gesture: the lane may still be writing after the leaf
    // has let go of its file, and the page scope would answer differently then.
    const library = this.pageLibrary();
    this.orderLaneGeneration = this.uiGeneration;
    return this.orderLane.enqueue(async () => {
      if (sortModeChanged) await this.plugin.saveSettings();
      if (moved) {
        await this.app.fileManager.processFrontMatter(from.file, (fm) => {
          if (genreChanged) fm.장르 = genre;
          if (groupChanged) fm.그룹 = group;
        });
        await this.adoptDestinationSchema(genre, group, library, {
          propagateFailure: true,
        });
      }
      // `writes` was frozen at drop time: re-reading `record.order` here would
      // hand this gesture the ranks a *later* drop has since assigned, and the
      // lane's whole promise is that the newest gesture is the one that wins.
      await writeOrderValues(this.app, writes);
    });
  }

  /**
   * The reorder lane drained: the vault is done agreeing with the screen.
   *
   * The guard lifts here and nowhere else, so a self-generated `order` event
   * describing a half-written vault can never repaint, and an *external* edit
   * that arrived during the window is not lost — it flushes as one refresh.
   * A failed span reports once and then reloads durable order, because the only
   * order still worth trusting is the one storage actually kept.
   */
  private settleOrderLane(failed: boolean): void {
    const deferred = this.orderFreeze.thaw();
    // The leaf may have gone while the writes finished. They kept their storage
    // guarantee; they lost the right to paint.
    if (!this.uiAlive(this.orderLaneGeneration)) return;
    if (failed) {
      new Notice("순서를 저장하지 못했어요.");
      this.plugin.markGalleriesDirty();
      void this.refresh();
      return;
    }
    if (deferred) void this.refresh();
  }

  /** After cross-group DOM moves: drop empty sections. */
  private syncGroupSectionChrome(): void {
    this.contentEl.querySelectorAll(".charinfo-genre").forEach((section) => {
      if (!(section instanceof HTMLElement)) return;
      const grid = section.querySelector(".charinfo-grid");
      if (!(grid instanceof HTMLElement)) return;
      const cardCount = grid.querySelectorAll(
        ".charinfo-card:not(.charinfo-card--add)",
      ).length;
      const count = section.querySelector(".charinfo-genre__count");
      if (count instanceof HTMLElement) count.textContent = String(cardCount);
      if (grid.childElementCount === 0) {
        section.remove();
      }
    });
  }

  private async renderDetail(detail: HTMLElement): Promise<void> {
    const requestId = ++this.detailRequestId;
    // The head owns the drag pointer capture and is about to be replaced.
    this.sheetDrag = null;
    this.contentEl.removeClass("is-sheet-dragging");
    this.unloadPeekBody();
    detail.empty();
    if (!this.selected) {
      this.peekOpen = false;
      this.contentEl.toggleClass("is-peek-open", false);
      return;
    }

    const record = this.selected;

    const head = detail.createDiv({ cls: "charinfo-detail__head" });
    const grip = head.createDiv({
      cls: "charinfo-detail__grip",
      attr: { "aria-hidden": "true" },
    });
    grip.createDiv({ cls: "charinfo-detail__grip-bar" });
    this.attachSheetDrag(grip, detail);
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

    // Side panel: every active field of this card's group, eyes ignored.
    // The pencil decides whether the values are editable.
    const props = detail.createDiv({ cls: "charinfo-detail__props" });
    props.createDiv({
      cls: "charinfo-detail__props-label",
      text: "속성",
    });
    this.renderViewProperties(props, record, {
      interactiveStatus: this.cardEditActive,
      surface: "peek",
    });
    // Keep the section label even if only status remains; drop if truly empty.
    if (props.querySelectorAll(".charinfo-detail__prop").length === 0) {
      props.remove();
    }

    // Peek is note-authoritative: read what Obsidian persisted, not the cache.
    let markdown: string;
    try {
      markdown = await this.app.vault.read(record.file);
    } catch {
      detail.createDiv({
        cls: "charinfo-detail__error",
        text: "노트를 읽지 못했어요. 새로고침해 보세요.",
      });
      return;
    }
    if (requestId !== this.detailRequestId || this.selected?.path !== record.path) {
      return;
    }

    await this.renderImageStrip(detail, record, markdown);
    if (requestId !== this.detailRequestId || this.selected?.path !== record.path) {
      return;
    }
    this.peekStripFingerprint = this.imageFingerprint(record, markdown);

    const body = detail.createDiv({ cls: "charinfo-detail__body" });
    const bodyChild = new Component();
    this.peekBodyChild = bodyChild;
    this.addChild(bodyChild);
    // A body-level render failure must not blank the sheet head or props.
    try {
      await renderLivePeekBody(
        this.app,
        bodyChild,
        body,
        markdown,
        record.path,
      );
    } catch {
      body.empty();
      body.createDiv({
        cls: "charinfo-detail__error",
        text: "본문을 그리지 못했어요.",
      });
    }
    if (
      requestId !== this.detailRequestId ||
      this.selected?.path !== record.path
    ) {
      if (this.peekBodyChild === bodyChild) this.unloadPeekBody();
    }
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

  /** `host` may be detached — a note-region patch stages the strip off-panel. */
  private async renderImageStrip(
    host: HTMLElement,
    record: CharacterRecord,
    markdown: string,
  ): Promise<void> {
    const images = listCharacterImages(this.app, record, markdown);

    const editable = this.cardEditActive;
    const strip = host.createDiv({
      cls: "charinfo-image-strip" + (editable ? " is-editable" : ""),
    });
    const head = strip.createDiv({ cls: "charinfo-image-strip__head" });
    head.createDiv({
      cls: "charinfo-image-strip__label",
      text: editable ? "이미지 · 탭하면 커버" : "이미지",
    });

    if (images.length === 0) {
      strip.createDiv({
        cls: "charinfo-image-strip__empty",
        text: editable
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
        !isCoverNone(coverPath) &&
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
        if (!this.cardEditActive) return;
        // Instant paint; quiet strip tap (no Notice spam).
        void this.changeCover(record, image, false, { quiet: true });
      });

      if (editable && images.length > 1) {
        attachHoldDrag(thumb, image.path, {
          canDrag: () => this.cardEditActive,
          activation: "hold",
          holdMs: 240,
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
