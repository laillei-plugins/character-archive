import assert from "node:assert/strict";
import { test } from "node:test";
import { createLanguageSource, en, ko, readObsidianLanguage, resolveLanguage, t, translate, uiLanguage } from "../src/i18n/index.ts";
import { displayColorLabel, displayFieldLabel, displayPropertyLabel, displayStatusLabel } from "../src/i18n/display.ts";

const variables = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("every translation key has nonempty English and Korean with matching variables", () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ko).sort());
  for (const key of Object.keys(ko) as (keyof typeof ko)[]) {
    assert.ok(ko[key].trim(), `${key}: empty Korean`);
    assert.ok(en[key].trim(), `${key}: empty English`);
    assert.deepEqual(variables(en[key]), variables(ko[key]), key);
    if (key !== "languageSettingName" && key !== "languageKorean") assert.doesNotMatch(en[key], /[가-힣]/, key);
  }
});

test("existing settings always migrate to Korean without detecting the host", () => {
  for (const saved of [{}, { libraryFolder: "Existing" }, { language: "auto" }, { language: null }, false, "legacy"]) {
    assert.equal(resolveLanguage(saved, () => { throw Error("must not detect"); }), "ko");
  }
});

test("fresh settings detect only Korean prefixes and otherwise choose English", () => {
  for (const saved of [null, undefined]) {
    for (const value of ["ko", "ko-KR", "ko_kr", "korean"]) assert.equal(resolveLanguage(saved, () => value), "ko");
    for (const value of ["en", "ja", "fr", "", null, undefined]) assert.equal(resolveLanguage(saved, () => value), "en");
  }
});

test("stored choices are preserved and the detector is never called", () => {
  for (const language of ["en", "ko"] as const) {
    assert.equal(resolveLanguage({ language }, () => { throw Error("must not detect"); }), language);
  }
});

test("the optional Obsidian API takes precedence, including non-Korean and null values", () => {
  for (const value of ["ko-KR", "en", null]) {
    assert.equal(readObsidianLanguage({ getLanguage: () => value }, () => { throw Error("must not read storage"); }), value);
  }
});

test("old Obsidian falls back to localStorage; unavailable storage means English", () => {
  assert.equal(readObsidianLanguage({}, () => "ko"), "ko");
  assert.equal(readObsidianLanguage({ getLanguage: undefined }, () => "en"), "en");
  assert.equal(readObsidianLanguage({ getLanguage: () => { throw Error("host failure"); } }, () => "ko"), "ko");
  assert.equal(readObsidianLanguage({}, () => { throw Error("denied"); }), null);
});

test("language listeners see the new value, fire only on change, and unsubscribe", () => {
  const source = createLanguageSource("ko");
  const events: unknown[] = [];
  const off = source.subscribe((language, previous) => events.push([language, previous, source.current]));
  source.set("ko");
  source.set("en");
  source.set("en");
  off();
  source.set("ko");
  assert.deepEqual(events, [["en", "ko", "en"]]);
});

test("interpolation preserves user strings including dollar signs and placeholder-looking text", () => {
  const value = "${x} {arg2} <tag> 한글";
  assert.equal(translate("ko", "couldNotRestorePropertiesValue", { arg1: value }), `속성 복구 실패 · ${value}`);
  assert.equal(translate("en", "couldNotRestorePropertiesValue", { arg1: value }), `Could not restore properties · ${value}`);
  assert.equal(translate("ko", "imagesReconnectedValueNotes", { arg1: 0 }), "이미지 다시 연결됨 · 노트 0개");
});

test("lookup follows the current language without freezing module-load labels", () => {
  try {
    uiLanguage.set("ko"); assert.equal(t("openGallery"), "갤러리 열기");
    uiLanguage.set("en"); assert.equal(t("openGallery"), "Open gallery");
    uiLanguage.set("ko"); assert.equal(t("openGallery"), "갤러리 열기");
  } finally { uiLanguage.set("ko"); }
});

test("display helpers translate only built-in labels and preserve renamed labels and ids", () => {
  try {
    uiLanguage.set("en");
    assert.equal(displayPropertyLabel("status", "상태"), "Status");
    assert.equal(displayPropertyLabel("relation"), "Relationship");
    assert.equal(displayPropertyLabel("name", "이름"), "Name");
    assert.equal(displayPropertyLabel("status", "진행 상황"), "진행 상황");
    assert.equal(displayPropertyLabel("custom:1", "설정값"), "설정값");
    assert.equal(displayFieldLabel({ id: "codename", label: "코드네임", key: "코드네임" }), "Codename");
    assert.equal(displayFieldLabel({ id: "status", label: "상태", key: "상태" }, { status: "진행" }), "진행");
    assert.equal(displayFieldLabel({ id: "custom", label: "상태", key: "상태" }), "상태");
    assert.equal(displayColorLabel("green", "초록"), "Green");
    assert.equal(displayColorLabel("#ABCDEF", "custom"), "custom");
    assert.equal(displayStatusLabel({ id: "On", label: "활성" }), "활성");
    assert.equal(displayStatusLabel({ id: "On", label: "On" }), "On");
    uiLanguage.set("ko");
    assert.equal(displayPropertyLabel("status"), "상태");
    assert.equal(displayColorLabel("green", "초록"), "초록");
  } finally { uiLanguage.set("ko"); }
});
