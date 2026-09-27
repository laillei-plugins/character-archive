export const UPDATE_NOTES_VERSION = "0.1.27";

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

- 커버 창에서 이미지를 드래그해 순서를 바꿀 수 있어요. 모바일에서는 이미지를 길게 누른 뒤 옮겨 주세요. 선택한 커버는 유지돼요.
- 커버를 편집할 때는 이미지를 눌러도 확대 화면이 열리지 않아요.
- 갤러리 패널의 경계를 드래그해 너비를 조절할 수 있어요. 화면이 좁으면 상세 내용이 전체 너비로 열려요.
- 공유 페이지는 한 줄에 최대 6개의 카드를 보여줘요. 화면에 맞춰 카드 수와 이미지 크기가 조절돼요.
- 이미지 아래 화살표로 다른 이미지를 볼 수 있어요. 이미지를 누르면 확대되고, 바깥의 어두운 영역을 누르면 닫혀요.
- 한 이미지당 최대 25MB, 공유 페이지 전체는 최대 20MB까지 올릴 수 있어요. 공유용 이미지만 줄이고 원본은 유지해요.
- 프롬프트는 복사 버튼으로 그대로 복사할 수 있어요.

기존 공유 링크에 새 화면을 적용하려면 공유 창에서 링크를 업데이트해 주세요.

---

## What's new

- Drag images to reorder them in the cover window. On mobile, hold an image before dragging. Your selected cover stays the same.
- Clicking an image while editing the cover no longer opens the enlarged view.
- Drag the gallery panel divider to adjust its width. On smaller screens, details use the full width.
- Shared galleries show up to six cards per row, with card counts and image sizes adapting to the available space.
- Use the arrows below an image to browse. Click the image to enlarge it, and click the dark background to close it.
- Add images up to 25MB each and share pages up to 20MB total. Only shared copies are compressed; originals stay unchanged.
- Prompt copy buttons preserve the exact text.

Update an existing link from the sharing window to apply the new layout.
`;
