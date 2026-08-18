import type { App } from "obsidian";

/**
 * Narrow adapter for optional Obsidian Imgur plugin.
 * Shape-checks the live plugin instance; never clones Imgur auth.
 */
export type ImgurUploadResult =
  | { ok: true; url: string }
  | { ok: false; reason: string };

type ImgurLikePlugin = {
  settings?: { albumToUpload?: string };
  getCurrentImagesUploader?: () => {
    upload: (file: File, album?: string) => Promise<string>;
  };
};

function asImgurPlugin(raw: unknown): ImgurLikePlugin | null {
  if (!raw || typeof raw !== "object") return null;
  const plugin = raw as ImgurLikePlugin;
  if (typeof plugin.getCurrentImagesUploader !== "function") return null;
  return plugin;
}

/** True when community plugin id is enabled and exposes the uploader. */
export function isImgurPluginAvailable(app: App): boolean {
  return getImgurPlugin(app) != null;
}

export function getImgurPlugin(app: App): ImgurLikePlugin | null {
  const plugins = (app as App & {
    plugins?: { enabledPlugins?: Set<string>; plugins?: Record<string, unknown> };
  }).plugins;
  if (!plugins?.enabledPlugins?.has("obsidian-imgur-plugin")) return null;
  return asImgurPlugin(plugins.plugins?.["obsidian-imgur-plugin"]);
}

export async function uploadFileViaImgurPlugin(
  app: App,
  file: File,
): Promise<ImgurUploadResult> {
  const plugin = getImgurPlugin(app);
  if (!plugin) {
    return { ok: false, reason: "Imgur 플러그인이 없거나 꺼져 있어요." };
  }
  try {
    const uploader = plugin.getCurrentImagesUploader?.();
    if (!uploader || typeof uploader.upload !== "function") {
      return { ok: false, reason: "Imgur 업로더를 쓸 수 없어요." };
    }
    const album = plugin.settings?.albumToUpload;
    const url = await uploader.upload(file, album);
    if (typeof url !== "string" || !/^https:\/\//i.test(url.trim())) {
      return { ok: false, reason: "Imgur가 유효한 HTTPS 주소를 주지 않았어요." };
    }
    return { ok: true, url: url.trim() };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
