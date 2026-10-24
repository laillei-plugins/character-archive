// @ts-expect-error TS5097: native Node TS tests.
import { displayPropertyLabel } from "../i18n/display.ts";
// @ts-expect-error TS5097: explicit extension also supports the native Node TS tests.
import { t } from "../i18n/index.ts";
import { App, Modal, Notice, Setting } from "obsidian";
import type CharinfoPlugin from "../main";
import { createGalleryPage } from "../page/galleryPage";
import {
  FILTER_AXIS_IDS,
  axisFor,
  axisLabel as rawAxisLabel,
  type PrimaryFilterProperty,
} from "../settings";

/**
 * Create a gallery note with optional library (B) and archive pin (A).
 */
export class CreateGalleryModal extends Modal {
  private plugin: CharinfoPlugin;
  private title = "";
  private library = "";
  private archive = "";
  /** Empty = follow the global 「메인 필터」 setting. */
  private primaryFilter = "";
  /** Empty = follow the globally remembered chip. */
  private defaultChipFilter = "";
  private chipRowEl: HTMLElement | null = null;

  constructor(
    app: App,
    plugin: CharinfoPlugin,
    defaults?: { library?: string; archive?: string; title?: string },
  ) {
    super(app);
    this.plugin = plugin;
    this.library =
      defaults?.library?.trim() || plugin.settings.libraryFolder;
    this.archive = defaults?.archive?.trim() || "";
    this.title = defaults?.title?.trim() || this.archive || "";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("charinfo-create-gallery-modal");
    this.modalEl.addClass("charinfo-create-gallery-modal-shell");
    this.setTitle(t("createNewGallery"));

    contentEl.createDiv({
      cls: "setting-item-description",
      text: t("keepTheFolderUnchangedToSeeTheSame"),
    });

    new Setting(contentEl)
      .setName(t("tabName"))
      .setDesc(t("nameShownInTheFileListAndTab"))
      .addText((text) => {
        text
          .setPlaceholder(t("nameToShowInTheTab"))
          .setValue(this.title)
          .onChange((value) => {
            this.title = value;
          });
      });

    new Setting(contentEl)
      .setName(t("folderContainingCards"))
      .setDesc(
        t("theCardLibraryForThisTabKeepIt"),
      )
      .addText((text) => {
        text
          .setPlaceholder("Character Archive")
          .setValue(this.library)
          .onChange((value) => {
            this.library = value;
          });
      });

    new Setting(contentEl)
      .setName(t("archiveNameAboveTheGallery"))
      .setDesc(
        t("theNameAboveTheGalleryLeaveBlankTo"),
      )
      .addText((text) => {
        text
          .setPlaceholder(t("leaveBlankToAllowSwitchingByClick"))
          .setValue(this.archive)
          .onChange((value) => {
            this.archive = value;
          });
      });

    new Setting(contentEl)
      .setName(t("filterChipsForThisTabOptional"))
      .setDesc(t("whatTheOnOffChipsFilterLeaveBlank"))
      .addDropdown((dropdown) => {
        dropdown.addOption("", t("usePluginDefault"));
        for (const id of FILTER_AXIS_IDS) {
          dropdown.addOption(
            id,
            axisLabel(id, this.plugin.settings.propertyDisplayNames),
          );
        }
        dropdown.setValue(this.primaryFilter).onChange((value) => {
          this.primaryFilter = value;
          // Chip ids belong to one vocabulary — drop a stale pick.
          this.defaultChipFilter = "";
          this.renderChipRow();
        });
      });

    this.chipRowEl = contentEl.createDiv();
    this.renderChipRow();

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText(t("create"))
        .setCta()
        .onClick(() => void this.submit()),
    );
  }

  /** First-open chip for the new page — options follow the chosen axis. */
  private renderChipRow(): void {
    const host = this.chipRowEl;
    if (!host) return;
    host.empty();
    const axisId = (this.primaryFilter ||
      this.plugin.settings.primaryFilterProperty) as PrimaryFilterProperty;
    const options = axisFor(this.plugin.settings, axisId).options;

    new Setting(host)
      .setName(t("initialChipOptional"))
      .setDesc(t("theChipSelectedWhenThisTabFirstOpens"))
      .addDropdown((dropdown) => {
        dropdown.addOption("", t("followSettings"));
        dropdown.addOption("all", t("all"));
        for (const option of options) {
          dropdown.addOption(option.id, option.label);
        }
        dropdown.setValue(this.defaultChipFilter).onChange((value) => {
          this.defaultChipFilter = value;
        });
      });
  }

  onClose(): void {
    this.contentEl.empty();
    this.modalEl.removeClass("charinfo-create-gallery-modal-shell");
  }

  private async submit(): Promise<void> {
    const library = this.library.trim() || this.plugin.settings.libraryFolder;
    const archive = this.archive.trim();
    const title =
      this.title.trim() || archive || library.split("/").pop() || "Gallery";

    try {
      await createGalleryPage(this.plugin, {
        library,
        archive: archive || undefined,
        title,
        // Default lives in createGalleryPage → library/_galleries
        primaryFilter: this.primaryFilter || undefined,
        defaultChipFilter: this.defaultChipFilter || undefined,
      });
      this.close();
    } catch (error) {
      new Notice(
        t("couldNotCreateValue", { arg1: error instanceof Error ? error.message : String(error) }),
      );
    }
  }
}

/** Translate built-in UI labels while preserving user-renamed fields. */
function axisLabel(...args: Parameters<typeof rawAxisLabel>): string {
  return displayPropertyLabel(args[0], rawAxisLabel(...args));
}
