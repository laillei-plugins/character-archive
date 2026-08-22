import { App, Modal, Notice, Setting } from "obsidian";
import type CharinfoPlugin from "../main";
import { CREATE_GALLERY_NAME } from "./commandSurface";
import { createGalleryPage } from "../page/galleryPage";
import {
  FILTER_AXIS_IDS,
  axisFor,
  axisLabel,
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
    this.setTitle(CREATE_GALLERY_NAME);

    contentEl.createDiv({
      cls: "setting-item-description",
      text: "같은 카드를 보려면 폴더를 그대로 두세요. 카드를 따로 나누려면 아래에 새 폴더 이름을 적으세요.",
    });

    new Setting(contentEl)
      .setName("탭 이름")
      .setDesc("파일 목록과 탭에 보이는 이름")
      .addText((text) => {
        text
          .setPlaceholder("탭에 보일 이름")
          .setValue(this.title)
          .onChange((value) => {
            this.title = value;
          });
      });

    new Setting(contentEl)
      .setName("카드가 있는 폴더")
      .setDesc(
        "이 탭이 볼 카드 상자입니다. 그대로 두면 지금과 같은 카드예요. 나누고 싶으면 새 이름을 적으세요. 없는 폴더는 만들어 줍니다.",
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
      .setName("맨 위 작품 이름")
      .setDesc(
        "갤러리 맨 위에 있는 그 이름입니다. 비우면 이름을 눌러 다른 작품으로 바꿀 수 있어요. 적으면 이 탭은 그 작품만 보고, 이름을 눌러도 바뀌지 않아요.",
      )
      .addText((text) => {
        text
          .setPlaceholder("비우면 눌러서 바꿀 수 있음")
          .setValue(this.archive)
          .onChange((value) => {
            this.archive = value;
          });
      });

    new Setting(contentEl)
      .setName("이 창의 칩 (선택)")
      .setDesc("맨 위 On/Off 칩이 무엇을 거를지. 비우면 설정을 따릅니다.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "설정 기본값 따르기");
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
        .setButtonText("만들기")
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
      .setName("처음 켤 칩 (선택)")
      .setDesc("이 창을 처음 열 때 고를 칩. 비워도 됩니다.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "설정값 따르기");
        dropdown.addOption("all", "전체");
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
        `만들기 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
