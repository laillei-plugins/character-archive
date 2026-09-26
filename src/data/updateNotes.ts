export const UPDATE_NOTES_VERSION = "0.1.25";

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

- 갤러리 편집에서 이미지를 여러 장 골라 한 번에 추가할 수 있어요. 추가한 이미지는 노트에도 들어가요.
- 선택한 커버는 유지돼요. 커버 이미지가 없어지면 남은 이미지 중 첫 번째가 커버가 돼요.
- 갤러리에서 이미지 순서를 바꾸면 노트에도 같은 순서로 반영돼요.
- 커버가 아닌 이미지는 휴지통 버튼으로 제거할 수 있어요. 노트에서도 함께 제거되며, 실수했다면 ‘되돌리기’를 누르세요.
- 웹 공유에서 ‘추가한 이미지도 웹에 표시’를 켜면 여러 이미지를 함께 볼 수 있어요. 이미지를 크게 열어 넘겨볼 수도 있어요.
- 앱을 다시 열 때 변경되지 않은 노트를 반복해서 확인하는 작업을 줄였어요.

---

## What's new

- Select several images at once in gallery edit mode. Added images also appear in the note.
- Your selected cover stays in place. If it is removed, the first remaining image becomes the cover.
- Reorder images in the gallery, and the note uses the same order.
- Remove a non-cover image with the trash button. It is also removed from the note; choose Undo (되돌리기) if you change your mind.
- Turn on “Show added images on the web” (추가한 이미지도 웹에 표시) when sharing to include multiple images. Open an image for a larger view and browse through the others.
- Reopening the app now avoids repeating checks on unchanged notes.
`;
