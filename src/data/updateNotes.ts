export const UPDATE_NOTES_VERSION = "0.1.26";

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

- 커버 창에서도 이미지를 제거하고 순서를 바꿀 수 있어요. 변경한 내용은 노트와 갤러리에 함께 반영돼요.
- 선택한 커버는 순서를 바꿔도 유지돼요. 다른 이미지가 있을 때 커버를 제거하려면 먼저 새 커버를 골라 주세요.
- 이미지를 제거한 뒤에는 이미지 목록 아래의 ‘되돌리기’를 눌러 복원할 수 있어요.
- 이미지가 많으면 컴퓨터에서는 한 페이지에 6장, 모바일에서는 4장씩 보여요. 한 페이지에 모두 보이면 ‘이전’과 ‘다음’ 버튼은 나타나지 않아요.
- ‘링크’ 버튼의 아이콘이 잘리지 않도록 수정했어요.

---

## What's new

- Remove and reorder images directly in the cover window. Changes are reflected in both the note and gallery.
- Reordering keeps your selected cover. To remove the cover when other images remain, choose a new cover first.
- After removing an image, restore it with Undo (되돌리기) below the image list.
- Browse six images per page on desktop and four on mobile. Previous and Next stay hidden when all images fit on one page.
- Fixed the clipped icon on the Link (링크) button.
`;
