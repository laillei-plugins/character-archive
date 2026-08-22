import { App, Modal } from "obsidian";
import {
  characterNameProblem,
  characterNameProblemMessage,
  normalizeCharacterName,
} from "../data/characterName";

let characterNameInputId = 0;

export interface CharacterNameModalOptions {
  title: string;
  initialName?: string;
  submitText: string;
  savingText: string;
  /** Return an error to keep the modal open; `null` closes it. */
  onSubmit: (name: string) => Promise<string | null>;
  onClose?: () => void;
}

/** One native close button, one name field, and one primary action. */
export class CharacterNameModal extends Modal {
  private input: HTMLInputElement | null = null;
  private errorEl: HTMLElement | null = null;
  private submitBtn: HTMLButtonElement | null = null;
  private saving = false;

  constructor(
    app: App,
    private readonly opts: CharacterNameModalOptions,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("charinfo-character-name-modal");
    this.contentEl.empty();
    this.setTitle(this.opts.title);

    characterNameInputId += 1;
    const inputId = `charinfo-character-name-${characterNameInputId}`;
    const errorId = `${inputId}-error`;
    const body = this.contentEl.createDiv({
      cls: "charinfo-character-name-modal__body",
    });
    body.createEl("label", {
      cls: "charinfo-character-name-modal__label",
      text: "이름",
      attr: { for: inputId },
    });
    this.input = body.createEl("input", {
      type: "text",
      cls: "charinfo-character-name-modal__input",
      attr: {
        id: inputId,
        value: this.opts.initialName ?? "",
        placeholder: "캐릭터 이름",
        spellcheck: "false",
        "aria-describedby": errorId,
      },
    });
    this.errorEl = body.createDiv({
      cls: "charinfo-character-name-modal__error",
      attr: { id: errorId, role: "alert" },
    });

    const foot = this.contentEl.createDiv({
      cls: "charinfo-character-name-modal__foot",
    });
    this.submitBtn = foot.createEl("button", {
      cls: "mod-cta",
      text: this.opts.submitText,
      attr: { type: "button" },
    });
    this.submitBtn.addEventListener("click", () => void this.submit());
    this.input.addEventListener("input", () => {
      this.clearProblem();
      this.syncSubmit();
    });
    this.input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      void this.submit();
    });

    this.syncSubmit();
    window.setTimeout(() => {
      this.input?.focus();
      this.input?.select();
    }, 0);
  }

  onClose(): void {
    this.saving = false;
    this.input = null;
    this.errorEl = null;
    this.submitBtn = null;
    this.contentEl.empty();
    this.modalEl.removeClass("charinfo-character-name-modal");
    this.opts.onClose?.();
  }

  private syncSubmit(): void {
    if (!this.submitBtn) return;
    this.submitBtn.disabled =
      this.saving || Boolean(characterNameProblem(this.input?.value ?? ""));
  }

  private clearProblem(): void {
    this.errorEl?.setText("");
    this.input?.removeAttribute("aria-invalid");
  }

  private showProblem(message: string): void {
    this.errorEl?.setText(message);
    this.input?.setAttribute("aria-invalid", "true");
    this.input?.focus();
    this.input?.select();
  }

  private async submit(): Promise<void> {
    if (this.saving || !this.input) return;
    const name = normalizeCharacterName(this.input.value);
    const problem = characterNameProblem(name);
    if (problem) {
      this.showProblem(characterNameProblemMessage(problem));
      return;
    }

    this.saving = true;
    this.input.disabled = true;
    if (this.submitBtn) {
      this.submitBtn.disabled = true;
      this.submitBtn.setText(this.opts.savingText);
    }
    let error: string | null;
    try {
      error = await this.opts.onSubmit(name);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    if (!error) {
      this.close();
      return;
    }

    this.saving = false;
    this.input.disabled = false;
    if (this.submitBtn) this.submitBtn.setText(this.opts.submitText);
    this.syncSubmit();
    this.showProblem(error);
  }
}

export function promptCharacterName(
  app: App,
  opts: Omit<CharacterNameModalOptions, "onSubmit" | "onClose">,
): Promise<string | null> {
  return new Promise((resolve) => {
    let submitted: string | null = null;
    new CharacterNameModal(app, {
      ...opts,
      onSubmit: async (name) => {
        submitted = name;
        return null;
      },
      onClose: () => resolve(submitted),
    }).open();
  });
}
