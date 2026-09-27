import { Modal, Notice, type TFile } from "obsidian";
import type CharinfoPlugin from "../main";
import type { CharacterRecord } from "../data/CharacterStore";
import type {
  HostedShareTtl,
  WebShareHostMode,
  WebShareLastState,
} from "../settings";
import {
  SHARE_ATTR_HEADER,
  clearWebShareForPage,
  getGroupOrderFor,
  getWebShareForPage,
  setWebShareForPage,
} from "../settings";
import {
  characterWebShareStatePath,
  clearLastShareIfSameUrl,
  isWebShareStateStale,
  recordLastShareUnlessLegacy,
} from "../share/webShareState";
import {
  buildSharePayload,
  collectPanelHeaders,
  groupPanelHeaders,
  renderShareHtml,
  SHARE_HTML_VERSION,
} from "../share/webShare";
import {
  githubPagesPublicUrl,
  githubPathForSlug,
  githubTokenCreateUrl,
  isGithubShareConfigured,
  parseGithubRepo,
  publishToGithubPages,
  setupGithubShareFromToken,
  slugifyLinkName,
} from "../share/githubPages";
import {
  checkShareSize,
  deleteHostedShare,
  hostedShareBaseFromUrl,
  isHostedShareConfigured,
  updateHostedShare,
  uploadKeyForHostedTarget,
  uploadToHostedShare,
} from "../share/hostedShare";
import {
  copyTextToClipboard,
  galleryPagePath,
  getFilterAxisForPage,
  readGalleryScope,
} from "../page/galleryPage";
import { resolveGroupOrder } from "../data/order";

type Panel = "hosted" | "github";

function archiveOf(record: CharacterRecord): string {
  return record.장르.trim();
}

function groupOf(record: CharacterRecord): string {
  return record.그룹.trim();
}

/** Stable key: archive + group (empty group = 미분류). */
function scopeKey(archive: string, group: string): string {
  return `${archive}\n${group}`;
}

export interface ShareGalleryModalOpts {
  /** Prefer current gallery archive when opening. */
  defaultArchive?: string;
  /** Hide archive/group pickers (single-character share). */
  selectionLocked?: boolean;
  /**
   * Gallery note this share came from. Its frontmatter decides the filter axis
   * — do not fall back to `getActiveFile()` when the caller knows the page.
   */
  pageFile?: TFile | null;
}

/**
 * Share gallery as a public web link.
 * Primary: our Cloudflare share-host (one click). Fallback: GitHub Pages.
 */
export class ShareGalleryModal extends Modal {
  private plugin: CharinfoPlugin;
  private records: CharacterRecord[];
  private title: string;
  private busy = false;
  private hostMode: WebShareHostMode;
  private linkSlug: string;
  private hostedTtl: HostedShareTtl;
  private statusEl: HTMLElement | null = null;
  private linkEl: HTMLInputElement | null = null;
  private primaryBtn: HTMLButtonElement | null = null;
  private forceReconnect = false;
  private panel: Panel = "hosted";
  private sessionUrl = "";
  private durationRow: HTMLElement | null = null;
  private advancedOpen = false;
  private pendingGithubToken: string;
  private panelHeaders: Set<string>;
  private includeNoteImages = false;
  private availableHeaders: string[] = [SHARE_ATTR_HEADER];
  private headerChipsEl: HTMLElement | null = null;
  private selectionLocked: boolean;
  /**
   * Explicit single-character share (not “gallery with one card”). Its hosted
   * credential uses a character-note key and never touches the gallery link.
   */
  private characterShare: boolean;
  private selectedArchives: Set<string>;
  private selectedGroups: Set<string>;
  private archiveWrap: HTMLElement | null = null;
  private groupWrap: HTMLElement | null = null;
  private scopeCountEl: HTMLElement | null = null;
  private pageFile: TFile | null;

  constructor(
    plugin: CharinfoPlugin,
    records: CharacterRecord[],
    title: string,
    opts: ShareGalleryModalOpts = {},
  ) {
    super(plugin.app);
    this.plugin = plugin;
    this.records = records;
    this.title = title;
    this.linkSlug =
      plugin.settings.webShareLinkSlug.trim() ||
      slugifyLinkName(title) ||
      "gallery";
    this.hostedTtl = plugin.settings.webShareHostedTtl;
    this.pendingGithubToken = plugin.settings.webShareGithubToken;
    this.panelHeaders = new Set(
      plugin.settings.webSharePanelHeaders.length
        ? plugin.settings.webSharePanelHeaders
        : [SHARE_ATTR_HEADER, "프롬프트"],
    );
    // GitHub connected + last used → open that panel with the Pages link ready.
    const ghReady = isGithubShareConfigured(plugin.settings);
    const preferGithub =
      ghReady && plugin.settings.webShareHost === "github";
    this.hostMode = preferGithub ? "github" : "hosted";
    this.panel = preferGithub ? "github" : "hosted";
    this.pageFile = opts.pageFile ?? null;
    this.characterShare = Boolean(opts.selectionLocked);
    this.includeNoteImages = this.pageHostedShare()?.includeNoteImages === true;
    // Only single-character share locks scope. Gallery share always keeps
    // archive / group / panel-header chips selectable.
    this.selectionLocked = this.characterShare;
    this.selectedArchives = new Set();
    this.selectedGroups = new Set();
    this.initScopeSelection(opts.defaultArchive?.trim() || "");
  }

  /** Gallery note path this share is scoped to (credentials key). */
  private pageSharePath(): string {
    if (this.characterShare) {
      return characterWebShareStatePath(this.records[0]?.file.path ?? "");
    }
    return this.pageFile?.path ?? galleryPagePath(this.plugin);
  }

