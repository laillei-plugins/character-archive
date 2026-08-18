/**
 * Lightweight reorder drag — prioritize 60fps ghost tracking.
 * Slot swaps are throttled; sibling FLIP is skipped (was the main jank source).
 */
export interface HoldDragHandlers {
  onReorder: (fromId: string, toId: string, place: "before" | "after") => void;
  canDrag: () => boolean;
  dropSelector?: string;
  ghostClass?: string;
  slotClass?: string;
  activation?: "move" | "hold";
  holdMs?: number;
  movePx?: number;
  handleSelector?: string;
  ignoreSelector?: string;
}

export function attachHoldDrag(
  el: HTMLElement,
  id: string,
  handlers: HoldDragHandlers,
): void {
  const activation = handlers.activation ?? "move";
  const HOLD_MS = handlers.holdMs ?? 90;
  const MOVE_PX = handlers.movePx ?? 2;
  const dropSelector = handlers.dropSelector ?? ".charinfo-card";
  const ghostClass = handlers.ghostClass ?? "charinfo-card-ghost";
  const slotClass = handlers.slotClass ?? "charinfo-card-slot";

  let holdTimer: number | null = null;
  let dragging = false;
  let armed = false;
  let docListening = false;
  let startX = 0;
  let startY = 0;
  let pointerId = -1;
  let ghost: HTMLElement | null = null;
  let placeholder: HTMLElement | null = null;
  let grabOffsetX = 0;
  let grabOffsetY = 0;
  let raf = 0;
  let pendingX = 0;
  let pendingY = 0;
  let lastHitKey = "";
  let lastHitAt = 0;
  let gridEl: HTMLElement | null = null;
  let cachedTargets: { el: HTMLElement; id: string; rect: DOMRect }[] = [];
  let cacheAt = 0;

  const clearHold = () => {
    if (holdTimer != null) {
      window.clearTimeout(holdTimer);
      holdTimer = null;
    }
  };

  const removeDocListeners = () => {
    if (!docListening) return;
    docListening = false;
    document.removeEventListener("pointermove", onDocMove);
    document.removeEventListener("pointerup", onDocUp);
    document.removeEventListener("pointercancel", onDocUp);
  };

  const ensureDocListeners = () => {
    if (docListening) return;
    docListening = true;
    document.addEventListener("pointermove", onDocMove, { passive: false });
    document.addEventListener("pointerup", onDocUp);
    document.addEventListener("pointercancel", onDocUp);
  };

  const cleanupDrag = (restore = false) => {
    dragging = false;
    armed = false;
    lastHitKey = "";
    cachedTargets = [];
    gridEl = null;
    el.classList.remove("is-dragging");
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    ghost?.remove();
    ghost = null;
    if (placeholder) {
      if (restore) {
        placeholder.parentElement?.insertBefore(el, placeholder);
      }
      placeholder.remove();
    }
    placeholder = null;
    document.body.classList.remove("charinfo-dragging");
    removeDocListeners();
  };

  const makePlaceholder = (w: number, h: number) => {
    const p = document.createElement("div");
    p.className = slotClass;
    p.setAttribute("aria-hidden", "true");
    p.setCssStyles({ width: `${w}px`, height: `${h}px` });
    return p;
  };

  /** Slim ghost — avoid deep-cloning the whole card (images + chrome). */
  const makeGhost = (w: number, h: number) => {
    const g = document.createElement("div");
    g.className = ghostClass.includes("thumb") || ghostClass.includes("genre")
      ? ghostClass
      : `charinfo-card ${ghostClass}`;
    g.setCssStyles({
      width: `${w}px`,
      height: `${h}px`,
      pointerEvents: "none",
      position: "fixed",
      left: "0px",
      top: "0px",
      margin: "0px",
      zIndex: "100000",
    });
    g.setAttribute("aria-hidden", "true");

    if (ghostClass.includes("genre")) {
      const title =
        el.querySelector(".charinfo-genre__header h3")?.textContent?.trim() ||
        el.dataset.id ||
        "";
      g.textContent = title;
      g.setCssStyles({ height: "2.5rem" });
      return g;
    }

    const srcImg = el.querySelector("img");
    if (ghostClass.includes("thumb")) {
      if (srcImg instanceof HTMLImageElement) {
        const img = document.createElement("img");
        img.src = srcImg.currentSrc || srcImg.src;
        img.alt = "";
        img.draggable = false;
        g.appendChild(img);
      }
      return g;
    }

    const cover = document.createElement("div");
    cover.className = "charinfo-card__cover";
    if (srcImg instanceof HTMLImageElement) {
      const img = document.createElement("img");
      img.src = srcImg.currentSrc || srcImg.src;
      img.alt = "";
      img.draggable = false;
      img.setCssStyles({
        objectPosition: srcImg.style.objectPosition || "50% 50%",
      });
      cover.appendChild(img);
    } else {
      const empty = document.createElement("span");
      empty.className = "charinfo-card__cover-empty";
      empty.textContent = "커버 없음";
      cover.appendChild(empty);
    }
    g.appendChild(cover);

    const title =
      el.querySelector(".charinfo-card__title")?.textContent?.trim() || "";
    if (title) {
      const meta = document.createElement("div");
      meta.className = "charinfo-card__meta";
      const titleEl = document.createElement("div");
      titleEl.className = "charinfo-card__title";
      titleEl.textContent = title;
      meta.appendChild(titleEl);
      g.appendChild(meta);
    }

    return g;
  };

  const moveGhost = (x: number, y: number) => {
    if (!ghost) return;
    // Compositor-only path.
    ghost.setCssStyles({
      transform: `translate3d(${x - grabOffsetX}px, ${y - grabOffsetY}px, 0) scale(1.04)`,
    });
  };

  const refreshCache = (force = false) => {
    const now = performance.now();
    if (!force && now - cacheAt < 40) return;
    cacheAt = now;
    if (!gridEl) return;
    const cards = gridEl.querySelectorAll(dropSelector);
    const next: typeof cachedTargets = [];
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (!(card instanceof HTMLElement) || card === el) continue;
      // Never drop onto the add tile.
      if (card.classList.contains("charinfo-card--add")) continue;
      const cid = card.dataset.path ?? card.dataset.id;
      if (!cid || cid === id) continue;
      next.push({ el: card, id: cid, rect: card.getBoundingClientRect() });
    }
    // Reading order for gap insertion.
    next.sort(
      (a, b) =>
        a.rect.top - b.rect.top || a.rect.left - b.rect.left,
    );
    cachedTargets = next;
  };

  const placePlaceholder = (target: HTMLElement, place: "before" | "after") => {
    if (!placeholder) return;
    const parent = target.parentElement;
    if (!parent) return;

    const key = `${place}:${target.dataset.path ?? target.dataset.id ?? ""}`;
    if (key === lastHitKey) {
      if (
        place === "before" &&
        placeholder.nextElementSibling === target &&
        placeholder.parentElement === parent
      ) {
        return;
      }
      if (
        place === "after" &&
        placeholder.previousElementSibling === target &&
        placeholder.parentElement === parent
      ) {
        return;
      }
    }

    if (place === "before") parent.insertBefore(placeholder, target);
    else parent.insertBefore(placeholder, target.nextSibling);
    lastHitKey = key;
    cacheAt = 0;
  };

  /**
   * Eager gap insert: crossing ~15% into the next card is enough to swap
   * (center-threshold forced a full half-card drag for 1→2).
   */
  const hitTest = (x: number, y: number) => {
    if (!placeholder || !gridEl) return;
    refreshCache(false);
    if (cachedTargets.length === 0) {
      refreshCache(true);
    }
    if (cachedTargets.length === 0) return;

    const EDGE = 0.15;

    for (const item of cachedTargets) {
      const r = item.rect;
      const rowSlop = r.height * 0.6;
      const cy = r.top + r.height / 2;
      const onRow = Math.abs(y - cy) <= rowSlop;

      if (onRow) {
        // Still left of this card's early edge → insert before it.
        if (x < r.left + r.width * EDGE) {
          placePlaceholder(item.el, "before");
          return;
        }
        // Otherwise keep scanning — past this card toward the next gap.
        continue;
      }

      // Below this row's early edge → insert before this card (new row).
      if (y < r.top + r.height * EDGE) {
        placePlaceholder(item.el, "before");
        return;
      }
    }

    // Past everything → after the last card.
    const last = cachedTargets[cachedTargets.length - 1];
    if (last) placePlaceholder(last.el, "after");
  };

  const flushFrame = () => {
    raf = 0;
    if (!dragging) return;
    moveGhost(pendingX, pendingY);
    const now = performance.now();
    // Slightly snappier slot updates now that hit-test is cheap.
    if (now - lastHitAt >= 24) {
      lastHitAt = now;
      hitTest(pendingX, pendingY);
    }
  };

  const onDocMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;

    if (!dragging && armed) {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (dx * dx + dy * dy > MOVE_PX * MOVE_PX) {
        startDrag(event);
      }
      return;
    }

    if (!dragging) return;
    event.preventDefault();
    pendingX = event.clientX;
    pendingY = event.clientY;
    if (!raf) raf = requestAnimationFrame(flushFrame);
  };

  const resolveDrop = (): { toId: string; place: "before" | "after" } | null => {
    if (!placeholder) return null;
    const next = placeholder.nextElementSibling as HTMLElement | null;
    if (next?.matches?.(dropSelector)) {
      const toId = next.dataset.path ?? next.dataset.id;
      if (toId && toId !== id) return { toId, place: "before" };
    }
    const prev = placeholder.previousElementSibling as HTMLElement | null;
    if (prev?.matches?.(dropSelector)) {
      const toId = prev.dataset.path ?? prev.dataset.id;
      if (toId && toId !== id) return { toId, place: "after" };
    }
    return null;
  };

  const onDocUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId && event.type !== "pointercancel") return;
    clearHold();

    if (!dragging) {
      cleanupDrag(false);
      try {
        el.releasePointerCapture(pointerId);
      } catch {
        /* ignore */
      }
      return;
    }

    // Final hit with fresh rects before drop.
    refreshCache(true);
    hitTest(pendingX, pendingY);

    const drop = resolveDrop();
    if (placeholder?.parentElement) {
      placeholder.parentElement.insertBefore(el, placeholder);
    }
    placeholder?.remove();
    placeholder = null;
    el.classList.remove("is-dragging");

    ghost?.remove();
    ghost = null;
    dragging = false;
    armed = false;
    lastHitKey = "";
    cachedTargets = [];
    gridEl = null;
    document.body.classList.remove("charinfo-dragging");
    removeDocListeners();
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }

    try {
      el.releasePointerCapture(pointerId);
    } catch {
      /* ignore */
    }

    if (drop) {
      handlers.onReorder(id, drop.toId, drop.place);
    }
  };

  const startDrag = (event: PointerEvent) => {
    if (dragging) return;
    clearHold();
    dragging = true;
    armed = false;
    pointerId = event.pointerId;
    lastHitKey = "";
    lastHitAt = 0;
    cacheAt = 0;

    const rect = el.getBoundingClientRect();
    grabOffsetX = event.clientX - rect.left;
    grabOffsetY = event.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;

    const parent = el.parentElement;
    gridEl =
      (parent?.closest(".charinfo-grid, .charinfo-image-strip__row") as
        | HTMLElement
        | null) ?? parent;
    placeholder = makePlaceholder(w, h);
    ghost = makeGhost(w, h);
    parent?.insertBefore(placeholder, el);
    el.classList.add("is-dragging");

    document.body.appendChild(ghost);
    document.body.classList.add("charinfo-dragging");
    moveGhost(event.clientX, event.clientY);
    pendingX = event.clientX;
    pendingY = event.clientY;
    refreshCache(true);
    ensureDocListeners();

    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (!handlers.canDrag()) return;
    if (document.body.classList.contains("charinfo-dragging")) return;
    if (
      (event.target as HTMLElement).closest("button, a, input, select, textarea")
    ) {
      return;
    }
    if (
      handlers.ignoreSelector &&
      (event.target as HTMLElement).closest(handlers.ignoreSelector)
    ) {
      return;
    }
    if (handlers.handleSelector) {
      if (!(event.target as HTMLElement).closest(handlers.handleSelector)) {
        return;
      }
    }

    startX = event.clientX;
    startY = event.clientY;
    pointerId = event.pointerId;
    clearHold();

    if (activation === "hold") {
      holdTimer = window.setTimeout(() => {
        holdTimer = null;
        startDrag(event);
      }, HOLD_MS);
    } else {
      armed = true;
      ensureDocListeners();
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  const onPointerMoveCancelHold = (event: PointerEvent) => {
    if (dragging || holdTimer == null) return;
    if (event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (dx * dx + dy * dy > MOVE_PX * MOVE_PX) clearHold();
  };

  const onPointerUpCancelHold = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    if (!dragging) clearHold();
  };

  el.addEventListener("pointerdown", onPointerDown);
  if (activation === "hold") {
    el.addEventListener("pointermove", onPointerMoveCancelHold);
    el.addEventListener("pointerup", onPointerUpCancelHold);
    el.addEventListener("pointercancel", onPointerUpCancelHold);
  }
}
