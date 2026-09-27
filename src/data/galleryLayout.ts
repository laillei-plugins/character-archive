/**
 * Detail-pane width for the gallery and the shared web view.
 * Full below the surface breakpoint; otherwise a clamped split width.
 * `preferred` is echoed unchanged. The caller keeps the stored preference.
 */

export interface DetailLayout {
  readonly mode: "full" | "split";
  readonly width: number | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly preferred: number | null;
}

const SPLIT_MIN = 320;
const SPLIT_MAX = 560;

function assertLayoutInputs(width: number, preferred: number | null): void {
  if (!Number.isFinite(width) || width < 0) {
    throw new Error("invalid width");
  }
  if (preferred !== null && (!Number.isFinite(preferred) || preferred < 0)) {
    throw new Error("invalid preferred");
  }
}

function fullLayout(preferred: number | null): DetailLayout {
  return { mode: "full", width: null, min: null, max: null, preferred };
}

function splitLayout(
  preferred: number | null,
  max: number,
  auto: number,
): DetailLayout {
  if (max < SPLIT_MIN) throw new Error("invalid bounds");
  const basis = preferred === null ? auto : preferred;
  return {
    mode: "split",
    width: Math.min(max, Math.max(SPLIT_MIN, basis)),
    min: SPLIT_MIN,
    max,
    preferred,
  };
}

/** Gallery (embedded) detail pane. Full below 900. */
export function galleryDetailLayout(
  width: number,
  preferred: number | null = null,
): DetailLayout {
  assertLayoutInputs(width, preferred);
  if (width < 900) return fullLayout(preferred);
  const max = Math.min(SPLIT_MAX, Math.floor(0.45 * width), width - 492);
  const auto = Math.min(480, Math.max(SPLIT_MIN, Math.round(0.34 * width)));
  return splitLayout(preferred, max, auto);
}

/** Shared web detail pane. Full below 960. Automatic width is 380. */
export function sharedDetailLayout(
  width: number,
  preferred: number | null = null,
): DetailLayout {
  assertLayoutInputs(width, preferred);
  if (width < 960) return fullLayout(preferred);
  const max = Math.min(SPLIT_MAX, Math.floor(0.45 * width));
  return splitLayout(preferred, max, 380);
}