  /** Share-scoped hosted link usable for Update/Stop. */
  private pageHostedShare(): WebShareLastState | null {
    return getWebShareForPage(this.plugin.settings, this.pageSharePath());
  }

  private initScopeSelection(preferredArchive: string): void {
    if (this.selectionLocked) {
      for (const r of this.records) {
        const a = archiveOf(r);
        const g = groupOf(r);
        this.selectedArchives.add(a);
        this.selectedGroups.add(scopeKey(a, g));
      }
      return;
    }
    const archives = this.listArchives();
    const start =
      preferredArchive && archives.includes(preferredArchive)
        ? preferredArchive
        : archives[0] || "";
    if (start) this.selectedArchives.add(start);
    else archives.forEach((a) => this.selectedArchives.add(a));
    this.syncGroupsToSelectedArchives({ selectAllNew: true });
  }

  private listArchives(): string[] {
    const set = new Set<string>();
    for (const r of this.records) set.add(archiveOf(r));
    return [...set].sort((a, b) => {
      if (!a && b) return 1;
      if (a && !b) return -1;
      return a.localeCompare(b, "ko");
    });
  }

  /** Groups present in currently selected archives. */
  private listGroupEntries(): { archive: string; group: string; key: string; label: string }[] {
    const multi = this.selectedArchives.size > 1;
    const map = new Map<string, { archive: string; group: string; key: string; label: string }>();
    for (const r of this.records) {
      const a = archiveOf(r);
      if (!this.selectedArchives.has(a)) continue;
      const g = groupOf(r);
      const key = scopeKey(a, g);
      if (map.has(key)) continue;
      const groupLabel = g || "미분류";
      map.set(key, {
        archive: a,
        group: g,
        key,
        label: multi && a ? `${a} · ${groupLabel}` : groupLabel,
      });
    }
    return [...map.values()].sort((a, b) => {
      const byArchive = a.archive.localeCompare(b.archive, "ko");
      if (byArchive) return byArchive;
      const ua = !a.group;
      const ub = !b.group;
      if (ua !== ub) return ua ? 1 : -1;
      return a.group.localeCompare(b.group, "ko");
    });
  }

  private syncGroupsToSelectedArchives(opts: { selectAllNew: boolean }): void {
    const valid = new Set(this.listGroupEntries().map((e) => e.key));
    for (const key of [...this.selectedGroups]) {
      if (!valid.has(key)) this.selectedGroups.delete(key);
    }
    if (opts.selectAllNew) {
      for (const key of valid) this.selectedGroups.add(key);
    }
  }

  private selectedRecords(): CharacterRecord[] {
    return this.records.filter((r) => {
      const a = archiveOf(r);
      if (!this.selectedArchives.has(a)) return false;
      return this.selectedGroups.has(scopeKey(a, groupOf(r)));
    });
  }

  private shareTitle(): string {
    if (this.records.length === 1) return this.title;
    const archives = [...this.selectedArchives].filter(Boolean);
    if (archives.length === 1) return archives[0]!;
    if (archives.length > 1) return `${archives[0]} 외 ${archives.length - 1}`;
    return this.title || "Character Archive";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("charinfo-share-modal");
    this.modalEl.addClass("charinfo-share-modal-shell");

    if (this.panel === "hosted") {
      this.hostMode = "hosted";
      this.renderHosted(contentEl);
      return;
    }
    this.hostMode = "github";
    if (
      !isGithubShareConfigured(this.plugin.settings) ||
      this.forceReconnect
    ) {
      this.renderGithubConnect(contentEl);
    } else {
      this.renderGithubPublish(contentEl);
    }
  }

  onClose(): void {
    this.contentEl.empty();
    this.modalEl.removeClass("charinfo-share-modal-shell");
  }

  /** Primary: our Cloudflare host — duration + one button. */
  private renderHosted(root: HTMLElement): void {
    this.setTitle(this.records.length === 1 ? "캐릭터 공유" : "갤러리 공유");
    this.renderHostSwitcher(root);
    const configured = isHostedShareConfigured(
      this.plugin.settings.webShareHostedBaseUrl,
    );

    if (!configured) {
      root.createDiv({
        cls: "charinfo-share-modal__lead",
        text: "공유 주소가 올바르지 않아요. 설정에서 확인하세요.",
      });
      this.statusEl = root.createDiv({ cls: "charinfo-share-modal__status" });
      this.renderAltMethods(root);
      return;
    }

    const page = this.pageHostedShare();
    const stale = isWebShareStateStale(page, SHARE_HTML_VERSION);
    const lastUrl =
      this.sessionUrl.trim() ||
      page?.url.trim() ||
      "";
    const canManage = Boolean(
      lastUrl &&
        page?.id.trim() &&
        page?.manageKey.trim() &&
        hostedShareBaseFromUrl(page.url),
    );
    /** Managed link is live — update/stop only; create appears after stop. */
    const hasLiveLink = canManage;

    root.createDiv({
      cls: "charinfo-share-modal__lead",
      text: hasLiveLink
        ? stale
          ? "이 공개 링크는 이전 형식이에요. 지금 형식으로 업데이트하거나 공유를 중지할 수 있어요."
          : "공개 링크가 있어요. 내용을 바꾼 뒤 업데이트하거나, 공유를 중지할 수 있어요."
        : lastUrl
          ? "예전에 만든 링크는 이 기기에서 갱신·중지할 수 없어요. 새 링크를 만드세요."
          : "넣을 아카이브·그룹과 범위를 고른 뒤 공유하세요.",
    });

    root.createDiv({
      cls: "charinfo-share-modal__hint",
      text: "공유하면 선택한 카드 정보와 표지가 공개 페이지로 올라가요. 링크가 있는 사람은 누구나 볼 수 있어요.",
    });

    if (hasLiveLink && lastUrl) {
      this.renderLiveLinkSection(root, lastUrl, true, { ruled: false });
    }

    if (!this.selectionLocked) {
      this.renderScopePickers(root);
    }

    this.renderAdvancedOptions(root);

    const actions = root.createDiv({ cls: "charinfo-share-modal__actions" });
    if (hasLiveLink) {
      this.renderPrimaryAction(actions, "이 링크 업데이트", () =>
        void this.publish({ update: true }),
      );
    } else {
      this.renderPrimaryAction(
        actions,
        lastUrl ? "새 링크 만들기" : "공유 링크 만들기",
        () => void this.publish(),
      );
    }

    this.statusEl = root.createDiv({ cls: "charinfo-share-modal__status" });

    if (lastUrl && !hasLiveLink) {
      this.renderLiveLinkSection(root, lastUrl, false);
    }

    this.renderAltMethods(root);
    this.refreshScopeCount();
  }

