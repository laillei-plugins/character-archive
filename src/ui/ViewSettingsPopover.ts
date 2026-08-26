import { Notice, setIcon } from "obsidian";
import {
  FILTER_AXIS_IDS,
  type PrimaryFilterProperty,
} from "../settings";
import { placeAnchoredPopover } from "./typeMenuPlacement";
import type {
  BatchActionDescriptor,
  FoldTier,
} from "./searchDisclosure";

/** One 보기 row: a field of the current page + active archive. */
export interface ViewFieldRow {
  fieldId: string;
  label: string;
  visible: boolean;
}

export interface ViewSettingsPopoverHandlers {
  /** Active fields for this gallery page + archive, label-suffixed. */
  getFields: () => ViewFieldRow[];
  setVisible: (fieldId: string, visible: boolean) => void | Promise<void>;
  getFitImage: () => boolean;
  setFitImage: (fit: boolean) => void | Promise<void>;
  getPageAxis: () => PrimaryFilterProperty | null;
  getGlobalAxis: () => PrimaryFilterProperty;
  axisName: (id: PrimaryFilterProperty) => string;
  axisReachable: (id: PrimaryFilterProperty) => boolean;
  axisOptions: (id: PrimaryFilterProperty) => string[];
  setPageAxis: (next: PrimaryFilterProperty | null) => void | Promise<void>;
  onShare: () => void;
  onManageAttributes: () => void;
  batchAction: () => BatchActionDescriptor;
  activateBatchAction: () => void;
  refresh: () => Promise<void>;
  isRefreshPending: () => boolean;
  onChange: () => void;
}

export interface ViewSettingsPopoverState {
  foldTier: FoldTier;
  editMode: boolean;
  batchMode: boolean;
  batchSaving: boolean;
  cardEditActive: boolean;
  refreshPending: boolean;
}

let viewSettingsPopoverId = 0;

/**
 * 보기: visibility for one gallery page + archive, plus this page’s chip filter.
 * Field order belongs to each group's schema and is edited in `속성 관리`.
 */
export class ViewSettingsPopover {
  private panel: HTMLElement | null = null;
  private onDocPointer: ((e: PointerEvent) => void) | null = null;
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  private onScroll: ((event: Event) => void) | null = null;
  private pending = false;
  private pageAxisOverride: PrimaryFilterProperty | null | undefined;
  private axisFocusKey = "";
  private responsiveState: ViewSettingsPopoverState = {
    foldTier: "none",
    editMode: false,
    batchMode: false,
    batchSaving: false,
    cardEditActive: false,
    refreshPending: false,
  };
  private readonly axisRadioName =
    `charinfo-page-axis-${++viewSettingsPopoverId}`;

  constructor(
    private anchor: HTMLElement,
    private handlers: ViewSettingsPopoverHandlers,
  ) {}

  toggle(state: ViewSettingsPopoverState): void {
    if (this.panel) this.close();
    else this.open(state);
  }

  close(): void {
    this.panel?.remove();
    this.panel = null;
    if (this.onDocPointer) {
      document.removeEventListener("pointerdown", this.onDocPointer, true);
      this.onDocPointer = null;
    }
    if (this.onKey) {
      document.removeEventListener("keydown", this.onKey);
      this.onKey = null;
    }
    if (this.onScroll) {
      document.removeEventListener("scroll", this.onScroll, true);
      this.onScroll = null;
    }
  }

  ownsFocus(): boolean {
    return this.panel?.contains(document.activeElement) ?? false;
  }

