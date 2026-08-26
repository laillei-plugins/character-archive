export type FoldTier = "none" | "narrow" | "compact";

export interface SearchDisclosureState {
  expanded: boolean;
  isNarrow: boolean;
  query: string;
}

export type SearchDisclosureEffect =
  | "none"
  | "focus-input"
  | "close"
  | "focus-overlay"
  | "mode-exit";

export type SearchDisclosureEvent =
  | { type: "open" }
  | { type: "close" }
  | { type: "slash" }
  | {
      type: "escape";
      priority: "focus-overlay" | "search-disclosure" | "mode-exit";
    }
  | { type: "resize"; isNarrow: boolean; inputOwnedFocus?: boolean }
  | { type: "compact-change" }
  | { type: "full-render"; inputOwnedFocus: boolean }
  | { type: "archive-change" }
  | { type: "edit-change" }
  | { type: "batch-change" }
  | { type: "external-query"; query: string };

export interface SearchDisclosureTransition {
  state: SearchDisclosureState;
  effect: SearchDisclosureEffect;
}

function enforceInvariant(
  state: SearchDisclosureState,
): SearchDisclosureState {
  if (!state.isNarrow) return { ...state, expanded: false };
  if (state.query.trim()) return { ...state, expanded: true };
  return state;
}

/**
 * Pure transition table for the narrow search disclosure. DOM effects are
 * returned separately so GalleryView can keep the header in place.
 */
export function transitionSearchDisclosure(
  current: SearchDisclosureState,
  event: SearchDisclosureEvent,
): SearchDisclosureTransition {
  let state = { ...current };
  let effect: SearchDisclosureEffect = "none";

  switch (event.type) {
    case "open":
    case "slash":
      if (state.isNarrow) {
        state.expanded = true;
        effect = "focus-input";
      } else if (event.type === "slash") {
        effect = "focus-input";
      }
      break;
    case "close":
      if (state.isNarrow && state.expanded) {
        state.expanded = false;
        state.query = "";
        effect = "close";
      }
      break;
    case "escape":
      if (event.priority === "focus-overlay") {
        effect = "focus-overlay";
      } else if (
        event.priority === "search-disclosure" &&
        state.isNarrow &&
        state.expanded
      ) {
        state.expanded = false;
        state.query = "";
        effect = "close";
      } else {
        effect = "mode-exit";
      }
      break;
    case "resize":
      state.isNarrow = event.isNarrow;
      if (event.isNarrow && event.inputOwnedFocus) {
        state.expanded = true;
        effect = "focus-input";
      }
      break;
    case "compact-change":
    case "edit-change":
    case "batch-change":
      break;
    case "full-render":
      if (event.inputOwnedFocus) effect = "focus-input";
      break;
    case "archive-change":
      state.query = "";
      state.expanded = false;
      break;
    case "external-query":
      state.query = event.query;
      if (!event.query.trim()) state.expanded = false;
      break;
  }

  return { state: enforceInvariant(state), effect };
}

export function foldTierForWidth(width: number): FoldTier {
  if (width < 368) return "compact";
  if (width < 720) return "narrow";
  return "none";
}

export type GalleryHeaderAction =
  | "search"
  | "edit"
  | "batch"
  | "attributes"
  | "view"
  | "share"
  | "refresh";

export type GalleryActionRoute = "bar" | "popover" | "search" | "hidden";

export interface GalleryActionState {
  foldTier: FoldTier;
  editMode: boolean;
  batchMode: boolean;
  searchExpanded: boolean;
}

/** Single-route ownership for every responsive header action. */
export function galleryActionRoute(
  action: GalleryHeaderAction,
  state: GalleryActionState,
): GalleryActionRoute {
  const narrow = state.foldTier !== "none";
  if (narrow && state.searchExpanded) {
    return action === "batch" && state.batchMode ? "search" : "hidden";
  }
  switch (action) {
    case "search":
      return narrow ? "bar" : "hidden";
    case "edit":
    case "view":
      return state.searchExpanded && narrow ? "hidden" : "bar";
    case "share":
      return narrow ? "popover" : "bar";
    case "attributes":
      return state.foldTier === "compact" ? "popover" : "bar";
    case "batch":
      if (
        state.foldTier === "compact" &&
        state.editMode &&
        !state.batchMode
      ) {
        return "popover";
      }
      return "bar";
    case "refresh":
      if (!state.editMode) return "hidden";
      return narrow ? "popover" : "bar";
  }
}