  private renderField(root: HTMLElement, label: string): HTMLElement {
    const field = root.createDiv({ cls: "charinfo-share-modal__field" });
    field.createDiv({
      cls: "charinfo-share-modal__field-label",
      text: label,
    });
    return field;
  }

  private renderScopePickers(root: HTMLElement): void {
    const section = root.createDiv({ cls: "charinfo-share-modal__section" });

    const archiveField = this.renderField(section, "아카이브");
    this.archiveWrap = archiveField.createDiv({
      cls: "charinfo-share-modal__chips",
      attr: { role: "group", "aria-label": "아카이브 선택" },
    });
    this.paintArchiveChips();

    const groupField = this.renderField(section, "그룹");
    this.groupWrap = groupField.createDiv({
      cls: "charinfo-share-modal__chips",
      attr: { role: "group", "aria-label": "그룹 선택" },
    });
    this.paintGroupChips();

    this.scopeCountEl = section.createDiv({
      cls: "charinfo-share-modal__hint",
    });
  }

  private paintArchiveChips(): void {
    const wrap = this.archiveWrap;
    if (!wrap) return;
    wrap.empty();
    const archives = this.listArchives();
    if (archives.length === 0) {
      wrap.createSpan({
        cls: "charinfo-share-modal__chip is-muted",
        text: "없음",
      });
      return;
    }
    for (const archive of archives) {
      const on = this.selectedArchives.has(archive);
      const btn = wrap.createEl("button", {
        cls: "charinfo-share-modal__chip" + (on ? " is-active" : ""),
        text: archive || "미분류",
        attr: {
          type: "button",
          "aria-pressed": on ? "true" : "false",
        },
      });
      btn.addEventListener("click", () => {
        if (this.busy) return;
        if (on) {
          if (this.selectedArchives.size <= 1) return;
          this.selectedArchives.delete(archive);
          this.syncGroupsToSelectedArchives({ selectAllNew: false });
        } else {
          this.selectedArchives.add(archive);
          this.syncGroupsToSelectedArchives({ selectAllNew: true });
        }
        this.paintArchiveChips();
        this.paintGroupChips();
        this.refreshScopeCount();
      });
    }
  }

  private paintGroupChips(): void {
    const wrap = this.groupWrap;
    if (!wrap) return;
    wrap.empty();
    const entries = this.listGroupEntries();
    if (entries.length === 0) {
      wrap.createSpan({
        cls: "charinfo-share-modal__chip is-muted",
        text: "없음",
      });
      return;
    }
    const allOn = entries.every((e) => this.selectedGroups.has(e.key));
    const allBtn = wrap.createEl("button", {
      cls: "charinfo-share-modal__chip" + (allOn ? " is-active" : ""),
      text: "모두",
      attr: { type: "button", "aria-pressed": allOn ? "true" : "false" },
    });
    allBtn.addEventListener("click", () => {
      if (this.busy) return;
      if (allOn) this.selectedGroups.clear();
      else for (const e of entries) this.selectedGroups.add(e.key);
      this.paintGroupChips();
      this.refreshScopeCount();
    });
    for (const entry of entries) {
      const on = this.selectedGroups.has(entry.key);
      const btn = wrap.createEl("button", {
        cls: "charinfo-share-modal__chip" + (on ? " is-active" : ""),
        text: entry.label,
        attr: {
          type: "button",
          "aria-pressed": on ? "true" : "false",
        },
      });
      btn.addEventListener("click", () => {
        if (this.busy) return;
        if (on) this.selectedGroups.delete(entry.key);
        else this.selectedGroups.add(entry.key);
        this.paintGroupChips();
        this.refreshScopeCount();
      });
    }
  }

  private refreshScopeCount(): void {
    if (!this.scopeCountEl) return;
    const n = this.selectedRecords().length;
    this.scopeCountEl.setText(
      n === 0 ? "선택된 카드가 없어요." : `${n}장 포함`,
    );
    if (this.primaryBtn) {
      this.primaryBtn.disabled = this.busy || n === 0;
    }
    if (this.advancedOpen) void this.refreshHeaderChips();
  }

