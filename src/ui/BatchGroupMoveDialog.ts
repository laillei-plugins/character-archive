import type { BatchDestinationRow } from "../data/batchGroupMove";

/**
 * 이동할 그룹 — the destination confirmation for a batch group move.
 *
 * Deliberately **not** an Obsidian `Modal`: this surface belongs to one gallery
 * leaf, it must vanish with that leaf, and it must have no X. `취소` and `이동`
 * are the whole commitment vocabulary, so a third dismissal affordance would be
 * a second exit for the same job (DESIGN.md §3 “One X”).
 *
 * Ownership is narrow on purpose. The dialog knows its own DOM, its focus trap,
 * which destination is chosen, and that a save is running. It does not know the
 * gallery's state machine, the vault, or the Notice — it only dispatches
 * `onCancel` / `onConfirm` and waits.
 */

export interface BatchGroupMoveDialogOptions {
  /** Positioned gallery element the scrim and dialog mount into. */
  host: HTMLElement;
  /** Selected card count — the number every label counts. */
  selectedCount: number;
  rows: readonly BatchDestinationRow[];
  onCancel: () => void;
  onConfirm: (destination: string) => void;
}

/** Two galleries may hold a dialog at once; label ids must not collide. */
let batchDialogId = 0;

export class BatchGroupMoveDialog {
  private scrim: HTMLElement | null = null;
  private dialog: HTMLElement | null = null;
  private confirmBtn: HTMLButtonElement | null = null;
  private cancelBtn: HTMLButtonElement | null = null;
  private savingLayer: HTMLElement | null = null;
  private savingText: HTMLElement | null = null;
  private onKey: ((event: KeyboardEvent) => void) | null = null;
  private rowButtons: HTMLButtonElement[] = [];
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

    this.renderRows(dialog);
    this.renderFoot(dialog);

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
    this.confirmBtn = null;
    this.cancelBtn = null;
    this.savingLayer = null;
    this.savingText = null;
    this.rowButtons = [];
    const restore = this.restoreTarget;
    this.restoreTarget = null;
    if (opts.restoreFocus && restore?.isConnected) restore.focus();
  }

  /**
   * Lock the dialog for the write transaction: no repeat submit, no cancel, no
   * destination change. Only the storage layer can end this state.
   */
  beginSaving(): void {
    if (this.saving) return;
    this.saving = true;
    this.dialog?.addClass("is-saving");
    this.dialog?.setAttribute("aria-busy", "true");
    this.savingLayer?.removeAttribute("aria-hidden");
    this.savingText?.setText(`${this.opts.selectedCount}명의 그룹을 바꾸는 중…`);
    for (const button of this.rowButtons) button.disabled = true;
    if (this.cancelBtn) this.cancelBtn.disabled = true;
    if (this.confirmBtn) this.confirmBtn.disabled = true;
  }

  /** Cancel through the dialog's own affordances (footer, scrim, Escape). */
  cancel(): void {
    if (this.saving || this.closed) return;
    this.opts.onCancel();
  }

  private renderRows(dialog: HTMLElement): void {
    const list = dialog.createDiv({
      cls: "charinfo-batch-dialog__list",
      attr: { role: "radiogroup", "aria-label": "이동할 그룹" },
    });
    const rows = this.opts.rows;
    if (rows.length === 0) {
      // Kept out of the radiogroup: a note is not a radio.
      dialog.createDiv({
        cls: "charinfo-batch-dialog__empty",
        text: "이 아카이브에는 옮길 그룹이 없어요.",
      });
      return;
    }
    const firstEligible = rows.find((row) => row.eligible)?.group ?? "";
    this.chosen = firstEligible;

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

    if (!firstEligible) {
      dialog.createDiv({
        cls: "charinfo-batch-dialog__empty",
        text: "선택한 캐릭터가 이미 모든 그룹에 있어요.",
      });
    }
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
    this.confirmBtn.disabled = !this.chosen;
    this.confirmBtn.addEventListener("click", () => {
      // Repeat-submit lock: the click is spent the moment saving starts, and
      // `beginSaving` also disables the button.
      if (this.saving || this.closed || !this.chosen) return;
      this.opts.onConfirm(this.chosen);
    });
  }

  private choose(group: string): void {
    this.chosen = group;
    for (const button of this.rowButtons) {
      const isChosen = button.dataset.group === group;
      button.toggleClass("is-chosen", isChosen);
      button.setAttribute("aria-checked", isChosen ? "true" : "false");
      button.setAttribute("tabindex", isChosen ? "0" : "-1");
    }
    if (this.confirmBtn) this.confirmBtn.disabled = !group;
  }

  private focusInitial(): void {
    const chosen = this.rowButtons.find(
      (button) => button.dataset.group === this.chosen && !button.disabled,
    );
    (chosen ?? this.cancelBtn)?.focus();
  }

  /** Elements Tab may land on: the chosen radio, then the footer. */
  private tabbable(): HTMLElement[] {
    const dialog = this.dialog;
    if (!dialog) return [];
    return Array.from(
      dialog.querySelectorAll<HTMLElement>("button, [tabindex]"),
    ).filter(
      (el) =>
        !(el instanceof HTMLButtonElement && el.disabled) &&
        el.getAttribute("tabindex") !== "-1",
    );
  }

  private handleKey(event: KeyboardEvent): void {
    if (this.closed || !this.dialog) return;
    if (event.key === "Escape") {
      // Escape order belongs to GalleryView; the dialog only refuses to react
      // while saving so the view's `consume` branch is the single authority.
      return;
    }
    if (this.saving) {
      if (event.key === "Tab") event.preventDefault();
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
