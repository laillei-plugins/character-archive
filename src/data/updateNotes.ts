export const UPDATE_NOTES_VERSION = "0.1.24";

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

- 모바일에서는 검색이 필요할 때만 펼쳐져 상단이 더 간결해요.
- 좁은 화면의 공유, 속성 관리, 여러 선택, 새로고침을 보기 메뉴에서 쉽게 찾을 수 있어요.
- 화면 너비가 바뀌거나 검색과 여러 선택을 끝내도 키보드 초점이 보이는 버튼에 남아요.

---

## What's new

- On mobile, search expands only when needed, keeping the header simpler.
- On narrow screens, Share, Manage attributes, Multi-select, and Refresh are easy to find in the View menu.
- Keyboard focus stays on a visible control after resizing or leaving search and multi-select.
`;