  private renderAdvancedOptions(root: HTMLElement): void {
    const imageField = this.renderField(root, "노트 이미지");
    const imageToggle = imageField.createEl("label", {
      cls: "charinfo-share-modal__image-toggle",
    });
    const imageInput = imageToggle.createEl("input", { attr: { type: "checkbox" } });
    imageInput.checked = this.includeNoteImages;
    imageInput.addEventListener("change", () => {
      this.includeNoteImages = imageInput.checked;
    });
    imageToggle.createSpan({ text: "추가한 이미지도 웹에 표시" });

    // Panel header chips are always visible — not buried behind a toggle.
    // (Users need to pick what the shared page shows on both hosted + GitHub.)
    const field = this.renderField(root, "옆 패널에 보일 정보");
    this.headerChipsEl = field.createDiv({
      cls: "charinfo-share-modal__chip-groups",
      attr: { role: "group", "aria-label": "옆 패널 헤더" },
    });
    this.paintHeaderChips();
    void this.refreshHeaderChips();

    // Hosted-only: link TTL. GitHub Pages keeps a fixed URL.
    if (this.hostMode === "hosted") {
      this.renderHostedTtl(root);
    }
  }

  private async refreshHeaderChips(): Promise<void> {
    const selected = this.selectedRecords();
    try {
      this.availableHeaders = await collectPanelHeaders(this.app, selected);
    } catch {
      this.availableHeaders = [SHARE_ATTR_HEADER];
    }
    // Drop selections that are no longer present.
    const avail = new Set(this.availableHeaders);
    for (const h of [...this.panelHeaders]) {
      if (!avail.has(h)) this.panelHeaders.delete(h);
    }
    if (this.panelHeaders.size === 0 && avail.has(SHARE_ATTR_HEADER)) {
      this.panelHeaders.add(SHARE_ATTR_HEADER);
    }
    this.persistPanelHeaders();
    this.paintHeaderChips();
  }

  private paintHeaderChips(): void {
    const root = this.headerChipsEl;
    if (!root) return;
    const groups = groupPanelHeaders(this.availableHeaders);
    const structureKey = groups
      .map((g) => `${g.id}:${g.headers.join(",")}`)
      .join("|");

    // Same chip layout → only sync active state (no remount / no jump).
    if (
      root.dataset.structureKey === structureKey &&
      root.querySelector(".charinfo-share-modal__chips--primary")
    ) {
      this.syncHeaderChipState(groups);
      return;
    }

    root.dataset.structureKey = structureKey;
    root.empty();
    if (groups.length === 0) {
      root.createSpan({
        cls: "charinfo-share-modal__chip is-muted",
        text: "헤더 없음",
      });
      return;
    }

    // Primary: one chip per hierarchy group (tap = toggle whole group).
    const primary = root.createDiv({
      cls: "charinfo-share-modal__chips charinfo-share-modal__chips--primary",
      attr: { role: "group", "aria-label": "정보 그룹" },
    });

    for (const group of groups) {
      const btn = primary.createEl("button", {
        cls: "charinfo-share-modal__chip charinfo-share-modal__chip--primary",
        text: group.label,
        attr: {
          type: "button",
          "data-group-id": group.id,
          title:
            group.headers.length > 1
              ? group.headers.join(" · ")
              : group.headers[0] ?? group.label,
        },
      });
      btn.addEventListener("click", () => {
        if (this.busy) return;
        const allOn = group.headers.every((h) => this.panelHeaders.has(h));
        if (allOn) {
          const remaining = new Set(this.panelHeaders);
          for (const h of group.headers) remaining.delete(h);
          if (remaining.size === 0) return;
          for (const h of group.headers) this.panelHeaders.delete(h);
        } else {
          for (const h of group.headers) this.panelHeaders.add(h);
        }
        this.persistPanelHeaders();
        this.paintHeaderChips();
      });
    }

    // Always reserve refine rows for multi-header groups (stable height while toggling).
    for (const group of groups) {
      if (group.headers.length <= 1) continue;
      const block = root.createDiv({
        cls: "charinfo-share-modal__chip-refine",
        attr: { "data-group-id": group.id },
      });
      block.createDiv({
        cls: "charinfo-share-modal__chip-refine-label",
        text: group.label,
      });
      const chips = block.createDiv({
        cls: "charinfo-share-modal__chips charinfo-share-modal__chips--sub",
        attr: {
          role: "group",
          "aria-label": `${group.label} 세부`,
        },
      });
      for (const header of group.headers) {
        const btn = chips.createEl("button", {
          cls: "charinfo-share-modal__chip",
          text: header,
          attr: {
            type: "button",
            "data-header": header,
          },
        });
        btn.addEventListener("click", () => {
          if (this.busy) return;
          const on = this.panelHeaders.has(header);
          if (on) {
            if (this.panelHeaders.size <= 1) return;
            this.panelHeaders.delete(header);
          } else {
            this.panelHeaders.add(header);
          }
          this.persistPanelHeaders();
          this.paintHeaderChips();
        });
      }
    }

    this.syncHeaderChipState(groups);
  }

  private syncHeaderChipState(
    groups: ReturnType<typeof groupPanelHeaders>,
  ): void {
    const root = this.headerChipsEl;
    if (!root) return;

    for (const group of groups) {
      const allOn = group.headers.every((h) => this.panelHeaders.has(h));
      const someOn = group.headers.some((h) => this.panelHeaders.has(h));
      const primary = root.querySelector(
        `.charinfo-share-modal__chip--primary[data-group-id="${CSS.escape(group.id)}"]`,
      );
      if (primary instanceof HTMLElement) {
        primary.toggleClass("is-active", allOn);
        primary.toggleClass("is-partial", !allOn && someOn);
        primary.setAttribute("aria-pressed", allOn ? "true" : "false");
      }

      const refine = root.querySelector(
        `.charinfo-share-modal__chip-refine[data-group-id="${CSS.escape(group.id)}"]`,
      );
      if (refine instanceof HTMLElement) {
        // Dim when group fully off — still occupies space so the panel doesn't jump.
        refine.toggleClass("is-idle", !someOn);
      }

      for (const header of group.headers) {
        const chip = root.querySelector(
          `.charinfo-share-modal__chip[data-header="${CSS.escape(header)}"]`,
        );
        if (!(chip instanceof HTMLElement)) continue;
        const on = this.panelHeaders.has(header);
        chip.toggleClass("is-active", on);
        chip.setAttribute("aria-pressed", on ? "true" : "false");
      }
    }
  }

