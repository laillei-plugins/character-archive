import type { BatchDestinationRow } from "../data/batchGroupMove";

/**
 * 이동할 그룹 — the destination confirmation for a batch group move.
 *
 * Deliberately **not** an Obsidian `Modal`: this surface belongs to one gallery
 * leaf, it must vanish with that leaf, and it must have no X. `취소` and `이동`
 * are the whole commitment vocabulary, so a third dismissal affordance would be
 * a second exit for the same job (DESIGN.md §3 “One X”).
 *
 * The body has two states and the shell has one. `list` picks an existing
 * destination; `create` names a new group and moves the selection into it in the
 * same commitment. Only the scrollable body swaps — the header, the footer, and
 * the two footer actions are the same controls in both states, because it is the
 * same job. `그룹 목록으로` walks back inside the dialog; it is not an exit, and
 * Escape is still the one cancel authority.
 *
 * Ownership is narrow on purpose. The dialog knows its own DOM, its focus trap,
 * which destination is chosen or typed, and that a save is running. It does not
 * know the gallery's state machine, the vault, or the Notice — it only dispatches
 * `onCancel` / `onConfirm` / `onCreate` and waits.
 */

export interface BatchGroupMoveDialogOptions {
  /** Positioned gallery element the scrim and dialog mount into. */
  host: HTMLElement;
  /** Selected card count — the number every label counts. */
  selectedCount: number;
  rows: readonly BatchDestinationRow[];
  /** Re-open directly into the create state after a recoverable failed save. */
  initialCreateName?: string;
  /**
   * Obsidian's `setIcon`, injected rather than imported: this file must stay
   * runtime-import-free so `node --test` can drive the real dialog.
   */
  setIcon: (el: HTMLElement, icon: string) => void;
  /**
   * The canonical `groupAddProblem` verdict for a candidate name, already
   * localized by the caller. `null` means the name is legal. Duplicates of a
   * *visible destination* never reach here — the dialog can say something more
   * useful about a row the user can see (`createVerdict`).
   */
  validateNewGroup: (name: string) => string | null;
  onCancel: () => void;
  onConfirm: (destination: string) => void;
  /** Create the named group and move the selection into it, atomically. */
  onCreate: (name: string) => void;
}

/** Two galleries may hold a dialog at once; label ids must not collide. */
let batchDialogId = 0;

/** Which state the scrollable body is in. The shell never changes. */
type BatchDialogBodyMode = "list" | "create";

/** Same normalization every other group name path uses. */
function normalizeCreateName(raw: unknown): string {
  return String(raw ?? "").trim();
}

/** `disabled` without an `instanceof`, so an input and a button read alike. */
function isDisabled(el: HTMLElement): boolean {
  return (el as { disabled?: boolean }).disabled === true;
}

export class BatchGroupMoveDialog {
  private scrim: HTMLElement | null = null;
  private dialog: HTMLElement | null = null;
  /** The one scroll region, and the only thing a state swap replaces. */
  private body: HTMLElement | null = null;
  private confirmBtn: HTMLButtonElement | null = null;
  private cancelBtn: HTMLButtonElement | null = null;
  private createBtn: HTMLButtonElement | null = null;
  private backBtn: HTMLButtonElement | null = null;
  private input: HTMLInputElement | null = null;
  private errorEl: HTMLElement | null = null;
  private savingLayer: HTMLElement | null = null;
  private savingText: HTMLElement | null = null;
  private onKey: ((event: KeyboardEvent) => void) | null = null;
  private rowButtons: HTMLButtonElement[] = [];
  private mode: BatchDialogBodyMode = "list";
  /** Survives a walk back to the list, for this dialog's lifetime only. */
  private draft = "";
  private chosen = "";
  private saving = false;
  private closed = false;
  private restoreTarget: HTMLElement | null = null;
  private readonly uid = ++batchDialogId;
  private readonly opts: BatchGroupMoveDialogOptions;

  // Spelled out rather than a constructor parameter property: this file imports
  // nothing at runtime, so `node --test` can drive the real dialog against a
  // fake DOM — and Node's type stripping cannot rewrite a parameter property.
  constructor(opts: BatchGroupMoveDialogOptions) {
    this.opts = opts;
    if (opts.initialCreateName !== undefined) {
      this.mode = "create";
      this.draft = opts.initialCreateName;
    }
  }

