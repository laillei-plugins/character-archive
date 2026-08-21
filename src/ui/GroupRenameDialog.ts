import {
  groupRenameErrorMessage,
  groupRenameProblem,
  normalizeRenameInput,
  type GroupRenameProblem,
} from "../data/groupRename";

export interface GroupRenameDialogOptions {
  host: HTMLElement;
  group: string;
  existing: readonly string[];
  onCancel: () => void;
  onSubmit: (next: string) => void;
}

let groupRenameDialogId = 0;

/** Leaf-owned subgroup rename surface: one title, no injected close button. */
export class GroupRenameDialog {
  private scrim: HTMLElement | null = null;
  private dialog: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private cancelBtn: HTMLButtonElement | null = null;
  private submitBtn: HTMLButtonElement | null = null;
  private errorEl: HTMLElement | null = null;
  private savingLayer: HTMLElement | null = null;
  private savingText: HTMLElement | null = null;
  private onKey: ((event: KeyboardEvent) => void) | null = null;
  private saving = false;
  private closed = false;
  private restoreTarget: HTMLElement | null = null;
  private readonly uid = ++groupRenameDialogId;
  private readonly opts: GroupRenameDialogOptions;

  constructor(opts: GroupRenameDialogOptions) {
    this.opts = opts;
  }

  get isOpen(): boolean {
    return !this.closed && this.dialog != null;
  }

  open(): void {
    if (this.dialog) return;
    const active = document.activeElement;
    this.restoreTarget = active instanceof HTMLElement ? active : null;

    this.scrim = this.opts.host.createDiv({
      cls: "charinfo-batch-scrim charinfo-group-rename-scrim",
      attr: { "aria-hidden": "true" },
    });
    this.scrim.addEventListener("click", () => this.cancel());

    const titleId = `charinfo-group-rename-title-${this.uid}`;
    const inputId = `charinfo-group-rename-input-${this.uid}`;
    const errorId = `charinfo-group-rename-error-${this.uid}`;
    this.dialog = this.opts.host.createDiv({
      cls: "charinfo-batch-dialog charinfo-group-rename-dialog",
      attr: {
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": titleId,
      },
    });
    const head = this.dialog.createDiv({ cls: "charinfo-batch-dialog__head" });
    head.createSpan({
      cls: "charinfo-batch-dialog__title",
      text: "그룹 이름 바꾸기",
      attr: { id: titleId },
    });

    const body = this.dialog.createDiv({ cls: "charinfo-group-rename-dialog__body" });
    body.createEl("label", {
      cls: "charinfo-group-rename-dialog__label",
      text: "새 그룹 이름",
      attr: { for: inputId },
    });
    this.input = body.createEl("input", {
      type: "text",
      cls: "charinfo-group-rename-dialog__input",
      attr: {
        id: inputId,
        value: this.opts.group,
        spellcheck: "false",
        "aria-describedby": errorId,
      },
    });
    this.errorEl = body.createDiv({
      cls: "charinfo-group-rename-dialog__error",
      attr: { id: errorId, role: "alert" },
    });
    this.input.addEventListener("input", () => {
      this.clearProblem();
      this.syncSubmit();
    });

    const foot = this.dialog.createDiv({ cls: "charinfo-batch-dialog__foot" });
    this.cancelBtn = foot.createEl("button", {
      cls: "charinfo-text-btn charinfo-batch-dialog__cancel",
      text: "취소",
      attr: { type: "button" },
    });
    this.cancelBtn.addEventListener("click", () => this.cancel());
    this.submitBtn = foot.createEl("button", {
      cls: "charinfo-text-btn mod-cta charinfo-batch-dialog__confirm",
      text: "이름 바꾸기",
      attr: { type: "button" },
    });
    this.submitBtn.addEventListener("click", () => this.submit());

    this.savingLayer = this.dialog.createDiv({
      cls: "charinfo-batch-dialog__saving",
      attr: { "aria-hidden": "true" },
    });
    this.savingLayer.createDiv({
      cls: "charinfo-batch-dialog__spinner",
      attr: { "aria-hidden": "true" },
    });
    this.savingText = this.savingLayer.createSpan({
      cls: "charinfo-batch-dialog__saving-text",
      attr: { role: "status" },
    });

    this.onKey = (event) => this.handleKey(event);
    document.addEventListener("keydown", this.onKey, true);
    this.syncSubmit();
    this.input.focus();
    this.input.select();
  }

  close(opts: { restoreFocus?: boolean } = {}): void {
    if (this.closed) return;
    this.closed = true;
    if (this.onKey) document.removeEventListener("keydown", this.onKey, true);
    this.onKey = null;
    this.scrim?.remove();
    this.dialog?.remove();
    this.scrim = null;
    this.dialog = null;
    const restore = this.restoreTarget;
    this.restoreTarget = null;
    if (
      opts.restoreFocus &&
      restore?.isConnected &&
      !(restore instanceof HTMLButtonElement && restore.disabled) &&
      !restore.closest("[inert]")
    ) {
      restore.focus();
    }
  }

  beginSaving(): void {
    if (this.saving) return;
    this.saving = true;
    this.dialog?.addClass("is-saving");
    this.dialog?.setAttribute("aria-busy", "true");
    this.savingLayer?.removeAttribute("aria-hidden");
    this.savingText?.setText("그룹 이름을 바꾸는 중…");
    if (this.input) this.input.disabled = true;
    if (this.cancelBtn) this.cancelBtn.disabled = true;
    if (this.submitBtn) this.submitBtn.disabled = true;
  }

  endSaving(): void {
    this.saving = false;
    this.dialog?.removeClass("is-saving");
    this.dialog?.removeAttribute("aria-busy");
    this.savingLayer?.setAttribute("aria-hidden", "true");
    if (this.input) this.input.disabled = false;
    if (this.cancelBtn) this.cancelBtn.disabled = false;
    this.syncSubmit();
  }

  showProblem(problem: GroupRenameProblem): void {
    this.endSaving();
    this.errorEl?.setText(groupRenameErrorMessage(problem));
    this.input?.setAttribute("aria-invalid", "true");
    this.input?.focus();
    this.input?.select();
  }

  cancel(): void {
    if (this.saving || this.closed) return;
    this.opts.onCancel();
  }

  private clearProblem(): void {
    this.errorEl?.setText("");
    this.input?.removeAttribute("aria-invalid");
  }

  private syncSubmit(): void {
    if (!this.submitBtn) return;
    this.submitBtn.disabled = this.saving || !normalizeRenameInput(this.input?.value ?? "");
  }

  private submit(): void {
    if (this.saving || this.closed) return;
    const next = normalizeRenameInput(this.input?.value ?? "");
    const problem = groupRenameProblem({
      from: this.opts.group,
      to: next,
      existing: this.opts.existing,
    });
    if (problem) {
      this.showProblem(problem);
      return;
    }
    this.opts.onSubmit(next);
  }

  private tabbable(): HTMLElement[] {
    if (!this.dialog) return [];
    return Array.from(this.dialog.querySelectorAll<HTMLElement>("input, button"))
      .filter((el) => !(el instanceof HTMLButtonElement && el.disabled) && !(el instanceof HTMLInputElement && el.disabled));
  }

  private handleKey(event: KeyboardEvent): void {
    if (this.closed || !this.dialog) return;
    if (event.key === "Escape") return;
    if (this.saving) {
      if (event.key === "Tab") event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.key === "Enter" && active === this.input) {
      event.preventDefault();
      this.submit();
      return;
    }
    if (event.key !== "Tab") return;
    const items = this.tabbable();
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (!(active instanceof HTMLElement) || !this.dialog.contains(active)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