  private persistPanelHeaders(): void {
    this.plugin.settings.webSharePanelHeaders = [...this.panelHeaders];
    void this.plugin.saveSettings();
  }

  private renderHostedTtl(root: HTMLElement): void {
    const field = this.renderField(root, "유지 기간");
    this.durationRow = field.createDiv({
      cls: "charinfo-share-modal__seg",
      attr: { role: "group", "aria-label": "링크 유지 기간" },
    });
    this.paintHostedTtl();
  }

  private paintHostedTtl(): void {
    const row = this.durationRow;
    if (!row) return;
    row.empty();
    const options: { id: HostedShareTtl; label: string }[] = [
      { id: "7d", label: "7일" },
      { id: "30d", label: "30일" },
      { id: "permanent", label: "1년" },
    ];
    for (const opt of options) {
      const selected = this.hostedTtl === opt.id;
      const btn = row.createEl("button", {
        cls:
          "charinfo-share-modal__seg-btn" + (selected ? " is-active" : ""),
        text: opt.label,
        attr: {
          type: "button",
          "aria-pressed": selected ? "true" : "false",
        },
      });
      btn.addEventListener("click", () => {
        if (this.busy || this.hostedTtl === opt.id) return;
        this.hostedTtl = opt.id;
        this.plugin.settings.webShareHostedTtl = opt.id;
        void this.plugin.saveSettings();
        this.paintHostedTtl();
      });
    }
  }

  private renderLiveLinkSection(
    root: HTMLElement,
    lastUrl: string,
    canManage: boolean,
    opts: { ruled?: boolean } = {},
  ): void {
    const ruled = opts.ruled !== false;
    const linkSection = root.createDiv({
      cls:
        "charinfo-share-modal__section" +
        (ruled ? " charinfo-share-modal__section--ruled" : ""),
    });
    const linkField = this.renderField(linkSection, "공개 링크");
    this.renderLinkBlock(linkField, lastUrl, { labeled: false });
    if (canManage) {
      const stopBtn = linkSection.createEl("button", {
        cls: "charinfo-share-modal__danger",
        text: "공유 중지",
        attr: { type: "button" },
      });
      stopBtn.addEventListener("click", () => void this.stopSharing());
    } else {
      linkSection.createDiv({
        cls: "charinfo-share-modal__hint",
        text: "이 링크는 업데이트할 수 없어요. 위에서 새 링크를 만드세요.",
      });
    }
  }

  /** When GitHub is connected, let the user pick hosted vs GitHub explicitly. */
  private renderHostSwitcher(root: HTMLElement): void {
    if (!isGithubShareConfigured(this.plugin.settings)) return;
    const field = this.renderField(root, "공유 방식");
    const row = field.createDiv({
      cls: "charinfo-share-modal__seg",
      attr: { role: "group", "aria-label": "공유 방식" },
    });
    const options: { id: Panel; label: string }[] = [
      { id: "hosted", label: "기본 링크" },
      { id: "github", label: "GitHub" },
    ];
    for (const opt of options) {
      const selected = this.panel === opt.id;
      const btn = row.createEl("button", {
        cls:
          "charinfo-share-modal__seg-btn" + (selected ? " is-active" : ""),
        text: opt.label,
        attr: {
          type: "button",
          "aria-pressed": selected ? "true" : "false",
        },
      });
      btn.addEventListener("click", () => {
        if (this.busy || this.panel === opt.id) return;
        this.panel = opt.id;
        this.hostMode = opt.id;
        this.forceReconnect = false;
        this.plugin.settings.webShareHost = opt.id;
        void this.plugin.saveSettings();
        this.onOpen();
      });
    }
  }

  private renderAltMethods(root: HTMLElement): void {
    // Connected users switch via 공유 방식 — don't duplicate as a second door.
    if (isGithubShareConfigured(this.plugin.settings)) return;

    const other = root.createDiv({
      cls: "charinfo-share-modal__section charinfo-share-modal__section--ruled",
    });
    const otherField = this.renderField(other, "다른 방법 (선택)");
    const gh = otherField.createEl("button", {
      cls: "charinfo-share-modal__alt",
      attr: { type: "button" },
    });
    gh.createDiv({
      cls: "charinfo-share-modal__alt-title",
      text: "내 GitHub에 연결",
    });
    gh.createDiv({
      cls: "charinfo-share-modal__alt-desc",
      text: "내 계정에 고정 주소로 올려 두고 싶을 때 (한 번만 설정)",
    });
    gh.addEventListener("click", () => {
      this.sessionUrl = "";
      this.panel = "github";
      this.hostMode = "github";
      this.onOpen();
    });
  }

  private renderPrimaryAction(
    root: HTMLElement,
    label: string,
    onClick: () => void,
  ): void {
    this.primaryBtn = root.createEl("button", {
      cls: "mod-cta charinfo-share-modal__cta",
      text: label,
      attr: { type: "button" },
    });
    this.primaryBtn.addEventListener("click", onClick);
  }

