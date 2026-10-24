export const UPDATE_NOTES_VERSION = "0.1.29";

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

- 그룹 이름 옆 숫자를 누르면 그룹을 접거나 펼칠 수 있어요. 읽기 모드와 편집 모드 모두에서 돼요.
- 접힌 그룹은 이름과 카드 수만 보여요. 화살표가 오른쪽(›)이면 접힌 상태, 아래(⌄)면 펼친 상태예요.
- 접은 상태는 저장돼서 다음에 열어도 그대로예요. 처음에는 모두 펼쳐져 있어요.
- 상단의 **모든 그룹 접기 / 펼치기** 버튼으로 한 번에 접고 펼 수 있어요.

---

## What's new

- Click the number next to a group name to fold or unfold that group, in both read mode and edit mode.
- A folded group shows only its name and card count. The arrow points right (›) when folded and down (⌄) when open.
- Folded groups stay folded the next time you open the gallery. Every group starts open.
- Use the **모든 그룹 접기 / 펼치기** (Fold all / Unfold all groups) button at the top to fold or unfold every group at once.
`;