export type FullRenderFocusTarget = "search" | "batch" | "none";

/** Search focus always wins over the batch route during a full repaint. */
export function fullRenderFocusTarget(input: {
  searchOwnedFocus: boolean;
  batchMode: boolean;
}): FullRenderFocusTarget {
  if (input.searchOwnedFocus) return "search";
  if (input.batchMode) return "batch";
  return "none";
}

/** Keep keyboard focus on a visible control after rebuilding a batch route. */
export function batchToggleFocusTarget(input: {
  enabled: boolean;
  foldTier: FoldTier;
  searchExpanded: boolean;
}): "search" | "batch" | "view" {
  if (!input.enabled && input.foldTier !== "none" && input.searchExpanded) {
    return "search";
  }
  if (!input.enabled && input.foldTier === "compact") return "view";
  return "batch";
}

export type ResponsiveFocusOwner =
  | "search-input"
  | "search-trigger"
  | "search-close"
  | "batch"
  | "view"
  | "view-popover"
  | "none";

export type ResponsiveFocusTarget =
  | "search-input"
  | "search-trigger"
  | "search-close"
  | "batch"
  | "view"
  | "none";

/** Map a disappearing responsive route to a visible counterpart. */
export function responsiveFocusTargetAfterResize(input: {
  owner: ResponsiveFocusOwner;
  nextTier: FoldTier;
  editMode: boolean;
  batchMode: boolean;
  searchExpanded: boolean;
}): ResponsiveFocusTarget {
  switch (input.owner) {
    case "search-input":
      return "search-input";
    case "search-trigger":
      return input.nextTier === "none" ? "search-input" : "search-trigger";
    case "search-close":
      return input.nextTier === "none" ? "search-input" : "search-close";
    case "batch": {
      const route = galleryActionRoute("batch", {
        foldTier: input.nextTier,
        editMode: input.editMode,
        batchMode: input.batchMode,
        searchExpanded: input.searchExpanded,
      });
      return route === "bar" || route === "search" ? "batch" : "view";
    }
    case "view":
    case "view-popover":
      return "view";
    case "none":
      return "none";
  }
}

/** One view-owned asynchronous flight that survives popover and DOM rebuilds. */
export class AsyncSingleFlight {
  private task: Promise<void> | null = null;

  get pending(): boolean {
    return this.task !== null;
  }

  run(start: () => Promise<void>, onError: (error: unknown) => void): Promise<void> {
    if (this.task) return this.task;
    let task: Promise<void>;
    task = Promise.resolve()
      .then(start)
      .catch(onError)
      .finally(() => {
        if (this.task === task) this.task = null;
      });
    this.task = task;
    return task;
  }
}

export interface BatchActionDescriptor {
  label: string;
  pressed: boolean;
  disabled: boolean;
  classes: string;
}

export function describeBatchAction(input: {
  editMode: boolean;
  batchMode: boolean;
  batchSaving: boolean;
}): BatchActionDescriptor {
  return {
    label: input.batchMode ? "여러 선택 끝내기" : "여러 선택",
    pressed: input.batchMode,
    disabled: input.batchSaving,
    classes:
      (input.batchMode ? " is-active" : "") +
      (input.editMode ? "" : " is-locked"),
  };
}

/** Returns false without activating when the shared descriptor is disabled. */
export function activateDescribedBatchAction(
  descriptor: BatchActionDescriptor,
  activate: () => void,
): boolean {
  if (descriptor.disabled) return false;
  activate();
  return true;
}

export type ImageFocusControl = "close" | "prev" | "next";

export function imageFocusTabTarget(
  current: ImageFocusControl,
  shift: boolean,
  count: number,
): ImageFocusControl {
  const controls: ImageFocusControl[] =
    count > 1 ? ["close", "prev", "next"] : ["close"];
  const index = Math.max(0, controls.indexOf(current));
  const delta = shift ? -1 : 1;
  return controls[(index + delta + controls.length) % controls.length] ?? "close";
}

export function imageFocusAfterStep(
  activated: "prev" | "next",
  index: number,
  count: number,
): "prev" | "next" {
  if (activated === "prev" && index <= 0) return "next";
  if (activated === "next" && index >= count - 1) return "prev";
  return activated;
}
