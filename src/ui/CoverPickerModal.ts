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
import { safeImageEmbedFilename } from "../data/imageEmbeds";
import {
  type CoverRef,
  coverDisplaySrc,
  coverRefKey,
  isCoverNone,
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

export type CoverBatchResult = {
  images: CoverRef[];
  currentCover: CoverRef | null;
  added: number;
  refreshFailed?: boolean;
};

export type CoverPickerState = Pick<CoverBatchResult, "images" | "currentCover">;
export type CoverPickerOperations = {
  read: () => Promise<CoverPickerState>;
  remove: (key: string) => Promise<(() => Promise<void>) | undefined>;
  move: (key: string, direction: -1 | 1) => Promise<void>;
  subscribe: (refresh: () => void) => () => void;
};

const MAX_REMOTE_BYTES = 8_000_000;

/**
 * Cover set-now modal — pick / add / reset.
 * Reposition stays on the card (drag), not here.
 */
export class CoverPickerModal extends Modal {
  private images: CoverRef[];
  private onPick: (result: CoverPickResult) => void | Promise<void>;
  private onAddFiles: (images: CoverRef[]) => Promise<CoverBatchResult>;
  private plugin: CharinfoPlugin;
  private record: CharacterRecord;
  private currentCover: CoverRef | null;
  private busy = false;
  private fileDialogOpen = false;
  private statusEl: HTMLElement | null = null;
  private undoEl: HTMLElement | null = null;
  private undoKey?: string;
  private linkInput: HTMLInputElement | null = null;
  private linkPanel: HTMLElement | null = null;
  private opToken = 0;
  private opened = false;
  private page = 0;
  private pageSize = 6;
  private currentEl!: HTMLElement;
  private pickEl!: HTMLElement;
  private unsubscribe?: () => void;
  private media?: MediaQueryList;
  private refreshVersion = 0;
  private movePending = 0;
  private pendingFocus?: { key: string; action?: string };
  private onResize = (): void => {
    const anchor = this.page * this.pageSize;
    this.pageSize = this.media?.matches ? 4 : 6;
    this.page = Math.floor(anchor / this.pageSize);
    this.renderImages();
  };

  constructor(
    app: App,
    plugin: CharinfoPlugin,
    record: CharacterRecord,
    images: CoverRef[],
    currentCover: CoverRef | null,
    onPick: (result: CoverPickResult) => void | Promise<void>,
    onAddFiles: (images: CoverRef[]) => Promise<CoverBatchResult>,
    private operations: CoverPickerOperations,
  ) {
    super(app);
    this.plugin = plugin;
    this.record = record;
    this.images = images;
    this.currentCover = currentCover;
    this.onPick = onPick;
    this.onAddFiles = onAddFiles;
  }

  onOpen(): void {
    this.modalEl.addClass("charinfo-cover-modal");
    this.setTitle("커버");

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("charinfo-cover-picker");

    this.opened = true;
    this.media = window.matchMedia("(max-width: 600px), (pointer: coarse)");
    this.pageSize = this.media.matches ? 4 : 6;
    this.media.addEventListener("change", this.onResize);
    this.unsubscribe = this.operations.subscribe(() => { void this.refresh(); });
    this.currentEl = contentEl.createDiv({ cls: "charinfo-cover-picker__current" });
    this.statusEl = contentEl.createDiv({
      cls: "charinfo-cover-picker__status",
      attr: { role: "status", "aria-live": "polite" },
    });
    const collection = contentEl.createDiv({ cls: "charinfo-cover-picker__block charinfo-cover-picker__collection" });
    this.pickEl = collection.createDiv();
    // Keep Undo outside the rebuilt grid so refreshes preserve its handler.
    this.undoEl = collection.createDiv({ cls: "charinfo-cover-picker__undo", attr: { role: "status", "aria-live": "polite" } });
    this.renderImages();

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
    fileBtn.setAttribute("title", "여러 이미지를 한 번에 선택할 수 있어요");
    fileBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.busy || this.fileDialogOpen) return;
      this.pickLocalFile();
    });

    const linkBtn = actions.createEl("button", {
      cls: "charinfo-cover-picker__action",
      attr: { type: "button" },
    });
    const linkIcon = linkBtn.createSpan({
      cls: "charinfo-cover-picker__action-icon",
    });
    setIcon(linkIcon, "link-2");
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

  private renderImages(followKey?: string, action?: string): void {
    if (!this.opened) return;
    const active = this.contentEl.ownerDocument.activeElement as HTMLElement | null;
    const focusKey = followKey ?? active?.closest<HTMLElement>("[data-image-key]")?.dataset.imageKey;
    const focusAction = action ?? active?.dataset.action;
    if (active === this.linkInput) this.pendingFocus = undefined;
    else if (focusKey) this.pendingFocus = { key: focusKey, action: focusAction };
    const index = followKey ? this.images.findIndex((image) => coverRefKey(image) === followKey) : -1;
    if (index >= 0) this.page = Math.floor(index / this.pageSize);
    const pages = Math.max(1, Math.ceil(this.images.length / this.pageSize));
    this.page = Math.max(0, Math.min(this.page, pages - 1));
    this.currentEl.empty();
    if (this.currentCover) {
      const frame = this.currentEl.createDiv({ cls: "charinfo-cover-picker__current-frame" });
      const image = frame.createEl("img", { cls: "charinfo-cover-picker__current-img", attr: {
        src: coverDisplaySrc(this.app, this.currentCover), alt: "현재 커버", draggable: "false",
      } });
      image.style.objectPosition = this.record.coverPosition || "50% 50%";
    }
    this.currentEl.createDiv({ cls: "charinfo-cover-picker__current-cap", text: this.currentCover ? "현재 커버" : "커버 없음" });
    this.pickEl.empty();
    const heading = this.pickEl.createDiv({ cls: "charinfo-cover-picker__block-title" });
    heading.createSpan({ text: "고르기" });
    heading.createSpan({ text: `총 ${this.images.length}장` });
    const grid = this.pickEl.createDiv({ cls: "charinfo-cover-picker__grid" });
    if (!this.images.length) grid.createDiv({ cls: "charinfo-cover-picker__empty", text: "이미지를 추가해 주세요." });
    const currentKey = this.currentCover ? coverRefKey(this.currentCover) : null;
    const start = this.page * this.pageSize;
    for (const [offset, image] of this.images.slice(start, start + this.pageSize).entries()) {
      const key = coverRefKey(image), position = start + offset;
      const label = this.coverLabel(image), isCurrent = key === currentKey;
      const tile = grid.createDiv({ cls: "charinfo-cover-picker__tile", attr: { "data-image-key": key } });
      const pick = tile.createEl("button", { cls: "charinfo-cover-picker__cell" + (isCurrent ? " is-current" : ""), attr: {
        type: "button", title: label, "aria-label": `${position + 1}번 ${label} 커버로 선택`, "aria-pressed": String(isCurrent), "data-action": "pick",
      } });
      pick.createEl("img", { attr: { src: coverDisplaySrc(this.app, image), alt: "", loading: "lazy", draggable: "false" } });
      pick.createSpan({ cls: "charinfo-cover-picker__number", text: String(position + 1) });
      if (isCurrent) pick.createSpan({ cls: "charinfo-cover-picker__badge", text: "현재" });
      pick.addEventListener("click", () => { void this.commit(image); });
      const actions = tile.createDiv({ cls: "charinfo-cover-picker__image-actions" });
      const moves = actions.createDiv({ cls: "charinfo-cover-picker__moves" });
      for (const direction of [-1, 1] as const) {
        const text = direction < 0 ? "앞으로 이동" : "뒤로 이동";
        const button = moves.createEl("button", { cls: "clickable-icon charinfo-icon-btn", attr: {
          type: "button", title: text, "aria-label": `${position + 1}번 이미지 ${text}`, "data-action": String(direction), "data-move": "",
        } });
        setIcon(button, direction < 0 ? "chevron-left" : "chevron-right");
        button.disabled = direction < 0 ? position === 0 : position === this.images.length - 1;
        button.addEventListener("click", () => { void this.moveImage(key, direction); });
      }
      const protectedCover = isCurrent && this.images.length > 1;
      const remove = actions.createEl("button", { cls: "clickable-icon charinfo-icon-btn charinfo-cover-picker__remove", attr: {
        type: "button", "aria-label": `${position + 1}번 이미지 제거`, "data-action": "remove",
        title: protectedCover ? "다른 이미지를 커버로 선택한 뒤 제거할 수 있어요" : "이미지 제거",
      } });
      setIcon(remove, "trash-2");
      remove.disabled = protectedCover;
      remove.addEventListener("click", () => { void this.removeImage(key); });
    }
    if (pages > 1) {
      const nav = this.pickEl.createDiv({ cls: "charinfo-cover-picker__pagination", attr: { role: "navigation", "aria-label": "이미지 페이지" } });
      const previous = nav.createEl("button", { text: "이전", attr: { type: "button", "aria-label": "이전 이미지 페이지", "data-page": "previous" } });
      previous.disabled = this.page === 0;
      nav.createSpan({ text: `${this.page + 1} / ${pages}`, attr: { role: "status", "aria-live": "polite" } });
      const next = nav.createEl("button", { text: "다음", attr: { type: "button", "aria-label": "다음 이미지 페이지", "data-page": "next" } });
      next.disabled = this.page === pages - 1;
      const turnPage = (delta: number, selector: string): void => {
        if (this.busy) return;
        this.page += delta;
        this.renderImages();
        (this.pickEl.querySelector<HTMLButtonElement>(`${selector}:not(:disabled)`) ?? this.pickEl.querySelector<HTMLButtonElement>(".charinfo-cover-picker__cell"))?.focus({ preventScroll: true });
      };
      previous.onclick = () => turnPage(-1, '[data-page="previous"]');
      next.onclick = () => turnPage(1, '[data-page="next"]');
    }
    this.setBusy(this.busy);
    if (focusKey) {
      const tile = Array.from(grid.children).find((el) => (el as HTMLElement).dataset.imageKey === focusKey);
      const target = tile?.querySelector<HTMLButtonElement>(`[data-action="${focusAction}"]:not(:disabled)`) ?? tile?.querySelector<HTMLButtonElement>("button:not(:disabled)");
      if (!this.busy && active !== this.linkInput) { target?.focus({ preventScroll: true }); this.pendingFocus = undefined; }
    }
  }

  private async refresh(followKey?: string, action?: string): Promise<boolean> {
    const version = ++this.refreshVersion;
    try {
      const state = await this.operations.read();
      if (!this.opened || version !== this.refreshVersion) return false;
      this.images = state.images;
      if (this.undoKey && this.images.some((image) => coverRefKey(image) === this.undoKey)) {
        this.undoEl?.empty();
        this.undoKey = undefined;
      }
      this.currentCover = state.currentCover;
      this.renderImages(followKey, action);
      return true;
    } catch (error) {
      if (this.opened && version === this.refreshVersion) this.setStatus("화면을 새로 불러오지 못했어요. 다시 시도해 주세요.", true);
      return false;
    }
  }

  private async moveImage(key: string, direction: -1 | 1): Promise<void> {
    if (!this.opened || (this.busy && this.movePending === 0)) return;
    this.movePending += 1;
    this.setBusy(true);
    try {
      await this.operations.move(key, direction);
      await this.refresh(key, String(direction));
    } catch (error) {
      if (this.opened) this.setStatus(error instanceof Error ? error.message : "순서를 바꾸지 못했어요.", true);
    } finally {
      this.movePending -= 1;
      if (this.opened && this.movePending === 0) { this.setBusy(false); this.renderImages(key, String(direction)); }
    }
  }

  private async removeImage(key: string): Promise<void> {
    if (this.busy || !this.opened) return;
    const index = this.images.findIndex((image) => coverRefKey(image) === key);
    const neighbor = this.images[index + 1] ?? this.images[index - 1];
    this.setBusy(true);
    try {
      const undo = await this.operations.remove(key);
      if (undo && this.opened && this.undoEl) {
        this.setStatus("");
        this.undoKey = key;
        this.undoEl.setText("이미지를 제거했어요. ");
        const button = this.undoEl.createEl("button", { cls: "charinfo-image-undo", text: "되돌리기", attr: { type: "button", "aria-label": "이미지 제거 되돌리기" } });
        button.onclick = () => {
          if (this.busy) return;
          this.setBusy(true);
          void undo().then(async () => {
            if (this.opened) { this.setStatus(""); this.undoEl?.empty(); this.undoKey = undefined; }
            await this.refresh(key, "pick");
          }).catch((error) => {
            if (this.opened) this.setStatus(error instanceof Error ? error.message : "되돌리지 못했어요.", true);
          }).finally(() => { if (this.opened) this.setBusy(false); });
        };
      }
      await this.refresh(neighbor ? coverRefKey(neighbor) : undefined, "remove");
    } catch (error) {
      if (this.opened) this.setStatus(error instanceof Error ? error.message : "이미지를 제거하지 못했어요.", true);
      await this.refresh();
    } finally {
      if (this.opened) { this.setBusy(false); this.renderImages(neighbor ? coverRefKey(neighbor) : undefined, "remove"); }
    }
  }

  private async appendLink(image: CoverRef, token: number): Promise<void> {
    const result = await this.onAddFiles([image]);
    if (!this.opened || token !== this.opToken) return;
    this.images = result.images;
    this.currentCover = result.currentCover;
    if (this.linkInput) this.linkInput.value = "";
    this.renderImages(coverRefKey(image));
    this.setStatus(result.added ? "이미지를 추가했어요." : "이미 추가한 이미지예요.");
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
    this.opened = false;
    this.opToken += 1;
    this.refreshVersion += 1;
    this.unsubscribe?.();
    this.media?.removeEventListener("change", this.onResize);
    this.fileDialogOpen = false;
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
    this.contentEl.setAttribute("aria-busy", String(busy));
    this.contentEl.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input").forEach((control) => {
      if (busy) {
        if (!control.hasAttribute("data-before-busy")) control.dataset.beforeBusy = String(control.disabled);
        control.disabled = control.dataset.beforeBusy === "true" || !(this.movePending > 0 && (control.hasAttribute("data-move") || control === this.linkInput));
      } else if (control.hasAttribute("data-before-busy")) {
        control.disabled = control.dataset.beforeBusy === "true";
        delete control.dataset.beforeBusy;
      }
    });
    if (this.contentEl.ownerDocument.activeElement === this.linkInput) this.pendingFocus = undefined;
    if (!busy && this.pendingFocus) {
      const { key, action } = this.pendingFocus;
      const tile = Array.from(this.pickEl.querySelectorAll<HTMLElement>("[data-image-key]")).find((el) => el.dataset.imageKey === key);
      (tile?.querySelector<HTMLButtonElement>(`[data-action="${action}"]:not(:disabled)`) ?? tile?.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus({ preventScroll: true });
      this.pendingFocus = undefined;
    }
  }

  private pickLocalFile(): void {
    if (this.busy || this.fileDialogOpen) return;
    this.fileDialogOpen = true;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif,image/*";
    input.multiple = true;
    let settled = false;
    const clearDialog = (): void => {
      if (settled) return;
      settled = true;
      this.fileDialogOpen = false;
      window.removeEventListener("focus", onFocus);
    };
    const onFocus = (): void => {
      window.setTimeout(() => {
        if (!input.files?.length) clearDialog();
      }, 750);
    };
    window.addEventListener("focus", onFocus, { once: true });
    input.addEventListener("cancel", clearDialog, { once: true });
    input.addEventListener("change", () => {
      clearDialog();
      const files = Array.from(input.files ?? []);
      if (files.length) void this.uploadLocalFiles(files);
    }, { once: true });
    input.click();
  }

  private async uploadLocalFiles(files: File[]): Promise<void> {
    if (this.busy || !this.opened) return;
    const token = ++this.opToken;
    const hadImages = this.images.length > 0;
    const coverWasHidden = isCoverNone(this.record.cover);
    this.setBusy(true);
    const uploaded: CoverRef[] = [];
    const failed: string[] = [];
    let vaultFallbacks = 0;
    try {
      for (const [index, file] of files.entries()) {
        if (token === this.opToken) this.setStatus(`올리는 중… ${index + 1}/${files.length}`);
        if (!isImagePath(file.name)) {
          failed.push(`${file.name}: 이미지 파일 아님`);
          continue;
        }
        if (file.size > MAX_REMOTE_BYTES) {
          failed.push(`${file.name}: 최대 8MB`);
          continue;
        }
        try {
          if (this.preferImgur()) {
            const result = await uploadFileViaImgurPlugin(this.app, file);
            if (result.ok) {
              uploaded.push({ kind: "remote", url: result.url });
              continue;
            }
            const saved = await this.saveBytes(file.name, await file.arrayBuffer());
            vaultFallbacks += 1;
            uploaded.push({ kind: "vault", file: saved });
            continue;
          }
          const saved = await this.saveBytes(file.name, await file.arrayBuffer());
          uploaded.push({ kind: "vault", file: saved });
        } catch (error) {
          console.error("Image import failed", file.name, error);
          failed.push(`${file.name}: ${error instanceof Error ? error.message : "저장 실패"}`);
        }
      }
      let added = 0;
      let refreshFailed = false;
      if (uploaded.length > 0) {
        // A batch is one note edit. The picker remains open so the new order
        // and current cover are visible before the user leaves.
        const result = await this.onAddFiles(uploaded);
        added = result.added;
        refreshFailed = result.refreshFailed === true;
        this.images = result.images;
        this.currentCover = result.currentCover;
      }
      if (token !== this.opToken) return;
      const firstAdded = uploaded.find((image) => this.images.some((candidate) => coverRefKey(candidate) === coverRefKey(image)));
      this.renderImages(firstAdded ? coverRefKey(firstAdded) : undefined);
      const coverMessage = coverWasHidden
        ? " · 커버 숨김 유지"
        : !hadImages && added > 0 && this.currentCover
          ? " · 첫 이미지가 커버"
          : " · 커버 그대로";
      const fallbackMessage = vaultFallbacks ? ` · ${vaultFallbacks}장 vault에 저장` : "";
      const failedMessage = failed.length
        ? ` · ${failed.length}장 실패: ${failed.slice(0, 2).join(", ")}${failed.length > 2 ? " 외" : ""}`
        : "";
      const refreshMessage = refreshFailed ? " · 갤러리를 다시 열어 확인하세요" : "";
      this.setStatus(`${added}장 추가${coverMessage}${fallbackMessage}${failedMessage}${refreshMessage}`, failed.length > 0 || refreshFailed);
    } catch (error) {
      console.error(error);
      if (token !== this.opToken) return;
      const failedSummary = failed.length
        ? ` · ${failed.length}장 실패: ${failed.slice(0, 2).join(", ")}`
        : "";
      this.setStatus(`${error instanceof Error ? error.message : `실패: ${String(error)}`}${failedSummary}`, true);
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
        await this.appendLink({ kind: "remote", url: pathLike }, token);
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
        await this.appendLink({ kind: "vault", file: existing }, token);
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
  ): Promise<TFile> {
    const folder = await this.ensureCharacterMediaFolder();
    const safe = safeImageEmbedFilename(filename);
    let vaultPath = normalizePath(`${folder}/${safe}`);
    let existing = this.app.vault.getAbstractFileByPath(vaultPath);
    if (existing instanceof TFile) {
      const dot = safe.lastIndexOf(".");
      const base = dot > 0 ? safe.slice(0, dot) : safe;
      const ext = dot > 0 ? safe.slice(dot) : "";
      let n = 1;
      while (existing instanceof TFile) {
        const previous = new Uint8Array(await this.app.vault.readBinary(existing));
        const incoming = new Uint8Array(data);
        if (previous.length === incoming.length && previous.every((byte, i) => byte === incoming[i])) {
          return existing;
        }
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
    if (this.busy || !this.opened) return;
    const token = this.opToken;
    this.setBusy(true);
    try {
      await this.onPick(result);
      if (token !== this.opToken) return;
      if (await this.refresh()) this.setStatus("");
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