  private renderLinkBlock(
    root: HTMLElement,
    initialUrl = "",
    opts: { labeled?: boolean } = {},
  ): void {
    root.querySelector(".charinfo-share-modal__result")?.remove();

    const url = initialUrl.trim();
    if (!url) return;

    const block = root.createDiv({ cls: "charinfo-share-modal__result" });
    if (opts.labeled !== false) {
      block.createDiv({
        cls: "charinfo-share-modal__result-label",
        text: "공개 링크",
      });
    }

    const row = block.createDiv({ cls: "charinfo-share-modal__link-row" });
    this.linkEl = row.createEl("input", {
      type: "text",
      cls: "charinfo-share-modal__link",
      attr: {
        readonly: "readonly",
        spellcheck: "false",
      },
    });
    this.linkEl.value = url;

    const copyBtn = row.createEl("button", {
      cls: "charinfo-share-modal__copy",
      text: "복사",
      attr: { type: "button" },
    });
    copyBtn.addEventListener("click", () => void this.copyLink());
  }

  private renderGithubConnect(root: HTMLElement): void {
    this.setTitle("내 GitHub 연결");
    root.createDiv({
      cls: "charinfo-share-modal__lead",
      text: "내 GitHub에 갤러리 페이지를 올려 두면, 바뀌지 않는 주소로 공유할 수 있어요. 아래는 한 번만 하면 됩니다.",
    });

    const steps = root.createDiv({ cls: "charinfo-share-modal__steps" });
    steps.createDiv({
      cls: "charinfo-share-modal__steps-title",
      text: "이렇게 하세요",
    });
    const list = steps.createEl("ol", { cls: "charinfo-share-modal__step-list" });
    list.createEl("li", {
      text: "「GitHub에서 키 만들기」를 눌러 브라우저를 엽니다.",
    });
    list.createEl("li", {
      text: "초록 버튼 Generate token 을 누릅니다. (public_repo 칸이 이미 체크돼 있으면 그대로 두세요.)",
    });
    list.createEl("li", {
      text: "화면에 나온 긴 글자(키)를 복사한 뒤, 아래 칸에 붙여넣고 「연결하기」를 누릅니다.",
    });
    steps.createDiv({
      cls: "charinfo-share-modal__steps-note",
      text: "키는 GitHub가 한 번만 보여 줍니다. 이 앱 설정에만 저장되며, 다른 사람과 나누지 마세요.",
    });

    const getKey = root.createEl("button", {
      cls: "mod-cta charinfo-share-modal__cta",
      text: "GitHub에서 키 만들기",
      attr: { type: "button" },
    });
    getKey.addEventListener("click", () => {
      window.open(githubTokenCreateUrl(), "_blank");
    });

    const tokenField = this.renderField(root, "복사한 키 붙여넣기");
    const paste = tokenField.createEl("input", {
      type: "password",
      cls: "charinfo-share-modal__token",
      attr: {
        placeholder: "여기에 붙여넣기",
        autocomplete: "off",
        spellcheck: "false",
      },
    });
    paste.value = this.pendingGithubToken;
    paste.addEventListener("input", () => {
      this.pendingGithubToken = paste.value.trim();
    });

    this.renderPrimaryAction(root, "연결하기", () => void this.saveGithubConnect());
    this.statusEl = root.createDiv({ cls: "charinfo-share-modal__status" });

    const footer = root.createDiv({ cls: "charinfo-share-modal__footer" });
    const back = footer.createEl("button", {
      cls: "charinfo-share-modal__quiet",
      text: "기본 공유로",
      attr: { type: "button" },
    });
    back.addEventListener("click", () => {
      this.panel = "hosted";
      this.onOpen();
    });
  }

  private async saveGithubConnect(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.setBusyUi(true);
    this.setStatus("연결 중…");
    try {
      const token = this.pendingGithubToken.trim();
      const setup = await setupGithubShareFromToken(token);
      this.plugin.settings.webShareGithubToken = token;
      this.plugin.settings.webShareGithubRepo = setup.repo;
      this.plugin.settings.webShareGithubBranch = setup.branch;
      this.plugin.settings.webShareHost = "github";
      await this.plugin.saveSettings();
      this.forceReconnect = false;
      new Notice(
        setup.createdRepo
          ? `연결됐어요. 공유용 저장소도 만들어 두었습니다.\n${setup.repo}`
          : `연결됐어요 · ${setup.repo}`,
      );
      this.panel = "github";
      this.hostMode = "github";
      this.onOpen();
    } catch (error) {
      this.setStatus(
        `연결에 실패했어요: ${error instanceof Error ? error.message : String(error)}`,
      );
      new Notice("연결에 실패했어요. 키를 다시 확인해 주세요.");
    } finally {
      this.busy = false;
      this.setBusyUi(false);
    }
  }

