/** Public command-surface: two palette jobs, one Korean name each. */

export const OPEN_GALLERY_NAME = "갤러리 열기";
/** Pane-menu and dialog label. Creating a gallery is not a palette command. */
export const CREATE_GALLERY_NAME = "새 갤러리 만들기";

export type CommandJob = "open-last-used" | "toggle-edit";

export type CommandSpec = {
  id: string;
  name: string;
  job: CommandJob;
};

export const COMMAND_SURFACE: readonly CommandSpec[] = [
  {
    id: "open-gallery",
    name: OPEN_GALLERY_NAME,
    job: "open-last-used",
  },
  {
    id: "toggle-edit-mode",
    name: "갤러리 편집 켜기 / 끄기",
    job: "toggle-edit",
  },
];

export function commandById(id: string): CommandSpec | undefined {
  return COMMAND_SURFACE.find((command) => command.id === id);
}

/** What the edit toggle needs from the gallery it acts on. */
export interface EditModeTarget {
  editMode: boolean;
  setEditMode(enabled: boolean): void;
}

/**
 * Palette check + run for the edit toggle. `active` is the gallery the user is
 * in right now; with none there the command is unavailable — it never reaches
 * for a background gallery.
 */
export function toggleActiveEditMode(
  checking: boolean,
  active: EditModeTarget | null,
): boolean {
  if (!active) return false;
  if (!checking) active.setEditMode(!active.editMode);
  return true;
}
