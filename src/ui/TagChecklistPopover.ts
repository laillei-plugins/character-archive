import { setIcon } from "obsidian";
import type { TagDef } from "../settings";
import { placeAnchoredPopover } from "./typeMenuPlacement";

export interface TagChecklistHandlers {
  /** Tag ids currently on the record. */
  getSelected: () => string[];
  /** Toggle membership; resolves after the frontmatter write. */
  toggle: (id: string, next: boolean) => Promise<void>;
}

/**
 * Anchored checklist for the `태그` property (edit mode).
 * Stays open across toggles — a Menu would close on every click. Vocabulary is
 * settings-owned: ids stored only in notes appear as removable gray ghosts and
 * are never added to the vocabulary from here.
 */
export class TagChecklistPopover {
  private panel: HTMLElement | null = null;
  private onDocPointer: ((e: PointerEvent) => void) | null = null;
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  private onScroll: ((event: Event) => void) | null = null;
  private busy = false;

  constructor(
    private anchor: HTMLElement,
    private vocab: TagDef[],
    private handlers: TagChecklistHandlers,
  ) {}

  /** False after Escape / outside click / scroll closed it on its own. */
  isOpen(): boolean {
    return this.panel !== null;
  }

  open(): void {
    this.close();
    const panel = document.body.createDiv({
      cls: "charinfo-view-menu charinfo-tag-menu",
      attr: { role: "group", "aria-label": "태그 고르기" },
    });
    this.panel = panel;

    this.render();
    this.placePanel();

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
    // A fixed overlay closes when its anchor moves out from under it.
    this.onScroll = (event) => {
      if (event.target instanceof Node && panel.contains(event.target)) return;
      this.close();
    };
    window.setTimeout(() => {
      if (this.onDocPointer) {
        document.addEventListener("pointerdown", this.onDocPointer, true);
      }
      if (this.onKey) document.addEventListener("keydown", this.onKey);
      if (this.onScroll) {
        document.addEventListener("scroll", this.onScroll, true);
      }
    }, 0);
  }

  private placePanel(): void {
    const panel = this.panel;
    if (!panel?.isConnected || !this.anchor.isConnected) return;
    panel.style.removeProperty("max-height");
    const placement = placeAnchoredPopover(
      this.anchor.getBoundingClientRect(),
      panel.getBoundingClientRect(),
      window.innerWidth,
      window.innerHeight,
      { anchorGap: 6 },
    );
    panel.setCssStyles({
      top: `${Math.round(placement.top)}px`,
      left: `${Math.round(placement.left)}px`,
      maxHeight: `${Math.floor(placement.maxHeight)}px`,
    });
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
    if (this.onScroll) {
      document.removeEventListener("scroll", this.onScroll, true);
      this.onScroll = null;
    }
  }

  private render(): void {
    const panel = this.panel;
    if (!panel) return;
    panel.empty();
    panel.createDiv({ cls: "charinfo-view-menu__title", text: "태그" });

    const selected = new Set(this.handlers.getSelected());
    const known = new Set(this.vocab.map((t) => t.id));
    const ghosts = [...selected].filter((id) => !known.has(id));

    if (this.vocab.length === 0 && ghosts.length === 0) {
      panel.createDiv({
        cls: "charinfo-view-menu__hint",
        text: "설정 → 태그 옵션에서 태그를 먼저 추가하세요.",
      });
      this.placePanel();
      return;
    }

    const list = panel.createDiv({ cls: "charinfo-tag-menu__list" });
    for (const tag of this.vocab) {
      this.renderRow(list, tag.id, tag.label, selected.has(tag.id), false);
    }
    for (const id of ghosts) {
      // Unknown id (deleted from the vocabulary) — removable only.
      this.renderRow(list, id, id, true, true);
    }
    this.placePanel();
  }

  private renderRow(
    list: HTMLElement,
    id: string,
    label: string,
    checked: boolean,
    ghost: boolean,
  ): void {
    const row = list.createEl("button", {
      cls:
        "charinfo-tag-menu__row" +
        (checked ? " is-checked" : "") +
        (ghost ? " is-ghost" : ""),
      attr: {
        type: "button",
        role: "checkbox",
        "aria-checked": checked ? "true" : "false",
      },
    });
    const box = row.createSpan({ cls: "charinfo-tag-menu__check" });
    if (checked) setIcon(box, "check");
    row.createSpan({ cls: "charinfo-tag-menu__label", text: label });
    if (ghost) {
      row.createSpan({ cls: "charinfo-tag-menu__note", text: "삭제된 태그" });
    }

    row.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      // One write at a time per card — repeated toggles would race in FM.
      if (this.busy) return;
      this.busy = true;
      void this.handlers
        .toggle(id, !checked)
        .finally(() => {
          this.busy = false;
          this.render();
        });
    });
  }
}
