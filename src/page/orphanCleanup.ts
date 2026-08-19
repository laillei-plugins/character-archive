import { Notice, TFile, TFolder, normalizePath } from "obsidian";
import type CharinfoPlugin from "../main";
import { forgetGalleryPageState } from "../settings";
import {
  isGalleryPage,
  readGalleryScope,
} from "./galleryPage";

function asFolder(file: unknown): TFolder | null {
  return file instanceof TFolder ? file : null;
}

function isEmptyFolder(folder: TFolder): boolean {
  if (folder.children.length === 0) return true;
  return folder.children.every(
    (child) => child instanceof TFolder && isEmptyFolder(child),
  );
}

function collectEmptyFolders(root: TFolder, out: TFolder[]): void {
  for (const child of root.children) {
    if (!(child instanceof TFolder)) continue;
    collectEmptyFolders(child, out);
    if (isEmptyFolder(child)) out.push(child);
  }
}

function libraryRoots(plugin: CharinfoPlugin): TFolder[] {
  const paths = new Set<string>();
  const main = normalizePath(
    plugin.settings.libraryFolder.trim() || "Character Archive",
  );
  paths.add(main);
  for (const file of plugin.app.vault.getMarkdownFiles()) {
    if (!isGalleryPage(file, plugin)) continue;
    const lib = readGalleryScope(plugin.app, file, plugin.settings).library;
    if (lib) paths.add(normalizePath(lib));
  }
  const roots: TFolder[] = [];
  for (const path of paths) {
    const folder = asFolder(plugin.app.vault.getAbstractFileByPath(path));
    if (folder) roots.push(folder);
  }
  return roots;
}

export function findEmptyFolders(plugin: CharinfoPlugin): TFolder[] {
  const seen = new Set<string>();
  const out: TFolder[] = [];
  for (const root of libraryRoots(plugin)) {
    collectEmptyFolders(root, out);
  }
  return out
    .filter((folder) => {
      if (seen.has(folder.path)) return false;
      seen.add(folder.path);
      return true;
    })
    .sort((a, b) => b.path.length - a.path.length);
}

/**
 * Gallery pages whose declared `library` folder is gone from the vault — those
 * windows can no longer show anything. An empty (or duplicated) library is a
 * legitimate state, so it is never an orphan. Cards are never included.
 */
export function findOrphanGalleryPages(plugin: CharinfoPlugin): TFile[] {
  const seen = new Set<string>();
  const out: TFile[] = [];
  const add = (file: TFile) => {
    if (seen.has(file.path)) return;
    seen.add(file.path);
    out.push(file);
  };

  for (const file of plugin.app.vault.getMarkdownFiles()) {
    if (!isGalleryPage(file, plugin)) continue;
    const scope = readGalleryScope(plugin.app, file, plugin.settings);
    const lib = normalizePath(scope.library);
    const libExists = Boolean(
      asFolder(plugin.app.vault.getAbstractFileByPath(lib)),
    );
    // Only missing libraries are orphans — including the default entry note
    // when its card folder is gone.
    if (!libExists) add(file);
  }
  return out.sort((a, b) => a.path.localeCompare(b.path, "ko"));
}

async function trashFiles(
  plugin: CharinfoPlugin,
  files: TFile[],
): Promise<number> {
  let n = 0;
  for (const file of files) {
    try {
      await plugin.app.fileManager.trashFile(file);
      forgetGalleryPageState(plugin.settings, file.path);
      n += 1;
    } catch (error) {
      console.error(error);
    }
  }
  if (n) await plugin.saveSettings();
  return n;
}

async function trashFolders(plugin: CharinfoPlugin, folders: TFolder[]): Promise<number> {
  let n = 0;
  const ordered = [...folders].sort((a, b) => b.path.length - a.path.length);
  for (const folder of ordered) {
    const live = asFolder(plugin.app.vault.getAbstractFileByPath(folder.path));
    if (!live || !isEmptyFolder(live)) continue;
    try {
      await plugin.app.fileManager.trashFile(live);
      n += 1;
    } catch (error) {
      console.error(error);
    }
  }
  return n;
}

function confirmList(title: string, names: string[], extra: string): boolean {
  const shown = names.slice(0, 8);
  const more = names.length > shown.length ? `\n외 ${names.length - shown.length}개` : "";
  return window.confirm(
    `${title}\n\n${shown.join("\n")}${more}\n\n${extra}`,
  );
}

export async function sweepEmptyFolders(plugin: CharinfoPlugin): Promise<void> {
  const folders = findEmptyFolders(plugin);
  if (folders.length === 0) {
    new Notice("남은 빈 폴더가 없어요.");
    return;
  }
  const ok = confirmList(
    `빈 폴더 ${folders.length}개`,
    folders.map((f) => f.path),
    "빈 폴더만 휴지통으로 보냅니다. 카드는 그대로입니다.",
  );
  if (!ok) return;
  const n = await trashFolders(plugin, folders);
  new Notice(n ? `빈 폴더 ${n}개를 치웠어요.` : "지울 빈 폴더가 없어요.");
}

export async function sweepOrphanGalleryPages(
  plugin: CharinfoPlugin,
): Promise<void> {
  const pages = findOrphanGalleryPages(plugin);
  if (pages.length === 0) {
    new Notice("남은 갤러리 창이 없어요.");
    return;
  }
  const ok = confirmList(
    `남은 갤러리 창 ${pages.length}개`,
    pages.map((f) => f.path),
    "창 노트만 휴지통으로 보냅니다. 카드는 그대로입니다.",
  );
  if (!ok) return;
  const n = await trashFiles(plugin, pages);
  new Notice(n ? `갤러리 창 ${n}개를 치웠어요.` : "지울 창이 없어요.");
}
