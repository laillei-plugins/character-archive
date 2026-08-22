export const UPDATE_NOTES_VERSION = "0.1.19";

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

- 갤러리 편집에서 올린 커버 이미지는 캐릭터 노트에도 바로 추가돼요.
- 노트에서 이미지를 지우면 커버 고르기와 이미지 목록에서도 사라져요. 이미지 파일은 삭제하지 않아요.
- 노트의 첫 이미지를 커버로 쓸 때 이미지 순서를 바꾸면 카드에도 바로 반영돼요.

---

## What's new

- A cover uploaded from gallery edit mode is now added to the character note too.
- Removing an image from the note also removes it from the cover picker and image list. The image file itself is not deleted.
- When the first note image is used as the cover, reordering images now updates the card immediately.
`;
