export const UPDATE_NOTES_VERSION = "0.1.20";

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

- 보관함 폴더 이름을 누르면 그 보관함 갤러리만 열려요. 폴더는 펼쳐지지 않아요.
- 보관함이 여러 개면 각각 다른 탭으로 열 수 있어요.
- 갤러리를 열 때 탭 위쪽 줄이 어긋나 보이던 문제를 고쳤어요.
- 리본의 격자 버튼과 «마지막 갤러리 열기» 명령이 마지막으로 봤던 갤러리를 다시 열어요. 본 적이 없으면 기본 갤러리가 열려요.
- 읽기 모드에서 카드의 그림을 누르면 크게 볼 수 있어요. 좌우 화살표로 넘기고, X 버튼이나 Esc 키로 닫아요.
- «이름순»을 고르면 카드 전체가 이름 순서대로 정렬돼요. 한글, 알파벳, 숫자 순서를 알아서 맞춰요.
- 명령 이름을 정리했어요. 새로 만들 때는 «새 갤러리 만들기», 이미지 복구는 «예전 폴더 이미지 다시 연결»이에요.

---

## What's new

- Clicking a library folder name opens that library's gallery only. The folder stays collapsed.
- Multiple libraries can stay open in separate tabs.
- Opening a gallery no longer splits the top tab line.
- The grid ribbon button and the "마지막 갤러리 열기" command reopen the gallery you last viewed. If you haven't opened one yet, the default gallery opens.
- In reading mode, click a card image to see it large. Move with the left/right arrows; close with the X button or Esc.
- Choosing "이름순" sorts every card by name — Korean, alphabet, and numbers in natural order.
- Command names were tidied: creating a gallery is now "새 갤러리 만들기", and image repair is "예전 폴더 이미지 다시 연결".
`;