  get isOpen(): boolean {
    return !this.closed && this.dialog != null;
  }

  open(): void {
    if (this.dialog) return;
    const active = document.activeElement;
    this.restoreTarget = active instanceof HTMLElement ? active : null;

    const host = this.opts.host;
    const scrim = host.createDiv({
      cls: "charinfo-batch-scrim",
      attr: { "aria-hidden": "true" },
    });
    this.scrim = scrim;
    scrim.addEventListener("click", () => {
      // Saving owns the surface: a stray backdrop click must not abandon a
      // transaction that is already writing notes.
      if (this.saving) return;
      this.cancel();
    });

    const titleId = `charinfo-batch-title-${this.uid}`;
    const descId = `charinfo-batch-desc-${this.uid}`;
    const dialog = host.createDiv({
      cls: "charinfo-batch-dialog",
      attr: {
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": titleId,
        "aria-describedby": descId,
      },
    });
    this.dialog = dialog;

    const head = dialog.createDiv({ cls: "charinfo-batch-dialog__head" });
    head.createSpan({
      cls: "charinfo-batch-dialog__title",
      text: "이동할 그룹",
      attr: { id: titleId },
    });
    head.createSpan({
      cls: "charinfo-batch-dialog__count",
      text: `${this.opts.selectedCount}명 선택`,
      attr: { id: descId },
    });

    // Built in DOM order — body between the fixed head and the fixed foot —
    // then filled, because filling it syncs the footer's primary action.
    this.body = dialog.createDiv({ cls: "charinfo-batch-dialog__body" });
    this.chosen = this.firstEligible();
    this.renderFoot(dialog);
    this.renderBody();

    this.savingLayer = dialog.createDiv({
      cls: "charinfo-batch-dialog__saving",
      attr: { "aria-hidden": "true" },
    });
    this.savingLayer.createDiv({
      cls: "charinfo-batch-dialog__spinner",
      attr: { "aria-hidden": "true" },
    });
    // Text is written when saving starts, so the live region actually announces.
    this.savingText = this.savingLayer.createSpan({
      cls: "charinfo-batch-dialog__saving-text",
      attr: { role: "status" },
    });

    // One document listener, removed in `close()`. Tab is trapped here rather
    // than on the dialog so focus dragged out by any means comes straight back.
    this.onKey = (event: KeyboardEvent) => this.handleKey(event);
    document.addEventListener("keydown", this.onKey, true);

    this.focusInitial();
  }

  /** Idempotent teardown. `restoreFocus` returns focus to the opener. */
  close(opts: { restoreFocus?: boolean } = {}): void {
    if (this.closed) return;
    this.closed = true;
    if (this.onKey) {
      document.removeEventListener("keydown", this.onKey, true);
      this.onKey = null;
    }
    this.scrim?.remove();
    this.dialog?.remove();
    this.scrim = null;
    this.dialog = null;
    this.body = null;
    this.confirmBtn = null;
    this.cancelBtn = null;
    this.createBtn = null;
    this.backBtn = null;
    this.input = null;
    this.errorEl = null;
    this.savingLayer = null;
    this.savingText = null;
    this.rowButtons = [];
    const restore = this.restoreTarget;
    this.restoreTarget = null;
    if (opts.restoreFocus && restore?.isConnected) restore.focus();
  }

  /**
   * Lock the dialog for the write transaction: no repeat submit, no cancel, no
   * destination change, no walk back, no edit of the name being created. Only
   * the storage layer can end this state.
   */
  beginSaving(): void {
    if (this.saving) return;
    this.saving = true;
    this.dialog?.addClass("is-saving");
    this.dialog?.setAttribute("aria-busy", "true");
    this.savingLayer?.removeAttribute("aria-hidden");
    this.savingText?.setText(`${this.opts.selectedCount}명의 그룹을 바꾸는 중…`);
    for (const button of this.rowButtons) button.disabled = true;
    if (this.createBtn) this.createBtn.disabled = true;
    if (this.backBtn) this.backBtn.disabled = true;
    if (this.input) this.input.disabled = true;
    if (this.cancelBtn) this.cancelBtn.disabled = true;
    if (this.confirmBtn) this.confirmBtn.disabled = true;
  }

