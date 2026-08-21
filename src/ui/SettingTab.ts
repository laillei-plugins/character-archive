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
  axisLabel,
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
    this.setTitle("공유 중지할까요?");
    contentEl.createEl("p", {
      text: `${this.label}의 공개 페이지를 서버에서 지웁니다. 이미 열린 사본은 잠시 남을 수 있어요.`,
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
        button.setButtonText("취소").onClick(() => this.close());
      })
      .addButton((button) => {
        stopButton = button;
        button
          .setButtonText("공유 중지")
          .setWarning()
          .onClick(async () => {
            cancelButton?.setDisabled(true);
            stopButton?.setDisabled(true);
            try {
              await this.onConfirm();
              this.close();
            } catch (error) {
              console.error(error);
              new Notice("멈추지 못했어요. 링크는 아직 열려 있어요.");
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

    const glossary = containerEl.createDiv({
      cls: "setting-item-description charinfo-settings__glossary",
    });
    glossary.createDiv({ text: "큰 묶음 = 갤러리 맨 위에 있는 이름" });
    glossary.createDiv({ text: "작은 묶음 = 카드 줄 위에 있는 제목" });
    glossary.createDiv({
      text: "창 = 같은 카드를 다른 탭으로 보는 것. 작은 묶음을 만들지 않아요.",
    });

    new Setting(containerEl)
      .setName("카드가 있는 폴더")
      .setDesc(
        "캐릭터 노트가 들어 있는 상자입니다. 여기를 바꾸면 카드가 안 보일 수 있어요. 폴더 이름을 바꿨다면 여기도 맞춘 뒤 칸 밖을 누르세요.",
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
                `이미지 다시 연결됨 · 노트 ${n}개\n(${fromFolder} → ${toFolder})`,
              );
              this.plugin.refreshOpenGalleries();
            }
            fromFolder = toFolder;
          })();
        });
      });

    new Setting(containerEl)
      .setName("처음 보여줄 큰 묶음")
      .setDesc(
        "갤러리를 열면 맨 위에 나올 이름입니다. 화면에 보이는 글자와 같아야 해요. 각 창은 마지막으로 고른 묶음을 따로 기억합니다.",
      )
      .addText((text) =>
        text
          .setPlaceholder("맨 위에 보일 이름")
          .setValue(this.plugin.settings.activeGenre)
          .onChange(async (value) => {
            this.plugin.settings.activeGenre = value.trim();
            await this.plugin.saveSettings();
            this.plugin.refreshOpenGalleries();
          }),
      );

    new Setting(containerEl)
      .setName("새 카드 양식")
      .setDesc("새 카드를 만들 때 쓰는 빈 노트. 비워 두면 플러그인 기본 양식.")
      .addText((text) =>
        text
          .setPlaceholder("비우면 플러그인 기본 템플릿")
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
        ? `아카이브별로 다른 템플릿을 쓰는 곳: ${templateOverrides
            .map(([genre, path]) => `${genre} → ${path}`)
            .join(", ")}`
        : "큰 묶음마다 다른 양식을 쓰려면 여기에 경로가 나타납니다.",
      cls: "setting-item-description",
    });

    this.renderFilterSettings(containerEl);

    new Setting(containerEl).setName("그림").setHeading();
    containerEl.createEl("p", {
      text: "이미 넣은 그림은 그대로 둡니다. 새로 올리는 파일만 아래 위치에 저장됩니다.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("새 그림 위치")
      .setDesc("보관함 폴더가 기본입니다. 바깥 폴더는 용량이 클 때만.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("vault", "보관함 폴더 (기본)")
          .addOption("external", "바깥 폴더 (선택)")
          .setValue(this.plugin.settings.mediaRootMode)
          .onChange(async (value: string) => {
            this.plugin.settings.mediaRootMode = value as MediaRootMode;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    const imgurReady = isImgurPluginAvailable(this.app);
    new Setting(containerEl)
      .setName("커버 / 파일 업로드")
      .setDesc(
        imgurReady
          ? "커버 팝업은 파일/링크만 보여요. Imgur로 올릴지는 여기서만 고릅니다."
          : "커버 팝업은 파일/링크만 보여요. Imgur 플러그인을 켜면 여기서 원격 업로드를 고를 수 있어요.",
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("vault", "보관함 (기본)");
        if (imgurReady) dropdown.addOption("imgur", "Imgur 플러그인");
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
      .setName("보관함 안 그림 폴더")
      .setDesc("새 그림 위치가 보관함일 때. 보관함 기준 상대 경로.")
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
      .setName("바깥 그림 폴더")
      .setDesc(
        "컴퓨터 전체 경로. 새 그림 위치를 바깥 폴더로 골랐을 때만 필요해요.",
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
      .setName("그림 폴더 만들기")
      .setDesc("없으면 그림 폴더를 만듭니다.")
      .addButton((button) =>
        button.setButtonText("폴더 만들기").onClick(async () => {
          await this.plugin.media.ensureVaultMediaFolder();
          new Notice("그림 폴더를 준비했어요.");
        }),
      );

    new Setting(containerEl)
      .setName("기본 편집 모드")
      .setDesc("켜면 갤러리를 편집 모드로 엽니다. 끄면 읽기(드래그·일괄 편집 잠금).")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.defaultEditMode).onChange(async (value) => {
          this.plugin.settings.defaultEditMode = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("웹 공유").setHeading();
    containerEl.createEl("p", {
      text: "공유를 누를 때만 선택한 카드 정보와 표지를 기본 공개 서버에 올려 링크를 만들어요. 다른 서버를 쓸 때만 주소를 바꾸세요. GitHub는 선택이에요.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("공유 주소")
      .setDesc("비우면 기본 공유 서버로 돌아가요. 끝의 / 는 빼 주세요.")
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
      .setName("업로드 열쇠 (선택)")
      .setDesc("직접 운영한 공유 서버가 열쇠를 요구할 때만 입력하세요.")
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
      .setName("기본 유지 기간")
      .setDesc("링크가 얼마나 살아 있을지. 공유 창에서도 바꿀 수 있어요.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("7d", "7일")
          .addOption("30d", "30일")
          .addOption("permanent", "1년")
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
      .setName("GitHub 백업 연결")
      .setDesc(
        ghReady
          ? `연결됨 · ${this.plugin.settings.webShareGithubRepo || "—"}`
          : "공유 주소 대신 내 GitHub에 올릴 때만 필요해요. 갤러리 → 지구본 → 「내 GitHub에 연결」.",
      )
      .addButton((btn) =>
        btn.setButtonText(ghReady ? "연결 끊기" : "안내").onClick(async () => {
          if (!ghReady) {
            new Notice(
              "갤러리를 연 뒤 공유(지구본) → 아래쪽 「내 GitHub에 연결」을 누르세요.",
            );
            return;
          }
          this.plugin.settings.webShareGithubToken = "";
          this.plugin.settings.webShareGithubRepo = "";
          await this.plugin.saveSettings();
          new Notice("GitHub 연결을 해제했어요.");
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
        const basename = filename.replace(/\.md$/i, "") || "이름 없는 노트";
        const parsedAt = Date.parse(state.at);
        return {
          key,
          state,
          label: `${character ? "캐릭터" : "갤러리"} · ${basename}`,
          sourceStatus: this.app.vault.getAbstractFileByPath(sourcePath)
            ? ""
            : "원본 노트 없음",
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
        label: "이전 링크",
        sourceStatus: "원본 노트 연결 안 됨",
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
        ? "노트를 옮기거나 지워도 여기서 공개 링크를 확인하고 멈출 수 있어요."
        : "공개 중인 링크가 없어요.",
    });

    for (const entry of entries) {
      const description = document.createDocumentFragment();
      description.createDiv({ text: entry.state.url });
      if (entry.sourceStatus) description.createDiv({ text: entry.sourceStatus });

      new Setting(containerEl)
        .setName(entry.label)
        .setDesc(description)
        .addButton((button) =>
          button.setButtonText("복사").onClick(async () => {
            const ok = await copyTextToClipboard(entry.state.url);
            new Notice(ok ? "링크를 복사했어요." : "링크를 복사하지 못했어요.");
          }),
        )
        .addButton((button) => {
          button
            .setButtonText("공유 중지")
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
    if (!targetBaseUrl) throw new Error("공유 링크 주소를 확인할 수 없어요.");
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
    new Notice("공유를 중지했어요. 이미 열린 사본은 잠시 남을 수 있어요.");
    this.display();
  }

  private renderFilterSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("필터").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "상태·관계 같은 이름과 값은 갤러리에서 연필을 켠 뒤 책 아이콘으로 바꿉니다. 여기는 기본값만 둡니다.",
    });

    const axis = getFilterAxis(this.plugin.settings);
    new Setting(containerEl)
      .setName("맨 위 칩이 거르는 항목")
      .setDesc(
        "On/Off 같은 칩이 어떤 칸을 보는지. 바꾸면 칩은 전체로 돌아갑니다.",
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
        text: `«${axisLabel(this.plugin.settings.primaryFilterProperty, this.plugin.settings.propertyDisplayNames)}»에 고를 값이 없어요. 갤러리 편집 → 속성 관리에서 추가해 주세요.`,
      });
    }

    new Setting(containerEl)
      .setName("새 캐릭터 기본 상태")
      .setDesc("새로 만든 카드에 처음 넣을 상태.")
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
