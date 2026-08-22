/** Capture-phase title click vs native chevron. Keep in sync with Obsidian 1.13 file explorer. */
export const LIBRARY_FOLDER_CHEVRON_SELECTOR =
  ".nav-folder-collapse-indicator, .collapse-icon, .tree-item-icon";

/** Default entry basename — keep aligned with `GALLERY_ENTRY_BASENAME`. */
const DEFAULT_ENTRY_BASENAME = "Character Archive";

export type LibraryFolderClickKind = "title" | "chevron" | "other";

export function normalizeLibraryPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function classifyLibraryFolderClick(input: {
  isChevron: boolean;
  folderPath: string | null;
  libraryPaths: string[];
}): LibraryFolderClickKind {
  if (input.isChevron) return "chevron";
  if (!input.folderPath) return "other";
  const want = normalizeLibraryPath(input.folderPath);
  const known = new Set(input.libraryPaths.map(normalizeLibraryPath));
  return known.has(want) ? "title" : "other";
}

export function pickGalleryLeafForLibrary<T>(
  leaves: T[],
  clickedLibrary: string,
  pageLibrary: (leaf: T) => string | null | undefined,
): T | undefined {
  const want = normalizeLibraryPath(clickedLibrary);
  return leaves.find(
    (leaf) => normalizeLibraryPath(pageLibrary(leaf) ?? "") === want,
  );
}

export function libraryFolderNotePath(library: string): string {
  const lib = normalizeLibraryPath(library);
  const base = lib.split("/").pop() || DEFAULT_ENTRY_BASENAME;
  return `${lib}/${base}.md`;
}

export function libraryNamedEntryPath(library: string): string {
  return `${normalizeLibraryPath(library)}/${DEFAULT_ENTRY_BASENAME}.md`;
}

export function pickLibraryEntryPath(input: {
  library: string;
  existingGalleryPaths: string[];
  unpinnedGalleryPaths: string[];
}): string | "create-folder-note" {
  const existing = new Set(input.existingGalleryPaths.map(normalizeLibraryPath));
  const folderNote = libraryFolderNotePath(input.library);
  if (existing.has(folderNote)) return folderNote;
  const named = libraryNamedEntryPath(input.library);
  if (existing.has(named)) return named;
  const first = [...input.unpinnedGalleryPaths]
    .map(normalizeLibraryPath)
    .sort((a, b) => a.localeCompare(b))[0];
  return first ?? "create-folder-note";
}

/** Next create target when no gallery exists. Occupied non-gallery notes are skipped. */
export function pickLibraryCreatePath(input: {
  library: string;
  occupiedPaths: string[];
}): string | "blocked" {
  const occupied = new Set(input.occupiedPaths.map(normalizeLibraryPath));
  const folderNote = libraryFolderNotePath(input.library);
  if (!occupied.has(folderNote)) return folderNote;
  const named = libraryNamedEntryPath(input.library);
  if (!occupied.has(named)) return named;
  return "blocked";
}

export class AutoRevealRestoreError extends Error {
  override name = "AutoRevealRestoreError";
}

function frontmatterBlock(text: string): string | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return null;
  return text.slice(4, end);
}

/** True when the note body itself declares `charinfo: gallery` (cache may still be empty). */
export function textHasGalleryFrontmatter(text: string): boolean {
  const block = frontmatterBlock(text);
  return Boolean(block && /(?:^|\n)charinfo:\s*gallery\s*(?:\n|$)/.test(block));
}

/** `library` from the note body when metadata cache has not parsed it yet. */
export function textGalleryLibrary(text: string): string | null {
  const block = frontmatterBlock(text);
  if (!block) return null;
  const match = block.match(
    /(?:^|\n)library:\s*(?:"([^"]+)"|'([^']+)'|(\S+))\s*(?:\n|$)/,
  );
  const value = (match?.[1] || match?.[2] || match?.[3] || "").trim();
  return value || null;
}

/** Cache present: trust `charinfo`. Cache miss: only the default entry paths. */
export function isGalleryByCache(input: {
  hasFrontmatter: boolean;
  charinfo: unknown;
  pathIsDefaultEntry: boolean;
}): boolean {
  if (input.hasFrontmatter) return input.charinfo === "gallery";
  return input.pathIsDefaultEntry;
}

export type GalleryLeafDecision = "reveal-same-file" | "reuse-recent" | "new-tab";

export function decideRibbonOpen(input: {
  lastPath: string;
  fileExists: boolean;
  isGallery: boolean;
}): "last-used" | "default" {
  if (input.lastPath && input.fileExists && input.isGallery) return "last-used";
  return "default";
}

export function shouldRecordLastOpenedGallery(
  current: string,
  incoming: string,
): boolean {
  return incoming.length > 0 && incoming !== current;
}