  /** Cancel through the dialog's own affordances (footer, scrim, Escape). */
  cancel(): void {
    if (this.saving || this.closed) return;
    this.opts.onCancel();
  }

  /**
   * Surface a create failure the caller found *before* any write — the storage
   * layer revalidates the name it is about to persist, and its verdict belongs
   * next to the input, not in a Notice.
   */
  showCreateError(message: string): void {
    if (this.closed || this.mode !== "create") return;
    this.showError(message);
    this.input?.focus();
  }

  private firstEligible(): string {
    return this.opts.rows.find((row) => row.eligible)?.group ?? "";
  }

  /** Swap the body, then re-sync the footer action the new state drives. */
  private renderBody(): void {
    const body = this.body;
    if (!body) return;
    body.empty();
    this.rowButtons = [];
    this.createBtn = null;
    this.backBtn = null;
    this.input = null;
    this.errorEl = null;
    if (this.mode === "list") this.renderList(body);
    else this.renderCreate(body);
    this.syncConfirm();
  }

  private renderList(body: HTMLElement): void {
    const list = body.createDiv({
      cls: "charinfo-batch-dialog__list",
      attr: { role: "radiogroup", "aria-label": "이동할 그룹" },
    });
    const rows = this.opts.rows;
    // A choice made before a walk into the create state survives the walk back.
    if (!rows.some((row) => row.eligible && row.group === this.chosen)) {
      this.chosen = this.firstEligible();
    }

    for (const row of rows) {
      const button = list.createEl("button", {
        cls:
          "charinfo-batch-dialog__dest" +
          (row.group === this.chosen ? " is-chosen" : ""),
        attr: {
          type: "button",
          role: "radio",
          "aria-checked": row.group === this.chosen ? "true" : "false",
          tabindex: row.group === this.chosen ? "0" : "-1",
          "data-group": row.group,
        },
      });
      if (!row.eligible) button.disabled = true;
      button.createSpan({
        cls: "charinfo-batch-dialog__radio",
        attr: { "aria-hidden": "true" },
      });
      const text = button.createDiv({ cls: "charinfo-batch-dialog__dest-text" });
      text.createSpan({
        cls: "charinfo-batch-dialog__dest-name",
        text: row.group,
      });
      if (row.meta) {
        text.createSpan({
          cls: "charinfo-batch-dialog__dest-meta",
          text: row.meta,
        });
      }
      button.createSpan({
        cls: "charinfo-batch-dialog__dest-total",
        text: `${row.total}명`,
      });
      button.addEventListener("click", () => {
        if (this.saving) return;
        this.choose(row.group);
      });
      this.rowButtons.push(button);
    }

    this.renderCreateAction(body);
  }

  /**
   * 새 그룹 만들기 — after the radiogroup and deliberately outside it. It is
   * not a destination among destinations: it opens a different state, so giving
   * it radio semantics would put a door in a list of rooms. It is also the
   * reason there is no dead-end notice left to write: an archive with no groups,
   * and one where every group is already full of the selection, both still have
   * exactly this way forward.
   */
  private renderCreateAction(body: HTMLElement): void {
    const button = body.createEl("button", {
      cls: "charinfo-batch-dialog__create",
      attr: { type: "button" },
    });
    const icon = button.createSpan({
      cls: "charinfo-batch-dialog__create-icon",
      attr: { "aria-hidden": "true" },
    });
    this.opts.setIcon(icon, "plus");
    const text = button.createDiv({ cls: "charinfo-batch-dialog__create-text" });
    text.createSpan({
      cls: "charinfo-batch-dialog__create-name",
      text: "새 그룹 만들기",
    });
    text.createSpan({
      cls: "charinfo-batch-dialog__create-meta",
      text: "이름을 정하고 바로 옮겨요",
    });
    const chevron = button.createSpan({
      cls: "charinfo-batch-dialog__create-chevron",
      attr: { "aria-hidden": "true" },
    });
    this.opts.setIcon(chevron, "chevron-right");
    button.addEventListener("click", () => {
      if (this.saving) return;
      this.enterCreate();
    });
    this.createBtn = button;
  }

