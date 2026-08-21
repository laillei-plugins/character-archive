import { Modal, Notice, setIcon } from "obsidian";
import type CharinfoPlugin from "../main";
import type { CharacterRecord } from "../data/CharacterStore";
import {
  STATUS_COLOR_TOKENS,
  axisFor,
  axisLabel,
  countRawAxisOccupants,
  decodeGroupRoute,
  encodeGroupRoute,
  forgetChipFilterOption,
  isCustomStatusColor,
  leftoverAxisIds,
  normalizeStatusColor,
  paintStatusColor,
  suggestStatusId,
  type PrimaryFilterProperty,
  type StatusColorToken,
  type StatusDef,
  type TagDef,
} from "../settings";
import {
  DEFAULT_ROUTE_LABEL,
  groupAddProblem,
  groupRenameErrorMessage,
  groupRenameProblem,
  normalizeRenameInput,
} from "../data/groupRename";
import { moveInOrder } from "../data/order";
import {
  adoptFieldOption,
  addCustomField,
  addFieldOption,
  builtinFieldDef,
  canRetypeFieldId,
  deactivateField,
  effectiveActiveFields,
  ensureGroupSchema,
  fieldLabel,
  fieldValue,
  GroupDeletionBlockedError,
  GroupOperationError,
  groupRouteInventory,
  isChipAxisField,
  isLockedFieldId,
  leftoverFieldOptionIds,
  multiValuedRecords,
  normalizeArchiveKey,
  normalizeGroupKey,
  removeFieldOption,
  renameField,
  renameFieldOption,
  reorderActiveFields,
  reorderFieldOptions,
  resolveGroupSchema,
  retypeField,
  type FieldDef,
  type FieldType,
  type RouteInventory,
} from "../data/groupSchema";
import { attachHoldDrag } from "./holdDrag";
import { placeTypeMenu } from "./typeMenuPlacement";

export interface AttrManageContext {
  records: CharacterRecord[];
  archive: string;
  /** Library folder this gallery page scans — half of the schema scope. */
  library: string;
  /** Selected card's `그룹`, or null when nothing is selected. */
  selectedGroup: string | null;
  /**
   * Named `그룹` values reachable in this archive (persisted schemas + observed
   * cards), in the stable archive order. Never contains `""` — the default route
   * is a separate question the inventory answers.
   *
   * Read live, not snapshotted: deleting a group has to remove its scope from
   * the band in the same redraw that reports the save.
   */
  namedGroups: () => string[];
  /** At least one card in this archive carries no `그룹`. */
  hasUngrouped: () => boolean;
  /** Cards routing to one group in this archive (`""` = the default route). */
  memberCount: (group: string) => number;
  /**
   * The canonical route order: every reachable route with `""` at its own rank,
   * in the exact order the gallery sections use.
   *
   * Read live, like `namedGroups` — a reorder has to be visible in the redraw
   * that reports it.
   */
  routeOrder: () => string[];
  /** Persist a route order the rail arranged (`""` allowed anywhere in it). */
  reorderRoutes: (order: readonly string[]) => Promise<void>;
  /**
   * Create and persist one group schema, appended at the canonical end of the
   * route order. Rejects with a user-facing message.
   */
  createGroup: (name: string) => Promise<void>;
  /**
   * Rewrite every member note, move the schema identity, and keep the order
   * slot. `from` may be `""` — naming the default route is allowed.
   */
  renameGroup: (from: string, to: string) => Promise<void>;
  /**
   * Move every member note to `to`, then drop `from`'s schema and order entry in
   * one settings commit. Rejects with a user-facing message when anything fails;
   * already-rewritten notes are rolled back by the caller. `from` may be `""`,
   * whose schema resets instead of disappearing.
   */
  deleteGroup: (from: string, to: string) => Promise<void>;
  /**
   * Send every member note of `from` to Obsidian's trash, then drop the route.
   * Not atomic and never claims to be: a partial run keeps the group and
   * rejects with the count that completed.
   */
  trashGroup: (from: string) => Promise<void>;
  onChanged: () => void;
  /** Reconcile one group's member notes after a successful schema save. */
  onSchemaSaved: (group: string) => void;
}

/** The root screen's one title: the rail and the ledger, in that order. */
const ROOT_TITLE = "그룹 · 속성 관리";

/** Visible name of one routing scope. `""` is 기본, never 미분류. */
function scopeLabel(group: string): string {
  return group.trim() || DEFAULT_ROUTE_LABEL;
}

/** Two screens only: the ledger, and one property's detail. */
type Screen = "list" | "detail";
type FieldRemovalOrigin = "list" | "detail";

/** The one group editor: closed, adding, or renaming exactly one route. */
type GroupEditor = { mode: "add" } | { mode: "rename"; route: string };

/** The one delete guard: one route, one chosen outcome, one destination. */
interface GroupDeleteState {
  route: string;
  outcome: "move" | "trash";
  /** Destination for the move outcome (`""` = 기본). */
  dest: string;
}

interface RetryJob {
  /** Where the retry line belongs: a global axis screen or the group list. */
  scope: "axis" | "schema";
  axisId: PrimaryFilterProperty;
  /** Exact schema route captured by the failed mutation. */
  group?: string;
  action: string;
  work: () => Promise<void>;
}

interface FieldTypeChoice {
  type: FieldType;
  label: string;
  icon: string;
}

const TEXT_TYPE_CHOICE: FieldTypeChoice = {
  type: "text",
  label: "글",
  icon: "type",
};

const FIELD_TYPE_CHOICES: FieldTypeChoice[] = [
  TEXT_TYPE_CHOICE,
  { type: "select", label: "선택", icon: "circle" },
  { type: "multi-select", label: "여러 값", icon: "list" },
];

function fieldTypeChoice(type: FieldType): FieldTypeChoice {
  return (
    FIELD_TYPE_CHOICES.find((choice) => choice.type === type) ??
    TEXT_TYPE_CHOICE
  );
}

function fieldTypeLabel(type: FieldType): string {
  return fieldTypeChoice(type).label;
}

function fieldTypeIcon(type: FieldType): string {
  return fieldTypeChoice(type).icon;
}

/**
 * The colour rail: five presets, then the one custom picker.
 *
 * A vault written before this rail can hold any of the twelve palette tokens.
 * Such a value stays selected and legible (`colorPresets` prepends it) — the
 * rail is five *offered* presets, never a filter that hides what is stored.
 */
const LEDGER_COLOR_PRESETS: readonly string[] = [
  "gray",
  "green",
  "blue",
  "amber",
  "violet",
];

/** One row of the option ledger, whichever vocabulary it came from. */
interface LedgerOption {
  id: string;
  label: string;
  /** `null` when this vocabulary has no colour (태그, custom fields). */
  color: StatusColorToken | null;
}

/**
 * 그룹 · 속성 관리 — one group rail, one ledger, one detail grammar.
 *
 * The rail on top is every real route of this archive as peers. `기본` — the
 * `""` route a note with no `그룹` lands in — is a chip like any other when it
 * has members or a user-customized schema; an untouched empty fallback stays
 * hidden. The rail is bare, not a card: the title, the first chip and the first
 * property name share one left edge. Selecting a chip swaps only the ledger
 * below it.
 *
 * The ledger is four columns: a 32px handle rail, the property name, a 112px
 * type control, and a 32px control rail. `이름` holds index 0 for good and
 * reserves the handle column without filling it, so every name shares one left
 * edge. Every other property drills into the same detail — name, type, then
 * only the settings its current type needs — and the same type picker opens
 * from the ledger and from that detail. This per-group order is the order every
 * card, peek and public share surface uses; 보기 only controls card visibility.
 */
export class AttrManageModal extends Modal {
  private plugin: CharinfoPlugin;
  private ctx: AttrManageContext;
  private screen: Screen = "list";
  /** Chip axis the open detail edits (also scopes a failed save's retry). */
  private axisId: PrimaryFilterProperty;
  /** Property whose detail is open. */
  private detailFieldId = "";
  /** Focus key to restore when the detail closes. */
  private detailReturn = "";
  private leftoverOpen = false;
  private pending = false;
  private confirmDelete: { id: string; message: string } | null = null;
  private confirmFieldRemove: {
    id: string;
    message: string;
    origin: FieldRemovalOrigin;
  } | null = null;
  private saveError = "";
  private retry: RetryJob | null = null;
  private nameDraft = "";
  /** Schema scope being edited. `""` = the default route (기본). */
  private group = "";
  /** The one group editor: add, or rename one route. Never both. */
  private groupEditor: GroupEditor | null = null;
  private groupDraft = "";
  /** The one delete guard, for one route. */
  private groupDelete: GroupDeleteState | null = null;
  /** Field whose label is currently an inline input. */
  private renameFieldId = "";
  private renameDraft = "";
  private addFieldDraft = "";
  private addFieldType: FieldType = "text";
  private addingField = false;
  /** Option whose editor is open, in whichever vocabulary the detail shows. */
  private optionExpandedId = "";
  private optionEditDraft = "";
  private optionCreating = false;
  private optionDraft = "";
  private focusKey = "";
  private saveHost: HTMLElement | null = null;
  private backBtn: HTMLButtonElement | null = null;
  private titleLabel: HTMLElement | null = null;
  private titleRow: HTMLElement | null = null;
  /** Reused so rapid edits produce one updated success toast, not a stack. */
  private saveNotice: Notice | null = null;
  private saveTimer = 0;
  private redrawFrame = 0;
  /** The one type picker. Never two competing menus. */
  private typeMenu: HTMLElement | null = null;
  private typeMenuAnchor: HTMLElement | null = null;
  private typeMenuDismiss: ((event: Event) => void) | null = null;
  private typeMenuReposition: ((event?: Event) => void) | null = null;

  constructor(plugin: CharinfoPlugin, ctx: AttrManageContext) {
    super(plugin.app);
    this.plugin = plugin;
    this.ctx = ctx;
    this.axisId = "status";
    this.nameDraft = this.displayName(this.axisId);
    this.group = ctx.selectedGroup?.trim() ?? "";
  }

  onOpen(): void {
    this.modalEl.addClass("charinfo-attr-modal-shell");
    this.installNav();
    this.saveHost = this.modalEl.createDiv({
      cls: "charinfo-attr-modal__save",
      attr: { "aria-live": "polite" },
    });
    // The rail always exists, so the caret always has a chip to start on.
    const routes = this.routes();
    if (!routes.routes.includes(this.group)) {
      this.group = routes.routes[0] ?? "";
    }
    this.focusKey = this.scopeFocusKey();
    this.redraw();
    // First Book open for this group persists its lazy built-in baseline, so
    // every later reader sees the same stored record.
    void this.ensureSchemaStored(this.group);
  }

  /**
   * Persist the baseline for a scope. The happy path saves nothing the user
   * asked for, so it stays silent; a failure is announced in the modal's live
   * region, because the next edit would otherwise write against a scope that
   * was never stored.
   */
  private async ensureSchemaStored(group: string): Promise<void> {
    try {
      await this.plugin.persistGroupSchema(
        this.ctx.library,
        this.ctx.archive,
        group,
      );
    } catch (error) {
      console.error("[charinfo] 그룹 속성 기본값 저장 실패", error);
      this.saveError = "저장하지 못했어요.";
      this.retry = {
        scope: "schema",
        axisId: this.axisId,
        group,
        action: "기본값",
        work: () =>
          this.plugin.persistGroupSchema(
            this.ctx.library,
            this.ctx.archive,
            group,
          ),
      };
      if (this.modalEl.isConnected) this.paintSave();
    }
  }

  close(): void {
    if (this.modalEl.isConnected && !this.canLeaveDraft()) return;
    super.close();
  }

  onClose(): void {
    window.clearTimeout(this.saveTimer);
    if (this.redrawFrame) cancelAnimationFrame(this.redrawFrame);
    this.saveTimer = 0;
    this.redrawFrame = 0;
    this.closeTypeMenu(false);
    this.contentEl.empty();
    this.saveHost?.remove();
    this.saveHost = null;
    this.backBtn = null;
    this.titleLabel = null;
    this.titleRow = null;
    this.saveNotice = null;
    this.titleEl.empty();
    this.modalEl.removeClass("charinfo-attr-modal-shell");
  }

