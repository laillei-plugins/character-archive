// @ts-expect-error TS5097: native Node TS tests.
import { displayPropertyLabel } from "../i18n/display.ts";
// @ts-expect-error TS5097: explicit extension also supports the native Node TS tests.
import { t } from "../i18n/index.ts";
import {
  App,
  Modal,
  normalizePath,
  Notice,
  PluginSettingTab,
  Setting,
  TFolder,
} from "obsidian";
import type CharinfoPlugin from "../main";
import type {
  ImageUploadDestination,
  MediaRootMode,
  PrimaryFilterProperty,
} from "../settings";
import {
  FILTER_AXIS_IDS,
  axisLabel as rawAxisLabel,
  getFilterAxis,
  resetChipFilters,
  DEFAULT_WEB_SHARE_HOSTED_BASE_URL,
  normalizeWebShareHostedBaseUrl,
  clearWebShareForPage,
  type WebShareLastState,
} from "../settings";
import { copyTextToClipboard } from "../page/galleryPage";
import { isImgurPluginAvailable } from "../media/imgurAdapter";
import { isGithubShareConfigured } from "../share/githubPages";
import {
  clearLastShareIfSameUrl,
  hasUnclaimedLegacyWebShare,
} from "../share/webShareState";
import {
  deleteHostedShare,
  hostedShareBaseFromUrl,
  uploadKeyForHostedTarget,
} from "../share/hostedShare";