  private renderCreate(body: HTMLElement): void {
    const back = body.createEl("button", {
      cls: "charinfo-batch-dialog__back",
      attr: { type: "button" },
    });
    const arrow = back.createSpan({
      cls: "charinfo-batch-dialog__back-icon",
      attr: { "aria-hidden": "true" },
    });
    this.opts.setIcon(arrow, "arrow-left");
    back.createSpan({
      cls: "charinfo-batch-dialog__back-label",
      text: "그룹 목록으로",
    });
    back.addEventListener("click", () => {
      if (this.saving) return;
      this.exitCreate();
    });
    this.backBtn = back;

    const form = body.createDiv({ cls: "charinfo-batch-dialog__form" });
    const inputId = `charinfo-batch-new-${this.uid}`;
    const hintId = `charinfo-batch-new-hint-${this.uid}`;
    const errorId = `charinfo-batch-new-error-${this.uid}`;
    form.createEl("label", {
      cls: "charinfo-batch-dialog__label",
      text: "새 그룹 이름",
      attr: { for: inputId },
    });
    this.input = form.createEl("input", {
      cls: "charinfo-batch-dialog__input",
      attr: {
        id: inputId,
        type: "text",
        value: this.draft,
        placeholder: "예: 조연",
        spellcheck: "false",
        "aria-describedby": `${hintId} ${errorId}`,
      },
    });
    form.createDiv({
      cls: "charinfo-batch-dialog__hint",
      text: `새 그룹을 만들고 선택한 ${this.opts.selectedCount}명을 바로 옮겨요.`,
      attr: { id: hintId },
    });
    this.errorEl = form.createDiv({
      cls: "charinfo-batch-dialog__error",
      attr: { id: errorId, role: "alert" },
    });
    this.input.addEventListener("input", () => {
      if (this.saving) return;
      this.draft = this.input?.value ?? "";
      this.syncConfirm();
    });
  }

  private renderFoot(dialog: HTMLElement): void {
    const foot = dialog.createDiv({ cls: "charinfo-batch-dialog__foot" });
    this.cancelBtn = foot.createEl("button", {
      cls: "charinfo-text-btn charinfo-batch-dialog__cancel",
      text: "취소",
      attr: { type: "button" },
    });
    this.cancelBtn.addEventListener("click", () => this.cancel());

    this.confirmBtn = foot.createEl("button", {
      cls: "charinfo-text-btn mod-cta charinfo-batch-dialog__confirm",
      text: `${this.opts.selectedCount}명 옮기기`,
      attr: { type: "button" },
    });
    // Repeat-submit lock lives in `submit`: the click is spent the moment
    // saving starts, and `beginSaving` also disables the button.
    this.confirmBtn.addEventListener("click", () => this.submit());
  }

  private enterCreate(): void {
    if (this.mode === "create") return;
    this.mode = "create";
    this.renderBody();
    this.input?.focus();
  }

  private exitCreate(): void {
    if (this.mode === "list") return;
    this.draft = this.input?.value ?? this.draft;
    this.mode = "list";
    this.renderBody();
    this.createBtn?.focus();
  }

  private choose(group: string): void {
    this.chosen = group;
    for (const button of this.rowButtons) {
      const isChosen = button.dataset.group === group;
      button.toggleClass("is-chosen", isChosen);
      button.setAttribute("aria-checked", isChosen ? "true" : "false");
      button.setAttribute("tabindex", isChosen ? "0" : "-1");
    }
    this.syncConfirm();
  }

  /** The typed name, live from the input when the create state is mounted. */
  private draftName(): string {
    return normalizeCreateName(this.input?.value ?? this.draft);
  }