export function normalizeLastOpenedGalleryPath(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

export function remapLastOpenedGalleryPath(
  current: string,
  fromPath: string,
  toPath: string,
): string {
  const from = normalizeLibraryPath(fromPath);
  const to = normalizeLibraryPath(toPath);
  if (!current || from === to) return current;
  return normalizeLibraryPath(current) === from ? to : current;
}

export function decideGalleryOpenLeaf(input: {
  hasSameFileLeaf: boolean;
  replaceActive: boolean;
  hasMostRecent: boolean;
  mostRecentIsSidebar: boolean;
  mostRecentIsGallery: boolean;
}): GalleryLeafDecision {
  if (input.hasSameFileLeaf) return "reveal-same-file";
  if (
    input.replaceActive &&
    input.hasMostRecent &&
    !input.mostRecentIsSidebar &&
    !input.mostRecentIsGallery
  ) {
    return "reuse-recent";
  }
  return "new-tab";
}

export type ExplorerViewLike = {
  getState: () => Record<string, unknown>;
  setState: (
    state: unknown,
    result: { history: boolean },
  ) => void | Promise<void>;
};

/** How long to keep auto-reveal off if no `file-open` arrives. */
export const AUTO_REVEAL_FALLBACK_MS = 400;
/** Extra quiet window after the gallery note’s own `file-open` / queued sort. */
export const AUTO_REVEAL_SETTLE_MS = 50;

export type AutoRevealSettleReason =
  | "target-settled"
  | "left-gallery"
  | "timeout";

/** Merge the saved flag into live explorer state so sort/search are not wiped. */
export function mergeAutoRevealState(
  current: Record<string, unknown>,
  autoReveal: boolean,
): Record<string, unknown> {
  return { ...current, autoReveal };
}

export function decideAutoRevealRestoreEvent(input: {
  openedPath: string | null;
  targetPath: string;
}): "settle-then-restore" | "restore-now" | "ignore" {
  if (!input.openedPath || !input.targetPath) return "ignore";
  const opened = normalizeLibraryPath(input.openedPath);
  const target = normalizeLibraryPath(input.targetPath);
  return opened === target ? "settle-then-restore" : "restore-now";
}

export function createAutoRevealSettleGate(input: {
  subscribeFileOpen: (cb: (path: string | null) => void) => () => void;
  sleep: (ms: number) => Promise<void>;
  fallbackMs?: number;
  settleMs?: number;
}): {
  setTarget: (path: string) => void;
  wait: () => Promise<AutoRevealSettleReason>;
  cancel: () => void;
} {
  const fallbackMs = input.fallbackMs ?? AUTO_REVEAL_FALLBACK_MS;
  const settleMs = input.settleMs ?? AUTO_REVEAL_SETTLE_MS;
  const seen: string[] = [];
  let target = "";
  let done: AutoRevealSettleReason | "cancel" | null = null;
  let resolveWait: ((reason: AutoRevealSettleReason) => void) | null = null;
  let settleStarted = false;

  const unsubscribe = input.subscribeFileOpen((path) => {
    if (!path) return;
    seen.push(normalizeLibraryPath(path));
    void consider();
  });

  const finish = (reason: AutoRevealSettleReason | "cancel") => {
    if (done) return;
    done = reason;
    unsubscribe();
    if (reason === "cancel") {
      resolveWait?.("timeout");
      return;
    }
    resolveWait?.(reason);
  };

  const consider = async () => {
    if (done || !target) return;
    for (const path of seen) {
      const decision = decideAutoRevealRestoreEvent({
        openedPath: path,
        targetPath: target,
      });
      if (decision === "restore-now") {
        finish("left-gallery");
        return;
      }
    }
    if (
      seen.some(
        (path) =>
          decideAutoRevealRestoreEvent({
            openedPath: path,
            targetPath: target,
          }) === "settle-then-restore",
      )
    ) {
      if (settleStarted) return;
      settleStarted = true;
      await input.sleep(settleMs);
      if (done) return;
      finish("target-settled");
    }
  };

  return {
    setTarget(path: string) {
      target = normalizeLibraryPath(path);
      void consider();
    },
    wait() {
      return new Promise<AutoRevealSettleReason>((resolve) => {
        if (done) {
          resolve(done === "cancel" ? "timeout" : done);
          return;
        }
        resolveWait = resolve;
        void input.sleep(fallbackMs).then(() => {
          if (!done) finish("timeout");
        });
        void consider();
      });
    },
    cancel() {
      finish("cancel");
    },
  };
}

/**
 * File Explorer auto-reveal expands ancestors of the active file. Opening the
 * gallery FileView would reopen the library folder after the title click
 * cancelled the native expand. Suppress only for this operation, then merge
 * the original flag back after `fn` (including any settle wait inside it).
 */
export async function withAutoRevealSuppressed<T>(
  views: ExplorerViewLike[],
  fn: () => Promise<T>,
): Promise<T> {
  const restored: ExplorerViewLike[] = [];
  let thrown: unknown;
  try {
    for (const view of views) {
      if (
        typeof view.getState !== "function" ||
        typeof view.setState !== "function"
      ) {
        continue;
      }
      const state = view.getState();
      if (!state || typeof state !== "object" || state.autoReveal !== true) {
        continue;
      }
      restored.push(view);
      await view.setState({ ...state, autoReveal: false }, { history: false });
    }
    return await fn();
  } catch (error) {
    thrown = error;
    throw error;
  } finally {
    let restoreError: unknown;
    for (const view of restored) {
      try {
        const current = view.getState();
        const live =
          current && typeof current === "object" ? current : {};
        await view.setState(mergeAutoRevealState(live, true), {
          history: false,
        });
      } catch (error) {
        restoreError = error;
      }
    }
    if (restoreError) {
      const error = new AutoRevealRestoreError(
        "Failed to restore file-explorer auto-reveal",
      );
      (error as Error & { cause?: unknown }).cause = thrown ?? restoreError;
      throw error;
    }
  }
}