class StopHostedShareModal extends Modal {
  constructor(
    app: App,
    private readonly label: string,
    private readonly url: string,
    private readonly onConfirm: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle(t("stopSharing"));
    contentEl.createEl("p", {
      text: t("thePublicPageForValueWillBeRemoved", { arg1: this.label }),
    });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: this.url,
    });

    let cancelButton: { setDisabled(value: boolean): unknown } | null = null;
    let stopButton: { setDisabled(value: boolean): unknown } | null = null;
    new Setting(contentEl)
      .addButton((button) => {
        cancelButton = button;
        button.setButtonText(t("cancel")).onClick(() => this.close());
      })
      .addButton((button) => {
        stopButton = button;
        button
          .setButtonText(t("stopSharing2"))
          .setWarning()
          .onClick(async () => {
            cancelButton?.setDisabled(true);
            stopButton?.setDisabled(true);
            try {
              await this.onConfirm();
              this.close();
            } catch (error) {
              console.error(error);
              new Notice(t("couldNotStopSharingTheLinkIsStill"));
              cancelButton?.setDisabled(false);
              stopButton?.setDisabled(false);
            }
          });
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class CharinfoSettingTab extends PluginSettingTab {
  plugin: CharinfoPlugin;

  constructor(app: App, plugin: CharinfoPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Language / 언어")
      .setDesc(t("languageSettingDescription"))
      .addDropdown((dropdown) => dropdown
        .addOption("en", "English")
        .addOption("ko", "한국어")
        .setValue(this.plugin.settings.language)
        .onChange(async (value) => {
          if (value !== "en" && value !== "ko") return;
          await this.plugin.setLanguage(value);
          this.display();
        }));

    const glossary = containerEl.createDiv({
      cls: "setting-item-description charinfo-settings__glossary",
    });
    glossary.createDiv({ text: t("archiveTheNameAboveTheGallery") });
    glossary.createDiv({ text: t("groupTheHeadingAboveARowOfCards") });
    glossary.createDiv({
      text: t("tabAnotherViewOfTheSameCardsIt"),
    });

    new Setting(containerEl)
      .setName(t("folderContainingCards"))
      .setDesc(
        t("theLibraryContainingCharacterNotesChangingItMay"),
      )
      .addText((text) => {
        const input = text
          .setPlaceholder("Character Archive")
          .setValue(this.plugin.settings.libraryFolder);
        let fromFolder = this.plugin.settings.libraryFolder;
        input.onChange(async (value) => {
          this.plugin.settings.libraryFolder = normalizePath(
            value.trim() || "Character Archive",
          );
          await this.plugin.saveSettings();
        });
        text.inputEl.addEventListener("focus", () => {
          fromFolder = this.plugin.settings.libraryFolder;
        });
        text.inputEl.addEventListener("blur", () => {
          void (async () => {
            const toFolder = this.plugin.settings.libraryFolder;
            if (!fromFolder || fromFolder === toFolder) return;
            const { rewriteLibraryPathPrefix } = await import("../data/images");
            const n = await rewriteLibraryPathPrefix(
              this.app,
              toFolder,
              fromFolder,
              toFolder,
            );
            if (n > 0) {
              new Notice(
                t("imagesReconnectedValueNotesValueValue", { arg1: n, arg2: fromFolder, arg3: toFolder }),
              );
              this.plugin.refreshOpenGalleries();
            }
            fromFolder = toFolder;
          })();
        });
      });

    new Setting(containerEl)
      .setName(t("initialArchive"))
      .setDesc(
        t("theArchiveShownWhenOpeningTheGalleryUse"),
      )
      .addText((text) =>
        text
          .setPlaceholder(t("nameToShowAboveTheGallery"))
          .setValue(this.plugin.settings.activeGenre)
          .onChange(async (value) => {
            this.plugin.settings.activeGenre = value.trim();
            await this.plugin.saveSettings();
            this.plugin.refreshOpenGalleries();
          }),
      );

    new Setting(containerEl)
      .setName(t("newCardTemplate"))
      .setDesc(t("aBlankNoteUsedToCreateNewCards"))
      .addText((text) =>
        text
          .setPlaceholder(t("leaveBlankForTheBuiltInTemplate"))
          .setValue(this.plugin.settings.characterTemplatePath)
          .onChange(async (value) => {
            this.plugin.settings.characterTemplatePath = normalizePath(value.trim());
            await this.plugin.saveSettings();
          }),
      );

    const templateOverrides = Object.entries(
      this.plugin.settings.characterTemplateByGenre,
    );
    containerEl.createEl("p", {
      text: templateOverrides.length
        ? t("perArchiveTemplateLocationsValue", { arg1: templateOverrides
            .map(([genre, path]) => `${genre} → ${path}`)
            .join(", ") })
        : t("pathsForSeparateArchiveTemplatesAppearHere"),
      cls: "setting-item-description",
    });

    this.renderFilterSettings(containerEl);

    new Setting(containerEl).setName(t("images")).setHeading();
    containerEl.createEl("p", {
      text: t("existingImagesStayUnchangedOnlyNewlyUploadedFiles"),
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName(t("newImageLocation"))
      .setDesc(t("theVaultFolderIsTheDefaultUseAn"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("vault", t("vaultFolderDefault"))
          .addOption("external", t("externalFolderOptional"))
          .setValue(this.plugin.settings.mediaRootMode)
          .onChange(async (value: string) => {
            this.plugin.settings.mediaRootMode = value as MediaRootMode;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    const imgurReady = isImgurPluginAvailable(this.app);
    new Setting(containerEl)
      .setName(t("coverFileUploads"))
      .setDesc(
        imgurReady
          ? t("theCoverPickerShowsFilesAndLinksOnly")
          : t("theCoverPickerShowsFilesAndLinksOnly2"),
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("vault", t("vaultDefault"));
        if (imgurReady) dropdown.addOption("imgur", t("imgurPlugin"));
        dropdown
          .setValue(
            this.plugin.settings.imageUploadDestination === "imgur" && imgurReady
              ? "imgur"
              : "vault",
          )
          .onChange(async (value: string) => {
            this.plugin.settings.imageUploadDestination =
              value as ImageUploadDestination;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(t("imageFolderInVault"))
      .setDesc(t("usedWhenSavingNewImagesInTheVault"))
      .addText((text) =>
        text
          .setPlaceholder("Character Archive")
          .setValue(this.plugin.settings.vaultMediaFolder)
          .onChange(async (value) => {
            this.plugin.settings.vaultMediaFolder = normalizePath(
              value.trim() || "Character Archive",
            );
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("externalImageFolder"))
      .setDesc(
        t("fullPathOnYourComputerRequiredOnlyWhen"),
      )
      .addText((text) =>
        text
          .setPlaceholder("/absolute/path/to/media")
          .setValue(this.plugin.settings.externalMediaPath)
          .onChange(async (value) => {
            this.plugin.settings.externalMediaPath = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("createImageFolder"))
      .setDesc(t("createsTheImageFolderIfItDoesNot"))
      .addButton((button) =>
        button.setButtonText(t("createFolder")).onClick(async () => {
          await this.plugin.media.ensureVaultMediaFolder();
          new Notice(t("theImageFolderIsReady"));
        }),
      );

    new Setting(containerEl)
      .setName(t("defaultEditMode"))
      .setDesc(t("openTheGalleryInEditModeWhenEnabled"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.defaultEditMode).onChange(async (value) => {
          this.plugin.settings.defaultEditMode = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName(t("webSharing")).setHeading();
    containerEl.createEl("p", {
      text: t("onlyWhenYouShareSelectedCardDetailsAnd"),
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName(t("shareServerAddress"))
      .setDesc(t("leaveBlankToUseTheDefaultShareServer"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_WEB_SHARE_HOSTED_BASE_URL)
          .setValue(this.plugin.settings.webShareHostedBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.webShareHostedBaseUrl =
              normalizeWebShareHostedBaseUrl(value);
            await this.plugin.saveSettings();
            // Reflect restored default in the field if user cleared it.
            text.setValue(this.plugin.settings.webShareHostedBaseUrl);
          }),
      );

    new Setting(containerEl)
      .setName(t("uploadKeyOptional"))
      .setDesc(t("enterOnlyIfYourOwnShareServerRequires"))
      .addText((text) => {
        text
          .setPlaceholder("optional")
          .setValue(this.plugin.settings.webShareHostedUploadKey)
          .onChange(async (value) => {
            this.plugin.settings.webShareHostedUploadKey = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
      });

    new Setting(containerEl)
      .setName(t("defaultLinkLifetime"))
      .setDesc(t("howLongTheLinkStaysAvailableYouCan"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("7d", t("7Days"))
          .addOption("30d", t("30Days"))
          .addOption("permanent", t("1Year"))
          .setValue(this.plugin.settings.webShareHostedTtl)
          .onChange(async (value: string) => {
            this.plugin.settings.webShareHostedTtl =
              value === "7d" || value === "permanent" ? value : "30d";
            await this.plugin.saveSettings();
          }),
      );

    this.renderHostedShareLedger(containerEl);

    const ghReady = isGithubShareConfigured(this.plugin.settings);
    new Setting(containerEl)
      .setName(t("githubBackupConnection"))
      .setDesc(
        ghReady
          ? t("connectedValue", { arg1: this.plugin.settings.webShareGithubRepo || "—" })
          : t("neededOnlyToPublishToYourGithubInstead"),
      )
      .addButton((btn) =>
        btn.setButtonText(ghReady ? t("disconnect") : t("help")).onClick(async () => {
          if (!ghReady) {
            new Notice(
              t("openTheGalleryThenChooseShareGlobeIcon"),
            );
            return;
          }
          this.plugin.settings.webShareGithubToken = "";
          this.plugin.settings.webShareGithubRepo = "";
          await this.plugin.saveSettings();
          new Notice(t("disconnectedFromGithub"));
          this.display();
        }),
      );
  }

  private managedHostedShares(): Array<{
    key: string | null;
    state: WebShareLastState;
    label: string;
    sourceStatus: string;
  }> {
    const characterPrefix = "@character/";
    const entries: Array<{
      key: string | null;
      state: WebShareLastState;
      label: string;
      sourceStatus: string;
      parsedAt: number | null;
      index: number;
    }> = Object.entries(this.plugin.settings.webShareByPage)
      .map(([key, state], index) => {
        const character = key.startsWith(characterPrefix);
        const sourcePath = character ? key.slice(characterPrefix.length) : key;
        const filename = sourcePath.split("/").pop() || sourcePath;
        const basename = filename.replace(/\.md$/i, "") || t("untitledNote");
        const parsedAt = Date.parse(state.at);
        return {
          key,
          state,
          label: `${character ? t("character") : t("gallery")} · ${basename}`,
          sourceStatus: this.app.vault.getAbstractFileByPath(sourcePath)
            ? ""
            : t("sourceNoteMissing"),
          parsedAt: Number.isFinite(parsedAt) ? parsedAt : null,
          index,
        };
      });

    const legacyUrl = this.plugin.settings.webShareLastUrl.trim();
    const legacyId = this.plugin.settings.webShareLastId.trim();
    const legacyManageKey = this.plugin.settings.webShareLastManageKey.trim();
    if (
      legacyUrl &&
      legacyId &&
      legacyManageKey &&
      hasUnclaimedLegacyWebShare(this.plugin.settings)
    ) {
      const at = this.plugin.settings.webShareLastAt.trim();
      const parsedAt = Date.parse(at);
      entries.push({
        key: null,
        state: {
          url: legacyUrl,
          id: legacyId,
          manageKey: legacyManageKey,
          at,
          htmlVersion: this.plugin.settings.webShareHtmlVersion,
        },
        label: t("previousLink"),
        sourceStatus: t("sourceNoteNotLinked"),
        parsedAt: Number.isFinite(parsedAt) ? parsedAt : null,
        index: entries.length,
      });
    }

    return entries
      .sort((a, b) => {
        if (a.parsedAt === null && b.parsedAt !== null) return 1;
        if (a.parsedAt !== null && b.parsedAt === null) return -1;
        if (a.parsedAt !== null && b.parsedAt !== null && a.parsedAt !== b.parsedAt) {
          return b.parsedAt - a.parsedAt;
        }
        return a.index - b.index;
      })
      .map(({ parsedAt: _parsedAt, index: _index, ...entry }) => entry);
  }

  private renderHostedShareLedger(containerEl: HTMLElement): void {
    const entries = this.managedHostedShares();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: entries.length
        ? t("youCanCheckAndStopPublicLinksHere")
        : t("thereAreNoActivePublicLinks"),
    });

    for (const entry of entries) {
      const description = document.createDocumentFragment();
      description.createDiv({ text: entry.state.url });
      if (entry.sourceStatus) description.createDiv({ text: entry.sourceStatus });

      new Setting(containerEl)
        .setName(entry.label)
        .setDesc(description)
        .addButton((button) =>
          button.setButtonText(t("copy")).onClick(async () => {
            const ok = await copyTextToClipboard(entry.state.url);
            new Notice(ok ? t("linkCopied") : t("couldNotCopyTheLink"));
          }),
        )
        .addButton((button) => {
          button
            .setButtonText(t("stopSharing2"))
            .setWarning()
            .setDisabled(
              !entry.state.id.trim() ||
                !entry.state.manageKey.trim() ||
                !hostedShareBaseFromUrl(entry.state.url),
            )
            .onClick(() => {
              new StopHostedShareModal(
                this.app,
                entry.label,
                entry.state.url,
                () => this.stopHostedShare(entry.key, entry.state),
              ).open();
            });
        });
    }
  }

  private async stopHostedShare(
    key: string | null,
    state: WebShareLastState,
  ): Promise<void> {
    const targetBaseUrl = hostedShareBaseFromUrl(state.url);
    if (!targetBaseUrl) throw new Error(t("couldNotDetermineTheShareLinkAddress"));
    await deleteHostedShare({
      baseUrl: targetBaseUrl,
      id: state.id,
      manageKey: state.manageKey,
      uploadKey: uploadKeyForHostedTarget(
        targetBaseUrl,
        this.plugin.settings.webShareHostedBaseUrl,
        this.plugin.settings.webShareHostedUploadKey,
      ),
    });
    if (key) clearWebShareForPage(this.plugin.settings, key);
    clearLastShareIfSameUrl(this.plugin.settings, state.url);
    await this.plugin.saveSettings();
    new Notice(t("sharingStoppedCopiesAlreadyOpenMayRemainBriefly"));
    this.display();
  }

  private renderFilterSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(t("filters")).setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: t("toChangeLabelsSuchAsStatusAndRelationship"),
    });

    const axis = getFilterAxis(this.plugin.settings);
    new Setting(containerEl)
      .setName(t("propertyFilteredByTheChips"))
      .setDesc(
        t("whichFieldChipsSuchAsOnOffFilter"),
      )
      .addDropdown((dropdown) => {
        for (const id of FILTER_AXIS_IDS) {
          dropdown.addOption(
            id,
            axisLabel(id, this.plugin.settings.propertyDisplayNames),
          );
        }
        dropdown
          .setValue(this.plugin.settings.primaryFilterProperty)
          .onChange(async (value) => {
            this.plugin.settings.primaryFilterProperty =
              value as PrimaryFilterProperty;
            resetChipFilters(this.plugin.settings);
            await this.plugin.saveSettings();
            this.plugin.refreshOpenGalleries();
            this.display();
          });
      });

    if (axis.empty) {
      containerEl.createEl("p", {
        cls: "setting-item-description",
        text: t("valueHasNoOptionsAddThemInGallery", { arg1: axisLabel(this.plugin.settings.primaryFilterProperty, this.plugin.settings.propertyDisplayNames) }),
      });
    }

    new Setting(containerEl)
      .setName(t("defaultStatusForNewCharacters"))
      .setDesc(t("theStatusInitiallySetOnNewlyCreatedCards"))
      .addDropdown((dropdown) => {
        for (const s of this.plugin.settings.statuses) {
          dropdown.addOption(s.id, s.label);
        }
        dropdown
          .setValue(this.plugin.settings.defaultStatusId)
          .onChange(async (value) => {
            this.plugin.settings.defaultStatusId = value;
            await this.plugin.saveSettings();
          });
      });
  }
}

export function folderExists(app: App, folderPath: string): boolean {
  const path = normalizePath(folderPath);
  const abstract = app.vault.getAbstractFileByPath(path);
  return abstract instanceof TFolder;
}

/** Translate built-in UI labels while preserving user-renamed fields. */
function axisLabel(...args: Parameters<typeof rawAxisLabel>): string {
  return displayPropertyLabel(args[0], rawAxisLabel(...args));
}