  /**
   * Whether the typed name may be created, and what to say when it may not.
   *
   * The two duplicate cases are answered here rather than by `groupAddProblem`'s
   * one generic line, because the user can *see* the row they collided with: an
   * eligible one is a redirect to the list, and a full-overlap one is the same
   * dead end they were trying to escape.
   */
  private createVerdict(): { ok: boolean; message: string } {
    const name = this.draftName();
    // Empty is not an error yet — there has been nothing to get wrong.
    if (!name) return { ok: false, message: "" };
    const row = this.opts.rows.find((entry) => entry.group === name);
    if (row) {
      return {
        ok: false,
        message: row.eligible
          ? "이미 있는 그룹이에요. 그룹 목록에서 선택해 주세요."
          : `선택한 캐릭터가 이미 모두 ‘${name}’ 그룹에 있어요. 다른 이름을 입력해 주세요.`,
      };
    }
    const problem = this.opts.validateNewGroup(name);
    return problem
      ? { ok: false, message: problem }
      : { ok: true, message: "" };
  }

  /** The footer's primary action is the current state's primary action. */
  private syncConfirm(): void {
    const confirm = this.confirmBtn;
    if (!confirm) return;
    if (this.mode === "list") {
      confirm.setText(`${this.opts.selectedCount}명 옮기기`);
      confirm.disabled = this.saving || !this.chosen;
      return;
    }
    confirm.setText(`만들고 ${this.opts.selectedCount}명 옮기기`);
    const verdict = this.createVerdict();
    confirm.disabled = this.saving || !verdict.ok;
    this.showError(verdict.message);
  }

  private showError(message: string): void {
    this.errorEl?.setText(message);
    if (!this.input) return;
    if (message) this.input.setAttribute("aria-invalid", "true");
    else this.input.removeAttribute("aria-invalid");
  }

  private submit(): void {
    if (this.saving || this.closed) return;
    if (this.mode === "list") {
      if (!this.chosen) return;
      this.opts.onConfirm(this.chosen);
      return;
    }
    const verdict = this.createVerdict();
    if (!verdict.ok) {
      this.showError(verdict.message);
      return;
    }
    this.opts.onCreate(this.draftName());
  }

  private focusInitial(): void {
    if (this.mode === "create") {
      this.input?.focus();
      return;
    }
    const chosen = this.rowButtons.find(
      (button) => button.dataset.group === this.chosen && !button.disabled,
    );
    // With nothing eligible the create action is the only way forward, so
    // landing on 취소 would say the opposite of what the body now offers.
    (chosen ?? this.createBtn ?? this.cancelBtn)?.focus();
  }

  /** Elements Tab may land on: the body's own stops, then the footer. */
  private tabbable(): HTMLElement[] {
    const dialog = this.dialog;
    if (!dialog) return [];
    return Array.from(
      dialog.querySelectorAll<HTMLElement>("button, input, [tabindex]"),
    ).filter(
      (el) => !isDisabled(el) && el.getAttribute("tabindex") !== "-1",
    );
  }

  private handleKey(event: KeyboardEvent): void {
    if (this.closed || !this.dialog) return;
    if (event.key === "Escape") {
      // Escape order belongs to GalleryView; the dialog only refuses to react
      // while saving so the view's `consume` branch is the single authority.
      // It is never a walk back to the list — one key, one cancel authority.
      return;
    }
    if (this.saving) {
      if (event.key === "Tab") event.preventDefault();
      return;
    }
    if (
      event.key === "Enter" &&
      this.mode === "create" &&
      document.activeElement === this.input
    ) {
      event.preventDefault();
      // Enter *is* the primary action, so it is gated by the same disabled bit.
      if (this.confirmBtn && !this.confirmBtn.disabled) this.submit();
      return;
    }
    if (event.key === "Tab") {
      const focusable = this.tabbable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !this.dialog.contains(active)) {
        event.preventDefault();
        first?.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last?.focus();
        return;
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
      return;
    }
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !this.dialog.contains(active)) {
      return;
    }
    // Arrow navigation is the radiogroup's alone: the create action is not a
    // radio, and the create state has no radios at all.
    if (!active.classList.contains("charinfo-batch-dialog__dest")) return;
    const step =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : 0;
    if (step === 0) return;
    const eligible = this.rowButtons.filter((button) => !button.disabled);
    if (eligible.length === 0) return;
    const at = eligible.indexOf(active as HTMLButtonElement);
    const next =
      eligible[(at + step + eligible.length) % eligible.length] ?? eligible[0];
    if (!next) return;
    event.preventDefault();
    this.choose(next.dataset.group ?? "");
    next.focus();
  }
}
