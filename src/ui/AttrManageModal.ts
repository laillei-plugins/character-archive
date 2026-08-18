import { Modal, Notice, setIcon } from "obsidian";
import type CharinfoPlugin from "../main";
import type { CharacterRecord } from "../data/CharacterStore";
import {
  FILTER_AXIS_IDS,
  STATUS_COLOR_TOKENS,
  axisFor,
  axisLabel,
  countRawAxisOccupants,
  forgetChipFilterOption,
  leftoverAxisIds,
  suggestStatusId,
  type PrimaryFilterProperty,
  type StatusColorToken,
  type StatusDef,
  type TagDef,
} from "../settings";
import { axisFrontmatterKey as fmKeyOf } from "../data/filterAxis";

export interface AttrManageContext {
  records: CharacterRecord[];
  archive: string;
  pageAxis: PrimaryFilterProperty | null;
  globalAxis: PrimaryFilterProperty;
  file: import("obsidian").TFile | null;
  onPageAxis: (next: PrimaryFilterProperty | null) => Promise<void>;
  onChanged: () => void;
}

type Screen = "list" | "property" | "pageFilter";

interface RetryJob {
  axisId: PrimaryFilterProperty;
  action: string;
  work: () => Promise<void>;
}

/**
 * Gallery-owned vocabulary editor. Three screens, one shell.
 */
export class AttrManageModal extends Modal {
  private plugin: CharinfoPlugin;
  private ctx: AttrManageContext;
  private screen: Screen = "list";
  private axisId: PrimaryFilterProperty;
  private expandedId = "";
  private colorOpen = false;
  private creating = false;
  private createDraft = "";
  private noteKeyOpen = false;
  private leftoverOpen = false;
  private defaultOpen = false;
  private pending = false;
  private confirmDelete: { id: string; library: number; archive: number } | null =
    null;
  private saveNote = "";
  private saveError = "";
  private retry: RetryJob | null = null;
  private nameDraft = "";
  private focusKey = "";
  private saveHost: HTMLElement | null = null;
  private backBtn: HTMLButtonElement | null = null;
  private titleLabel: HTMLElement | null = null;
  private saveTimer = 0;
  private redrawFrame = 0;

  constructor(plugin: CharinfoPlugin, ctx: AttrManageContext) {
    super(plugin.app);
    this.plugin = plugin;
    this.ctx = ctx;
    this.axisId = ctx.pageAxis ?? ctx.globalAxis;
    this.nameDraft = this.displayName(this.axisId);
  }

  onOpen(): void {
    this.modalEl.addClass("charinfo-attr-modal-shell");
    this.installNav();
    this.saveHost = this.modalEl.createDiv({
      cls: "charinfo-attr-modal__save",
      attr: { "aria-live": "polite" },
    });
    this.focusKey = `prop-${FILTER_AXIS_IDS[0]}`;
    this.redraw();
  }

  onClose(): void {
    window.clearTimeout(this.saveTimer);
    if (this.redrawFrame) cancelAnimationFrame(this.redrawFrame);
    this.saveTimer = 0;
    this.redrawFrame = 0;
    this.contentEl.empty();
    this.saveHost?.remove();
    this.saveHost = null;
    this.backBtn = null;
    this.titleLabel = null;
    this.titleEl.empty();
    this.modalEl.removeClass("charinfo-attr-modal-shell");
  }

