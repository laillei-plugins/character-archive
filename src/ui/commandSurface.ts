/** Public command-surface after last-used ribbon. One job, one Korean name. */

export const OPEN_GALLERY_NAME = "마지막 갤러리 열기";
export const CREATE_GALLERY_NAME = "새 갤러리 만들기";
export const HEAL_IMAGE_LINKS_NAME = "예전 폴더 이미지 다시 연결";

export type CommandVisibility = "palette" | "hidden";

export type CommandJob =
  | "open-last-used"
  | "create"
  | "open-default-compat"
  | "sweep-folders"
  | "sweep-orphan-pages"
  | "new-character"
  | "toggle-edit"
  | "refresh"
  | "heal-legacy-folder"
  | "share"
  | "copy-app-link"
  | "copy-wikilink";

export type CommandSpec = {
  id: string;
  name: string;
  visibility: CommandVisibility;
  job: CommandJob;
};

export const COMMAND_SURFACE: readonly CommandSpec[] = [
  {
    id: "open-gallery",
    name: OPEN_GALLERY_NAME,
    visibility: "palette",
    job: "open-last-used",
  },
  {
    id: "new-gallery-page",
    name: CREATE_GALLERY_NAME,
    visibility: "palette",
    job: "create",
  },
  {
    id: "new-gallery-page-default",
    name: "기본 갤러리 열기",
    visibility: "hidden",
    job: "open-default-compat",
  },
  {
    id: "sweep-empty-folders",
    name: "남은 빈 폴더 치우기",
    visibility: "palette",
    job: "sweep-folders",
  },
  {
    id: "sweep-orphan-gallery-pages",
    name: "남은 갤러리 창 치우기",
    visibility: "palette",
    job: "sweep-orphan-pages",
  },
  {
    id: "new-character",
    name: "캐릭터 노트 만들기",
    visibility: "palette",
    job: "new-character",
  },
  {
    id: "toggle-edit-mode",
    name: "갤러리 편집 모드 전환",
    visibility: "palette",
    job: "toggle-edit",
  },
  {
    id: "refresh-gallery",
    name: "갤러리 새로고침",
    visibility: "palette",
    job: "refresh",
  },
  {
    id: "heal-library-image-links",
    name: HEAL_IMAGE_LINKS_NAME,
    visibility: "palette",
    job: "heal-legacy-folder",
  },
  {
    id: "share-gallery-web",
    name: "갤러리 공유",
    visibility: "palette",
    job: "share",
  },
  {
    id: "copy-gallery-page-link",
    name: "갤러리 앱 링크 복사",
    visibility: "palette",
    job: "copy-app-link",
  },
  {
    id: "copy-gallery-wikilink",
    name: "갤러리 노트 링크 복사",
    visibility: "palette",
    job: "copy-wikilink",
  },
];

export function paletteCommands(): CommandSpec[] {
  return COMMAND_SURFACE.filter((command) => command.visibility === "palette");
}

export function commandById(id: string): CommandSpec | undefined {
  return COMMAND_SURFACE.find((command) => command.id === id);
}

/** Palette check: hidden ids stay bound for hotkeys, but never appear in the list. */
export function hiddenCompatCheck(checking: boolean): boolean {
  return !checking;
}
