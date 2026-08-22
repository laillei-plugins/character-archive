import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";

import { BUNDLED_CHARACTER_TEMPLATE } from "../src/data/bundledTemplate.ts";

const PROPERTY_GUIDE = [
  "> [!tip] 속성 관리",
  "> 위쪽 속성(Properties)에서는 이 캐릭터의 속성 값만 입력해 주세요.",
  "> **이름** 값과 노트 파일명은 함께 바뀌어요.",
  "> 속성을 추가·삭제하거나 이름·종류·순서·선택 항목을 바꾸려면 갤러리의 **편집 모드 → 그룹 · 속성 관리**를 열어 주세요.",
  "> 노트 위쪽 속성(Properties)에서 이름(키)을 직접 바꾸면 갤러리가 값을 찾지 못할 수 있어요.",
].join("\n");

test("the inner-page guide sends property structure changes to gallery edit mode", () => {
  assert.ok(BUNDLED_CHARACTER_TEMPLATE.includes(PROPERTY_GUIDE));
  assert.ok(!BUNDLED_CHARACTER_TEMPLATE.includes("보이는 이름만 바꿀 수 있어요"));
});

test("the shipped template and starter note keep the canonical guide", () => {
  const paths = [
    join("examples", "templates", "Character Archive 기본 템플릿.md"),
    join("examples", "Character Archive", "_starter", "첫 카드", "첫 카드.md"),
  ];
  for (const path of paths) {
    assert.ok(readFileSync(path, "utf8").includes(PROPERTY_GUIDE), path);
  }
});
