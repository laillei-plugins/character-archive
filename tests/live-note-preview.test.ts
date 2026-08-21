/**
 * Freeze regressions for the live note preview scanner.
 *
 * Only the pure lexical layer is covered here — `noteSections.ts` imports
 * nothing, so `node --test` runs it straight from TypeScript. Renderer and
 * share-HTML behaviour is verified in Obsidian; the structural facts those two
 * paths both depend on are locked down below.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PRIVATE_SECTION_MARKER,
  extractPromptFences,
  scanNoteSections,
  sectionPrivacyKind,
} from "../src/ui/noteSections.ts";

const FRONTMATTER = ['---', 'kind: "character"', '이름: "에트나"', '---'].join(
  "\n",
);

function note(...body: string[]): string {
  return `${FRONTMATTER}\n\n# 에트나\n\n${body.join("\n")}\n`;
}

/** Titles that survive the privacy filter, in source order. */
function visibleTitles(markdown: string): string[] {
  return scanNoteSections(markdown)
    .sections.filter(
      (section) =>
        !section.markedPrivate && sectionPrivacyKind(section.title) !== "private",
    )
    .map((section) => section.title);
}

test("arbitrary H2 keeps its literal title and body", () => {
  const scan = scanNoteSections(note("## 짜자잔", "", "숨겨둔 반전이 여기 있다."));
  assert.deepEqual(
    scan.sections.map((s) => s.title),
    ["짜자잔"],
  );
  assert.equal(scan.sections[0]?.body, "숨겨둔 반전이 여기 있다.");
});

test("renamed heading shows only the new title", () => {
  assert.deepEqual(visibleTitles(note("## 모습", "", "키 173.")), ["모습"]);
});

test("nested H3 stays inside its H2 section", () => {
  const scan = scanNoteSections(
    note("## 능력", "", "### 검술", "", "빠르다.", "", "## 성격", "", "차분함."),
  );
  assert.deepEqual(
    scan.sections.map((s) => s.title),
    ["능력", "성격"],
  );
  assert.equal(scan.sections[0]?.body, "### 검술\n\n빠르다.");
  assert.equal(scan.sections[1]?.body, "차분함.");
});

test("empty H2 still yields a section", () => {
  const scan = scanNoteSections(note("## 짜자잔", "", "## 성격", "", "차분함."));
  assert.deepEqual(
    scan.sections.map((s) => s.title),
    ["짜자잔", "성격"],
  );
  assert.equal(scan.sections[0]?.body, "");
});