  private renderGithubPublish(root: HTMLElement): void {
    this.setTitle("GitHub로 공유");
    this.renderHostSwitcher(root);
    const displayUrl = this.githubShareDisplayUrl();
    const hasPublished =
      Boolean(this.sessionUrl.trim()) ||
      this.isGithubPagesUrl(this.plugin.settings.webShareLastUrl.trim()) ||
      Boolean(this.plugin.settings.webShareGithubPath.trim());

    root.createDiv({
      cls: "charinfo-share-modal__lead",
      text: hasPublished
        ? "같은 GitHub 링크로 내용만 덮어씁니다. 받는 사람 주소를 바꿀 필요 없어요."
        : "아래 주소가 고정 링크예요. 「GitHub에 올리기」로 바로 게시할 수 있어요.",
    });

    // Always show scope + panel chips on gallery share (and on character share
    // still show panel chips so users can pick what appears).
    if (!this.selectionLocked) {
      this.renderScopePickers(root);
    }
    this.renderAdvancedOptions(root);

    if (displayUrl) {
      const linkField = this.renderField(root, "공개 링크");
      this.renderLinkBlock(linkField, displayUrl, { labeled: false });
      this.renderPrimaryAction(
        root,
        hasPublished ? "이 링크 업데이트" : "GitHub에 올리기",
        () => void this.publish(),
      );
    } else {
      this.renderPrimaryAction(root, "GitHub에 올리기", () => void this.publish());
    }

    this.statusEl = root.createDiv({ cls: "charinfo-share-modal__status" });

    const footer = root.createDiv({ cls: "charinfo-share-modal__footer" });
    const reconnect = footer.createEl("button", {
      cls: "charinfo-share-modal__quiet",
      text: "계정 다시 연결",
      attr: { type: "button" },
    });
    reconnect.addEventListener("click", () => {
      this.forceReconnect = true;
      this.onOpen();
    });
    const back = footer.createEl("button", {
      cls: "charinfo-share-modal__quiet",
      text: "기본 공유로",
      attr: { type: "button" },
    });
    back.addEventListener("click", () => {
      this.panel = "hosted";
      this.hostMode = "hosted";
      this.plugin.settings.webShareHost = "hosted";
      void this.plugin.saveSettings();
      this.onOpen();
    });
  }

  /** Stable Pages URL to show as soon as GitHub is connected. */
  private githubShareDisplayUrl(): string {
    const session = this.sessionUrl.trim();
    if (session && this.isGithubPagesUrl(session)) return session;
    const last = this.plugin.settings.webShareLastUrl.trim();
    if (last && this.isGithubPagesUrl(last)) return last;
    return this.predictedGithubUrl();
  }

