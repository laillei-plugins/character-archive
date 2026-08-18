import { setIcon } from "obsidian";
import type {
  CardPropertyId,
  CardPropertyPref,
} from "../data/cardProperties";
import { propertyLabel } from "../data/cardProperties";
import { attachHoldDrag } from "./holdDrag";

export interface ViewSettingsPopoverHandlers {
  getProperties: () => CardPropertyPref[];
  setProperties: (next: CardPropertyPref[]) => void | Promise<void>;
  getFitImage: () => boolean;
  setFitImage: (fit: boolean) => void | Promise<void>;
  getLabel?: (id: CardPropertyId) => string;
  onChange: () => void;
}

/**
 * Flat view menu: properties + fit toggle on one screen (no drill-down).
 */
export class ViewSettingsPopover {
  private panel: HTMLElement | null = null;
  private onDocPointer: ((e: PointerEvent) => void) | null = null;
  private onKey: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    private anchor: HTMLElement,
    private host: HTMLElement,
    private handlers: ViewSettingsPopoverHandlers,
  ) {}

  toggle(): void {
    if (this.panel) this.close();
    else this.open();
  }

  close(): void {
    this.panel?.remove();
    this.panel = null;
    if (this.onDocPointer) {
      document.removeEventListener("pointerdown", this.onDocPointer, true);
      this.onDocPointer = null;
    }
    if (this.onKey) {
      document.removeEventListener("keydown", this.onKey);
      this.onKey = null;
    }
  }

  private open(): void {
    this.close();
    const panel = this.host.createDiv({ cls: "charinfo-view-menu" });
    this.panel = panel;

    const rect = this.anchor.getBoundingClientRect();
    const hostRect = this.host.getBoundingClientRect();
    panel.style.top = `${rect.bottom - hostRect.top + 6}px`;
    panel.style.right = `${hostRect.right - rect.right}px`;

    this.render(panel);

    this.onDocPointer = (event) => {
      if (!(event.target instanceof Node)) return;
      if (panel.contains(event.target) || this.anchor.contains(event.target)) {
        return;
      }
      this.close();
    };
    this.onKey = (event) => {
      if (event.key === "Escape") this.close();
    };
    window.setTimeout(() => {
      if (this.onDocPointer) {
        document.addEventListener("pointerdown", this.onDocPointer, true);
      }
      if (this.onKey) {
        document.addEventListener("keydown", this.onKey);
      }
    }, 0);
  }

  private render(panel: HTMLElement): void {
    panel.empty();
    panel.createDiv({ cls: "charinfo-view-menu__title", text: "카드에 보일 항목" });
    panel.createDiv({
      cls: "charinfo-view-menu__hint",
      text: "눈 아이콘으로 카드에 보일 항목을 고릅니다. 옆 패널에는 항상 전부 표시됩니다.",
    });

    const list = panel.createDiv({ cls: "charinfo-prop-list" });
    const prefs = this.handlers.getProperties().map((p) => ({ ...p }));

    const rerender = () => {
      list.empty();
      for (const pref of prefs) {
        this.renderPropRow(list, prefs, pref, rerender);
      }
    };
    rerender();

    const fit = this.handlers.getFitImage();
    const row = panel.createDiv({ cls: "charinfo-view-menu__toggle-row" });
    row.createDiv({
      cls: "charinfo-view-menu__toggle-label",
      text: "이미지 맞추기",
    });
    const toggle = row.createEl("button", {
      cls: "charinfo-view-menu__switch" + (fit ? " is-on" : ""),
      attr: {
        type: "button",
        role: "switch",
        "aria-checked": fit ? "true" : "false",
        "aria-label": "이미지 맞추기",
      },
    });
    toggle.createSpan({ cls: "charinfo-view-menu__switch-knob" });
    toggle.addEventListener("click", () => {
      const next = !this.handlers.getFitImage();
      void this.handlers.setFitImage(next);
      this.render(panel);
      this.handlers.onChange();
    });
  }

  private renderPropRow(
    list: HTMLElement,
    prefs: CardPropertyPref[],
    pref: CardPropertyPref,
    rerender: () => void,
  ): void {
    const row = list.createDiv({
      cls: "charinfo-prop-row" + (pref.visible ? " is-visible" : " is-hidden"),
    });
    row.dataset.id = pref.id;

    const handle = row.createDiv({
      cls: "charinfo-prop-row__handle",
      attr: { title: "드래그해서 순서 변경", "aria-label": "순서" },
    });
    setIcon(handle, "grip-vertical");

    row.createDiv({
      cls: "charinfo-prop-row__label",
      text: (this.handlers.getLabel ?? propertyLabel)(pref.id),
    });

    const eye = row.createEl("button", {
      cls: "charinfo-prop-row__eye",
      attr: {
        type: "button",
        title: pref.visible ? "카드에서 숨기기" : "카드에 보이기",
        "aria-pressed": pref.visible ? "true" : "false",
      },
    });
    setIcon(eye, pref.visible ? "eye" : "eye-off");
    eye.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      pref.visible = !pref.visible;
      void this.persist(prefs);
      rerender();
      this.handlers.onChange();
    });

    attachHoldDrag(row, pref.id, {
      canDrag: () => true,
      activation: "move",
      movePx: 4,
      dropSelector: ".charinfo-prop-row",
      ghostClass: "charinfo-prop-row-ghost",
      slotClass: "charinfo-prop-row-slot",
      onReorder: (fromId, toId, place) => {
        const from = prefs.findIndex((p) => p.id === fromId);
        const to = prefs.findIndex((p) => p.id === toId);
        if (from < 0 || to < 0 || from === to) return;
        const [item] = prefs.splice(from, 1);
        if (!item) return;
        let insertAt = prefs.findIndex((p) => p.id === toId);
        if (insertAt < 0) return;
        if (place === "after") insertAt += 1;
        prefs.splice(insertAt, 0, item);
        void this.persist(prefs);
        rerender();
        this.handlers.onChange();
      },
    });
  }

  private async persist(prefs: CardPropertyPref[]): Promise<void> {
    await this.handlers.setProperties(prefs.map((p) => ({ ...p })));
  }
}

export type { CardPropertyId };
