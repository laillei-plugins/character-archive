import {
  App,
  Modal,
  Notice,
  TFile,
  normalizePath,
  setIcon,
} from "obsidian";
import type CharinfoPlugin from "../main";
import type { CharacterRecord } from "../data/CharacterStore";
import {
  type CoverRef,
  coverDisplaySrc,
  coverRefKey,
  isImagePath,
  isRemoteCoverUrl,
} from "../data/images";
import {
  isImgurPluginAvailable,
  uploadFileViaImgurPlugin,
} from "../media/imgurAdapter";

export type CoverPickResult =
  | { kind: "vault"; file: TFile }
  | { kind: "remote"; url: string }
  | { kind: "default" }
  | { kind: "none" };

const MAX_REMOTE_BYTES = 8_000_000;

/**
 * Cover set-now modal — pick / add / reset.
 * Reposition stays on the card (drag), not here.
 */
export class CoverPickerModal extends Modal {
  private images: CoverRef[];
  private onPick: (result: CoverPickResult) => void | Promise<void>;
  private plugin: CharinfoPlugin;
  private record: CharacterRecord;
  private currentCover: CoverRef | null;
  private busy = false;
  private statusEl: HTMLElement | null = null;
  private linkInput: HTMLInputElement | null = null;
  private linkPanel: HTMLElement | null = null;
  private opToken = 0;

  constructor(
    app: App,
    plugin: CharinfoPlugin,
    record: CharacterRecord,
    images: CoverRef[],
    currentCover: CoverRef | null,
    onPick: (result: CoverPickResult) => void | Promise<void>,
  ) {
    super(app);
    this.plugin = plugin;
    this.record = record;
    this.images = images;
    this.currentCover = currentCover;
    this.onPick = onPick;
  }

