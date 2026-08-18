import { App, Modal, Notice } from "obsidian";

/**
 * Rename an archive label across matching character notes
 * (frontmatter `장르` field).
 */
export class RenameGenreModal extends Modal {
  private from: string;
  private onSubmit: (to: string) => void | Promise<void>;
  private next = "";
  private inputEl: HTMLInputElement | null = null;

  constructor(
    app: App,
    from: string,
    onSubmit: (to: string) => void | Promise<void>,
  ) {
    super(app);
    this.from = from;
    this.next = from;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("charinfo-rename-modal");
    this.modalEl.addClass("charinfo-rename-modal-shell");
    this.setTitle("아카이브 이름");

    contentEl.createDiv({
      cls: "charinfo-rename-modal__lead",
      text: "원하는 아카이브 이름으로 바꿀 수 있어요.",
    });

    const field = contentEl.createDiv({ cls: "charinfo-rename-modal__field" });
    field.createDiv({
      cls: "charinfo-rename-modal__label",
      text: "새 이름",
    });
    this.inputEl = field.createEl("input", {
      type: "text",
      cls: "charinfo-rename-modal__input",
      attr: { value: this.from, spellcheck: "false" },
    });
    this.inputEl.select();
    this.inputEl.addEventListener("input", () => {
      this.next = this.inputEl?.value.trim() ?? "";
    });
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.submit();
      }
    });

    const cta = contentEl.createEl("button", {
      cls: "mod-cta charinfo-rename-modal__cta",
      text: "바꾸기",
      attr: { type: "button" },
    });
    cta.addEventListener("click", () => void this.submit());
  }

  onClose(): void {
    this.contentEl.empty();
    this.modalEl.removeClass("charinfo-rename-modal-shell");
  }

  private async submit(): Promise<void> {
    const to = this.next.trim();
    if (!to) {
      new Notice("아카이브 이름을 입력하세요.");
      this.inputEl?.focus();
      return;
    }
    if (to === this.from) {
      this.close();
      return;
    }
    this.close();
    await this.onSubmit(to);
  }
}
