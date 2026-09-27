/** Cover editor drag: mouse movement, touch hold, bounded scrolling, one write on drop. */
export function attachCoverImageDrag(grid: HTMLElement, onDrop: (key: string, anchor: string, place: "before" | "after") => void, canDrag: () => boolean): () => void {
  const doc = grid.ownerDocument, win = doc.defaultView!;
  const abort = new AbortController(), signal = abort.signal;
  let pending: { tile: HTMLElement; x: number; y: number; timer?: number } | null = null;
  let drag: { tile: HTMLElement; ghost: HTMLElement; order: Element[]; x: number; y: number; dx: number; dy: number; frame: number } | null = null;
  let swallowUntil = 0;
  const clear = () => { if (pending?.timer) win.clearTimeout(pending.timer); pending = null; };
  const move = (x: number, y: number) => {
    if (!drag) return;
    drag.x = x; drag.y = y;
    drag.ghost.style.transform = `translate(${x - drag.dx}px, ${y - drag.dy}px)`;
    const r = grid.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
    const tile = doc.elementFromPoint(x, y)?.closest<HTMLElement>("[data-image-key]");
    if (!tile || tile === drag.tile || tile.parentElement !== grid) return;
    const children = Array.from(grid.children);
    grid.insertBefore(drag.tile, children.indexOf(drag.tile) < children.indexOf(tile) ? tile.nextSibling : tile);
  };
  const tick = () => {
    if (!drag) return;
    const r = grid.getBoundingClientRect();
    if (drag.x >= r.left && drag.x <= r.right) {
      const delta = drag.y < r.top + 42 ? -Math.min(14, (r.top + 42 - drag.y) / 3) : drag.y > r.bottom - 42 ? Math.min(14, (drag.y - r.bottom + 42) / 3) : 0;
      if (delta) { grid.scrollTop += delta; move(drag.x, Math.max(r.top + 1, Math.min(r.bottom - 1, drag.y))); }
    }
    drag.frame = win.requestAnimationFrame(tick);
  };
  const lift = () => {
    if (!pending || !canDrag()) { clear(); return; }
    const p = pending, rect = p.tile.getBoundingClientRect();
    clear();
    const ghost = doc.createElement("div"); ghost.className = "charinfo-cover-drag-ghost";
    const image = p.tile.querySelector("img"); if (image) ghost.appendChild(image.cloneNode());
    Object.assign(ghost.style, { width: `${rect.width}px`, height: `${rect.height}px` });
    doc.body.appendChild(ghost);
    drag = { tile: p.tile, ghost, order: Array.from(grid.children), x: p.x, y: p.y, dx: p.x - rect.left, dy: p.y - rect.top, frame: 0 };
    p.tile.classList.add("is-lifted"); swallowUntil = Infinity;
    move(p.x, p.y); tick();
  };
  const end = (cancel: boolean) => {
    clear(); if (!drag) return;
    const d = drag; drag = null;
    win.cancelAnimationFrame(d.frame); d.ghost.remove(); d.tile.classList.remove("is-lifted"); swallowUntil = Date.now() + 400;
    const order = Array.from(grid.children), changed = order.some((el, i) => el !== d.order[i]);
    const next = d.tile.nextElementSibling as HTMLElement | null, prev = d.tile.previousElementSibling as HTMLElement | null;
    if (cancel) d.order.forEach(el => grid.appendChild(el));
    else if (changed && (next || prev)) onDrop(d.tile.dataset.imageKey!, (next ?? prev)!.dataset.imageKey!, next ? "before" : "after");
  };
  const tileAt = (target: EventTarget | null) => (target as Element | null)?.closest(".charinfo-cover-picker__cell")?.closest<HTMLElement>("[data-image-key]");
  grid.addEventListener("mousedown", e => { const tile = tileAt(e.target); if (e.button || !tile || !canDrag()) return; e.preventDefault(); pending = { tile, x: e.clientX, y: e.clientY }; }, { signal });
  doc.addEventListener("mousemove", e => { if (pending && !pending.timer && Math.hypot(e.clientX-pending.x, e.clientY-pending.y)>5) lift(); if (drag) move(e.clientX,e.clientY); }, { signal });
  doc.addEventListener("mouseup", () => end(false), { signal });
  grid.addEventListener("touchstart", e => { const tile=tileAt(e.target); if (e.touches.length !== 1 || !tile || !canDrag()) { end(true); return; } const p=e.touches[0]!; pending={tile,x:p.clientX,y:p.clientY,timer:win.setTimeout(lift,280)}; }, { signal, passive: true });
  doc.addEventListener("touchmove", e => { if(e.touches.length!==1){end(true);return;} const p=e.touches[0]; if(!p)return; if(drag){e.preventDefault();move(p.clientX,p.clientY);} else if(pending&&Math.hypot(p.clientX-pending.x,p.clientY-pending.y)>8)clear(); }, { signal, passive: false });
  doc.addEventListener("touchend", e => end(e.touches.length > 0), { signal });
  doc.addEventListener("touchcancel", () => end(true), { signal });
  win.addEventListener("blur", () => end(true), { signal });
  doc.addEventListener("keydown", e => { if(e.key==="Escape"&&drag){e.preventDefault();e.stopImmediatePropagation();end(true);} }, { signal, capture: true });
  grid.addEventListener("contextmenu", e => { if(tileAt(e.target))e.preventDefault(); }, { signal });
  grid.addEventListener("click", e => { if(Date.now()<swallowUntil){e.preventDefault();e.stopImmediatePropagation();} }, { signal, capture: true });
  return () => { end(true); abort.abort(); };
}