  onOpen(): void {
    this.modalEl.addClass("charinfo-cover-modal");
    this.setTitle("커버");

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("charinfo-cover-picker");

    // —— 1. Current (read-only preview; pan on the card) ——
    const current = contentEl.createDiv({ cls: "charinfo-cover-picker__current" });
    const coverRef = this.currentCover;
    if (coverRef) {
      const frame = current.createDiv({
        cls: "charinfo-cover-picker__current-frame",
      });
      const img = frame.createEl("img", {
        cls: "charinfo-cover-picker__current-img",
        attr: {
          src: coverDisplaySrc(this.app, coverRef),
          alt: "현재 커버",
          draggable: "false",
        },
      });
      img.style.objectPosition = this.record.coverPosition || "50% 50%";
      current.createDiv({
        cls: "charinfo-cover-picker__current-cap",
        text: "현재 · 위치는 카드에서 드래그",
      });
    } else {
      current.createDiv({
        cls: "charinfo-cover-picker__current-empty",
        text: "커버 없음",
      });
    }

    this.statusEl = contentEl.createDiv({ cls: "charinfo-cover-picker__status" });
    // Destination (vault / Imgur) lives in Settings — keep picker chrome quiet.

    // —— 2. Pick existing (primary) ——
    const pick = contentEl.createDiv({ cls: "charinfo-cover-picker__block" });
    pick.createDiv({
      cls: "charinfo-cover-picker__block-title",
      text: "고르기",
    });
    if (this.images.length === 0) {
      pick.createDiv({
        cls: "charinfo-cover-picker__empty",
        text: "이 캐릭터 이미지가 없어요. 아래에서 추가하세요.",
      });
    } else {
      const grid = pick.createDiv({ cls: "charinfo-cover-picker__grid" });
      for (const image of this.images) {
        const label = this.coverLabel(image);
        const isCurrent =
          coverRef != null && coverRefKey(coverRef) === coverRefKey(image);
        const cell = grid.createEl("button", {
          cls:
            "charinfo-cover-picker__cell" + (isCurrent ? " is-current" : ""),
          attr: {
            type: "button",
            title: label,
            "aria-label": isCurrent
              ? `${label} (현재)`
              : label,
          },
        });
        cell.createEl("img", {
          attr: {
            src: coverDisplaySrc(this.app, image),
            alt: label,
            loading: "lazy",
          },
        });
        if (isCurrent) {
          cell.createSpan({
            cls: "charinfo-cover-picker__badge",
            text: "현재",
          });
        }
        cell.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          void this.commit(
            image.kind === "vault"
              ? { kind: "vault", file: image.file }
              : { kind: "remote", url: image.url },
          );
        });
      }
    }

    // —— 3. Add (secondary, equal file | link) ——
    const add = contentEl.createDiv({ cls: "charinfo-cover-picker__block" });
    add.createDiv({
      cls: "charinfo-cover-picker__block-title",
      text: "추가",
    });
    const actions = add.createDiv({ cls: "charinfo-cover-picker__actions" });

    const fileBtn = actions.createEl("button", {
      cls: "charinfo-cover-picker__action",
      attr: { type: "button" },
    });
    const fileIcon = fileBtn.createSpan({
      cls: "charinfo-cover-picker__action-icon",
    });
    setIcon(fileIcon, "upload");
    const fileText = fileBtn.createDiv({
      cls: "charinfo-cover-picker__action-text",
    });
    fileText.createDiv({
      cls: "charinfo-cover-picker__action-label",
      text: "파일",
    });
    fileBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.busy) return;
      this.pickLocalFile();
    });

    const linkBtn = actions.createEl("button", {
      cls: "charinfo-cover-picker__action",
      attr: { type: "button" },
    });
    const linkIcon = linkBtn.createSpan({
      cls: "charinfo-cover-picker__action-icon",
    });
    setIcon(linkIcon, "link");
    const linkText = linkBtn.createDiv({
      cls: "charinfo-cover-picker__action-text",
    });
    linkText.createDiv({
      cls: "charinfo-cover-picker__action-label",
      text: "링크",
    });
    linkBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.busy) return;
      this.showLinkPanel();
    });

    this.linkPanel = add.createDiv({
      cls: "charinfo-cover-picker__link-panel is-hidden",
    });
    this.linkInput = this.linkPanel.createEl("input", {
      type: "text",
      cls: "charinfo-cover-picker__link",
      attr: { placeholder: "https://… 또는 vault 경로" },
    });
    this.linkInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        void this.addFromLink(this.linkInput?.value ?? "");
      }
    });
    const linkGo = this.linkPanel.createEl("button", {
      text: "적용",
      cls: "charinfo-cover-picker__link-go",
      attr: { type: "button" },
    });
    linkGo.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.addFromLink(this.linkInput?.value ?? "");
    });

    // —— 4. Reset / clear (quiet) ——
    const footer = contentEl.createDiv({ cls: "charinfo-cover-picker__footer" });
    const defBtn = footer.createEl("button", {
      text: "기본으로",
      cls: "charinfo-cover-picker__quiet",
      attr: {
        type: "button",
        title: "노트의 첫 이미지를 자동으로 사용",
      },
    });
    defBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.commit({ kind: "default" });
    });

    const noneBtn = footer.createEl("button", {
      text: "커버 없음",
      cls: "charinfo-cover-picker__quiet",
      attr: {
        type: "button",
        title: "이미지는 남기고 카드 커버만 숨김",
      },
    });
    noneBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.commit({ kind: "none" });
    });
  }

  private coverLabel(cover: CoverRef): string {
    if (cover.kind === "vault") return cover.file.basename;
    try {
      const parsed = new URL(cover.url);
      const parts = parsed.pathname.split("/").filter(Boolean);
      const tail = parts[parts.length - 1];
      return tail ? decodeURIComponent(tail) : parsed.hostname;
    } catch {
      return "웹 이미지";
    }
  }

  onClose(): void {
    this.opToken += 1;
    this.contentEl.empty();
  }

  private showLinkPanel(): void {
    if (!this.linkPanel || !this.linkInput) return;
    this.linkPanel.removeClass("is-hidden");
    this.linkInput.focus();
  }

  private preferImgur(): boolean {
    return (
      this.plugin.settings.imageUploadDestination === "imgur" &&
      isImgurPluginAvailable(this.app)
    );
  }

  private setStatus(text: string, isError = false): void {
    if (!this.statusEl) return;
    this.statusEl.setText(text);
    this.statusEl.toggleClass("is-error", isError);
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.contentEl.toggleClass("is-busy", busy);
  }

  private pickLocalFile(): void {
    if (this.busy) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif,image/*";
    input.multiple = false;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void this.uploadLocal(file);
    });
    input.click();
  }

  private async uploadLocal(file: File): Promise<void> {
    if (this.busy) return;
    if (!file.type.startsWith("image/") && !isImagePath(file.name)) {
      this.setStatus("이미지 파일만 가능해요.", true);
      return;
    }
    if (file.size > MAX_REMOTE_BYTES) {
      this.setStatus("최대 8MB.", true);
      return;
    }

    const token = ++this.opToken;
    this.setBusy(true);
    this.setStatus("올리는 중…");
    try {
      if (this.preferImgur()) {
        const result = await uploadFileViaImgurPlugin(this.app, file);
        if (token !== this.opToken) return;
        if (!result.ok) {
          this.setStatus(`Imgur 실패 → vault`, true);
          const data = await file.arrayBuffer();
          const saved = await this.saveBytes(file.name, data);
          if (token !== this.opToken) return;
          if (saved) await this.commit({ kind: "vault", file: saved });
          return;
        }
        await this.commit({ kind: "remote", url: result.url });
        return;
      }

      const data = await file.arrayBuffer();
      const saved = await this.saveBytes(file.name, data);
      if (token !== this.opToken) return;
      if (saved) await this.commit({ kind: "vault", file: saved });
    } catch (error) {
      if (token !== this.opToken) return;
      console.error(error);
      this.setStatus(
        `실패: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      if (token === this.opToken) this.setBusy(false);
    }
  }

  private async addFromLink(raw: string): Promise<void> {
    if (this.busy) return;
    const link = raw.trim();
    if (!link) {
      this.setStatus("링크를 입력하세요.", true);
      this.showLinkPanel();
      return;
    }

    const token = ++this.opToken;
    this.setBusy(true);
    this.setStatus("처리 중…");
    try {
      const wiki = link.match(/^!?\[\[([^\]]+)\]\]$/);
      const pathLike = wiki?.[1]?.split("|")[0]?.trim() || link;

      if (isRemoteCoverUrl(pathLike) || /^https:\/\//i.test(pathLike)) {
        await this.commit({ kind: "remote", url: pathLike });
        return;
      }
      if (/^http:\/\//i.test(pathLike)) {
        this.setStatus("https만 가능해요.", true);
        return;
      }

      const cleaned = normalizePath(pathLike.replace(/^\//, ""));
      const existing =
        this.app.vault.getAbstractFileByPath(cleaned) ??
        this.app.metadataCache.getFirstLinkpathDest(cleaned, this.record.path);
      if (existing instanceof TFile && isImagePath(existing.path)) {
        await this.commit({ kind: "vault", file: existing });
        return;
      }
      this.setStatus("이미지를 찾지 못했어요.", true);
    } catch (error) {
      if (token !== this.opToken) return;
      console.error(error);
      this.setStatus(
        `실패: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      if (token === this.opToken) this.setBusy(false);
    }
  }

  private async saveBytes(
    filename: string,
    data: ArrayBuffer,
  ): Promise<TFile | null> {
    const folder = await this.ensureCharacterMediaFolder();
    const safe = filename.replace(/[\\/]/g, "-");
    let vaultPath = normalizePath(`${folder}/${safe}`);
    let existing = this.app.vault.getAbstractFileByPath(vaultPath);
    if (existing instanceof TFile) {
      const dot = safe.lastIndexOf(".");
      const base = dot > 0 ? safe.slice(0, dot) : safe;
      const ext = dot > 0 ? safe.slice(dot) : "";
      let n = 1;
      while (existing instanceof TFile) {
        vaultPath = normalizePath(`${folder}/${base}-${n}${ext}`);
        existing = this.app.vault.getAbstractFileByPath(vaultPath);
        n += 1;
      }
    }
    return this.app.vault.createBinary(vaultPath, data);
  }

  private async ensureCharacterMediaFolder(): Promise<string> {
    const path = normalizePath(this.record.path);
    const parts = path.split("/");
    const base = (parts[parts.length - 1] ?? "").replace(/\.md$/i, "");
    const parent = parts.slice(0, -1).join("/");
    if (parent && (parent === base || parent.endsWith(`/${base}`))) {
      return parent;
    }
    const sibling = path.replace(/\.md$/i, "");
    const abs = this.app.vault.getAbstractFileByPath(sibling);
    if (abs) return sibling;
    try {
      await this.app.vault.createFolder(sibling);
      return sibling;
    } catch {
      return this.plugin.media.ensureVaultMediaFolder();
    }
  }

  private async commit(result: CoverPickResult): Promise<void> {
    if (this.busy && result.kind !== "default") {
      /* allow commit while uploading finishes via same busy path */
    }
    const token = this.opToken;
    this.setBusy(true);
    try {
      await this.onPick(result);
      if (token !== this.opToken) return;
      this.close();
    } catch (error) {
      if (token !== this.opToken) return;
      console.error(error);
      this.setStatus(
        `저장 실패: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
      new Notice("커버 저장 실패");
    } finally {
      if (token === this.opToken) this.setBusy(false);
    }
  }
}