  private open(state: ViewSettingsPopoverState): void {
    this.close();
    this.responsiveState = { ...state };
    this.pageAxisOverride = undefined;
    const panel = document.body.createDiv({ cls: "charinfo-view-menu" });
    this.panel = panel;

    this.render(panel);
    this.placePanel();

    this.onDocPointer = (event) => {
      if (!(event.target instanceof Node)) return;
      if (panel.contains(event.target) || this.anchor.contains(event.target)) {
        return;
      }
      this.close();
    };
    this.onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.close();
      if (this.anchor.isConnected) this.anchor.focus();
    };
    this.onScroll = (event) => {
      if (event.target instanceof Node && panel.contains(event.target)) return;
      if (!this.anchor.isConnected) {
        this.close();
        return;
      }
      this.placePanel();
    };
    window.setTimeout(() => {
      if (this.onDocPointer) {
        document.addEventListener("pointerdown", this.onDocPointer, true);
      }
      if (this.onKey) {
        document.addEventListener("keydown", this.onKey);
      }
      if (this.onScroll) {
        document.addEventListener("scroll", this.onScroll, true);
      }
    }, 0);
  }

  private placePanel(): void {
    const panel = this.panel;
    if (!panel?.isConnected || !this.anchor.isConnected) return;
    panel.style.removeProperty("max-height");
    const placement = placeAnchoredPopover(
      this.anchor.getBoundingClientRect(),
      panel.getBoundingClientRect(),
      window.innerWidth,
      window.innerHeight,
      { anchorGap: 6, align: "end" },
    );
    panel.setCssStyles({
      top: `${Math.round(placement.top)}px`,
      left: `${Math.round(placement.left)}px`,
      maxHeight: `${Math.floor(placement.maxHeight)}px`,
    });
  }

  private render(panel: HTMLElement): void {
    panel.empty();
    panel.createDiv({ cls: "charinfo-view-menu__title", text: "보기 설정" });
    panel.createDiv({
      cls: "charinfo-view-menu__hint",
      text: "순서는 속성 관리에서 정해요.",
    });

    const list = panel.createDiv({ cls: "charinfo-prop-list" });
    const rerender = () => {
      if (!panel.isConnected) return;
      this.render(panel);
    };
    const rows = this.handlers.getFields();
    if (rows.length === 0) {
      list.createDiv({
        cls: "charinfo-view-menu__hint",
        text: "이 아카이브에 보일 항목이 없어요.",
      });
    } else {
      for (const row of rows) this.renderRow(list, row, rerender);
    }

    this.renderPageFilter(panel, rerender);

    const fit = this.handlers.getFitImage();
    const row = panel.createDiv({ cls: "charinfo-view-menu__toggle-row" });
    row.createDiv({
      cls: "charinfo-view-menu__toggle-label",
      text: "이미지 맞추기",
    });
    const toggle = row.createEl("button", {
      cls: "charinfo-view-menu__switch" + (fit ? " is-on" : ""),
      attr: {
        type: "button",
        role: "switch",
        "aria-checked": fit ? "true" : "false",
        "aria-label": "이미지 맞추기",
      },
    });
    toggle.createSpan({ cls: "charinfo-view-menu__switch-knob" });
    toggle.disabled = this.pending;
    toggle.addEventListener("click", () => {
      const next = !this.handlers.getFitImage();
      void this.handlers.setFitImage(next);
      this.render(panel);
      this.handlers.onChange();
    });

    this.renderFoldedActions(panel);
    this.renderRefreshAction(panel);

    if (this.axisFocusKey && !this.pending) {
      const focusKey = this.axisFocusKey;
      this.axisFocusKey = "";
      panel
        .querySelector<HTMLInputElement>(`[data-focus="${focusKey}"]`)
        ?.focus();
    }
    this.placePanel();
  }

  private renderFoldedActions(panel: HTMLElement): void {
    const state = this.responsiveState;
    const rows: {
      label: string;
      icon: string;
      disabled: boolean;
      pressed?: boolean;
      classes?: string;
      activate: () => void;
    }[] = [];
    if (state.foldTier !== "none") {
      rows.push({
        label: "공유",
        icon: "globe",
        disabled: false,
        activate: this.handlers.onShare,
      });
    }
    if (state.foldTier === "compact") {
      rows.push({
        label: "속성 관리",
        icon: "book",
        disabled: state.batchMode || !state.cardEditActive,
        activate: () => {
          // aria-disabled does not suppress keyboard or scripted activation.
          if (this.responsiveState.batchMode || !this.responsiveState.cardEditActive) {
            return;
          }
          this.handlers.onManageAttributes();
        },
      });
      if (state.editMode && !state.batchMode) {
        const descriptor = this.handlers.batchAction();
        rows.push({
          label: descriptor.label,
          icon: "list-checks",
          disabled: descriptor.disabled,
          pressed: descriptor.pressed,
          classes: descriptor.classes,
          activate: this.handlers.activateBatchAction,
        });
      }
    }
    if (rows.length === 0) return;
    const section = panel.createDiv({ cls: "charinfo-view-menu__actions" });
    for (const row of rows) {
      this.renderActionRow(section, row);
    }
  }

  private renderRefreshAction(panel: HTMLElement): void {
    const state = this.responsiveState;
    if (state.foldTier === "none" || !state.editMode) return;
    const section = panel.createDiv({
      cls: "charinfo-view-menu__actions charinfo-view-menu__actions--refresh",
    });
    const pending = this.handlers.isRefreshPending();
    this.renderActionRow(section, {
      label: "새로고침",
      icon: "refresh-cw",
      disabled: pending,
      classes: pending ? " is-pending" : "",
      activate: () => {
        void this.handlers.refresh().finally(() => {
          if (panel.isConnected) this.render(panel);
        });
        if (panel.isConnected) this.render(panel);
      },
    });
  }

  private renderActionRow(
    section: HTMLElement,
    row: {
      label: string;
      icon: string;
      disabled: boolean;
      pressed?: boolean;
      classes?: string;
      activate: () => void;
    },
  ): void {
    const button = section.createEl("button", {
      cls: "charinfo-view-menu__action" + (row.classes ?? ""),
      attr: {
        type: "button",
        "aria-disabled": row.disabled ? "true" : "false",
        ...(row.pressed == null
          ? {}
          : { "aria-pressed": row.pressed ? "true" : "false" }),
      },
    });
    const icon = button.createSpan({ cls: "charinfo-view-menu__action-icon" });
    setIcon(icon, row.icon);
    button.createSpan({ text: row.label });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      if (row.disabled) return;
      row.activate();
    });
  }

  private renderPageFilter(panel: HTMLElement, rerender: () => void): void {
    const section = panel.createDiv({ cls: "charinfo-view-menu__filter" });
    section.createDiv({
      cls: "charinfo-view-menu__title",
      text: "맨 위 필터 칩",
    });
    section.createDiv({
      cls: "charinfo-view-menu__hint",
      text: "갤러리 맨 위 칩에 쓸 속성을 고르세요.",
    });
    const pageAxis =
      this.pageAxisOverride === undefined
        ? this.handlers.getPageAxis()
        : this.pageAxisOverride;
    const globalAxis = this.handlers.getGlobalAxis();
    const axes = FILTER_AXIS_IDS.map((id) => {
      const reachable = this.handlers.axisReachable(id);
      const options = this.handlers.axisOptions(id);
      return {
        id,
        reachable,
        options,
        available: reachable && (id === "status" || options.length > 0),
      };
    });
    const group = section.createEl("fieldset", {
      cls: "charinfo-view-menu__axis-group",
      attr: {
        role: "radiogroup",
        "aria-label": "맨 위 필터 칩",
        ...(this.pending ? { "aria-busy": "true" } : {}),
      },
    });
    this.axisRadio(group, {
      active: pageAxis == null,
      label: "기본값 사용",
      note: `전체 설정을 따라요 · 현재: ${this.handlers.axisName(globalAxis)}`,
      value: "default",
      disabled: this.pending,
      onPick: () => this.commitPageAxis(null, rerender),
    });
    group.createDiv({
      cls: "charinfo-view-menu__axis-sublabel",
      text: "이 페이지만 바꾸기",
    });
    for (const axis of axes) {
      const pinnedUnavailable = pageAxis === axis.id && !axis.available;
      if (!axis.available && !pinnedUnavailable) continue;
      const note = axis.available
        ? this.axisPreview(axis.options)
        : axis.reachable
          ? "현재 선택됨 · 속성 관리에서 선택 항목을 추가해 주세요."
          : "현재 선택됨 · 이 아카이브에서 쓰지 않는 속성이에요.";
      this.axisRadio(group, {
        active: pageAxis === axis.id,
        label: this.handlers.axisName(axis.id),
        note,
        value: axis.id,
        disabled: this.pending,
        onPick: () => this.commitPageAxis(axis.id, rerender),
      });
    }

    const emptyAxes = axes.filter(
      (axis) =>
        !axis.available && axis.reachable && pageAxis !== axis.id,
    );
    const unreachableAxes = axes.filter(
      (axis) => !axis.reachable && pageAxis !== axis.id,
    );
    if (emptyAxes.length > 0 || unreachableAxes.length > 0) {
      const footer = section.createDiv({
        cls: "charinfo-view-menu__axis-footer",
      });
      if (emptyAxes.length > 0) {
        footer.createDiv({
          text: `${emptyAxes
            .map((axis) => this.handlers.axisName(axis.id))
            .join(" · ")}: 속성 관리에서 선택 항목을 추가하면 쓸 수 있어요.`,
        });
      }
      if (unreachableAxes.length > 0) {
        footer.createDiv({
          text: `${unreachableAxes
            .map((axis) => this.handlers.axisName(axis.id))
            .join(" · ")}: 이 아카이브에서 쓰지 않는 속성이에요.`,
        });
      }
    }
  }

  private axisPreview(options: string[]): string {
    const labels = options.map((label) => label.trim()).filter(Boolean);
    const preview = ["전체", ...labels.slice(0, 2)].join(" · ");
    const rest = labels.length - 2;
    return rest > 0 ? `${preview} · 외 ${rest}개` : preview;
  }

  private axisRadio(
    host: HTMLElement,
    opts: {
      active: boolean;
      label: string;
      note: string;
      value: string;
      disabled: boolean;
      onPick: () => void;
    },
  ): void {
    const row = host.createEl("label", {
      cls:
        "charinfo-view-menu__axis-row" +
        (opts.active ? " is-active" : ""),
    });
    const radio = row.createEl("input", {
      type: "radio",
      attr: {
        name: this.axisRadioName,
        value: opts.value,
        "data-focus": `axis-${opts.value}`,
      },
    });
    radio.checked = opts.active;
    radio.disabled = opts.disabled;
    row.createSpan({
      cls: "charinfo-view-menu__axis-name",
      text: opts.label,
    });
    row.createSpan({
      cls: "charinfo-view-menu__axis-note",
      text: opts.note,
      attr: { title: opts.note },
    });
    radio.addEventListener("change", () => {
      if (!radio.checked || this.pending) return;
      this.axisFocusKey = `axis-${opts.value}`;
      opts.onPick();
    });
  }

  private commitPageAxis(
    next: PrimaryFilterProperty | null,
    rerender: () => void,
  ): void {
    if (this.pending) return;
    const current =
      this.pageAxisOverride === undefined
        ? this.handlers.getPageAxis()
        : this.pageAxisOverride;
    if ((current ?? null) === (next ?? null)) return;
    this.pageAxisOverride = next;
    this.pending = true;
    rerender();
    void Promise.resolve(this.handlers.setPageAxis(next))
      .then(() => {
        this.pending = false;
        this.close();
        this.handlers.onChange();
      })
      .catch(() => {
        this.pending = false;
        this.pageAxisOverride = current;
        new Notice("필터 저장에 실패했어요. 다시 시도해 주세요.");
        rerender();
      });
  }

  private renderRow(
    list: HTMLElement,
    field: ViewFieldRow,
    rerender: () => void,
  ): void {
    const row = list.createDiv({
      cls:
        "charinfo-prop-row" +
        (field.visible ? " is-visible" : " is-hidden"),
    });

    row.createDiv({
      cls: "charinfo-prop-row__label",
      text: field.label,
    });

    const eye = row.createEl("button", {
      cls: "charinfo-prop-row__eye",
      attr: {
        type: "button",
        title: field.visible ? "카드에서 숨기기" : "카드에 보이기",
        "aria-pressed": field.visible ? "true" : "false",
      },
    });
    setIcon(eye, field.visible ? "eye" : "eye-off");
    eye.disabled = this.pending;
    eye.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      // Repaint from the saved rows, not from the click — the write is queued
      // behind any other settings mutation, so reading back early would lie.
      void Promise.resolve(
        this.handlers.setVisible(field.fieldId, !field.visible),
      ).then(() => {
        rerender();
        this.handlers.onChange();
      });
    });
  }
}
