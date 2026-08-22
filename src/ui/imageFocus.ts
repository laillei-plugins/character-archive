/** Reading-mode peek image focus. Keep in sync with GalleryView overlay wiring. */

export function shouldOpenImageFocus(input: {
  editMode: boolean;
  batchMode: boolean;
}): boolean {
  return !input.editMode && !input.batchMode;
}

export function openFocus(
  keys: string[],
  startKey: string,
): { keys: string[]; index: number } | null {
  const index = keys.indexOf(startKey);
  if (index < 0 || keys.length === 0) return null;
  return { keys, index };
}

export function advanceFocus(
  index: number,
  dir: -1 | 1,
  count: number,
): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, index + dir));
}

export function reconcileFocus(
  openKey: string,
  nextKeys: string[],
): { kind: "keep"; index: number } | { kind: "close" } {
  const index = nextKeys.indexOf(openKey);
  if (index < 0) return { kind: "close" };
  return { kind: "keep", index };
}

export function focusKeyAction(
  key: string,
): "close" | "prev" | "next" | "none" {
  if (key === "Escape") return "close";
  if (key === "ArrowLeft") return "prev";
  if (key === "ArrowRight") return "next";
  return "none";
}

export function focusArrowState(
  index: number,
  count: number,
): { show: boolean; prevDisabled: boolean; nextDisabled: boolean } {
  return {
    show: count > 1,
    prevDisabled: index <= 0,
    nextDisabled: index >= count - 1,
  };
}