test("`## ` inside a fence is not a section boundary", () => {
  const scan = scanNoteSections(
    note(
      "## 프롬프트",
      "",
      "**기본외형**",
      "",
      "```",
      "## 이건 프롬프트 본문",
      "1girl, {white hair}",
      "```",
      "",
      "## 성격",
      "",
      "차분함.",
    ),
  );
  assert.deepEqual(
    scan.sections.map((s) => s.title),
    ["프롬프트", "성격"],
  );
  assert.match(scan.sections[0]?.body ?? "", /## 이건 프롬프트 본문/);
});

test("private marker inside a fence has no structural effect", () => {
  const scan = scanNoteSections(
    note(
      "## 프롬프트",
      "",
      "```",
      PRIVATE_SECTION_MARKER,
      "```",
      "",
      "## 외형",
      "",
      "키 173.",
    ),
  );
  const 외형 = scan.sections.find((s) => s.title === "외형");
  assert.equal(외형?.markedPrivate, false);
  assert.match(scan.sections[0]?.body ?? "", /charinfo:private/);
});

test("marker after a section body still hides the next H2", () => {
  // Regression: the marker used to be swallowed by the previous section's body.
  const markdown = note(
    "## 공개",
    "",
    "보여도 되는 내용.",
    "",
    PRIVATE_SECTION_MARKER,
    "## 외형",
    "",
    "숨겨야 하는 내용.",
    "",
    "## 성격",
    "",
    "차분함.",
  );
  const scan = scanNoteSections(markdown);
  assert.deepEqual(
    scan.sections.map((s) => [s.title, s.markedPrivate]),
    [
      ["공개", false],
      ["외형", true],
      ["성격", false],
    ],
  );
  assert.equal(scan.sections[0]?.body, "보여도 되는 내용.");
  assert.deepEqual(visibleTitles(markdown), ["공개", "성격"]);
});

test("marker binds across blank lines only", () => {
  const bound = scanNoteSections(
    note("## 공개", "", PRIVATE_SECTION_MARKER, "", "", "## 비밀", "", "x"),
  );
  assert.equal(bound.sections[1]?.markedPrivate, true);

  const broken = scanNoteSections(
    note("## 공개", "", PRIVATE_SECTION_MARKER, "", "사이 문장.", "", "## 비밀", "", "x"),
  );
  assert.equal(broken.sections[1]?.markedPrivate, false);
});

test("legacy privacy is exact, never a prefix", () => {
  assert.equal(sectionPrivacyKind("메모"), "private");
  assert.equal(sectionPrivacyKind("말투"), "private");
  assert.equal(sectionPrivacyKind("1. 메모 (자유)"), "private");
  assert.equal(sectionPrivacyKind("메모리"), "normal");
  assert.equal(sectionPrivacyKind("말투법"), "normal");
  assert.equal(sectionPrivacyKind("프롬프트"), "prompt");
  assert.deepEqual(
    visibleTitles(
      note(
        "## 메모리",
        "",
        "공개해도 되는 설정.",
        "",
        "## 메모",
        "",
        "비밀.",
        "",
        "## 말투",
        "",
        "비밀.",
      ),
    ),
    ["메모리"],
  );
});

test("preamble is an untitled block, kept when the first H2 is private", () => {
  const markdown = note(
    "> [!tip] 속성 이름",
    "> 시작용 안내문.",
    "",
    PRIVATE_SECTION_MARKER,
    "## 메모",
    "",
    "비밀.",
    "",
    "## 설명",
    "",
    "한 줄 소개.",
  );
  const scan = scanNoteSections(markdown);
  assert.equal(scan.preamble, "> [!tip] 속성 이름\n> 시작용 안내문.");
  assert.equal(scan.sections[0]?.markedPrivate, true);
  assert.deepEqual(visibleTitles(markdown), ["설명"]);
});

test("preamble skips the H1 title and cover embeds", () => {
  const scan = scanNoteSections(
    [
      FRONTMATTER,
      "",
      "# 에트나",
      "",
      "![[cover.png]]",
      "",
      "### 프로필",
      "",
      "안내 문장.",
      "",
      "## 설명",
      "",
      "한 줄 소개.",
    ].join("\n"),
  );
  assert.equal(scan.preamble, "안내 문장.");
  assert.deepEqual(
    scan.sections.map((s) => s.title),
    ["설명"],
  );
});

test("prompt fences keep NAI `::` weights verbatim", () => {
  const scan = scanNoteSections(
    note(
      "## 프롬프트",
      "",
      "**기본외형**",
      "",
      "```",
      "1.4::white hair::, {{blue eyes}},   trailing spaces  ",
      "",
      "  indented line",
      "```",
      "",
      "**의상**",
      "",
      "```",
      "black dress",
      "```",
    ),
  );
  const prompts = extractPromptFences(scan.sections[0]?.body ?? "");
  assert.deepEqual(
    prompts.map((p) => p.label),
    ["기본외형", "의상"],
  );
  const first = prompts[0]?.value ?? "";
  assert.match(first, /1\.4::white hair::/);
  assert.ok(!first.includes("=="), "must never convert `::` to `==`");
  assert.equal(
    first,
    "1.4::white hair::, {{blue eyes}},   trailing spaces  \n\n  indented line",
  );
});

test("unlabelled and tilde fences are still extracted", () => {
  const prompts = extractPromptFences(
    ["~~~", "solo, 1girl", "~~~"].join("\n"),
  );
  assert.deepEqual(prompts, [{ label: "프롬프트", value: "solo, 1girl" }]);
});

test("longer inner backtick runs do not close the fence early", () => {
  const scan = scanNoteSections(
    note(
      "## 프롬프트",
      "",
      "````",
      "```",
      "## still inside",
      "```",
      "````",
      "",
      "## 성격",
      "",
      "차분함.",
    ),
  );
  assert.deepEqual(
    scan.sections.map((s) => s.title),
    ["프롬프트", "성격"],
  );
  assert.match(
    extractPromptFences(scan.sections[0]?.body ?? "")[0]?.value ?? "",
    /## still inside/,
  );
});

test("CRLF notes scan the same as LF notes", () => {
  const lf = note("## 짜자잔", "", "본문.");
  const scan = scanNoteSections(lf.replace(/\n/g, "\r\n"));
  assert.deepEqual(
    scan.sections.map((s) => s.title),
    ["짜자잔"],
  );
  assert.equal(scan.sections[0]?.body, "본문.");
});
