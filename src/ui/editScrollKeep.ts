/** Keep the same card in view across an edit-mode rebuild. */

export type EditScrollAnchor = {
  path: string | null;
  delta: number;
  scrollTop: number;
};

export type EditScrollCardBox = {
  path: string;
  top: number;
  bottom: number;
};

export function captureEditScrollAnchor(
  mainTop: number,
  scrollTop: number,
  cards: readonly EditScrollCardBox[],
): EditScrollAnchor {
  const first = cards.find((card) => card.path && card.bottom > mainTop);
  if (!first) return { path: null, delta: 0, scrollTop };
  return {
    path: first.path,
    delta: first.top - mainTop,
    scrollTop,
  };
}

export function restoreEditScrollTop(input: {
  anchor: EditScrollAnchor;
  mainTop: number;
  scrollHeight: number;
  clientHeight: number;
  cardTop: number | null;
}): number {
  const max = Math.max(0, input.scrollHeight - input.clientHeight);
  if (input.cardTop == null) {
    return clamp(input.anchor.scrollTop, 0, max);
  }
  return clamp(input.cardTop - input.mainTop - input.anchor.delta, 0, max);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
