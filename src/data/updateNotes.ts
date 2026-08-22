export const UPDATE_NOTES_VERSION = "0.1.18";

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

- 편집 모드의 **그룹 · 속성 관리**에서 그룹과 속성을 함께 관리할 수 있어요.
- 그룹을 추가하고, 이름과 순서를 바꾸고, 삭제할 수 있어요. 삭제할 때는 남은 카드를 옮길 그룹을 고릅니다.
- 카드를 여러 장 골라 다른 그룹으로 옮길 수 있어요. 필요한 그룹이 없으면 그 자리에서 만들 수 있어요.
- 속성의 이름, 종류, 순서, 선택 항목을 그룹별로 바꿀 수 있어요.
- 카드를 끌어 놓으면 새 순서가 바로 저장돼요.
- **이름** 값과 노트 파일명은 함께 바뀌어요. 새 캐릭터를 만들 때도 이름을 먼저 정합니다.
- 새 카드 템플릿의 속성 안내문을 지금 편집 흐름에 맞게 고쳤어요.

---

## What's new

- In edit mode, use **Groups · Properties** to manage groups and properties in one place.
- Add, rename, reorder, or delete groups. When deleting a group, choose where its remaining cards should move.
- Select several cards and move them to another group. If the group does not exist, create it during the move.
- Change property names, types, order, and select options for each group.
- Dragging a card saves the new order right away.
- The **Name** value and note filename stay in sync. New characters are also named before they are created.
- The property guide in the new-card template now matches the current editing flow.
`;
