export interface TypeMenuRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface TypeMenuPlacement {
  top: number;
  left: number;
  maxHeight: number;
  side: "above" | "below";
}

export interface AnchoredPopoverOptions {
  edgeInset?: number;
  anchorGap?: number;
  align?: "start" | "end";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Keep the type picker inside the viewport without changing its reading order.
 * A complete menu opens below when possible, flips above otherwise, and only
 * becomes internally scrollable when neither side can hold its full height.
 */
export function placeAnchoredPopover(
  anchor: TypeMenuRect,
  menu: Pick<TypeMenuRect, "width" | "height">,
  viewportWidth: number,
  viewportHeight: number,
  options: AnchoredPopoverOptions = {},
): TypeMenuPlacement {
  const edgeInset = options.edgeInset ?? 8;
  const anchorGap = options.anchorGap ?? 4;
  const align = options.align ?? "start";
  const idealLeft = align === "end" ? anchor.right - menu.width : anchor.left;
  const left = clamp(
    idealLeft,
    edgeInset,
    viewportWidth - edgeInset - menu.width,
  );
  const belowTop = anchor.bottom + anchorGap;
  const aboveBottom = anchor.top - anchorGap;
  const belowSpace = Math.max(0, viewportHeight - edgeInset - belowTop);
  const aboveSpace = Math.max(0, aboveBottom - edgeInset);

  if (menu.height <= belowSpace) {
    return { top: belowTop, left, maxHeight: menu.height, side: "below" };
  }
  if (menu.height <= aboveSpace) {
    return {
      top: aboveBottom - menu.height,
      left,
      maxHeight: menu.height,
      side: "above",
    };
  }
  if (aboveSpace > belowSpace) {
    return { top: edgeInset, left, maxHeight: aboveSpace, side: "above" };
  }
  return { top: belowTop, left, maxHeight: belowSpace, side: "below" };
}

/** Backward-compatible type-picker placement using start-edge alignment. */
export function placeTypeMenu(
  anchor: TypeMenuRect,
  menu: Pick<TypeMenuRect, "width" | "height">,
  viewportWidth: number,
  viewportHeight: number,
  edgeInset = 8,
  anchorGap = 4,
): TypeMenuPlacement {
  return placeAnchoredPopover(anchor, menu, viewportWidth, viewportHeight, {
    edgeInset,
    anchorGap,
  });
}
