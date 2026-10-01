export const UPDATE_NOTES_VERSION = "0.1.28";

export function normalizeSeenUpdateNotesVersion(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

export function updateNotesPath(libraryFolder: string): string {
  const root = libraryFolder.replace(/\\/g, "/").replace(/\/+$/, "");
  return `${root}/_updates/${UPDATE_NOTES_VERSION}.md`;
}

function compareVersions(a: string, b: string): number {
  const parts = (value: string) => value.split(".").map((part) => Number(part));
  const left = parts(a);
  const right = parts(b);
  if (left.some((part) => !Number.isInteger(part) || part < 0)) return -1;
  if (right.some((part) => !Number.isInteger(part) || part < 0)) return 1;
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function shouldOpenUpdateNotes(input: {
  installedVersion: string;
  seenVersion: string;
  hadStoredSettings: boolean;
}): boolean {
  return (
    input.hadStoredSettings &&
    input.installedVersion === UPDATE_NOTES_VERSION &&
    compareVersions(input.seenVersion, UPDATE_NOTES_VERSION) < 0
  );
}

export const UPDATE_NOTES_MARKDOWN = `---
kind: "character-archive-update"
---

# Character Archive ${UPDATE_NOTES_VERSION}

## 업데이트 내용

- 편집 모드에서 왼쪽 위 아카이브 이름을 누르고 **새 아카이브 만들기**를 선택하면 대분류를 추가할 수 있어요.
- 카드가 없는 아카이브도 저장돼요. 다시 열어도 목록에 남고, **캐릭터 추가**로 첫 카드를 만들 수 있어요.
- 같은 이름의 아카이브가 있으면 입력창에서 알려줘요.
- 명령 팔레트는 **갤러리 열기**, **갤러리 편집 켜기 / 끄기** 두 개로 정리했어요. 편집 명령은 지금 보고 있는 갤러리에만 적용돼요.

카드 추가와 속성 설정은 갤러리의 편집 모드에서 이용해 주세요.

---

## What's new

- In edit mode, click the archive name at the top left and choose **새 아카이브 만들기** (Create archive) to add a top-level archive.
- Empty archives are saved and stay in the list when you reopen the gallery. Use **캐릭터 추가** (Add character) to create the first card.
- If an archive with the same name already exists, the name dialog explains it.
- The command palette now has just **갤러리 열기** (Open gallery) and **갤러리 편집 켜기 / 끄기** (Turn gallery editing on / off). The editing command only affects the gallery you are viewing.

Use the gallery's edit mode to add cards and manage properties.
`;
