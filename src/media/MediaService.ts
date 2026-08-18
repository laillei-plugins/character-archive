import { App, normalizePath, Notice, TFile } from "obsidian";
import type { CharinfoSettings } from "../settings";
import { folderExists } from "../ui/SettingTab";

/**
 * Resolves where new image uploads should land.
 * Never relocates existing embeds — only routes new files.
 */
export class MediaService {
  constructor(
    private app: App,
    private getSettings: () => CharinfoSettings,
  ) {}

  /** Active destination for NEW uploads. */
  getActiveUploadFolder(): { kind: "vault" | "external"; path: string } {
    const settings = this.getSettings();
    if (settings.mediaRootMode === "external" && settings.externalMediaPath) {
      return { kind: "external", path: settings.externalMediaPath };
    }
    return {
      kind: "vault",
      path: normalizePath(settings.vaultMediaFolder || settings.libraryFolder),
    };
  }

  async ensureVaultMediaFolder(): Promise<string> {
    const folder = normalizePath(this.getSettings().vaultMediaFolder);
    if (!folderExists(this.app, folder)) {
      await this.app.vault.createFolder(folder);
    }
    return folder;
  }

  /**
   * Save a binary blob as a new media file under the active upload root.
   * Vault mode writes into the vault. External mode writes via Node fs (desktop).
   */
  async saveUpload(
    filename: string,
    data: ArrayBuffer,
  ): Promise<{ vaultPath?: string; absolutePath?: string; link: string }> {
    const safeName = filename.replace(/[\\/]/g, "-");
    const target = this.getActiveUploadFolder();

    if (target.kind === "vault") {
      const folder = await this.ensureVaultMediaFolder();
      const vaultPath = normalizePath(`${folder}/${safeName}`);
      const existing = this.app.vault.getAbstractFileByPath(vaultPath);
      if (existing instanceof TFile) {
        await this.app.vault.modifyBinary(existing, data);
      } else {
        await this.app.vault.createBinary(vaultPath, data);
      }
      return {
        vaultPath,
        link: `![[${vaultPath}]]`,
      };
    }

    // External: desktop-only absolute path write
    try {
      const fs = await import("fs/promises");
      const pathMod = await import("path");
      await fs.mkdir(target.path, { recursive: true });
      const absolutePath = pathMod.join(target.path, safeName);
      await fs.writeFile(absolutePath, Buffer.from(data));
      // Prefer file URL for Obsidian embed when outside vault
      const link = `![](file://${absolutePath})`;
      return { absolutePath, link };
    } catch (error) {
      console.error(error);
      new Notice(
        "External media write failed. Falling back to vault media folder.",
      );
      const folder = await this.ensureVaultMediaFolder();
      const vaultPath = normalizePath(`${folder}/${safeName}`);
      await this.app.vault.createBinary(vaultPath, data);
      return { vaultPath, link: `![[${vaultPath}]]` };
    }
  }
}