  /**
   * One real title row: 32px 뒤로 and a flexible place title. Obsidian owns
   * the sole Close control so click, Escape, focus, and theme behavior stay
   * native instead of competing with a second plugin-created button.
   * On the root screen the hidden Back releases its space so `속성 관리` starts
   * on the same left edge as the handle rail beneath it.
   */
  private installNav(): void {
    this.titleEl.empty();
    this.titleEl.addClass("charinfo-attr-modal__title-row");
    this.titleRow = this.titleEl;
    const back = this.titleEl.createEl("button", {
      type: "button",
      cls: "clickable-icon charinfo-icon-btn charinfo-attr-modal__back is-hidden",
      attr: {
        "data-focus": "back",
        "aria-label": "속성 목록으로 돌아가기",
        title: "속성 목록으로 돌아가기",
      },
    });
    setIcon(back, "arrow-left");
    back.addEventListener("click", () => this.goList());
    this.backBtn = back;
    this.titleLabel = this.titleEl.createSpan({
      cls: "charinfo-attr-modal__title",
      text: ROOT_TITLE,
    });
  }

  private syncNav(): void {
    if (!this.backBtn) return;
    const home = this.screen === "list";
    this.backBtn.toggleClass("is-hidden", home);
    this.backBtn.setAttribute("aria-hidden", home ? "true" : "false");
    this.backBtn.tabIndex = home ? -1 : 0;
    this.titleRow?.toggleClass("is-root", home);
    if (this.titleLabel) {
      const field = this.detailField();
      this.titleLabel.setText(home || !field ? ROOT_TITLE : this.fieldName(field));
    }
  }

  private goList(): void {
    if (!this.canLeaveDraft()) return;
    const returnKey = this.detailReturn || `field-${this.detailFieldId}`;
    this.screen = "list";
    this.detailFieldId = "";
    this.detailReturn = "";
    // A rename left open in the detail must not follow the caret into the
    // ledger, where the same field would render as a bare input.
    this.renameFieldId = "";
    this.renameDraft = "";
    this.optionExpandedId = "";
    this.optionEditDraft = "";
    this.optionCreating = false;
    this.optionDraft = "";
    this.confirmDelete = null;
    this.confirmFieldRemove = null;
    this.leftoverOpen = false;
    this.focusKey = returnKey;
    this.redraw();
  }

  private settings() {
    return this.plugin.settings;
  }

  private displayName(id: PrimaryFilterProperty): string {
    return axisLabel(id, this.settings().propertyDisplayNames);
  }

  private fieldName(field: FieldDef): string {
    return fieldLabel(field, this.settings().propertyDisplayNames);
  }

  private redraw(): void {
    const { contentEl } = this;
    // The redraw places the caret itself, so the picker must not also try to.
    this.closeTypeMenu(false);
    contentEl.empty();
    contentEl.addClass("charinfo-attr-modal");
    this.syncNav();
    if (this.screen === "detail") this.renderDetail(contentEl);
    else this.renderList(contentEl);
    this.paintSave();
    this.applyFocus();
  }

  private scheduleRedraw(): void {
    if (this.redrawFrame) return;
    this.redrawFrame = requestAnimationFrame(() => {
      this.redrawFrame = 0;
      if (this.modalEl.isConnected) this.redraw();
    });
  }

  /* ------------------------------------------------- 이 그룹의 속성 (section 1) */

  /** Current group's schema — the stored record, or its lazy baseline. */
  private schema() {
    return resolveGroupSchema(
      this.settings(),
      this.ctx.library,
      this.ctx.archive,
      this.group,
    );
  }

  private activeFields(): FieldDef[] {
    return effectiveActiveFields(this.schema());
  }

  /** Every route of this archive, as peers, in canonical order. */
  private routes(): RouteInventory {
    return groupRouteInventory(this.settings(), this.ctx.library, this.ctx.archive, {
      namedGroups: this.ctx.namedGroups(),
      hasUngroupedRecords: this.ctx.hasUngrouped(),
      routeOrder: this.ctx.routeOrder(),
    });
  }

  /** Focus keys travel on the encoded route, so `""` owns an unambiguous one. */
  private scopeFocusKey(group = this.group): string {
    return `scope-${encodeGroupRoute(group)}`;
  }

  private groupFocusKey(kind: string, group: string): string {
    return `group-${kind}-${encodeGroupRoute(group)}`;
  }

  /**
   * What a chip is called out loud.
   *
   * A legacy vault can hold a named group literally called 기본, and two chips
   * reading the same word is worse than a longer name — so the default route,
   * and only then, says which one it is.
   */
  private routeTitle(route: string, routes: RouteInventory): string {
    const label = scopeLabel(route);
    if (route || !routes.named.includes(DEFAULT_ROUTE_LABEL)) return label;
    return `${label} (그룹 없음)`;
  }

  /** The cards this scope actually governs — the retype guard's population. */
  private routeMembers(): CharacterRecord[] {
    const archive = normalizeArchiveKey(this.ctx.archive);
    const group = normalizeGroupKey(this.group);
    return this.ctx.records.filter(
      (record) =>
        normalizeArchiveKey(record.장르) === archive &&
        normalizeGroupKey(record.그룹) === group,
    );
  }

  /**
   * Every user-facing key already present anywhere in this archive. Allocation
   * reserves them so a new schema field can never claim hand-written data and
   * later delete it as though the plugin owned it.
   */
  private observedArchiveKeys(): string[] {
    const archive = normalizeArchiveKey(this.ctx.archive);
    const keys = new Set<string>();
    for (const record of this.ctx.records) {
      if (normalizeArchiveKey(record.장르) !== archive) continue;
      for (const key of Object.keys(record.values ?? {})) keys.add(key);
    }
    return [...keys];
  }

  private renderGroupSection(root: HTMLElement): void {
    const section = root.createDiv({ cls: "charinfo-attr-modal__section" });
    const routes = this.routes();
    // The rail always has exactly one selected chip, and the ledger below it
    // always belongs to that chip. A route can disappear under an open modal —
    // another gallery deleted it, or this one is mid-rename — and a scope with
    // no chip would leave 이름 바꾸기 / 삭제 unreachable for the list on screen.
    if (!routes.routes.includes(this.group)) {
      this.group = routes.routes[0] ?? "";
    }

    this.renderGroupRail(section, routes);

    if (this.groupDelete) {
      this.renderDeleteSheet(section, routes);
      return;
    }

    this.renderFieldList(section);
  }

  /**
   * The group rail — every route as a peer chip, then `+ 그룹`.
   *
   * A bare wrapping rail, not a surface: no border, no inset, no label above it.
   * That puts the first chip on the same left edge as the title and the first
   * property name. The add affordance always remains even when no route chip is
   * eligible yet.
   */
  private renderGroupRail(root: HTMLElement, routes: RouteInventory): void {
    const rail = root.createDiv({
      cls: "charinfo-attr-modal__group-rail",
      attr: { role: "group", "aria-label": "그룹" },
    });
    if (this.pending) rail.setAttribute("aria-busy", "true");
    for (const route of routes.routes) {
      const editing =
        this.groupEditor?.mode === "rename" && this.groupEditor.route === route;
      if (editing) this.renderGroupEditor(rail, routes);
      else this.renderGroupChip(rail, routes, route);
    }
    if (this.groupEditor?.mode === "add") {
      this.renderGroupEditor(rail, routes);
      return;
    }
    const add = rail.createEl("button", {
      type: "button",
      cls: "charinfo-group-chip is-add",
      attr: {
        "aria-label": "그룹 추가",
        title: "그룹 추가",
        "data-focus": "group-add",
      },
    });
    const icon = add.createSpan({
      cls: "charinfo-group-chip__add-icon",
      attr: { "aria-hidden": "true" },
    });
    setIcon(icon, "plus");
    add.createSpan({ cls: "charinfo-group-chip__name", text: "그룹" });
    add.disabled = this.pending;
    add.addEventListener("click", () => this.openGroupAdd());
  }

  /**
   * One chip: grabber · name · divider+count, and — only while selected — the
   * two verbs that act on this group.
   *
   * The track list *is* the state. An unselected chip has no rename/delete
   * track at all rather than an invisible one, so nothing reserves space, and
   * the name is the only flexible track, so it truncates before the count and
   * the actions at any width.
   */
  private renderGroupChip(
    rail: HTMLElement,
    routes: RouteInventory,
    route: string,
  ): void {
    const selected = route === this.group;
    const title = this.routeTitle(route, routes);
    const members = this.ctx.memberCount(route);
    const chip = rail.createDiv({
      cls: "charinfo-group-chip" + (selected ? " is-selected" : ""),
    });
    chip.dataset.id = encodeGroupRoute(route);

    const grip = chip.createEl("button", {
      type: "button",
      cls: "charinfo-group-chip__grip",
      attr: {
        "aria-label": `「${title}」 그룹 순서 바꾸기`,
        title: "드래그하거나 Alt+←/→로 순서 바꾸기",
        "aria-keyshortcuts":
          "Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown",
        "data-focus": this.groupFocusKey("grip", route),
      },
    });
    setIcon(grip, "grip-vertical");
    grip.disabled = this.pending;
    grip.addEventListener("keydown", (event) => {
      if (!event.altKey) return;
      const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
      const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
      if (!back && !forward) return;
      event.preventDefault();
      this.moveRouteByKeyboard(route, back ? -1 : 1);
    });

    const select = chip.createEl("button", {
      type: "button",
      cls: "charinfo-group-chip__select",
      attr: {
        // A count alone is not a name; the chip says what it counts.
        "aria-label": `「${title}」 그룹 · 캐릭터 ${members}명`,
        "aria-pressed": selected ? "true" : "false",
        title,
        "data-focus": this.scopeFocusKey(route),
      },
    });
    select.createSpan({
      cls: "charinfo-group-chip__name charinfo-prop-row__label",
      text: scopeLabel(route),
    });
    select.createSpan({
      cls: "charinfo-group-chip__count",
      text: String(members),
      attr: { "aria-hidden": "true" },
    });
    select.disabled = this.pending;
    select.addEventListener("click", () => this.selectScope(route));

    if (selected) {
      const renameLabel = `「${title}」 그룹 이름 바꾸기`;
      const rename = chip.createEl("button", {
        type: "button",
        cls: "clickable-icon charinfo-icon-btn charinfo-group-chip__rename",
        attr: {
          "aria-label": renameLabel,
          title: renameLabel,
          "data-focus": this.groupFocusKey("rename", route),
        },
      });
      setIcon(rename, "pencil");
      rename.disabled = this.pending;
      rename.addEventListener("click", () => this.openGroupRename(route));

      const deleteLabel = `「${title}」 그룹 삭제`;
      const remove = chip.createEl("button", {
        type: "button",
        cls: "clickable-icon charinfo-icon-btn charinfo-group-chip__delete",
        attr: {
          "aria-label": deleteLabel,
          title: deleteLabel,
          "data-focus": this.groupFocusKey("delete", route),
        },
      });
      setIcon(remove, "trash-2");
      remove.disabled = this.pending;
      remove.addEventListener("click", () => this.openGroupDelete(route));
    }

    // The two-class ghost keeps `makeGhost` on its text-only branch, and the
    // name carries `charinfo-prop-row__label` so the ghost reads the group name
    // instead of the encoded route.
    attachHoldDrag(chip, encodeGroupRoute(route), {
      canDrag: () => !this.pending,
      activation: "move",
      movePx: 4,
      handleSelector: ".charinfo-group-chip__grip",
      dropSelector: ".charinfo-group-chip[data-id]",
      ghostClass: "charinfo-prop-row-ghost charinfo-group-chip-ghost",
      slotClass: "charinfo-prop-row-slot charinfo-group-chip-slot",
      onReorder: (fromId, toId, place) =>
        this.reorderRoutes(fromId, toId, place),
    });
  }