  private installNav(): void {
    this.titleEl.empty();
    this.titleEl.addClass("charinfo-attr-modal__title-row");
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
      text: "속성 관리",
    });
  }

  private syncNav(): void {
    if (!this.backBtn) return;
    const home = this.screen === "list";
    this.backBtn.toggleClass("is-hidden", home);
    this.backBtn.setAttribute("aria-hidden", home ? "true" : "false");
    this.backBtn.tabIndex = home ? -1 : 0;
    if (this.titleLabel) {
      this.titleLabel.setText(
        home
          ? "속성 관리"
          : this.screen === "pageFilter"
            ? "이 페이지 필터"
            : this.displayName(this.axisId),
      );
    }
  }

  private goList(): void {
    const returnKey =
      this.screen === "pageFilter" ? "page-filter" : `prop-${this.axisId}`;
    this.screen = "list";
    this.creating = false;
    this.expandedId = "";
    this.confirmDelete = null;
    this.colorOpen = false;
    this.focusKey = returnKey;
    this.redraw();
  }

  private settings() {
    return this.plugin.settings;
  }

  private displayName(id: PrimaryFilterProperty): string {
    return axisLabel(id, this.settings().propertyDisplayNames);
  }

  private options(): StatusDef[] {
    return axisFor(this.settings(), this.axisId).options;
  }

  private redraw(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("charinfo-attr-modal");
    this.syncNav();
    if (this.screen === "list") this.renderList(contentEl);
    else if (this.screen === "pageFilter") this.renderPageFilter(contentEl);
    else this.renderProperty(contentEl);
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

  private renderList(root: HTMLElement): void {
    root.createEl("h3", {
      cls: "charinfo-attr-modal__heading",
      text: "무엇을 바꿀까요?",
    });
    root.createDiv({
      cls: "charinfo-attr-modal__hint",
      text: "속성 이름과 값은 모든 페이지에서 함께 써요.",
    });
    const list = root.createDiv({ cls: "charinfo-attr-modal__pick" });
    for (const id of FILTER_AXIS_IDS) {
      const btn = list.createEl("button", {
        type: "button",
        cls: "charinfo-attr-modal__pick-btn",
        text: this.displayName(id),
        attr: { "data-focus": `prop-${id}` },
      });
      btn.disabled = this.pending;
      btn.addEventListener("click", () => {
        this.axisId = id;
        this.nameDraft = this.displayName(id);
        this.screen = "property";
        this.expandedId = "";
        this.creating = false;
        this.noteKeyOpen = false;
        this.leftoverOpen = false;
        this.defaultOpen = false;
        this.confirmDelete = null;
        this.focusKey = "display-name";
        this.redraw();
      });
    }
    const page = root.createEl("button", {
      type: "button",
      cls: "charinfo-attr-modal__page-link",
      text: "이 페이지 필터",
      attr: { "data-focus": "page-filter" },
    });
    page.disabled = this.pending;
    page.addEventListener("click", () => {
      this.screen = "pageFilter";
      this.focusKey = "page-default";
      this.redraw();
    });
  }

  private renderProperty(root: HTMLElement): void {
    const field = root.createDiv({ cls: "charinfo-attr-modal__field" });
    field.createDiv({ cls: "charinfo-attr-modal__label", text: "보이는 이름" });
    const input = field.createEl("input", {
      type: "text",
      cls: "charinfo-attr-modal__input",
      attr: {
        spellcheck: "false",
        "aria-label": "보이는 이름",
        "data-focus": "display-name",
      },
    });
    input.value = this.nameDraft;
    input.disabled = this.pending;
    const commitName = () => {
      this.nameDraft = input.value;
      const next = input.value.trim() || this.displayName(this.axisId);
      const axisId = this.axisId;
      void this.run("이름", axisId, async () => {
        await this.plugin.commitSettings((s) => {
          s.propertyDisplayNames = {
            ...s.propertyDisplayNames,
            [axisId]: next,
          };
        });
        this.nameDraft = next;
      });
    };
    input.addEventListener("change", commitName);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitName();
      }
    });
    field.createDiv({
      cls: "charinfo-attr-modal__hint",
      text: "카드와 맨 위 필터에 보이는 이름만 바뀝니다. 노트 속성 이름은 그대로예요.",
    });

    const keyFold = field.createEl("button", {
      type: "button",
      cls: "charinfo-attr-modal__fold",
      text: `${this.noteKeyOpen ? "▾" : "▸"} 노트 속성 이름 보기`,
      attr: { "aria-expanded": this.noteKeyOpen ? "true" : "false" },
    });
    keyFold.addEventListener("click", () => {
      this.noteKeyOpen = !this.noteKeyOpen;
      this.redraw();
    });
    if (this.noteKeyOpen) {
      field.createDiv({
        cls: "charinfo-attr-modal__key",
        text: fmKeyOf(this.axisId),
      });
    }

    this.renderValues(root);
    if (this.axisId === "status") this.renderDefaultFold(root);
    this.renderLeftoverFold(root);
  }

  private renderValues(root: HTMLElement): void {
    const wrap = root.createDiv({ cls: "charinfo-attr-modal__list-wrap" });
    wrap.createDiv({ cls: "charinfo-attr-modal__label", text: "고를 수 있는 값" });
    const list = wrap.createDiv({ cls: "charinfo-attr-modal__list" });
    for (const option of this.options()) {
      this.renderValueRow(list, option);
    }

    if (this.creating) {
      const draft = list.createDiv({ cls: "charinfo-attr-modal__create" });
      draft.createDiv({ cls: "charinfo-attr-modal__label", text: "새 값 이름" });
      const input = draft.createEl("input", {
        type: "text",
        cls: "charinfo-attr-modal__input",
        attr: {
          placeholder: "이름을 입력하세요",
          spellcheck: "false",
          "data-focus": "create-name",
        },
      });
      input.value = this.createDraft;
      input.disabled = this.pending;
      const commit = () => {
        this.createDraft = input.value;
        void this.commitCreate();
      };
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          this.creating = false;
          this.createDraft = "";
          this.focusKey = "add-value";
          this.redraw();
        }
      });
      input.addEventListener("change", commit);
    } else {
      const add = list.createEl("button", {
        type: "button",
        cls: "charinfo-attr-modal__add",
        text: "새 값 추가",
        attr: { "data-focus": "add-value" },
      });
      add.disabled = this.pending;
      add.addEventListener("click", () => {
        this.creating = true;
        this.createDraft = "";
        this.expandedId = "";
        this.colorOpen = false;
        this.confirmDelete = null;
        this.focusKey = "create-name";
        this.redraw();
      });
    }
  }

  private renderValueRow(list: HTMLElement, option: StatusDef): void {
    if (this.confirmDelete?.id === option.id) {
      const box = list.createDiv({ cls: "charinfo-attr-modal__confirm" });
      box.createDiv({
        text: `‘${option.label}’을 쓰는 카드가 모든 아카이브 합쳐 ${this.confirmDelete.library}장 있어요. 이 아카이브에는 ${this.confirmDelete.archive}장 있어요. 목록에서만 빠지고, 카드에 저장된 값은 그대로 남아요. 카드는 회색 ‘${option.id}’으로 보일 수 있어요.`,
      });
      const actions = box.createDiv({
        cls: "charinfo-attr-modal__confirm-actions",
      });
      const cancel = actions.createEl("button", { type: "button", text: "취소" });
      cancel.addEventListener("click", () => {
        this.confirmDelete = null;
        this.focusKey = `value-${option.id}`;
        this.redraw();
      });
      const del = actions.createEl("button", {
        type: "button",
        cls: "mod-warning",
        text: "목록에서 빼기",
      });
      del.disabled = this.pending;
      del.addEventListener("click", () => void this.deleteOption(option.id));
      return;
    }

    if (this.expandedId === option.id) {
      this.renderEditor(list, option);
      return;
    }

    const row = list.createEl("button", {
      type: "button",
      cls: "charinfo-attr-modal__row is-collapsed",
      attr: { "data-focus": `value-${option.id}` },
    });
    if (this.axisId !== "tags") {
      row.createSpan({
        cls: "charinfo-attr-modal__dot is-" + option.color,
      });
    }
    row.createSpan({ cls: "charinfo-attr-modal__row-label", text: option.label });
    row.disabled = this.pending;
    row.addEventListener("click", () => {
      this.expandedId = option.id;
      this.colorOpen = false;
      this.confirmDelete = null;
      this.creating = false;
      this.focusKey = `edit-${option.id}`;
      this.redraw();
    });
  }

  private renderEditor(list: HTMLElement, option: StatusDef): void {
    const row = list.createDiv({ cls: "charinfo-attr-modal__row is-open" });
    const input = row.createEl("input", {
      type: "text",
      cls: "charinfo-attr-modal__row-input",
      attr: { spellcheck: "false", "data-focus": `edit-${option.id}` },
    });
    input.value = option.label;
    input.disabled = this.pending;
    const commitLabel = () => {
      const label = input.value.trim() || option.id;
      const axisId = this.axisId;
      void this.run("이름", axisId, async () => {
        await this.plugin.commitSettings((s) => {
          this.patchOption(s, axisId, option.id, { label });
        });
      });
    };
    input.addEventListener("change", commitLabel);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitLabel();
      }
      if (event.key === "Escape") {
        this.expandedId = "";
        this.focusKey = `value-${option.id}`;
        this.redraw();
      }
    });

    if (this.axisId !== "tags") {
      const colorBtn = row.createEl("button", {
        type: "button",
        cls: "charinfo-attr-modal__mini",
        text: "색 바꾸기",
        attr: { "data-focus": `color-${option.id}` },
      });
      colorBtn.disabled = this.pending;
      colorBtn.addEventListener("click", () => {
        this.colorOpen = !this.colorOpen;
        this.focusKey = `color-${option.id}`;
        this.redraw();
      });
      if (this.colorOpen) {
        const swatches = row.createDiv({ cls: "charinfo-attr-modal__swatches" });
        for (const token of STATUS_COLOR_TOKENS) {
          const sw = swatches.createEl("button", {
            type: "button",
            cls:
              "charinfo-attr-modal__swatch is-" +
              token.id +
              (option.color === token.id ? " is-active" : ""),
            attr: {
              title: token.label,
              "aria-label": token.label,
              "aria-pressed": option.color === token.id ? "true" : "false",
            },
          });
          sw.disabled = this.pending;
          sw.addEventListener("click", () => {
            const axisId = this.axisId;
            void this.run("색", axisId, async () => {
              await this.plugin.commitSettings((s) => {
                this.patchOption(s, axisId, option.id, { color: token.id });
              });
            });
          });
        }
      }
    }

    const del = row.createEl("button", {
      type: "button",
      cls: "charinfo-attr-modal__mini is-danger",
      text: "목록에서 빼기",
    });
    del.disabled = this.pending;
    del.addEventListener("click", () => void this.requestDelete(option));
  }

  private renderDefaultFold(root: HTMLElement): void {
    const fold = root.createEl("button", {
      type: "button",
      cls: "charinfo-attr-modal__fold",
      text: `${this.defaultOpen ? "▾" : "▸"} 새 카드에 미리 넣을 상태`,
      attr: { "aria-expanded": this.defaultOpen ? "true" : "false" },
    });
    fold.addEventListener("click", () => {
      this.defaultOpen = !this.defaultOpen;
      this.redraw();
    });
    if (!this.defaultOpen) return;
    const chips = root.createDiv({ cls: "charinfo-attr-modal__chips" });
    const current = this.settings().defaultStatusId;
    for (const option of this.settings().statuses) {
      const btn = chips.createEl("button", {
        type: "button",
        cls: "charinfo-chip" + (option.id === current ? " is-active" : ""),
        text: option.label,
      });
      btn.disabled = this.pending;
      btn.addEventListener("click", () => {
        void this.run("기본값", "status", async () => {
          await this.plugin.commitSettings((s) => {
            s.defaultStatusId = option.id;
          });
        });
      });
    }
  }

  private renderLeftoverFold(root: HTMLElement): void {
    const leftovers = leftoverAxisIds(
      axisFor(this.settings(), this.axisId),
      this.ctx.records,
      this.ctx.archive,
    );
    if (leftovers.length === 0) return;
    const fold = root.createEl("button", {
      type: "button",
      cls: "charinfo-attr-modal__fold",
      text: `${this.leftoverOpen ? "▾" : "▸"} 이 아카이브에서 목록에 없는 값 · ${leftovers.length}개`,
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
      add.addEventListener("click", () => void this.adopt(id));
    }
  }

  private renderPageFilter(root: HTMLElement): void {
    root.createDiv({
      cls: "charinfo-attr-modal__hint",
      text: "이 페이지 맨 위 필터만 바뀝니다.",
    });
    const chips = root.createDiv({ cls: "charinfo-attr-modal__chips" });
    const usingDefault = this.ctx.pageAxis == null;
    const defBtn = chips.createEl("button", {
      type: "button",
      cls: "charinfo-chip" + (usingDefault ? " is-active" : ""),
      text: `기본 필터 따르기 (현재: ${this.displayName(this.ctx.globalAxis)})`,
      attr: { "data-focus": "page-default" },
    });
    defBtn.disabled = this.pending;
    defBtn.addEventListener("click", () => {
      void this.run("필터", this.ctx.globalAxis, async () => {
        await this.ctx.onPageAxis(null);
        this.ctx.pageAxis = null;
      });
    });
    for (const id of FILTER_AXIS_IDS) {
      const empty =
        id !== "status" && axisFor(this.settings(), id).options.length === 0;
      const wrap = chips.createDiv({ cls: "charinfo-attr-modal__axis-choice" });
      const btn = wrap.createEl("button", {
        type: "button",
        cls:
          "charinfo-chip" +
          (!usingDefault && this.ctx.pageAxis === id ? " is-active" : ""),
        text: this.displayName(id),
      });
      btn.disabled = this.pending || empty;
      if (empty) {
        wrap.createDiv({
          cls: "charinfo-attr-modal__hint",
          text: "고를 값이 없어요. 속성 목록에서 먼저 추가해 주세요.",
        });
        continue;
      }
      btn.addEventListener("click", () => {
        void this.run("필터", id, async () => {
          await this.ctx.onPageAxis(id);
          this.ctx.pageAxis = id;
        });
      });
    }
  }

  private retryBelongsHere(): boolean {
    if (!this.retry) return false;
    if (this.retry.action === "필터") return this.screen === "pageFilter";
    return this.screen === "property" && this.axisId === this.retry.axisId;
  }

  private paintSave(): void {
    const line = this.saveHost;
    if (!line) return;
    line.empty();
    line.removeClass("is-ok");
    line.removeClass("is-error");
    line.removeClass("is-empty");
    if (this.pending) {
      line.setText("저장 중…");
      return;
    }
    if (this.saveError && this.retryBelongsHere()) {
      line.addClass("is-error");
      line.createSpan({ text: this.saveError + " " });
      const retry = line.createEl("button", {
        type: "button",
        cls: "charinfo-attr-modal__retry",
        text: "다시 시도",
      });
      retry.addEventListener("click", () => {
        if (!this.retry) return;
        void this.run(this.retry.action, this.retry.axisId, this.retry.work);
      });
      return;
    }
    if (this.saveNote) {
      line.addClass("is-ok");
      line.setText(this.saveNote);
      return;
    }
    line.addClass("is-empty");
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
  ): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    this.saveError = "";
    this.retry = { axisId, action, work };
    this.paintSave();
    this.scheduleRedraw();
    try {
      await work();
      this.saveNote = "저장됨";
      this.saveError = "";
      this.retry = null;
      this.ctx.onChanged();
      window.clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => {
        this.saveTimer = 0;
        if (this.saveNote === "저장됨") {
          this.saveNote = "";
          if (this.modalEl.isConnected) this.paintSave();
        }
      }, 800);
    } catch (error) {
      this.saveError = "저장하지 못했어요.";
      new Notice(this.saveError);
      console.error(error);
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

  private async commitCreate(): Promise<void> {
    const label = this.createDraft.trim();
    if (!label) return;
    const axisId = this.axisId;
    const id = suggestStatusId(label, axisFor(this.settings(), axisId).options);
    const next: StatusDef = { id, label, color: "gray" };
    await this.run("추가", axisId, async () => {
      await this.plugin.commitSettings((s) => {
        this.pushOption(s, axisId, next);
      });
      this.creating = false;
      this.createDraft = "";
      this.expandedId = id;
      this.focusKey = `edit-${id}`;
    });
  }

  private async requestDelete(option: StatusDef): Promise<void> {
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
      this.confirmDelete = { id: option.id, library, archive };
      this.expandedId = "";
      this.redraw();
      return;
    }
    await this.deleteOption(option.id);
  }

  private async deleteOption(id: string): Promise<void> {
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
      this.expandedId = "";
    });
  }

  private async adopt(id: string): Promise<void> {
    const axisId = this.axisId;
    const next: StatusDef = { id, label: id, color: "gray" };
    await this.run("넣기", axisId, async () => {
      await this.plugin.commitSettings((s) => {
        this.pushOption(s, axisId, next);
      });
    });
  }
}
