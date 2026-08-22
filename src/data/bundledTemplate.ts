/** Starter names for the one example group shipped with the plugin. */
export const EXAMPLE_ARCHIVE = "예시";
export const EXAMPLE_GROUP = "예시";
export const EXAMPLE_TITLE = "첫 카드";
/**
 * Folder under the library for the seeded sample card.
 * Separate from user archive folders so those trees stay untouched.
 */
export const EXAMPLE_FOLDER = "_starter";

/** Canonical new-character template (plugin-bundled). Vault path may override. */
export const BUNDLED_CHARACTER_TEMPLATE = `---
kind: "character"
장르: "{{genre}}"
그룹: "{{group}}"
이름: "{{title}}"
상태: "Off"
관계: ""
인연: ""
소속: ""
코드네임: ""
본명: ""
태그: []
cover: ""
order: 0
---

# {{title}}

> [!tip] 속성 관리
> 위쪽 속성(Properties)에서는 이 캐릭터의 속성 값만 입력해 주세요.
> **이름** 값과 노트 파일명은 함께 바뀌어요.
> 속성을 추가·삭제하거나 이름·종류·순서·선택 항목을 바꾸려면 갤러리의 **편집 모드 → 그룹 · 속성 관리**를 열어 주세요.
> 노트 위쪽 속성(Properties)에서 이름(키)을 직접 바꾸면 갤러리가 값을 찾지 못할 수 있어요.

## 설명

한두 줄로 이 캐릭터를 소개하세요. 갤러리에서 카드를 누르면 여기가 본문입니다.

첫 번째로 넣은 그림이 카드 표지가 됩니다. 갤러리 편집에서 표지 그림을 누르면 바꿀 수 있어요.

## 신상

| 구분 | 내용 |
| --- | --- |
| 코드네임 |  |
| 본명 |  |
| 소속 |  |
| 나이 |  |
| 성별 |  |

## 외형

키·머리·눈·피부·복장처럼 겉모습을 적어주세요.

## 성격

말투와 태도, 사람을 대하는 방식을 적어주세요.

## 능력

**[능력명]**

능력에 대한 설명

## 프롬프트

**기본외형**

\`\`\`
여기에 기본 외형 프롬프트를 적어주세요
\`\`\`

**의상**

\`\`\`
여기에 의상 프롬프트를 적어주세요
\`\`\`

## 메모

갤러리 시트에는 안 나옵니다. 메모·링크·체크리스트를 자유롭게 두세요.
제목을 바꿔 숨기려면 그 제목 **바로 위**에 \`<!-- charinfo:private -->\` 를 두세요.
`;

export function fillCharacterTemplate(
  source: string,
  vars: { title: string; genre: string; group?: string },
): string {
  return source
    .replace(/\{\{title\}\}/g, vars.title)
    .replace(/\{\{genre\}\}/g, vars.genre)
    .replace(/\{\{group\}\}/g, vars.group ?? "");
}

export function exampleCharacterRelPath(library: string): string {
  const lib = library.replace(/\/+$/, "") || "Character Archive";
  return `${lib}/${EXAMPLE_FOLDER}/${EXAMPLE_TITLE}/${EXAMPLE_TITLE}.md`;
}

/** One-card seed for an empty library. Same skeleton as new notes, plus a delete-me line. */
export function exampleCharacterBody(): string {
  const filled = fillCharacterTemplate(BUNDLED_CHARACTER_TEMPLATE, {
    title: EXAMPLE_TITLE,
    genre: EXAMPLE_ARCHIVE,
    group: EXAMPLE_GROUP,
  });
  return filled.replace(
    `# ${EXAMPLE_TITLE}\n\n`,
    `# ${EXAMPLE_TITLE}\n\n이 카드는 시작용 예시입니다.\n아래를 자유롭게 고쳐 쓰세요.\n\`##\` 제목과 표는 갤러리가 읽습니다. 이 카드는 지워도 됩니다.\n\n`,
  );
}