  /**
   * The add / rename editor — one full rail row.
   *
   * `flex: 1 0 100%` is the whole layout rule: a 100%-basis flex item cannot
   * share a line with a neighbouring chip at any width, so the input never
   * overlaps a name or a count. Internals are the ledger's add-row grammar.
   */
  private renderGroupEditor(rail: HTMLElement, routes: RouteInventory): void {
    const editor = this.groupEditor;
    if (!editor) return;
    const renaming = editor.mode === "rename";
    const route = renaming ? editor.route : "";
    const title = renaming ? this.routeTitle(route, routes) : "";
    const row = rail.createDiv({ cls: "charinfo-group-chip-editor" });
    const input = row.createEl("input", {
      type: "text",
      cls: "charinfo-attr-modal__row-input",
      attr: {
        placeholder: "그룹 이름",
        spellcheck: "false",
        "aria-label": renaming ? `「${title}」 새 그룹 이름` : "새 그룹 이름",
        "data-focus": "group-editor-input",
      },
    });
    input.value = this.groupDraft;
    input.disabled = this.pending;

    const submitLabel = renaming ? "그룹 이름 저장" : "그룹 추가";
    const submit = row.createEl("button", {
      type: "button",
      cls: "clickable-icon charinfo-icon-btn charinfo-attr-modal__add-submit",
      attr: {
        "aria-label": submitLabel,
        title: submitLabel,
        "data-focus": "group-editor-submit",
      },
    });
    setIcon(submit, "check");
    const cancel = row.createEl("button", {
      type: "button",
      cls: "clickable-icon charinfo-icon-btn charinfo-attr-modal__row-remove",
      attr: {
        "aria-label": renaming ? "이름 바꾸기 취소" : "그룹 추가 취소",
        title: "취소",
        "data-focus": "group-editor-cancel",
      },
    });
    setIcon(cancel, "x");
    cancel.disabled = this.pending;

    const syncSubmit = () => {
      submit.disabled = this.pending || !input.value.trim();
    };
    syncSubmit();
    input.addEventListener("input", () => {
      this.groupDraft = input.value;
      syncSubmit();
    });
    submit.addEventListener("click", () => void this.commitGroupEditor());
    cancel.addEventListener("click", () => this.cancelGroupEditor());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.commitGroupEditor();
        return;
      }
      if (event.key !== "Escape") return;
      // The draft guard owns this door; Escape only stops the modal from
      // hearing it while the guard is deciding.
      event.preventDefault();
      event.stopPropagation();
      this.cancelGroupEditor();
    });
  }

  private openGroupAdd(): void {
    if (this.pending || !this.canLeaveDraft()) return;
    this.cancelEditing();
    this.groupEditor = { mode: "add" };
    this.groupDraft = "";
    this.focusKey = "group-editor-input";
    this.redraw();
  }

  private openGroupRename(route: string): void {
    if (this.pending || !this.canLeaveDraft()) return;
    this.cancelEditing();
    this.groupEditor = { mode: "rename", route };
    this.groupDraft = scopeLabel(route);
    this.focusKey = "group-editor-input";
    this.redraw();
  }

  /**
   * Cancel is the one door that may drop a draft — the user pressed 취소 or
   * Escape, so it is a decision, not an accident. It still says what it dropped:
   * every *other* way out of this row goes through `canLeaveDraft`.
   */
  private cancelGroupEditor(): void {
    const editor = this.groupEditor;
    if (!editor) return;
    const draft = normalizeRenameInput(this.groupDraft);
    if (draft && draft !== this.groupDraftBaseline()) {
      new Notice(`입력한 「${draft}」은 저장하지 않고 닫았어요.`);
    }
    this.groupEditor = null;
    this.groupDraft = "";
    this.focusKey =
      editor.mode === "add"
        ? "group-add"
        : this.groupFocusKey("rename", editor.route);
    this.redraw();
  }

  /** The draft the guard compares against: the current name, or nothing. */
  private groupDraftBaseline(): string {
    const editor = this.groupEditor;
    if (!editor) return "";
    return editor.mode === "rename" ? scopeLabel(editor.route) : "";
  }

  private async commitGroupEditor(): Promise<void> {
    const editor = this.groupEditor;
    if (!editor || this.pending) return;
    const name = normalizeRenameInput(this.groupDraft);
    const routes = this.routes();
    const refuse = (message: string) => {
      this.focusKey = "group-editor-input";
      new Notice(message);
      this.applyFocus();
    };
    if (editor.mode === "rename") {
      const from = editor.route;
      if (name === scopeLabel(from)) {
        this.groupEditor = null;
        this.groupDraft = "";
        this.focusKey = this.groupFocusKey("rename", from);
        this.redraw();
        return;
      }
      const problem = groupRenameProblem({
        from,
        to: name,
        existing: routes.named,
        allowDefaultSource: true,
        defaultRouteVisible: true,
      });
      if (problem) {
        refuse(groupRenameErrorMessage(problem));
        return;
      }
      // The draft is committed work now, so the guard must not re-claim it.
      this.groupEditor = null;
      this.groupDraft = "";
      // Captured before the save: `run` redraws while `from` is already gone,
      // and that redraw re-anchors `this.group` to a route that still exists.
      const wasSelected = this.group === from;
      const saved = await this.run(
        "이름",
        this.axisId,
        () => this.ctx.renameGroup(from, name),
        "schema",
        from,
      );
      if (!saved) {
        this.groupEditor = { mode: "rename", route: from };
        this.groupDraft = name;
        this.focusKey = "group-editor-input";
        if (this.modalEl.isConnected) this.redraw();
        return;
      }
      if (wasSelected) this.group = name;
      this.focusKey = this.groupFocusKey("rename", name);
      if (this.modalEl.isConnected) this.redraw();
      void this.ensureSchemaStored(this.group);
      return;
    }

    const problem = groupAddProblem({
      name,
      existing: routes.named,
      defaultRouteVisible: true,
    });
    if (problem) {
      refuse(groupRenameErrorMessage(problem));
      return;
    }
    this.groupEditor = null;
    this.groupDraft = "";
    const saved = await this.run(
      "추가",
      this.axisId,
      () => this.ctx.createGroup(name),
      "schema",
      // The retry line belongs to the group the user is standing in, because
      // the new one does not exist yet if this failed.
      this.group,
    );
    if (!saved) {
      this.groupEditor = { mode: "add" };
      this.groupDraft = name;
      this.focusKey = "group-editor-input";
      if (this.modalEl.isConnected) this.redraw();
      return;
    }
    // A new group is only useful selected: the ledger below is now its ledger.
    this.group = name;
    this.focusKey = this.scopeFocusKey(name);
    if (this.modalEl.isConnected) this.redraw();
  }

  private openGroupDelete(route: string): void {
    if (this.pending || !this.canLeaveDraft()) return;
    const routes = this.routes();
    this.cancelEditing();
    const destinations = this.deleteDestinations(routes, route);
    this.groupDelete = {
      route,
      outcome: "move",
      dest: destinations[0] ?? "",
    };
    this.focusKey = "delete-cancel";
    this.redraw();
  }

  /** Move one route inside the canonical order and persist the whole list. */
  private reorderRoutes(
    fromId: string,
    toId: string,
    place: "before" | "after",
    focus = "",
  ): void {
    if (fromId === toId) return;
    const order = this.ctx.routeOrder().map(encodeGroupRoute);
    if (!order.includes(fromId) || !order.includes(toId)) return;
    const next = moveInOrder(order, fromId, toId, place);
    if (next.join("\0") === order.join("\0")) return;
    void this.run(
      "순서",
      this.axisId,
      async () => {
        await this.ctx.reorderRoutes(next.map(decodeGroupRoute));
        if (focus) this.focusKey = focus;
      },
      "schema",
      this.group,
    );
  }

  private moveRouteByKeyboard(route: string, delta: -1 | 1): void {
    const order = this.ctx.routeOrder();
    const index = order.indexOf(route);
    const target = order[index + delta];
    if (index < 0 || target === undefined) return;
    this.reorderRoutes(
      encodeGroupRoute(route),
      encodeGroupRoute(target),
      delta < 0 ? "before" : "after",
      this.groupFocusKey("grip", route),
    );
  }

  /**
   * Switching scope swaps every row under the caret, so any half-finished
   * rename / add / option / delete interaction is cancelled *before* the swap
   * and the caret lands back on the scope control the user just pressed.
   */
  private selectScope(group: string): void {
    if (this.pending) return;
    const next = group.trim();
    if (next === this.group) {
      this.focusKey = this.scopeFocusKey(next);
      this.redraw();
      return;
    }
    if (!this.canLeaveDraft()) return;
    if (
      this.retry?.scope === "schema" &&
      this.retry.group !== next
    ) {
      this.retry = null;
      this.saveError = "";
    }
    this.cancelEditing();
    this.group = next;
    this.focusKey = this.scopeFocusKey(next);
    this.redraw();
    void this.ensureSchemaStored(next);
  }

  /** Drop every in-flight edit and return to the field list. */
  private cancelEditing(): void {
    this.closeTypeMenu(false);
    this.screen = "list";
    this.detailFieldId = "";
    this.detailReturn = "";
    this.renameFieldId = "";
    this.renameDraft = "";
    this.addingField = false;
    this.addFieldDraft = "";
    this.optionExpandedId = "";
    this.optionEditDraft = "";
    this.optionCreating = false;
    this.optionDraft = "";
    this.leftoverOpen = false;
    this.confirmDelete = null;
    this.confirmFieldRemove = null;
    this.groupEditor = null;
    this.groupDraft = "";
    this.groupDelete = null;
  }

  /** Typed work never disappears through any navigation or destructive door. */
  private canLeaveDraft(): boolean {
    let focus = "";
    if (
      this.groupEditor &&
      this.groupDraft.trim() &&
      this.groupDraft.trim() !== this.groupDraftBaseline()
    ) {
      focus = "group-editor-submit";
    } else if (this.addingField && this.addFieldDraft.trim()) {
      focus = "add-field-submit";
    } else if (this.optionCreating && this.optionDraft.trim()) {
      focus = "option-submit";
    } else if (this.renameFieldId) {
      const field = this.detailField();
      if (
        field &&
        this.renameDraft.trim() &&
        this.renameDraft.trim() !== this.fieldName(field)
      ) {
        focus = `field-name-${field.id}`;
      }
    } else if (this.optionExpandedId) {
      const field = this.detailField();
      const option = field
        ? this.detailOptions(field).find(
            (item) => item.id === this.optionExpandedId,
          )
        : null;
      if (
        option &&
        this.optionEditDraft.trim() &&
        this.optionEditDraft.trim() !== option.label
      ) {
        focus = `option-edit-${option.id}`;
      }
    }
    if (!focus) return true;
    this.focusKey = focus;
    new Notice("먼저 저장하거나 취소해 주세요.");
    this.applyFocus();
    return false;
  }

  private renderFieldList(root: HTMLElement): void {
    const list = root.createDiv({
      cls: "charinfo-attr-modal__list charinfo-attr-modal__fields",
    });
    const fields = this.activeFields();
    for (const field of fields) {
      this.renderFieldRow(list, field);
      if (
        this.confirmFieldRemove?.id === field.id &&
        this.confirmFieldRemove.origin === "list"
      ) {
        this.renderFieldRemoveConfirm(list, field, "list");
      }
    }
    this.renderAddField(list);
  }

  /* --------------------------------------------------- delete / reassign */

  /** Where this route's members can go: every other route, 기본 included. */
  private deleteDestinations(routes: RouteInventory, route: string): string[] {
    return routes.routes.filter((other) => other !== route);
  }

  /**
   * The delete guard — one route, its members, and the two honest ways out.
   *
   * A route with members never just disappears: either they move to another
   * route, or the notes themselves go to Obsidian's trash. `기본` is deletable
   * like any peer, and what "delete" means there is stated plainly: the chip
   * stays (it is where a note with no 그룹 lands) and its property list resets.
   * When there is nowhere to move to, the move action is disabled *with the
   * reason on screen* rather than quietly missing.
   */
  private renderDeleteSheet(root: HTMLElement, routes: RouteInventory): void {
    const state = this.groupDelete;
    if (!state) return;
    const route = state.route;
    const title = this.routeTitle(route, routes);
    const members = this.ctx.memberCount(route);
    const sheet = root.createDiv({
      cls: "charinfo-attr-modal__danger",
      attr: { role: "group", "aria-label": `「${title}」 그룹 삭제 확인` },
    });
    sheet.createDiv({
      cls: "charinfo-attr-modal__danger-title",
      text: `「${title}」 그룹 삭제`,
    });
    sheet.createDiv({
      cls: "charinfo-attr-modal__danger-copy",
      text: this.deleteCopy(route, members),
    });

    const destinations = this.deleteDestinations(routes, route);
    if (members > 0) {
      if (!destinations.includes(state.dest)) {
        state.dest = destinations[0] ?? "";
      }
      const move = sheet.createDiv({ cls: "charinfo-attr-modal__danger-move" });
      const pick = move.createEl("select", {
        cls: "charinfo-attr-modal__select",
        attr: { "aria-label": "옮길 위치", "data-focus": "delete-dest" },
      });
      for (const group of destinations) {
        pick.createEl("option", {
          value: group,
          text: this.routeTitle(group, routes),
        });
      }
      pick.value = state.dest;
      pick.disabled = this.pending || destinations.length === 0;
      pick.addEventListener("change", () => {
        state.dest = pick.value;
      });
      const apply = move.createEl("button", {
        type: "button",
        text: "옮기고 삭제",
        attr: { "data-focus": "delete-move" },
      });
      apply.disabled = this.pending || destinations.length === 0;
      // While saving, the armed outcome stays legible instead of dimming into
      // the other one: two destructive doors must never look alike mid-flight.
      apply.toggleClass("is-armed", this.pending && state.outcome === "move");
      if (destinations.length === 0) {
        const reasonId = "charinfo-group-move-reason";
        move.createDiv({
          cls: "charinfo-attr-modal__danger-reason",
          text: "옮길 다른 그룹이 없어요. 먼저 그룹을 추가해 주세요.",
          attr: { id: reasonId },
        });
        apply.setAttribute("aria-describedby", reasonId);
      }
      apply.addEventListener("click", () => void this.commitGroupDelete("move"));

      const trash = sheet.createEl("button", {
        type: "button",
        cls: "mod-warning",
        text: `캐릭터 ${members}명을 휴지통으로 보내고 삭제`,
        attr: { "data-focus": "delete-trash" },
      });
      trash.disabled = this.pending;
      trash.toggleClass("is-armed", this.pending && state.outcome === "trash");
      trash.addEventListener("click", () => void this.commitGroupDelete("trash"));
    }

    const actions = sheet.createDiv({ cls: "charinfo-attr-modal__confirm-actions" });
    const cancel = actions.createEl("button", {
      type: "button",
      text: "취소",
      attr: { "data-focus": "delete-cancel" },
    });
    cancel.disabled = this.pending;
    cancel.addEventListener("click", () => {
      this.groupDelete = null;
      this.focusKey = this.groupFocusKey("delete", route);
      this.redraw();
    });
    if (members > 0) return;
    const apply = actions.createEl("button", {
      type: "button",
      cls: "mod-warning",
      text: "삭제",
    });
    apply.disabled = this.pending;
    apply.addEventListener("click", () => void this.commitGroupDelete("move"));
  }

  /** What this delete actually does to this route, in one sentence. */
  private deleteCopy(route: string, members: number): string {
    if (!route) {
      return members > 0
        ? `「${DEFAULT_ROUTE_LABEL}」은 지워도 사라지지 않아요. 캐릭터 ${members}명을 옮기거나 휴지통으로 보내고, 이 그룹의 속성 목록만 처음 상태로 돌아가요.`
        : `「${DEFAULT_ROUTE_LABEL}」은 지워도 사라지지 않아요. 속성 목록만 처음 상태로 돌아가고, 노트의 값은 지워지지 않아요.`;
    }
    return members > 0
      ? `이 그룹의 캐릭터 ${members}명을 옮기거나 휴지통으로 보내야 해요. 옮기면 속성 값은 지워지지 않아요.`
      : "옮길 캐릭터가 없어요. 속성 목록만 사라지고, 값은 지워지지 않아요.";
  }

  /**
   * One removal, two outcomes.
   *
   * `move` is the transactional one: `deleteGroup` rewrites the member notes,
   * commits the schema + order drop, and rolls the notes back if either half
   * fails — so the group is either gone with its members moved, or exactly as it
   * was. `trash` cannot be that: a note already in the trash stays there, so a
   * partial run keeps the group and reports the count it reached. Either way a
   * failure leaves the sheet open so a retry converges.
   */
  private async commitGroupDelete(outcome: "move" | "trash"): Promise<void> {
    const state = this.groupDelete;
    if (!state) return;
    const from = state.route;
    const to = state.dest;
    state.outcome = outcome;
    const members = this.ctx.memberCount(from);
    const saved = await this.run(
      "삭제",
      this.axisId,
      async () => {
        if (outcome === "trash") await this.ctx.trashGroup(from);
        else await this.ctx.deleteGroup(from, to);
      },
      "schema",
      from,
    );
    if (!saved) return; // the sheet stays open for a retry
    if (outcome === "trash" && members > 0) {
      new Notice(
        `「${scopeLabel(from)}」 그룹을 지우고 노트 ${members}개를 휴지통으로 보냈어요. 복구는 옵시디언 휴지통 설정에 따라요.`,
      );
    }
    this.cancelEditing();
    const routes = this.routes();
    // A reset 기본 remains selected only when it is still visible (members or a
    // customization). Otherwise the caret follows the first surviving route,
    // just as it does after deleting a named group.
    const next = routes.routes.includes(from)
      ? from
      : outcome === "move" && routes.routes.includes(to)
        ? to
        : (routes.routes[0] ?? "");
    this.group = next;
    this.focusKey = this.scopeFocusKey(next);
    if (this.modalEl.isConnected) this.redraw();
    void this.ensureSchemaStored(next);
  }

  /* -------------------------------------------------------- the ledger row */

  /**
   * One ledger row: handle rail · name · type control · control rail.
   *
   * `이름` reserves the handle and control rails without filling them, so its
   * name starts on the same left edge as every other property and no status
   * glyph implies an action it does not have. Its type control is the same
   * shape, minus the press: the card identity is text by construction.
   */
  private renderFieldRow(list: HTMLElement, field: FieldDef): void {
    const fixed = isLockedFieldId(field.id);
    const row = list.createDiv({
      cls:
        "charinfo-attr-modal__row is-field" +
        (fixed ? " is-fixed" : " is-reorderable"),
    });
    if (!fixed) row.dataset.id = field.id;

    if (fixed) {
      row.createDiv({
        cls: "charinfo-attr-modal__handle-slot",
        attr: { "aria-hidden": "true" },
      });
    } else {
      const handle = row.createEl("button", {
        type: "button",
        cls: "clickable-icon charinfo-icon-btn charinfo-attr-modal__handle",
        attr: {
          "aria-label": `${this.fieldName(field)} 순서 바꾸기`,
          title: "드래그하거나 Alt+↑/↓로 순서 바꾸기",
          "aria-keyshortcuts": "Alt+ArrowUp Alt+ArrowDown",
          "data-focus": `field-handle-${field.id}`,
        },
      });
      setIcon(handle, "grip-vertical");
      handle.disabled = this.pending;
      handle.addEventListener("keydown", (event) => {
        if (!event.altKey) return;
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        this.moveFieldByKeyboard(field.id, event.key === "ArrowUp" ? -1 : 1);
      });
    }

    if (this.renameFieldId === field.id) {
      this.renderNameInput(row, field);
    } else {
      const name = row.createEl("button", {
        type: "button",
        cls: "charinfo-attr-modal__row-label charinfo-attr-modal__field-name",
        text: this.fieldName(field),
        attr: { "data-focus": `field-${field.id}`, title: "속성 열기" },
      });
      name.disabled = this.pending;
      name.addEventListener("click", (event) => {
        event.stopPropagation();
        this.openDetail(field, `field-${field.id}`);
      });
    }

    this.renderTypeControl(row, field, `field-type-${field.id}`);

    if (!fixed) {
      const remove = row.createEl("button", {
        type: "button",
        cls: "clickable-icon charinfo-icon-btn charinfo-attr-modal__row-remove",
        attr: {
          "aria-label": `${this.fieldName(field)} 목록에서 빼기`,
          title: "속성 빼기 (노트의 값도 지워져요)",
          "data-focus": `field-remove-${field.id}`,
        },
      });
      setIcon(remove, "x");
      remove.disabled = this.pending;
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        void this.requestFieldRemoval(field, "list");
      });
    } else {
      row.createDiv({
        cls: "charinfo-attr-modal__slot",
        attr: { "aria-hidden": "true" },
      });
    }

    if (fixed) return;
    // `이름` is not a drop target either (no `data-id`), so nothing can be
    // inserted ahead of it even before the pin below re-asserts index 0.
    attachHoldDrag(row, field.id, {
      canDrag: () => !this.pending,
      activation: "move",
      movePx: 4,
      handleSelector: ".charinfo-attr-modal__handle",
      dropSelector: ".charinfo-attr-modal__row.is-reorderable",
      ghostClass: "charinfo-prop-row-ghost",
      slotClass: "charinfo-prop-row-slot",
      onReorder: (fromId, toId, place) => this.reorderFields(fromId, toId, place),
    });
  }

  /**
   * Move one active property inside this group's sequence.
   *
   * `이름` is pinned back to index 0 after the splice, and the tombstones keep
   * their relative order because `reorderActiveFields` only ever rewrites the
   * active prefix.
   */
  private reorderFields(
    fromId: string,
    toId: string,
    place: "before" | "after",
    focus = `field-${fromId}`,
  ): void {
    const ids = this.activeFields().map((field) => field.id);
    const from = ids.indexOf(fromId);
    if (from < 0) return;
    ids.splice(from, 1);
    let insertAt = ids.indexOf(toId);
    if (insertAt < 0) return;
    if (place === "after") insertAt += 1;
    ids.splice(insertAt, 0, fromId);
    const order = [
      ...ids.filter((id) => isLockedFieldId(id)),
      ...ids.filter((id) => !isLockedFieldId(id)),
    ];
    void this.runSchema(
      "순서",
      (group) => {
        reorderActiveFields(
          this.settings(),
          this.ctx.library,
          this.ctx.archive,
          group,
          order,
        );
      },
      { focus },
    );
  }

  private moveFieldByKeyboard(fieldId: string, delta: -1 | 1): void {
    const movable = this.activeFields().filter(
      (field) => !isLockedFieldId(field.id),
    );
    const index = movable.findIndex((field) => field.id === fieldId);
    const target = movable[index + delta];
    if (index < 0 || !target) return;
    this.reorderFields(
      fieldId,
      target.id,
      delta < 0 ? "before" : "after",
      `field-handle-${fieldId}`,
    );
  }

  /** The inline rename slot — same geometry as the label it replaces. */
  private renderNameInput(row: HTMLElement, field: FieldDef): void {
    const input = row.createEl("input", {
      type: "text",
      cls: "charinfo-attr-modal__row-input",
      attr: {
        spellcheck: "false",
        "aria-label": "속성 이름",
        "data-focus": `field-name-${field.id}`,
      },
    });
    input.value = this.fieldName(field);
    this.renameDraft = input.value;
    input.disabled = this.pending;
    input.addEventListener("input", () => {
      this.renameDraft = input.value;
    });
    const commit = () => {
      const label = input.value.trim();
      if (!label) {
        this.focusKey = `field-name-${field.id}`;
        new Notice("이름을 입력해 주세요.");
        this.applyFocus();
        return;
      }
      this.renameFieldId = "";
      this.renameDraft = "";
      if (isChipAxisField(field)) {
        // 상태 · 관계 · 인연 · 소속 · 태그 share one name everywhere.
        const axisId = (builtinFieldDef(field.id)?.id ??
          "status") as PrimaryFilterProperty;
        void this.run(
          "이름",
          axisId,
          async () => {
            await this.plugin.commitSettings((s) => {
              s.propertyDisplayNames = {
                ...s.propertyDisplayNames,
                [axisId]: label,
              };
            });
          },
        );
        return;
      }
      void this.runSchema("이름", (group) => {
        renameField(
          this.settings(),
          this.ctx.library,
          this.ctx.archive,
          group,
          field.id,
          label,
        );
      });
    };
    input.addEventListener("change", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.renameFieldId = "";
        this.renameDraft = "";
        this.focusKey =
          this.screen === "detail" ? "detail-name" : `field-${field.id}`;
        this.redraw();
      }
    });
  }

  /**
   * The type control — a real button on every property whose type is user data.
   *
   * Two shapes, one behaviour. In the ledger it is the enclosed 112px control
   * with its own disclosure caret; in the detail it is the row's value, and the
   * row's rail already carries the chevron. `이름` gets the same slot without
   * the press: reserving it keeps the rails straight, and a disabled-looking
   * button would invite a click that can never do anything.
   */
  private renderTypeControl(
    row: HTMLElement,
    field: FieldDef,
    focusKey: string,
    variant: "ledger" | "detail" = "ledger",
  ): void {
    const label = fieldTypeLabel(field.type);
    const plain = variant === "detail";
    const base =
      "charinfo-attr-modal__type-btn" + (plain ? " is-plain" : "");
    if (!canRetypeFieldId(field.id)) {
      const slot = row.createDiv({
        cls: base + " is-static",
        attr: { title: `${this.fieldName(field)} 종류 · ${label}` },
      });
      const icon = slot.createSpan({
        cls: "charinfo-attr-modal__type-icon",
        attr: { "aria-hidden": "true" },
      });
      setIcon(icon, fieldTypeIcon(field.type));
      slot.createSpan({
        cls: "charinfo-attr-modal__type-label",
        text: label,
      });
      return;
    }
    const btn = row.createEl("button", {
      type: "button",
      cls: base,
      attr: {
        "aria-label": `${this.fieldName(field)} 종류 · ${label}`,
        title: "속성 종류 바꾸기",
        "aria-haspopup": "true",
        "data-focus": focusKey,
      },
    });
    const icon = btn.createSpan({
      cls: "charinfo-attr-modal__type-icon",
      attr: { "aria-hidden": "true" },
    });
    setIcon(icon, fieldTypeIcon(field.type));
    btn.createSpan({ cls: "charinfo-attr-modal__type-label", text: label });
    if (!plain) {
      const chev = btn.createSpan({
        cls: "charinfo-attr-modal__type-chev",
        attr: { "aria-hidden": "true" },
      });
      setIcon(chev, "chevron-down");
    }
    btn.disabled = this.pending;
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.pending) return;
      this.openTypeMenu(btn, field, focusKey);
    });
  }

  /* ---------------------------------------------------------- the type menu */

  /**
   * One picker, two entry points: the ledger's type control and the detail's
   * 속성 종류 row. It is built imperatively rather than during `redraw`, because
   * it has to be positioned against the button that opened it.
   */
  private openTypeMenu(
    anchor: HTMLElement,
    field: FieldDef,
    returnKey: string,
  ): void {
    if (this.typeMenuAnchor === anchor) {
      this.closeTypeMenu();
      return;
    }
    this.closeTypeMenu();
    const menu = this.containerEl.createDiv({
      cls: "charinfo-attr-modal__type-menu",
      attr: { role: "menu", "aria-label": "속성 종류" },
    });
    menu.createDiv({
      cls: "charinfo-attr-modal__type-menu-head",
      text: "속성 종류",
    });
    const items: HTMLButtonElement[] = [];
    for (const choice of FIELD_TYPE_CHOICES) {
      const current = choice.type === field.type;
      const item = menu.createEl("button", {
        type: "button",
        cls:
          "charinfo-attr-modal__type-item" + (current ? " is-current" : ""),
        attr: {
          role: "menuitemradio",
          "aria-checked": current ? "true" : "false",
        },
      });
      const icon = item.createSpan({
        cls: "charinfo-attr-modal__type-item-icon",
        attr: { "aria-hidden": "true" },
      });
      setIcon(icon, choice.icon);
      item.createSpan({
        cls: "charinfo-attr-modal__type-item-label",
        text: choice.label,
      });
      const check = item.createSpan({
        cls: "charinfo-attr-modal__type-item-check",
        attr: { "aria-hidden": "true" },
      });
      if (current) setIcon(check, "check");
      item.addEventListener("click", () => {
        this.closeTypeMenu(false);
        void this.applyType(field, choice.type, returnKey);
      });
      items.push(item);
    }

    const reposition = (event?: Event): void => {
      if (
        event?.type === "scroll" &&
        event.target instanceof Node &&
        menu.contains(event.target)
      )
        return;
      if (!menu.isConnected || !anchor.isConnected) {
        this.closeTypeMenu(false);
        return;
      }
      menu.style.removeProperty("max-height");
      const anchorRect = anchor.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const placement = placeTypeMenu(
        anchorRect,
        menuRect,
        window.innerWidth,
        window.innerHeight,
      );
      menu.setCssStyles({
        top: `${Math.round(placement.top)}px`,
        left: `${Math.round(placement.left)}px`,
        maxHeight: `${Math.floor(placement.maxHeight)}px`,
      });
      menu.toggleClass("is-above", placement.side === "above");
    };

    menu.addEventListener("keydown", (event) => {
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.closeTypeMenu();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const start = at < 0 ? (step > 0 ? -1 : 0) : at;
        const next = items[(start + step + items.length) % items.length];
        next?.focus();
        next?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        items[0]?.focus();
        items[0]?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        items[items.length - 1]?.focus();
        items[items.length - 1]?.scrollIntoView({ block: "nearest" });
      }
    });

    this.typeMenu = menu;
    this.typeMenuAnchor = anchor;
    this.typeMenuDismiss = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (menu.contains(target) || anchor.contains(target))
      )
        return;
      this.closeTypeMenu();
    };
    document.addEventListener("pointerdown", this.typeMenuDismiss, true);
    this.typeMenuReposition = reposition;
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    reposition();
    const current = items.find((item) => item.hasClass("is-current"));
    (current ?? items[0])?.focus();
  }

  /**
   * `restoreFocus` is false when a redraw is about to place the caret itself —
   * otherwise a dismissed picker would leave the caret on `body`.
   */
  private closeTypeMenu(restoreFocus = true): void {
    if (this.typeMenuDismiss) {
      document.removeEventListener("pointerdown", this.typeMenuDismiss, true);
      this.typeMenuDismiss = null;
    }
    if (this.typeMenuReposition) {
      window.removeEventListener("resize", this.typeMenuReposition);
      window.removeEventListener("scroll", this.typeMenuReposition, true);
      this.typeMenuReposition = null;
    }
    const anchor = this.typeMenuAnchor;
    this.typeMenuAnchor = null;
    if (!this.typeMenu) return;
    const held = this.typeMenu.contains(document.activeElement);
    this.typeMenu.remove();
    this.typeMenu = null;
    if (restoreFocus && held && anchor?.isConnected) anchor.focus();
  }

  /**
   * Commit one type change, or refuse it out loud.
   *
   * Leaving multi-select is the only lossy direction: a scalar holds one value,
   * so a member with two would quietly lose one. That is refused here — before
   * the mutation — with the count in the message, and no note is rewritten
   * either way (the values stay exactly as they are, read through the new type).
   */
  private async applyType(
    field: FieldDef,
    type: FieldType,
    focus: string,
  ): Promise<void> {
    if (type === field.type) return;
    if (!canRetypeFieldId(field.id)) {
      new Notice("「이름」은 종류를 바꿀 수 없어요.");
      return;
    }
    if (field.type === "multi-select" && type !== "multi-select") {
      const lossy = multiValuedRecords(this.routeMembers(), field);
      if (lossy.length > 0) {
        new Notice(
          `값이 2개 이상인 카드가 ${lossy.length}장 있어서 「${fieldTypeLabel(type)}」으로 바꿀 수 없어요. 먼저 값을 하나로 줄여 주세요.`,
        );
        return;
      }
    }
    const saved = await this.runSchema(
      "종류",
      (group) => {
        retypeField(
          this.settings(),
          this.ctx.library,
          this.ctx.archive,
          group,
          field.id,
          type,
        );
      },
      { focus },
    );
    if (!saved || field.options.length === 0) return;
    if (type === "text") {
      new Notice("선택 항목은 보관돼요. 선택 종류로 돌아오면 다시 보여요.");
    } else if (field.type === "text") {
      new Notice("목록에 없는 기존 값은 회색으로 보여요.");
    }
  }

  /** Cards in the current route that still carry a non-empty value. */
  private countFieldUsage(field: FieldDef): number {
    return this.routeMembers().filter((record) => {
      const value = fieldValue(record, field);
      return Array.isArray(value)
        ? value.some((item) => item.trim().length > 0)
        : value.trim().length > 0;
    }).length;
  }

  /**
   * The row disappears after removal, so capture its live neighbour first.
   * `이름` is locked and normally makes the add-button fallback unreachable;
   * the fallback remains defensive for a malformed imported schema.
   */
  private focusAfterFieldRemoval(fieldId: string): string {
    const fields = this.activeFields();
    const index = fields.findIndex((field) => field.id === fieldId);
    const neighbour =
      (index >= 0 ? fields[index + 1] : undefined) ??
      (index > 0 ? fields[index - 1] : undefined);
    return neighbour ? `field-${neighbour.id}` : "add-field-open";
  }

  /** Empty custom properties leave immediately; valued/default fields confirm. */
  private async requestFieldRemoval(
    field: FieldDef,
    origin: FieldRemovalOrigin,
  ): Promise<void> {
    if (!this.canLeaveDraft()) return;
    const used = this.countFieldUsage(field);
    const builtin = Boolean(builtinFieldDef(field.id));
    if (!builtin && used === 0) {
      await this.removeField(field, origin);
      return;
    }
    const scope = scopeLabel(this.group);
    const usage =
      used > 0
        ? `「${this.fieldName(field)}」 값이 있는 카드가 「${scope}」에 ${used}장 있어요. `
        : "이 항목은 기본 속성이에요. ";
    this.confirmDelete = null;
    this.confirmFieldRemove = {
      id: field.id,
      origin,
      message: `${usage}목록에서 빠지고, 카드 속성에서도 값이 지워져요. 되돌릴 수 없어요.`,
    };
    this.focusKey = `field-remove-confirm-${field.id}`;
    this.redraw();
  }

  private renderFieldRemoveConfirm(
    root: HTMLElement,
    field: FieldDef,
    origin: FieldRemovalOrigin,
  ): void {
    const messageId = `charinfo-field-remove-message-${field.id}`;
    const cancelConfirm = () => {
      this.confirmFieldRemove = null;
      this.focusKey =
        origin === "detail" ? "detail-remove" : `field-remove-${field.id}`;
      this.redraw();
    };
    const box = root.createDiv({
      cls:
        "charinfo-attr-modal__confirm is-field-remove" +
        (origin === "detail" ? " is-detail" : ""),
      attr: {
        role: "group",
        "aria-label": `${this.fieldName(field)} 빼기 확인`,
      },
    });
    box.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelConfirm();
    });
    box.createDiv({
      text: this.confirmFieldRemove?.message ?? "",
      attr: { id: messageId },
    });
    const actions = box.createDiv({
      cls: "charinfo-attr-modal__confirm-actions",
    });
    const cancel = actions.createEl("button", {
      type: "button",
      text: "취소",
      attr: {
        "data-focus": `field-remove-confirm-${field.id}`,
        "aria-describedby": messageId,
      },
    });
    cancel.disabled = this.pending;
    cancel.addEventListener("click", cancelConfirm);
    const remove = actions.createEl("button", {
      type: "button",
      cls: "mod-warning",
      text: "빼기",
      attr: { "aria-describedby": messageId },
    });
    remove.disabled = this.pending;
    remove.addEventListener("click", () => {
      void this.removeField(field, origin);
    });
  }

  private async removeField(
    field: FieldDef,
    origin: FieldRemovalOrigin,
  ): Promise<void> {
    const id = field.id;
    const name = this.fieldName(field);
    const successFocus = this.focusAfterFieldRemoval(id);
    const failureFocus =
      origin === "detail" ? "detail-remove" : `field-remove-${id}`;
    this.confirmFieldRemove = null;
    const saved = await this.runSchema(
      "빼기",
      (group) => {
        deactivateField(
          this.settings(),
          this.ctx.library,
          this.ctx.archive,
          group,
          id,
        );
      },
      {
        reconcile: true,
        focus: successFocus,
        onSaved:
          origin === "detail"
            ? () => {
                this.screen = "list";
                this.detailFieldId = "";
                this.detailReturn = "";
              }
            : undefined,
      },
    );
    if (!saved) {
      this.focusKey = failureFocus;
      this.applyFocus();
      return;
    }
    new Notice(`「${name}」 속성을 뺐어요. 노트의 값도 함께 정리해요.`);
  }

  private openDetail(field: FieldDef, returnKey: string): void {
    if (this.pending) return;
    if (!this.canLeaveDraft()) return;
    // An empty add row is only transient chrome; leaving the ledger cancels it.
    this.addingField = false;
    this.addFieldDraft = "";
    this.detailFieldId = field.id;
    this.detailReturn = returnKey;
    this.renameFieldId = "";
    this.renameDraft = "";
    this.optionExpandedId = "";
    this.optionEditDraft = "";
    this.optionCreating = false;
    this.optionDraft = "";
    this.confirmDelete = null;
    this.confirmFieldRemove = null;
    this.leftoverOpen = false;
    if (isChipAxisField(field)) {
      const axisId = (builtinFieldDef(field.id)?.id ??
        "status") as PrimaryFilterProperty;
      this.axisId = axisId;
      this.nameDraft = this.displayName(axisId);
    }
    this.screen = "detail";
    // The first row always exists; the type row does not on `이름`.
    this.focusKey = "detail-name";
    this.redraw();
  }

  private renderAddField(list: HTMLElement): void {
    if (!this.addingField) {
      const row = list.createDiv({
        cls: "charinfo-attr-modal__row is-field is-add",
      });
      const open = row.createEl("button", {
        type: "button",
        cls: "charinfo-attr-modal__fold charinfo-attr-modal__add-open",
        attr: { "data-focus": "add-field-open", "aria-label": "속성 추가" },
      });
      const icon = open.createSpan({
        cls: "charinfo-attr-modal__add-icon",
        attr: { "aria-hidden": "true" },
      });
      setIcon(icon, "plus");
      open.createSpan({ text: "속성 추가" });
      open.disabled = this.pending;
      open.addEventListener("click", () => {
        this.addingField = true;
        this.focusKey = "add-field-name";
        this.redraw();
      });
      return;
    }

    const row = list.createDiv({
      cls: "charinfo-attr-modal__row is-field is-add",
    });
    const nameCell = row.createDiv({
      cls: "charinfo-attr-modal__add-name-cell",
    });
    const input = nameCell.createEl("input", {
      type: "text",
      cls: "charinfo-attr-modal__row-input",
      attr: {
        placeholder: "이름",
        spellcheck: "false",
        "aria-label": "새 속성 이름",
        "data-focus": "add-field-name",
      },
    });
    input.value = this.addFieldDraft;
    input.disabled = this.pending;
    input.addEventListener("input", () => {
      this.addFieldDraft = input.value;
    });

    const typeWrap = row.createDiv({
      cls: "charinfo-attr-modal__add-type-wrap",
    });
    const type = typeWrap.createEl("select", {
      cls: "charinfo-attr-modal__select charinfo-attr-modal__add-type",
      attr: { "aria-label": "속성 종류" },
    });
    for (const choice of FIELD_TYPE_CHOICES) {
      type.createEl("option", { value: choice.type, text: choice.label });
    }
    type.value = this.addFieldType;
    type.disabled = this.pending;
    type.addEventListener("change", () => {
      const picked = FIELD_TYPE_CHOICES.find(
        (choice) => choice.type === type.value,
      );
      this.addFieldType = picked?.type ?? "text";
    });
    const typeChevron = typeWrap.createSpan({
      cls: "charinfo-attr-modal__add-type-chevron",
      attr: { "aria-hidden": "true" },
    });
    setIcon(typeChevron, "chevron-down");

    const submit = row.createEl("button", {
      type: "button",
      cls:
        "clickable-icon charinfo-icon-btn charinfo-attr-modal__add-submit",
      attr: {
        "aria-label": "속성 추가",
        title: "속성 추가",
        "data-focus": "add-field-submit",
      },
    });
    setIcon(submit, "check");
    submit.disabled = this.pending || !input.value.trim();
    input.addEventListener("input", () => {
      submit.disabled = this.pending || !input.value.trim();
    });

    const cancel = row.createEl("button", {
      type: "button",
      cls:
        "clickable-icon charinfo-icon-btn charinfo-attr-modal__row-remove charinfo-attr-modal__add-cancel",
      attr: {
        "aria-label": "속성 추가 취소",
        title: "취소",
        "data-focus": "add-field-cancel",
      },
    });
    setIcon(cancel, "x");
    cancel.disabled = this.pending;

    const cancelAdd = () => {
      this.addingField = false;
      this.addFieldDraft = "";
      this.focusKey = "add-field-open";
      this.redraw();
    };

    const commit = () => {
      const label = input.value.trim();
      if (!label || this.pending) return;
      const fieldType = this.addFieldType;
      void this.runSchema(
        "추가",
        (group) => {
          addCustomField(
            this.settings(),
            this.ctx.library,
            this.ctx.archive,
            group,
            label,
            fieldType,
            this.observedArchiveKeys(),
          );
        },
        { reconcile: true },
      ).then((saved) => {
        if (!saved) return;
        this.addFieldDraft = "";
        this.addingField = false;
        this.focusKey = "add-field-open";
        if (this.modalEl.isConnected) this.redraw();
      });
    };
    submit.addEventListener("click", commit);
    cancel.addEventListener("click", cancelAdd);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancelAdd();
      }
    });
  }

  private renderList(root: HTMLElement): void {
    this.renderGroupSection(root);
  }

  /* ------------------------------------------------------- property detail */

  private detailField(): FieldDef | null {
    if (!this.detailFieldId) return null;
    return (
      this.schema().fields.find((field) => field.id === this.detailFieldId) ??
      null
    );
  }

  /** True when this field's values come from the global chip vocabulary. */
  private isAxisField(field: FieldDef): boolean {
    return isChipAxisField(field);
  }

  /** The vocabulary the detail edits, from whichever side owns it. */
  private detailOptions(field: FieldDef): LedgerOption[] {
    if (this.isAxisField(field)) {
      const colored = this.axisId !== "tags";
      return axisFor(this.settings(), this.axisId).options.map((option) => ({
        id: option.id,
        label: option.label,
        color: colored ? option.color : null,
      }));
    }
    return field.options.map((option) => ({
      id: option.id,
      label: option.label,
      color: null,
    }));
  }

  /** Option rails are capabilities, never placeholders used for indentation. */
  private optionLayout(field: FieldDef): {
    reorderable: boolean;
    colored: boolean;
    className: string;
  } {
    const reorderable = !this.isAxisField(field);
    const colored = this.isAxisField(field) && this.axisId !== "tags";
    return {
      reorderable,
      colored,
      className:
        (reorderable ? " has-grip" : "") +
        (colored ? " has-color" : ""),
    };
  }

  /**
   * One detail grammar: the name, the type, then only what that type needs.
   *
   * There is no storage-key disclosure and no second picker. A text property
   * ends after the common rows; select and multi-select continue into the one
   * option ledger, fed by the global chip vocabulary for a built-in axis and by
   * the field's own list for everything else.
   */
  private renderDetail(root: HTMLElement): void {
    const field = this.detailField();
    if (!field) {
      root.createDiv({
        cls: "charinfo-attr-modal__hint",
        text: "이 속성을 찾지 못했어요.",
      });
      return;
    }

    const rows = root.createDiv({ cls: "charinfo-attr-modal__detail" });

    const nameRow = rows.createDiv({ cls: "charinfo-attr-modal__detail-row" });
    nameRow.createSpan({
      cls: "charinfo-attr-modal__detail-label",
      text: "속성 이름",
    });
    if (this.renameFieldId === field.id) {
      this.renderNameInput(nameRow, field);
      nameRow.createDiv({
        cls: "charinfo-attr-modal__slot",
        attr: { "aria-hidden": "true" },
      });
    } else {
      const name = nameRow.createEl("button", {
        type: "button",
        cls: "charinfo-attr-modal__detail-value",
        text: this.fieldName(field),
        attr: { title: "이름 바꾸기", "data-focus": "detail-name" },
      });
      name.disabled = this.pending;
      name.addEventListener("click", () => {
        this.renameFieldId = field.id;
        this.renameDraft = this.fieldName(field);
        this.focusKey = `field-name-${field.id}`;
        this.redraw();
      });
      nameRow.createDiv({
        cls: "charinfo-attr-modal__slot",
        attr: { "aria-hidden": "true" },
      });
    }

    const typeRow = rows.createDiv({ cls: "charinfo-attr-modal__detail-row" });
    typeRow.createSpan({
      cls: "charinfo-attr-modal__detail-label",
      text: "속성 종류",
    });
    this.renderTypeControl(typeRow, field, "detail-type", "detail");
    if (canRetypeFieldId(field.id)) {
      const chev = typeRow.createSpan({
        cls: "charinfo-attr-modal__detail-chev",
        attr: { "aria-hidden": "true" },
      });
      setIcon(chev, "chevron-right");
    } else {
      typeRow.createDiv({
        cls: "charinfo-attr-modal__slot",
        attr: { "aria-hidden": "true" },
      });
    }

    // Only worth saying when there is more than one route to be confused
    // between: `switchable` is the peer-rail's answer to "is this a choice?".
    if (this.isAxisField(field) && this.routes().switchable) {
      root.createDiv({
        cls: "charinfo-attr-modal__hint charinfo-attr-modal__ownership",
        text: `이름과 선택 항목은 모든 그룹이 함께 써요. 종류는 「${scopeLabel(this.group)}」에서만 바뀌어요.`,
      });
    }

    if (field.type !== "text") {
      this.renderOptionLedger(root, field);
      this.renderLeftoverFold(root, field);
    }

    if (canRetypeFieldId(field.id)) this.renderDetailRemove(root, field);
  }

  /** The property's own removal door — the same active-only flow as the ledger X. */
  private renderDetailRemove(root: HTMLElement, field: FieldDef): void {
    const btn = root.createEl("button", {
      type: "button",
      cls: "charinfo-attr-modal__danger-row",
      attr: {
        "aria-label": `${this.fieldName(field)} 목록에서 빼기`,
        title: "속성 빼기 (노트의 값도 지워져요)",
        "data-focus": "detail-remove",
      },
    });
    const icon = btn.createSpan({
      cls: "charinfo-attr-modal__danger-icon",
      attr: { "aria-hidden": "true" },
    });
    setIcon(icon, "trash-2");
    btn.createSpan({ text: "속성 빼기" });
    btn.disabled = this.pending;
    btn.addEventListener("click", () => {
      void this.requestFieldRemoval(field, "detail");
    });
    if (
      this.confirmFieldRemove?.id === field.id &&
      this.confirmFieldRemove.origin === "detail"
    ) {
      this.renderFieldRemoveConfirm(root, field, "detail");
    }
  }

  /* ---------------------------------------------------- the option ledger */

  private renderOptionLedger(root: HTMLElement, field: FieldDef): void {
    const options = this.detailOptions(field);
    const layout = this.optionLayout(field);
    const head = root.createDiv({ cls: "charinfo-attr-modal__section-head" });
    head.createSpan({
      cls: "charinfo-attr-modal__section-title",
      text: "선택 항목",
    });
    head.createSpan({
      cls: "charinfo-attr-modal__section-count",
      text: String(options.length),
      attr: { "aria-label": `선택 항목 ${options.length}개` },
    });

    const list = root.createDiv({ cls: "charinfo-attr-modal__list" });
    for (const option of options) this.renderOptionRow(list, field, option);

    if (this.optionCreating) {
      this.renderOptionDraft(list, field);
      return;
    }
    const add = list.createEl("button", {
      type: "button",
      cls: "charinfo-attr-modal__option-add" + layout.className,
      attr: { "data-focus": "option-add", "aria-label": "선택 항목 추가" },
    });
    const content = add.createSpan({
      cls: "charinfo-attr-modal__option-add-content",
    });
    const icon = content.createSpan({
      cls: "charinfo-attr-modal__add-icon",
      attr: { "aria-hidden": "true" },
    });
    setIcon(icon, "plus");
    content.createSpan({ text: "선택 항목 추가" });
    add.disabled = this.pending;
    add.addEventListener("click", () => {
      this.optionCreating = true;
      this.optionDraft = "";
      this.optionExpandedId = "";
      this.confirmDelete = null;
      this.focusKey = "option-name";
      this.redraw();
    });
  }

  private renderOptionDraft(list: HTMLElement, field: FieldDef): void {
    const layout = this.optionLayout(field);
    const draft = list.createDiv({
      cls:
        "charinfo-attr-modal__row is-option is-draft" + layout.className,
    });
    if (layout.reorderable) {
      const grip = draft.createDiv({
        cls: "charinfo-attr-modal__grip",
        attr: { "aria-hidden": "true" },
      });
      setIcon(grip, "grip-vertical");
    }
    if (layout.colored) {
      const dot = draft.createSpan({ cls: "charinfo-attr-modal__dot" });
      paintStatusColor(dot, "gray");
    }
    const input = draft.createEl("input", {
      type: "text",
      cls: "charinfo-attr-modal__row-input",
      attr: {
        placeholder: "새 선택 항목 이름",
        spellcheck: "false",
        "aria-label": "새 선택 항목 이름",
        "data-focus": "option-name",
      },
    });
    input.value = this.optionDraft;
    input.disabled = this.pending;

    const submit = draft.createEl("button", {
      type: "button",
      cls: "clickable-icon charinfo-icon-btn charinfo-attr-modal__add-submit",
      attr: {
        "aria-label": "선택 항목 추가",
        title: "선택 항목 추가",
        "data-focus": "option-submit",
      },
    });
    setIcon(submit, "check");
    submit.disabled = this.pending || !input.value.trim();

    const cancel = draft.createEl("button", {
      type: "button",
      cls: "clickable-icon charinfo-icon-btn charinfo-attr-modal__option-remove",
      attr: {
        "aria-label": "선택 항목 추가 취소",
        title: "취소",
      },
    });
    setIcon(cancel, "x");
    cancel.disabled = this.pending;

    const commit = () => {
      this.optionDraft = input.value;
      if (!this.optionDraft.trim()) {
        new Notice("이름을 입력해 주세요.");
        input.focus();
        return;
      }
      void this.commitOptionCreate(field);
    };
    input.addEventListener("input", () => {
      this.optionDraft = input.value;
      submit.disabled = this.pending || !input.value.trim();
    });
    submit.addEventListener("click", commit);
    cancel.addEventListener("click", () => {
      this.optionCreating = false;
      this.optionDraft = "";
      this.focusKey = "option-add";
      this.redraw();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancel.click();
      }
    });
  }

  /**
   * One option row: capability rails · name · badge · X.
   *
   * The X is its own button on the shared 32px rail, so pressing it never
   * expands or collapses the editor first — deletion has exactly one location
   * and one meaning on every row.
   */
  private renderOptionRow(
    list: HTMLElement,
    field: FieldDef,
    option: LedgerOption,
  ): void {
    if (this.confirmDelete?.id === option.id) {
      this.renderDeleteConfirm(list, field, option);
      return;
    }
    const open = this.optionExpandedId === option.id;
    const layout = this.optionLayout(field);
    const row = list.createDiv({
      cls:
        "charinfo-attr-modal__row is-option" +
        layout.className +
        (open ? " is-open" : ""),
    });
    const { reorderable, colored } = layout;
    if (reorderable) {
      row.dataset.id = option.id;
      const grip = row.createEl("button", {
        type: "button",
        cls: "clickable-icon charinfo-icon-btn charinfo-attr-modal__grip",
        attr: {
          "aria-label": `${option.label} 순서 바꾸기`,
          title: "드래그하거나 Alt+↑/↓로 순서 바꾸기",
          "aria-keyshortcuts": "Alt+ArrowUp Alt+ArrowDown",
          "data-focus": `option-handle-${option.id}`,
        },
      });
      setIcon(grip, "grip-vertical");
      grip.disabled = this.pending;
      grip.addEventListener("keydown", (event) => {
        if (!event.altKey) return;
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        this.moveOptionByKeyboard(
          field,
          option.id,
          event.key === "ArrowUp" ? -1 : 1,
        );
      });
    }

    if (colored) {
      const dot = row.createSpan({ cls: "charinfo-attr-modal__dot" });
      paintStatusColor(dot, option.color ?? "gray");
    }

    if (open) {
      const input = row.createEl("input", {
        type: "text",
        cls: "charinfo-attr-modal__row-input",
        attr: {
          spellcheck: "false",
          "aria-label": "선택 항목 이름",
          "data-focus": `option-edit-${option.id}`,
        },
      });
      input.value = this.optionEditDraft;
      input.disabled = this.pending;
      input.addEventListener("input", () => {
        this.optionEditDraft = input.value;
      });
      const commit = () => this.commitOptionLabel(field, option, input.value);
      const collapse = () => {
        this.optionExpandedId = "";
        this.focusKey = `option-${option.id}`;
        this.redraw();
      };
      input.addEventListener("change", commit);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          this.optionEditDraft = "";
          collapse();
        }
      });
    } else {
      const name = row.createEl("button", {
        type: "button",
        cls: "charinfo-attr-modal__row-label charinfo-attr-modal__option-name",
        text: option.label,
        attr: {
          title: option.color !== null ? "이름과 색 바꾸기" : "이름 바꾸기",
          "aria-expanded": "false",
          "data-focus": `option-${option.id}`,
        },
      });
      name.disabled = this.pending;
      name.addEventListener("click", () => {
        this.optionExpandedId = option.id;
        this.optionEditDraft = option.label;
        this.optionCreating = false;
        this.confirmDelete = null;
        this.focusKey = `option-edit-${option.id}`;
        this.redraw();
      });
    }

    // One value is always the new-card default; the flat row says which.
    if (
      this.isAxisField(field) &&
      this.axisId === "status" &&
      option.id === this.settings().defaultStatusId
    ) {
      row.createSpan({ cls: "charinfo-attr-modal__badge", text: "기본" });
    } else {
      row.createSpan({ cls: "charinfo-attr-modal__badge" });
    }

    const remove = row.createEl("button", {
      type: "button",
      cls: "clickable-icon charinfo-icon-btn charinfo-attr-modal__option-remove",
      attr: {
        "aria-label": `${option.label} 목록에서 빼기`,
        title: "목록에서 빼기 (카드에 저장된 값은 그대로 남아요)",
        "data-focus": `option-remove-${option.id}`,
      },
    });
    setIcon(remove, "x");
    remove.disabled = this.pending;
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.requestOptionDelete(field, option);
    });

    if (open) this.renderOptionEditor(list, field, option);

    if (!reorderable) return;
    attachHoldDrag(row, option.id, {
      canDrag: () => !this.pending,
      activation: "move",
      movePx: 4,
      handleSelector: ".charinfo-attr-modal__grip",
      dropSelector: ".charinfo-attr-modal__row.is-option",
      ghostClass: "charinfo-prop-row-ghost",
      slotClass: "charinfo-prop-row-slot",
      onReorder: (fromId, toId, place) =>
        this.reorderOptions(field, fromId, toId, place),
    });
  }

  private reorderOptions(
    field: FieldDef,
    fromId: string,
    toId: string,
    place: "before" | "after",
    focus?: string,
  ): void {
    const order = field.options.map((item) => item.id);
    const from = order.indexOf(fromId);
    if (from < 0) return;
    order.splice(from, 1);
    let insertAt = order.indexOf(toId);
    if (insertAt < 0) return;
    if (place === "after") insertAt += 1;
    order.splice(insertAt, 0, fromId);
    void this.runSchema(
      "순서",
      (group) => {
        reorderFieldOptions(
          this.settings(),
          this.ctx.library,
          this.ctx.archive,
          group,
          field.id,
          order,
        );
      },
      focus ? { focus } : {},
    );
  }

  private moveOptionByKeyboard(
    field: FieldDef,
    optionId: string,
    delta: -1 | 1,
  ): void {
    const index = field.options.findIndex((option) => option.id === optionId);
    const target = field.options[index + delta];
    if (index < 0 || !target) return;
    this.reorderOptions(
      field,
      optionId,
      target.id,
      delta < 0 ? "before" : "after",
      `option-handle-${optionId}`,
    );
  }

  /**
   * The open option's drawer: only the settings this vocabulary actually has.
   * A custom field's options carry no colour and no default, so they get no
   * drawer at all rather than an empty box.
   */
  private renderOptionEditor(
    list: HTMLElement,
    field: FieldDef,
    option: LedgerOption,
  ): void {
    if (!this.isAxisField(field)) return;
    const colored = this.axisId !== "tags";
    const isStatus = this.axisId === "status";
    if (!colored && !isStatus) return;
    const drawer = list.createDiv({ cls: "charinfo-attr-modal__drawer" });
    if (colored) this.renderColorRow(drawer, option);
    if (isStatus) this.renderDefaultControl(drawer, option);
  }

  private commitOptionLabel(
    field: FieldDef,
    option: LedgerOption,
    raw: string,
  ): void {
    const label = raw.trim();
    if (!label) {
      this.focusKey = `option-edit-${option.id}`;
      new Notice("이름을 입력해 주세요.");
      this.applyFocus();
      return;
    }
    this.optionEditDraft = label;
    if (this.isAxisField(field)) {
      const axisId = this.axisId;
      void this.run("이름", axisId, async () => {
        await this.plugin.commitSettings((s) => {
          this.patchOption(s, axisId, option.id, { label });
        });
      });
      return;
    }
    this.optionExpandedId = "";
    void this.runSchema("이름", (group) => {
      renameFieldOption(
        this.settings(),
        this.ctx.library,
        this.ctx.archive,
        group,
        field.id,
        option.id,
        label,
      );
    });
  }

  private async commitOptionCreate(field: FieldDef): Promise<void> {
    const label = this.optionDraft.trim();
    if (!label) {
      new Notice("이름을 입력해 주세요.");
      return;
    }
    if (this.isAxisField(field)) {
      const axisId = this.axisId;
      const id = suggestStatusId(label, axisFor(this.settings(), axisId).options);
      const next: StatusDef = { id, label, color: "gray" };
      await this.run("추가", axisId, async () => {
        await this.plugin.commitSettings((s) => {
          this.pushOption(s, axisId, next);
        });
        this.optionCreating = false;
        this.optionDraft = "";
        this.optionExpandedId = id;
        this.optionEditDraft = label;
        this.focusKey = `option-edit-${id}`;
      });
      return;
    }
    const saved = await this.runSchema("추가", (group) => {
      addFieldOption(
        this.settings(),
        this.ctx.library,
        this.ctx.archive,
        group,
        field.id,
        label,
      );
    });
    if (!saved) return;
    this.optionCreating = false;
    this.optionDraft = "";
    this.focusKey = "option-add";
    if (this.modalEl.isConnected) this.redraw();
  }

  /**
   * Usage-aware removal. A value already written to notes is never deleted, so
   * the confirmation says how many cards still carry it and what they will look
   * like afterwards. With nothing using it there is nothing to warn about.
   */
  private async requestOptionDelete(
    field: FieldDef,
    option: LedgerOption,
  ): Promise<void> {
    if (!this.canLeaveDraft()) return;
    if (this.isAxisField(field)) {
      if (this.axisId === "status") {
        if (this.settings().statuses.length <= 1) {
          new Notice("고를 수 있는 값이 하나는 필요해요.");
          return;
        }
        if (option.id === this.settings().defaultStatusId) {
          new Notice("새 카드 기본값으로 쓰는 중이에요. 다른 기본값을 고른 뒤에 빼 주세요.");
          return;
        }
      }
      const library = countRawAxisOccupants(
        this.axisId,
        option.id,
        this.ctx.records,
      );
      const archive = countRawAxisOccupants(
        this.axisId,
        option.id,
        this.ctx.records,
        this.ctx.archive,
      );
      if (library > 0) {
        this.confirmDelete = {
          id: option.id,
          message: `‘${option.label}’을 쓰는 카드가 모든 아카이브 합쳐 ${library}장 있어요. 이 아카이브에는 ${archive}장 있어요. 목록에서만 빠지고, 카드에 저장된 값은 그대로 남아요. 카드는 회색 ‘${option.id}’으로 보일 수 있어요.`,
        };
        this.optionExpandedId = "";
        this.redraw();
        return;
      }
      await this.deleteOption(field, option.id);
      return;
    }
    const used = this.countFieldOptionUsage(field, option.id);
    if (used > 0) {
      this.confirmDelete = {
        id: option.id,
        message: `‘${option.label}’을 쓰는 카드가 이 그룹에 ${used}장 있어요. 목록에서만 빠지고, 카드에 저장된 값은 그대로 남아요. 카드는 회색 ‘${option.id}’으로 보일 수 있어요.`,
      };
      this.optionExpandedId = "";
      this.redraw();
      return;
    }
    await this.deleteOption(field, option.id);
  }

  /** Route members still storing one field-local option id. */
  private countFieldOptionUsage(field: FieldDef, optionId: string): number {
    let used = 0;
    for (const record of this.routeMembers()) {
      const raw = record.values ? record.values[field.key] : undefined;
      const ids = Array.isArray(raw) ? raw : [String(raw ?? "")];
      if (ids.some((id) => id.trim() === optionId)) used += 1;
    }
    return used;
  }

  private renderDeleteConfirm(
    list: HTMLElement,
    field: FieldDef,
    option: LedgerOption,
  ): void {
    const box = list.createDiv({ cls: "charinfo-attr-modal__confirm" });
    box.createDiv({ text: this.confirmDelete?.message ?? "" });
    const actions = box.createDiv({
      cls: "charinfo-attr-modal__confirm-actions",
    });
    const cancel = actions.createEl("button", { type: "button", text: "취소" });
    cancel.addEventListener("click", () => {
      this.confirmDelete = null;
      this.focusKey = `option-${option.id}`;
      this.redraw();
    });
    const del = actions.createEl("button", {
      type: "button",
      cls: "mod-warning",
      text: "빼기",
    });
    del.disabled = this.pending;
    del.addEventListener("click", () => void this.deleteOption(field, option.id));
  }

  private async deleteOption(field: FieldDef, id: string): Promise<void> {
    if (!this.isAxisField(field)) {
      this.confirmDelete = null;
      this.optionExpandedId = "";
      await this.runSchema(
        "빼기",
        (group) => {
          removeFieldOption(
            this.settings(),
            this.ctx.library,
            this.ctx.archive,
            group,
            field.id,
            id,
          );
        },
        { focus: "option-add" },
      );
      return;
    }
    const axisId = this.axisId;
    await this.run("빼기", axisId, async () => {
      await this.plugin.commitSettings((s) => {
        if (axisId === "status") {
          if (s.statuses.length <= 1) return;
          if (s.defaultStatusId === id) return;
          s.statuses = s.statuses.filter((o) => o.id !== id);
        } else if (axisId === "tags") {
          s.tagVocab = s.tagVocab.filter((o) => o.id !== id);
        } else {
          s.selectVocab = {
            ...s.selectVocab,
            [axisId]: s.selectVocab[axisId].filter((o) => o.id !== id),
          };
        }
        forgetChipFilterOption(s, axisId, id);
      });
      this.confirmDelete = null;
      this.optionExpandedId = "";
    });
  }

  /**
   * Five presets, then exactly one custom entry backed by a native picker.
   *
   * Selection is never colour-only: the chosen circle carries a ring **and** a
   * check, so the state survives a monochrome or colour-blind read.
   */
  private renderColorRow(drawer: HTMLElement, option: LedgerOption): void {
    drawer.createDiv({ cls: "charinfo-attr-modal__editor-label", text: "색상" });
    const swatches = drawer.createDiv({
      cls: "charinfo-attr-modal__swatches",
      attr: { role: "radiogroup", "aria-label": "색" },
    });
    for (const token of this.colorPresets(option)) {
      const active = option.color === token.id;
      const sw = swatches.createEl("button", {
        type: "button",
        cls:
          "charinfo-attr-modal__swatch is-" +
          token.id +
          (active ? " is-active" : ""),
        attr: {
          title: token.label,
          "aria-label": token.label,
          role: "radio",
          "aria-checked": active ? "true" : "false",
          "data-focus": `swatch-${option.id}-${token.id}`,
        },
      });
      if (active) {
        const check = sw.createSpan({
          cls: "charinfo-attr-modal__swatch-check",
          attr: { "aria-hidden": "true" },
        });
        setIcon(check, "check");
      }
      sw.disabled = this.pending;
      sw.addEventListener("click", () => {
        // The redraw lands the caret back on the swatch that was just pressed.
        this.focusKey = `swatch-${option.id}-${token.id}`;
        void this.applyColor(option, token.id);
      });
    }

    // The last cell: a multicolor face over `input[type=color]`. Once a colour
    // is committed the face shows it, and it stays the custom picker's trigger.
    const custom = option.color ? isCustomStatusColor(option.color) : false;
    const face = swatches.createEl("label", {
      cls:
        "charinfo-attr-modal__swatch is-multicolor" +
        (custom ? " is-active is-picked" : ""),
      attr: { title: "색 직접 고르기" },
    });
    if (custom && option.color) {
      face.style.setProperty("--charinfo-swatch-picked", option.color);
      const check = face.createSpan({
        cls: "charinfo-attr-modal__swatch-check",
        attr: { "aria-hidden": "true" },
      });
      setIcon(check, "check");
    }
    const picker = face.createEl("input", {
      type: "color",
      cls: "charinfo-attr-modal__swatch-input",
      attr: {
        "aria-label": "색 직접 고르기",
        "data-focus": `custom-${option.id}`,
      },
    });
    picker.value = custom && option.color ? option.color.toLowerCase() : "#7c3aed";
    picker.disabled = this.pending;
    picker.addEventListener("change", () => {
      this.focusKey = `custom-${option.id}`;
      void this.applyColor(option, normalizeStatusColor(picker.value));
    });
  }

  /**
   * The five offered presets — plus the stored one when a vault predates this
   * rail, so no saved colour becomes unreachable or unreadable.
   */
  private colorPresets(option: LedgerOption): typeof STATUS_COLOR_TOKENS {
    const offered = STATUS_COLOR_TOKENS.filter((token) =>
      LEDGER_COLOR_PRESETS.includes(token.id),
    ).sort(
      (a, b) =>
        LEDGER_COLOR_PRESETS.indexOf(a.id) - LEDGER_COLOR_PRESETS.indexOf(b.id),
    );
    const current = option.color;
    if (
      current &&
      !isCustomStatusColor(current) &&
      !LEDGER_COLOR_PRESETS.includes(current)
    ) {
      const legacy = STATUS_COLOR_TOKENS.find((token) => token.id === current);
      if (legacy) return [legacy, ...offered];
    }
    return offered;
  }

  private async applyColor(
    option: LedgerOption,
    color: StatusColorToken,
  ): Promise<void> {
    const axisId = this.axisId;
    await this.run("색", axisId, async () => {
      await this.plugin.commitSettings((s) => {
        this.patchOption(s, axisId, option.id, { color });
      });
    });
  }

  /**
   * Exclusive default, on the shared 32px rail as a check. Picking another
   * status transfers it; the current default cannot be cleared here, because a
   * list with no default has no new-card value.
   */
  private renderDefaultControl(
    drawer: HTMLElement,
    option: LedgerOption,
  ): void {
    const isDefault = option.id === this.settings().defaultStatusId;
    const line = drawer.createDiv({ cls: "charinfo-attr-modal__setting-line" });
    line.createSpan({
      cls: "charinfo-attr-modal__setting-label",
      text: "새 카드 기본값",
    });
    const btn = line.createEl("button", {
      type: "button",
      cls:
        "charinfo-attr-modal__check" + (isDefault ? " is-active" : ""),
      attr: {
        "aria-pressed": isDefault ? "true" : "false",
        "aria-label": "새 카드 기본값",
        title: "새 카드에 미리 넣을 상태",
        "data-focus": `default-${option.id}`,
      },
    });
    if (isDefault) {
      const mark = btn.createSpan({ attr: { "aria-hidden": "true" } });
      setIcon(mark, "check");
    }
    btn.disabled = this.pending;
    btn.addEventListener("click", () => {
      if (isDefault) {
        new Notice("기본값은 하나가 필요해요. 다른 값을 기본값으로 골라 주세요.");
        return;
      }
      this.focusKey = `default-${option.id}`;
      void this.run("기본값", "status", async () => {
        await this.plugin.commitSettings((s) => {
          s.defaultStatusId = option.id;
        });
      });
    });
  }

  private renderLeftoverFold(root: HTMLElement, field: FieldDef): void {
    const axis = this.isAxisField(field);
    const leftovers = axis
      ? leftoverAxisIds(
          axisFor(this.settings(), this.axisId),
          this.ctx.records,
          this.ctx.archive,
        )
      : leftoverFieldOptionIds(field, this.routeMembers());
    if (leftovers.length === 0) return;
    const fold = root.createEl("button", {
      type: "button",
      cls: "charinfo-attr-modal__fold",
      text: `${this.leftoverOpen ? "▾" : "▸"} ${axis ? "이 아카이브" : "이 그룹"}에서 목록에 없는 값 · ${leftovers.length}개`,
      attr: { "aria-expanded": this.leftoverOpen ? "true" : "false" },
    });
    fold.addEventListener("click", () => {
      this.leftoverOpen = !this.leftoverOpen;
      this.redraw();
    });
    if (!this.leftoverOpen) return;
    for (const id of leftovers) {
      const row = root.createDiv({ cls: "charinfo-attr-modal__leftover-row" });
      row.createSpan({ text: id, cls: "is-ghost" });
      const add = row.createEl("button", {
        type: "button",
        text: "목록에 넣기",
      });
      add.disabled = this.pending;
      add.addEventListener("click", () => void this.adopt(id, field));
    }
  }

  /**
   * One schema mutation: save first, then (only on success) reconcile the
   * group's member notes. A failed save rolls back in `commitSettings` and must
   * not enqueue note work.
   *
   * `focus` is claimed *inside* the job, not before it: `run` schedules an
   * interim redraw for the saving state, and that redraw would otherwise spend
   * the caret before the row it belongs to exists.
   */
  private async runSchema(
    action: string,
    mutate: (group: string) => void,
    opts: {
      reconcile?: boolean;
      focus?: string;
      onSaved?: () => void;
    } = {},
  ): Promise<boolean> {
    const group = this.group;
    return this.run(
      action,
      this.axisId,
      async () => {
        await this.plugin.commitSettings((settings) => {
          ensureGroupSchema(settings, this.ctx.library, this.ctx.archive, group);
          mutate(group);
        });
        if (opts.reconcile) this.ctx.onSchemaSaved(group);
        opts.onSaved?.();
        if (opts.focus) this.focusKey = opts.focus;
      },
      "schema",
      group,
    );
  }

  private retryBelongsHere(): boolean {
    if (!this.retry) return false;
    if (this.retry.scope === "schema") {
      return this.retry.group === this.group;
    }
    return this.screen === "detail" && this.axisId === this.retry.axisId;
  }

  private paintSave(): void {
    const line = this.saveHost;
    if (!line) return;
    line.empty();
    line.removeClass("is-error");
    line.removeClass("is-empty");
    if (this.pending) {
      line.setText("저장 중…");
      return;
    }
    if (this.saveError && (!this.retry || this.retryBelongsHere())) {
      line.addClass("is-error");
      line.createSpan({ text: this.saveError + (this.retry ? " " : "") });
      if (!this.retry) return;
      const retry = line.createEl("button", {
        type: "button",
        cls: "charinfo-attr-modal__retry",
        text: "다시 시도",
      });
      retry.addEventListener("click", () => {
        const job = this.retry;
        if (!job) return;
        if (job.scope === "schema" && job.group !== this.group) {
          this.retry = null;
          this.saveError = "";
          new Notice("현재 그룹에서 다시 시도할 작업이 없어요.");
          this.paintSave();
          return;
        }
        void this.run(job.action, job.axisId, job.work, job.scope, job.group);
      });
      return;
    }
    line.addClass("is-empty");
  }

  /** Success is transient global feedback; the panel is reserved for recovery. */
  private showSaveNotice(): void {
    this.saveNotice?.hide();
    window.clearTimeout(this.saveTimer);
    const notice = new Notice("저장했어요.", 1600);
    this.saveNotice = notice;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = 0;
      if (this.saveNotice === notice) this.saveNotice = null;
    }, 1600);
  }

  private applyFocus(): void {
    const key = this.focusKey;
    if (!key) return;
    this.focusKey = "";
    const el = this.modalEl.querySelector<HTMLElement>(
      `[data-focus="${CSS.escape(key)}"]`,
    );
    el?.focus();
  }

  private async run(
    action: string,
    axisId: PrimaryFilterProperty,
    work: () => Promise<void>,
    scope: RetryJob["scope"] = "axis",
    group?: string,
  ): Promise<boolean> {
    if (this.pending) return false;
    this.pending = true;
    this.saveError = "";
    this.retry = { scope, axisId, group, action, work };
    this.paintSave();
    this.scheduleRedraw();
    try {
      await work();
      this.saveError = "";
      this.retry = null;
      this.ctx.onChanged();
      this.showSaveNotice();
      return true;
    } catch (error) {
      const blocked = error instanceof GroupDeletionBlockedError;
      // A group operation that already knows what went wrong says it verbatim —
      // a count the user needs must not flatten into "저장하지 못했어요".
      const spoken = blocked || error instanceof GroupOperationError;
      this.saveError = spoken ? (error as Error).message : "저장하지 못했어요.";
      if (blocked) this.retry = null;
      new Notice(this.saveError);
      console.error(error);
      return false;
    } finally {
      this.pending = false;
      this.redraw();
    }
  }

  private patchOption(
    settings: CharinfoPlugin["settings"],
    axisId: PrimaryFilterProperty,
    id: string,
    patch: { label?: string; color?: StatusColorToken },
  ): void {
    if (axisId === "status") {
      settings.statuses = settings.statuses.map((s) =>
        s.id === id ? { ...s, ...patch } : s,
      );
      return;
    }
    if (axisId === "tags") {
      settings.tagVocab = settings.tagVocab.map((t) =>
        t.id === id ? { ...t, label: patch.label ?? t.label } : t,
      );
      return;
    }
    settings.selectVocab = {
      ...settings.selectVocab,
      [axisId]: settings.selectVocab[axisId].map((s) =>
        s.id === id ? { ...s, ...patch } : s,
      ),
    };
  }

  private pushOption(
    settings: CharinfoPlugin["settings"],
    axisId: PrimaryFilterProperty,
    option: StatusDef,
  ): void {
    if (axisId === "status") {
      if (settings.statuses.some((s) => s.id === option.id)) return;
      settings.statuses = [...settings.statuses, option];
      return;
    }
    if (axisId === "tags") {
      if (settings.tagVocab.some((t) => t.id === option.id)) return;
      const tag: TagDef = { id: option.id, label: option.label };
      settings.tagVocab = [...settings.tagVocab, tag];
      return;
    }
    const list = settings.selectVocab[axisId];
    if (list.some((s) => s.id === option.id)) return;
    settings.selectVocab = {
      ...settings.selectVocab,
      [axisId]: [...list, option],
    };
  }

  private async adopt(id: string, field: FieldDef): Promise<void> {
    if (!this.isAxisField(field)) {
      await this.runSchema("넣기", (group) => {
        adoptFieldOption(
          this.settings(),
          this.ctx.library,
          this.ctx.archive,
          group,
          field.id,
          id,
          id,
        );
      });
      return;
    }
    const axisId = this.axisId;
    const next: StatusDef = { id, label: id, color: "gray" };
    await this.run("넣기", axisId, async () => {
      await this.plugin.commitSettings((s) => {
        this.pushOption(s, axisId, next);
      });
    });
  }
}