  private isGithubPagesUrl(url: string): boolean {
    if (!url) return false;
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host.endsWith(".github.io");
    } catch {
      return false;
    }
  }

  private async copyLink(): Promise<void> {
    const url = this.linkEl?.value.trim();
    if (!url) {
      new Notice("아직 링크가 없어요.");
      return;
    }
    const ok = await copyTextToClipboard(url);
    new Notice(ok ? "링크 복사됨" : "복사 실패");
  }

  private predictedGithubUrl(): string {
    const s = this.plugin.settings;
    const parsed = parseGithubRepo(s.webShareGithubRepo);
    if (!parsed) return "";
    const path = githubPathForSlug(this.linkSlug);
    return githubPagesPublicUrl(parsed.owner, parsed.name, path);
  }

  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.setText(text);
  }

  private setBusyUi(busy: boolean): void {
    if (this.primaryBtn) {
      this.primaryBtn.disabled =
        busy || this.selectedRecords().length === 0;
    }
  }

  private async buildHtml(): Promise<string> {
    const selected = this.selectedRecords();
    const genre = this.shareTitle();
    const present = [
      ...new Set(selected.map((r) => r.그룹.trim()).filter(Boolean)),
    ];
    const archive = [...this.selectedArchives][0] || "";
    const scope = readGalleryScope(
      this.app,
      this.pageFile ?? this.app.workspace.getActiveFile(),
      this.plugin.settings,
    );
    const library = scope.library || this.plugin.settings.libraryFolder;
    const groupOrder = resolveGroupOrder(
      getGroupOrderFor(this.plugin.settings, library, archive),
      present,
    );
    // The source page's axis, not the global default.
    const axis = getFilterAxisForPage(this.plugin.settings, scope);
    const payload = await buildSharePayload(this.app, selected, {
      title: this.shareTitle(),
      genre,
      chipFilter: this.plugin.settings.chipFilter,
      tagVocab: this.plugin.settings.tagVocab,
      cardProperties: this.plugin.settings.cardProperties,
      groupOrder,
      panelHeaders: [...this.panelHeaders],
      includeNoteImages: this.includeNoteImages,
      panelProps: this.plugin.settings.webSharePanelProps,
      statuses: this.plugin.settings.statuses,
      filterProperty: axis.propertyId,
      filterOptions: axis.options,
      // Every chip-axis vocabulary, so a non-primary built-in (관계 / 인연 /
      // 소속) publishes its renamed label instead of the stored option id.
      axisSource: this.plugin.settings,
      propertyDisplayNames: this.plugin.settings.propertyDisplayNames,
      // Group schemas decide which fields each card publishes; eyes are read
      // per (page, archive) for the card previews only.
      schemaSource: this.plugin.settings,
      library,
      pagePath: this.pageFile?.path ?? "",
    });
    const html = renderShareHtml(payload);
    checkShareSize(html);
    return html;
  }

  private async publish(opts: { update?: boolean } = {}): Promise<void> {
    if (this.busy) return;
    const selected = this.selectedRecords();
    if (selected.length === 0) {
      new Notice("공유할 카드가 없어요. 아카이브·그룹을 선택하세요.");
      return;
    }
    const update = Boolean(opts.update);
    const pagePath = this.pageSharePath();
    const pageShare = this.pageHostedShare();
    if (update) {
      if (
        !pageShare?.id.trim() ||
        !pageShare.manageKey.trim() ||
        !hostedShareBaseFromUrl(pageShare.url)
      ) {
        new Notice("업데이트할 링크 열쇠가 없어요. 새 링크를 만드세요.");
        return;
      }
    }
    this.busy = true;
    this.setBusyUi(true);
    this.setStatus(update ? "업데이트 중…" : "만드는 중…");
    try {
      const html = await this.buildHtml();
      let url: string;
      let note: string;

      if (this.hostMode === "hosted") {
        this.setStatus(
          `${update ? "업데이트" : "올리는 중"}… ${Math.round(html.length / 1024)} KB`,
        );
        const targetBaseUrl = update
          ? hostedShareBaseFromUrl(pageShare!.url)
          : this.plugin.settings.webShareHostedBaseUrl;
        const result = update
          ? await updateHostedShare(html, {
              baseUrl: targetBaseUrl,
              id: pageShare!.id,
              manageKey: pageShare!.manageKey,
              uploadKey: uploadKeyForHostedTarget(
                targetBaseUrl,
                this.plugin.settings.webShareHostedBaseUrl,
                this.plugin.settings.webShareHostedUploadKey,
              ),
              ttl: this.hostedTtl,
            })
          : await uploadToHostedShare(html, {
              baseUrl: targetBaseUrl,
              uploadKey: uploadKeyForHostedTarget(
                targetBaseUrl,
                this.plugin.settings.webShareHostedBaseUrl,
                this.plugin.settings.webShareHostedUploadKey,
              ),
              ttl: this.hostedTtl,
        });
        url = result.url;
        const at = new Date().toISOString();
        const manageKey =
          result.manageKey || (update ? pageShare?.manageKey : "") || "";
        setWebShareForPage(this.plugin.settings, pagePath, {
          url,
          id: result.id,
          manageKey,
          at,
          htmlVersion: SHARE_HTML_VERSION,
          includeNoteImages: this.includeNoteImages,
        });
        const ttlLabel =
          result.ttl === "permanent"
            ? "1년"
            : result.ttl === "7d"
              ? "7일"
              : "30일";
        note = update
          ? "같은 링크 내용이 갱신됐어요."
          : `링크 생성됨 · ${ttlLabel} 유지.`;
      } else {
        if (!isGithubShareConfigured(this.plugin.settings)) {
          throw new Error("먼저 GitHub를 연결하세요.");
        }
        const slug = slugifyLinkName(this.linkSlug);
        const path = githubPathForSlug(slug);
        this.setStatus(`올리는 중… ${Math.round(html.length / 1024)} KB`);
        const result = await publishToGithubPages(html, {
          token: this.plugin.settings.webShareGithubToken,
          repo: this.plugin.settings.webShareGithubRepo,
          branch: this.plugin.settings.webShareGithubBranch,
          path,
        });
        url = result.url;
        this.plugin.settings.webShareLinkSlug = slug;
        this.plugin.settings.webShareGithubPath = path;
        note = result.updated
          ? `「${slug}」 갱신됨. 약 1분 후 새로고침.`
          : `「${slug}」 게시됨.`;
      }

      this.sessionUrl = url;
      recordLastShareUnlessLegacy(
        this.plugin.settings,
        url,
        new Date().toISOString(),
        SHARE_HTML_VERSION,
      );
      this.plugin.settings.webSharePanelHeaders = [...this.panelHeaders];
      this.plugin.settings.webShareHost = this.hostMode;
      await this.plugin.saveSettings();

      const ok = await copyTextToClipboard(url);
      new Notice(ok ? (update ? "업데이트됨 · 링크 복사" : "링크 복사됨") : "게시 완료");

      if (this.panel === "hosted" || this.panel === "github") {
        this.busy = false;
        this.onOpen();
        this.setStatus(ok ? `${note} 복사됨.` : note);
      } else {
        this.contentEl.querySelector(".charinfo-share-modal__result")?.remove();
        this.renderLinkBlock(this.contentEl, url);
        this.setStatus(ok ? `${note} 복사됨.` : note);
      }
    } catch (error) {
      console.error(error);
      this.setStatus(
        `실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      new Notice(update ? "업데이트 실패" : "웹 게시 실패");
    } finally {
      this.busy = false;
      this.setBusyUi(false);
      this.refreshScopeCount();
    }
  }

  private async stopSharing(): Promise<void> {
    if (this.busy) return;
    const pageShare = this.pageHostedShare();
    const id = pageShare?.id.trim() ?? "";
    const manageKey = pageShare?.manageKey.trim() ?? "";
    const targetBaseUrl = hostedShareBaseFromUrl(pageShare?.url ?? "");
    if (!id || !manageKey || !targetBaseUrl) {
      new Notice("중지할 링크 열쇠가 없어요.");
      return;
    }
    this.busy = true;
    this.setBusyUi(true);
    this.setStatus("공유 중지 중…");
    try {
      await deleteHostedShare({
        baseUrl: targetBaseUrl,
        id,
        manageKey,
        uploadKey: uploadKeyForHostedTarget(
          targetBaseUrl,
          this.plugin.settings.webShareHostedBaseUrl,
          this.plugin.settings.webShareHostedUploadKey,
        ),
      });
      this.sessionUrl = "";
      clearWebShareForPage(this.plugin.settings, this.pageSharePath());
      clearLastShareIfSameUrl(this.plugin.settings, pageShare?.url ?? "");
      await this.plugin.saveSettings();
      new Notice("공유 중지됨 · 이미 열린 사본은 잠시 남을 수 있어요.");
      this.busy = false;
      this.onOpen();
      this.setStatus("공유가 중지됐어요. 캐시된 사본은 잠시 남을 수 있어요.");
    } catch (error) {
      console.error(error);
      this.setStatus(
        `실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      new Notice("공유 중지 실패");
    } finally {
      this.busy = false;
      this.setBusyUi(false);
      this.refreshScopeCount();
    }
  }
}
