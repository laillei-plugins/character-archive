export const UPDATE_NOTES_VERSION = "0.1.30";

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

### A. English / 한국어 언어 옵션

**무엇이 바뀌었나요**

플러그인의 버튼, 메뉴, 대화상자, 설정과 기본 필드 이름을 English 또는 한국어로 볼 수 있어요. 노트와 속성 이름은 바뀌지 않아요. 기존 설치는 한국어로 유지되고, 새 설치는 Obsidian 자체가 한국어가 아니면 English로 시작해요.

**어떻게 쓰나요**

드롭다운에서 언어를 선택하면 열려 있는 갤러리가 바로 바뀌어요. 노트 안의 섹션 제목과 웹 공유 페이지는 당분간 한국어로 유지돼요.

**어디에 있나요**

설정 → 커뮤니티 플러그인 → Character Archive → Language / 언어 (첫 행)

### B. 모두 접기 아이콘 이동

**무엇이 바뀌었나요**

모두 접기 / 펼치기 버튼이 툴바에서 첫 번째 그룹 제목 줄의 아이콘으로 이동했어요. 카드가 시작하는 위치는 같아요.

**어떻게 쓰나요**

아이콘을 누르면 모든 그룹이 접혀요. 모두 접힌 상태에서 같은 아이콘을 누르면 모두 펼쳐져요. 각 그룹의 숫자 필은 해당 그룹만 접어요. 접힌 상태는 기억돼요.

**어디에 있나요**

갤러리 → 첫 번째 그룹 제목 줄 오른쪽 끝의 ⇕ 아이콘

---

## What's new

### A. English / 한국어 language option

**What changed**

The plugin's buttons, menus, dialogs, settings, and built-in field names can appear in English or Korean. Notes and property names do not change. Existing installs stay Korean; a new install starts in English unless Obsidian itself is set to Korean.

**How it works**

Choose a language from the dropdown, and open galleries switch right away. Section headings inside notes and the web share page stay Korean for now.

**Where to find it**

Settings → Community plugins → Character Archive → Language / 언어 (first row)

### B. Fold-all icon moved

**What changed**

The fold all / unfold all button is now an icon on the first group's header row instead of the toolbar. The cards start at the same place.

**How it works**

Click it to fold every group. When all groups are folded, the same icon unfolds them all. Each group's own count pill still folds only that group. The folded state is remembered.

**Where to find it**

Gallery → right end of the first group's title row (⇕ icon)

`;
