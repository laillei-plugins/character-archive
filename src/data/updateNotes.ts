export const UPDATE_NOTES_VERSION = "0.1.31";

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

### 모바일 시작 속도 개선

**무엇이 바뀌었나요**

휴대폰에서 Obsidian을 열 때 Character Archive가 하는 일을 줄였어요. 캐릭터 노트가 아닌 노트는 더 이상 읽지 않고, 속성 확인 기록은 기기마다 따로 저장해서 Mac과 휴대폰이 iCloud로 서로 덮어쓰지 않아요. 화면은 바뀌지 않아요.

**어떻게 쓰나요**

따로 할 일은 없어요. 업데이트 후 각 기기에서 처음 열 때 한 번만 캐릭터 노트를 확인하고, 그다음부터는 바뀐 노트만 확인해요. 휴대폰에서는 이 확인이 앱이 열리고 3초 뒤에 시작돼요. 화면을 누를 때마다 전체 노트를 훑던 동작과, PDF·이미지를 열기 전에 파일 전체를 읽던 동작도 없앴어요.

**어디에 있나요**

설정 → 커뮤니티 플러그인 → Character Archive → 버전 0.1.31 (자동 적용, 별도 설정 없음)

---

## What's new

### Faster mobile startup

**What changed**

Character Archive does less work when Obsidian opens on your phone. It no longer reads notes that are not character notes, and its property-check record is now stored per device, so your Mac and phone stop overwriting each other through iCloud. Nothing on screen changes.

**How it works**

Nothing to do. After the update, each device checks your character notes once on first launch, then only notes that changed. On phones that check starts 3 seconds after the app opens. Taps no longer scan every note, and PDFs and images are no longer read in full before they open.

**Where to find it**

Settings → Community plugins → Character Archive → version 0.1.31 (applies automatically, no setting)

`;
