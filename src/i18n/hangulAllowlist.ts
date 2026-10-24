/** Explicit remaining literals in Phase 1A/1B-scanned production files.
 * Exact source text + occurrence counts prevent new Korean UI text hiding behind a file exemption.
 * Shared metadata is kept raw to preserve saved data and Phase 2 web-share output.
 */
export const hangulAllowlist = [
  {
    "file": "src/main.ts",
    "literal": "\"[charinfo] 시작 작업 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/main.ts",
    "literal": "\"[charinfo] 이름 변경 경로 저장 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/main.ts",
    "literal": "\"[charinfo] 속성 스캔 중단\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/main.ts",
    "literal": "`[charinfo] 속성 스캔 · 폴더 ${roots.join(\", \")} · 확인 ${tally.scanned} · 보정 ${tally.patched} · YAML 손상 ${tally.malformed} · 실패 ${tally.failed}`",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/main.ts",
    "literal": "`[charinfo] 속성 복구 실패 · ${path} · 시도 ${attempts}회`",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/main.ts",
    "literal": "\"[charinfo] 보관함 폴더 이름 새로고침 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/main.ts",
    "literal": "\"이름\"",
    "count": 6,
    "reason": "Stored frontmatter key or type reference; must remain byte-identical."
  },
  {
    "file": "src/main.ts",
    "literal": "\"[charinfo] 이름 속성 되돌리기 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/main.ts",
    "literal": "\"[charinfo] 파일명 → 이름 동기화 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/main.ts",
    "literal": "\"[charinfo] 대소문자 이름 되돌리기 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/main.ts",
    "literal": "\"[charinfo] 업데이트 안내 열기 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/main.ts",
    "literal": "\"[charinfo] 최근 갤러리 경로 저장 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/main.ts",
    "literal": "\"[charinfo] 갤러리 열기 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/settings.ts",
    "literal": "\"속성\"",
    "count": 1,
    "reason": "Existing persisted default, migration identity or note/share heading; not display text."
  },
  {
    "file": "src/settings.ts",
    "literal": "\"예시\"",
    "count": 3,
    "reason": "Existing persisted default, migration identity or note/share heading; not display text."
  },
  {
    "file": "src/settings.ts",
    "literal": "\"프롬프트\"",
    "count": 2,
    "reason": "Existing persisted default, migration identity or note/share heading; not display text."
  },
  {
    "file": "src/settings.ts",
    "literal": "\"메모\"",
    "count": 1,
    "reason": "Existing persisted default, migration identity or note/share heading; not display text."
  },
  {
    "file": "src/settings.ts",
    "literal": "\"가이드버스\"",
    "count": 1,
    "reason": "Existing persisted default, migration identity or note/share heading; not display text."
  },
  {
    "file": "src/settings.ts",
    "literal": "\"가이드 버스\"",
    "count": 1,
    "reason": "Existing persisted default, migration identity or note/share heading; not display text."
  },
  {
    "file": "src/settings.ts",
    "literal": "\"캐릭터 프롬프트\"",
    "count": 2,
    "reason": "Existing persisted default, migration identity or note/share heading; not display text."
  },
  {
    "file": "src/settings.ts",
    "literal": "\"가이드\"",
    "count": 1,
    "reason": "Existing persisted default, migration identity or note/share heading; not display text."
  },
  {
    "file": "src/settings.ts",
    "literal": "\"센티넬\"",
    "count": 1,
    "reason": "Existing persisted default, migration identity or note/share heading; not display text."
  },
  {
    "file": "src/data/CharacterStore.ts",
    "literal": "\"언급\"",
    "count": 1,
    "reason": "Frontmatter key/type or canonical fallback archive identity."
  },
  {
    "file": "src/data/CharacterStore.ts",
    "literal": "\"이름\"",
    "count": 1,
    "reason": "Frontmatter key/type or canonical fallback archive identity."
  },
  {
    "file": "src/data/CharacterStore.ts",
    "literal": "\"코드네임\"",
    "count": 1,
    "reason": "Frontmatter key/type or canonical fallback archive identity."
  },
  {
    "file": "src/data/CharacterStore.ts",
    "literal": "\"미분류\"",
    "count": 1,
    "reason": "Frontmatter key/type or canonical fallback archive identity."
  },
  {
    "file": "src/data/cardProperties.ts",
    "literal": "\"이름\"",
    "count": 2,
    "reason": "Raw builtin metadata also used for storage/schema defaults; UI uses i18n/display helpers. Frontmatter keys remain unchanged."
  },
  {
    "file": "src/data/cardProperties.ts",
    "literal": "\"상태\"",
    "count": 1,
    "reason": "Raw builtin metadata also used for storage/schema defaults; UI uses i18n/display helpers. Frontmatter keys remain unchanged."
  },
  {
    "file": "src/data/cardProperties.ts",
    "literal": "\"그룹\"",
    "count": 2,
    "reason": "Raw builtin metadata also used for storage/schema defaults; UI uses i18n/display helpers. Frontmatter keys remain unchanged."
  },
  {
    "file": "src/data/cardProperties.ts",
    "literal": "\"관계\"",
    "count": 2,
    "reason": "Raw builtin metadata also used for storage/schema defaults; UI uses i18n/display helpers. Frontmatter keys remain unchanged."
  },
  {
    "file": "src/data/cardProperties.ts",
    "literal": "\"인연\"",
    "count": 2,
    "reason": "Raw builtin metadata also used for storage/schema defaults; UI uses i18n/display helpers. Frontmatter keys remain unchanged."
  },
  {
    "file": "src/data/cardProperties.ts",
    "literal": "\"코드네임\"",
    "count": 2,
    "reason": "Raw builtin metadata also used for storage/schema defaults; UI uses i18n/display helpers. Frontmatter keys remain unchanged."
  },
  {
    "file": "src/data/cardProperties.ts",
    "literal": "\"본명\"",
    "count": 2,
    "reason": "Raw builtin metadata also used for storage/schema defaults; UI uses i18n/display helpers. Frontmatter keys remain unchanged."
  },
  {
    "file": "src/data/cardProperties.ts",
    "literal": "\"소속\"",
    "count": 2,
    "reason": "Raw builtin metadata also used for storage/schema defaults; UI uses i18n/display helpers. Frontmatter keys remain unchanged."
  },
  {
    "file": "src/data/cardProperties.ts",
    "literal": "\"태그\"",
    "count": 1,
    "reason": "Raw builtin metadata also used for storage/schema defaults; UI uses i18n/display helpers. Frontmatter keys remain unchanged."
  },
  {
    "file": "src/data/filterAxis.ts",
    "literal": "\"상태\"",
    "count": 2,
    "reason": "Frontmatter keys and raw axis labels/empty option shared with public web-share; UI must translate via display helpers or confirmed display-only fallback."
  },
  {
    "file": "src/data/filterAxis.ts",
    "literal": "\"관계\"",
    "count": 2,
    "reason": "Frontmatter keys and raw axis labels/empty option shared with public web-share; UI must translate via display helpers or confirmed display-only fallback."
  },
  {
    "file": "src/data/filterAxis.ts",
    "literal": "\"인연\"",
    "count": 2,
    "reason": "Frontmatter keys and raw axis labels/empty option shared with public web-share; UI must translate via display helpers or confirmed display-only fallback."
  },
  {
    "file": "src/data/filterAxis.ts",
    "literal": "\"소속\"",
    "count": 2,
    "reason": "Frontmatter keys and raw axis labels/empty option shared with public web-share; UI must translate via display helpers or confirmed display-only fallback."
  },
  {
    "file": "src/data/filterAxis.ts",
    "literal": "\"태그\"",
    "count": 2,
    "reason": "Frontmatter keys and raw axis labels/empty option shared with public web-share; UI must translate via display helpers or confirmed display-only fallback."
  },
  {
    "file": "src/data/filterAxis.ts",
    "literal": "\"없음\"",
    "count": 1,
    "reason": "Frontmatter keys and raw axis labels/empty option shared with public web-share; UI must translate via display helpers or confirmed display-only fallback."
  },
  {
    "file": "src/data/groupRename.ts",
    "literal": "\"기본\"",
    "count": 1,
    "reason": "Reserved default-route name used in validation; translate only its UI display."
  },
  {
    "file": "src/data/groupSchema.ts",
    "literal": "\"장르\"",
    "count": 2,
    "reason": "Immutable builtin key/default label, reserved allocation key, or canonical group/archive identity; UI uses displayFieldLabel rather than mutating schema metadata."
  },
  {
    "file": "src/data/groupSchema.ts",
    "literal": "\"작품\"",
    "count": 2,
    "reason": "Immutable builtin key/default label, reserved allocation key, or canonical group/archive identity; UI uses displayFieldLabel rather than mutating schema metadata."
  },
  {
    "file": "src/data/groupSchema.ts",
    "literal": "\"상태\"",
    "count": 2,
    "reason": "Immutable builtin key/default label, reserved allocation key, or canonical group/archive identity; UI uses displayFieldLabel rather than mutating schema metadata."
  },
  {
    "file": "src/data/groupSchema.ts",
    "literal": "\"관계\"",
    "count": 2,
    "reason": "Immutable builtin key/default label, reserved allocation key, or canonical group/archive identity; UI uses displayFieldLabel rather than mutating schema metadata."
  },
  {
    "file": "src/data/groupSchema.ts",
    "literal": "\"인연\"",
    "count": 2,
    "reason": "Immutable builtin key/default label, reserved allocation key, or canonical group/archive identity; UI uses displayFieldLabel rather than mutating schema metadata."
  },
  {
    "file": "src/data/groupSchema.ts",
    "literal": "\"소속\"",
    "count": 2,
    "reason": "Immutable builtin key/default label, reserved allocation key, or canonical group/archive identity; UI uses displayFieldLabel rather than mutating schema metadata."
  },
  {
    "file": "src/data/groupSchema.ts",
    "literal": "\"태그\"",
    "count": 2,
    "reason": "Immutable builtin key/default label, reserved allocation key, or canonical group/archive identity; UI uses displayFieldLabel rather than mutating schema metadata."
  },
  {
    "file": "src/data/groupSchema.ts",
    "literal": "\"이름\"",
    "count": 2,
    "reason": "Immutable builtin key/default label, reserved allocation key, or canonical group/archive identity; UI uses displayFieldLabel rather than mutating schema metadata."
  },
  {
    "file": "src/data/groupSchema.ts",
    "literal": "\"그룹\"",
    "count": 3,
    "reason": "Immutable builtin key/default label, reserved allocation key, or canonical group/archive identity; UI uses displayFieldLabel rather than mutating schema metadata."
  },
  {
    "file": "src/data/groupSchema.ts",
    "literal": "\"코드네임\"",
    "count": 1,
    "reason": "Immutable builtin key/default label, reserved allocation key, or canonical group/archive identity; UI uses displayFieldLabel rather than mutating schema metadata."
  },
  {
    "file": "src/data/groupSchema.ts",
    "literal": "\"본명\"",
    "count": 1,
    "reason": "Immutable builtin key/default label, reserved allocation key, or canonical group/archive identity; UI uses displayFieldLabel rather than mutating schema metadata."
  },
  {
    "file": "src/data/groupSchema.ts",
    "literal": "\"미분류\"",
    "count": 2,
    "reason": "Immutable builtin key/default label, reserved allocation key, or canonical group/archive identity; UI uses displayFieldLabel rather than mutating schema metadata."
  },
  {
    "file": "src/data/groupSchema.ts",
    "literal": "\"속성\"",
    "count": 1,
    "reason": "Immutable builtin key/default label, reserved allocation key, or canonical group/archive identity; UI uses displayFieldLabel rather than mutating schema metadata."
  },
  {
    "file": "src/data/images.ts",
    "literal": "\"상태\"",
    "count": 1,
    "reason": "Frontmatter migration keys, never translated."
  },
  {
    "file": "src/data/images.ts",
    "literal": "\"언급\"",
    "count": 2,
    "reason": "Frontmatter migration keys, never translated."
  },
  {
    "file": "src/data/order.ts",
    "literal": "\"이름\"",
    "count": 1,
    "reason": "Frontmatter field type reference; never translated."
  },
  {
    "file": "src/data/order.ts",
    "literal": "\"[charinfo] 순서 저장 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/data/order.ts",
    "literal": "\"[charinfo] 아카이브 이름 되돌리기 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/data/propertyLabels.ts",
    "literal": "\"상태\"",
    "count": 1,
    "reason": "Raw default names persisted into settings; displayPropertyLabel translates at the UI boundary."
  },
  {
    "file": "src/data/propertyLabels.ts",
    "literal": "\"관계\"",
    "count": 1,
    "reason": "Raw default names persisted into settings; displayPropertyLabel translates at the UI boundary."
  },
  {
    "file": "src/data/propertyLabels.ts",
    "literal": "\"인연\"",
    "count": 1,
    "reason": "Raw default names persisted into settings; displayPropertyLabel translates at the UI boundary."
  },
  {
    "file": "src/data/propertyLabels.ts",
    "literal": "\"소속\"",
    "count": 1,
    "reason": "Raw default names persisted into settings; displayPropertyLabel translates at the UI boundary."
  },
  {
    "file": "src/data/propertyLabels.ts",
    "literal": "\"태그\"",
    "count": 1,
    "reason": "Raw default names persisted into settings; displayPropertyLabel translates at the UI boundary."
  },
  {
    "file": "src/data/propertySchema.ts",
    "literal": "\"이름\"",
    "count": 1,
    "reason": "Canonical frontmatter keys, never translated."
  },
  {
    "file": "src/data/propertySchema.ts",
    "literal": "\"상태\"",
    "count": 1,
    "reason": "Canonical frontmatter keys, never translated."
  },
  {
    "file": "src/data/propertySchema.ts",
    "literal": "\"그룹\"",
    "count": 1,
    "reason": "Canonical frontmatter keys, never translated."
  },
  {
    "file": "src/data/propertySchema.ts",
    "literal": "\"관계\"",
    "count": 1,
    "reason": "Canonical frontmatter keys, never translated."
  },
  {
    "file": "src/data/propertySchema.ts",
    "literal": "\"인연\"",
    "count": 1,
    "reason": "Canonical frontmatter keys, never translated."
  },
  {
    "file": "src/data/propertySchema.ts",
    "literal": "\"코드네임\"",
    "count": 1,
    "reason": "Canonical frontmatter keys, never translated."
  },
  {
    "file": "src/data/propertySchema.ts",
    "literal": "\"본명\"",
    "count": 1,
    "reason": "Canonical frontmatter keys, never translated."
  },
  {
    "file": "src/data/propertySchema.ts",
    "literal": "\"소속\"",
    "count": 1,
    "reason": "Canonical frontmatter keys, never translated."
  },
  {
    "file": "src/data/propertySchema.ts",
    "literal": "\"태그\"",
    "count": 2,
    "reason": "Canonical frontmatter keys, never translated."
  },
  {
    "file": "src/data/propertySchema.ts",
    "literal": "\"장르\"",
    "count": 1,
    "reason": "Canonical frontmatter keys, never translated."
  },
  {
    "file": "src/data/propertySchema.ts",
    "literal": "\"작품\"",
    "count": 1,
    "reason": "Canonical frontmatter keys, never translated."
  },
  {
    "file": "src/data/status.ts",
    "literal": "\"초록\"",
    "count": 1,
    "reason": "Raw preset labels are also shared metadata; use displayColorLabel for UI. Korean recognition words are status-id parsing heuristics."
  },
  {
    "file": "src/data/status.ts",
    "literal": "\"회색\"",
    "count": 1,
    "reason": "Raw preset labels are also shared metadata; use displayColorLabel for UI. Korean recognition words are status-id parsing heuristics."
  },
  {
    "file": "src/data/status.ts",
    "literal": "\"호박\"",
    "count": 1,
    "reason": "Raw preset labels are also shared metadata; use displayColorLabel for UI. Korean recognition words are status-id parsing heuristics."
  },
  {
    "file": "src/data/status.ts",
    "literal": "\"파랑\"",
    "count": 1,
    "reason": "Raw preset labels are also shared metadata; use displayColorLabel for UI. Korean recognition words are status-id parsing heuristics."
  },
  {
    "file": "src/data/status.ts",
    "literal": "\"빨강\"",
    "count": 1,
    "reason": "Raw preset labels are also shared metadata; use displayColorLabel for UI. Korean recognition words are status-id parsing heuristics."
  },
  {
    "file": "src/data/status.ts",
    "literal": "\"보라\"",
    "count": 1,
    "reason": "Raw preset labels are also shared metadata; use displayColorLabel for UI. Korean recognition words are status-id parsing heuristics."
  },
  {
    "file": "src/data/status.ts",
    "literal": "\"청록\"",
    "count": 1,
    "reason": "Raw preset labels are also shared metadata; use displayColorLabel for UI. Korean recognition words are status-id parsing heuristics."
  },
  {
    "file": "src/data/status.ts",
    "literal": "\"분홍\"",
    "count": 1,
    "reason": "Raw preset labels are also shared metadata; use displayColorLabel for UI. Korean recognition words are status-id parsing heuristics."
  },
  {
    "file": "src/data/status.ts",
    "literal": "\"올리브\"",
    "count": 1,
    "reason": "Raw preset labels are also shared metadata; use displayColorLabel for UI. Korean recognition words are status-id parsing heuristics."
  },
  {
    "file": "src/data/status.ts",
    "literal": "\"남색\"",
    "count": 1,
    "reason": "Raw preset labels are also shared metadata; use displayColorLabel for UI. Korean recognition words are status-id parsing heuristics."
  },
  {
    "file": "src/data/status.ts",
    "literal": "\"라임\"",
    "count": 1,
    "reason": "Raw preset labels are also shared metadata; use displayColorLabel for UI. Korean recognition words are status-id parsing heuristics."
  },
  {
    "file": "src/data/status.ts",
    "literal": "\"노랑\"",
    "count": 1,
    "reason": "Raw preset labels are also shared metadata; use displayColorLabel for UI. Korean recognition words are status-id parsing heuristics."
  },
  {
    "file": "src/data/status.ts",
    "literal": "\"활성\"",
    "count": 1,
    "reason": "Raw preset labels are also shared metadata; use displayColorLabel for UI. Korean recognition words are status-id parsing heuristics."
  },
  {
    "file": "src/data/status.ts",
    "literal": "\"보관\"",
    "count": 1,
    "reason": "Raw preset labels are also shared metadata; use displayColorLabel for UI. Korean recognition words are status-id parsing heuristics."
  },
  {
    "file": "src/data/status.ts",
    "literal": "\"대기\"",
    "count": 1,
    "reason": "Raw preset labels are also shared metadata; use displayColorLabel for UI. Korean recognition words are status-id parsing heuristics."
  },
  {
    "file": "src/data/status.ts",
    "literal": "\"작성\"",
    "count": 1,
    "reason": "Raw preset labels are also shared metadata; use displayColorLabel for UI. Korean recognition words are status-id parsing heuristics."
  },
  {
    "file": "src/data/status.ts",
    "literal": "\"예정\"",
    "count": 1,
    "reason": "Raw preset labels are also shared metadata; use displayColorLabel for UI. Korean recognition words are status-id parsing heuristics."
  },
  {
    "file": "src/data/tags.ts",
    "literal": "\"태그\"",
    "count": 1,
    "reason": "Canonical frontmatter key, never translated."
  },
  {
    "file": "src/ui/AttrManageModal.ts",
    "literal": "\"[charinfo] 그룹 속성 기본값 저장 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/ui/SettingTab.ts",
    "literal": "\"Language / 언어\"",
    "count": 1,
    "reason": "Approved bilingual settings row name; fixed in both languages."
  },
  {
    "file": "src/ui/SettingTab.ts",
    "literal": "\"한국어\"",
    "count": 1,
    "reason": "Native language dropdown option label; fixed in both languages."
  },
  {
    "file": "src/ui/ShareGalleryModal.ts",
    "literal": "\"프롬프트\"",
    "count": 1,
    "reason": "Canonical panel-header data value used by shared HTML; never translated."
  },
  {
    "file": "src/ui/ShareGalleryModal.ts",
    "literal": "\"미분류\"",
    "count": 2,
    "reason": "Fallback archive identity used in stored share state; never translated."
  },
  {
    "file": "src/ui/cleanBody.ts",
    "literal": "\"설명\"",
    "count": 2,
    "reason": "Canonical note-section heading or parsing token; preserves note parsing and Korean share output."
  },
  {
    "file": "src/ui/cleanBody.ts",
    "literal": "\"신상\"",
    "count": 3,
    "reason": "Canonical note-section heading or parsing token; preserves note parsing and Korean share output."
  },
  {
    "file": "src/ui/cleanBody.ts",
    "literal": "\"배경\"",
    "count": 3,
    "reason": "Canonical note-section heading or parsing token; preserves note parsing and Korean share output."
  },
  {
    "file": "src/ui/cleanBody.ts",
    "literal": "\"외형\"",
    "count": 2,
    "reason": "Canonical note-section heading or parsing token; preserves note parsing and Korean share output."
  },
  {
    "file": "src/ui/cleanBody.ts",
    "literal": "\"성격\"",
    "count": 2,
    "reason": "Canonical note-section heading or parsing token; preserves note parsing and Korean share output."
  },
  {
    "file": "src/ui/cleanBody.ts",
    "literal": "\"특징\"",
    "count": 2,
    "reason": "Canonical note-section heading or parsing token; preserves note parsing and Korean share output."
  },
  {
    "file": "src/ui/cleanBody.ts",
    "literal": "\"능력\"",
    "count": 3,
    "reason": "Canonical note-section heading or parsing token; preserves note parsing and Korean share output."
  },
  {
    "file": "src/ui/cleanBody.ts",
    "literal": "\"리스크\"",
    "count": 3,
    "reason": "Canonical note-section heading or parsing token; preserves note parsing and Korean share output."
  },
  {
    "file": "src/ui/cleanBody.ts",
    "literal": "\"운용\"",
    "count": 2,
    "reason": "Canonical note-section heading or parsing token; preserves note parsing and Korean share output."
  },
  {
    "file": "src/ui/cleanBody.ts",
    "literal": "\"비고\"",
    "count": 2,
    "reason": "Canonical note-section heading or parsing token; preserves note parsing and Korean share output."
  },
  {
    "file": "src/ui/cleanBody.ts",
    "literal": "\"특이사항\"",
    "count": 2,
    "reason": "Canonical note-section heading or parsing token; preserves note parsing and Korean share output."
  },
  {
    "file": "src/ui/cleanBody.ts",
    "literal": "\"추가 정보\"",
    "count": 2,
    "reason": "Canonical note-section heading or parsing token; preserves note parsing and Korean share output."
  },
  {
    "file": "src/ui/cleanBody.ts",
    "literal": "\"프롬프트\"",
    "count": 5,
    "reason": "Canonical note-section heading or parsing token; preserves note parsing and Korean share output."
  },
  {
    "file": "src/ui/cleanBody.ts",
    "literal": "\"메모\"",
    "count": 2,
    "reason": "Canonical note-section heading or parsing token; preserves note parsing and Korean share output."
  },
  {
    "file": "src/ui/cleanBody.ts",
    "literal": "\"말투\"",
    "count": 2,
    "reason": "Canonical note-section heading or parsing token; preserves note parsing and Korean share output."
  },
  {
    "file": "src/ui/cleanBody.ts",
    "literal": "\"구분\"",
    "count": 3,
    "reason": "Canonical note-section heading or parsing token; preserves note parsing and Korean share output."
  },
  {
    "file": "src/ui/cleanBody.ts",
    "literal": "\"내용\"",
    "count": 2,
    "reason": "Canonical note-section heading or parsing token; preserves note parsing and Korean share output."
  },
  {
    "file": "src/ui/cleanBody.ts",
    "literal": "\"보안 \"",
    "count": 1,
    "reason": "Canonical note-section heading or parsing token; preserves note parsing and Korean share output."
  },
  {
    "file": "src/ui/cleanBody.ts",
    "literal": "\"프로필\"",
    "count": 1,
    "reason": "Canonical note-section heading or parsing token; preserves note parsing and Korean share output."
  },
  {
    "file": "src/views/GalleryView.ts",
    "literal": "\"[charinfo] 새로고침 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/views/GalleryView.ts",
    "literal": "\"[charinfo] 아카이브 만들기 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/views/GalleryView.ts",
    "literal": "\"[charinfo] 아카이브 이름 되돌리기 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/views/GalleryView.ts",
    "literal": "\"[charinfo] 아카이브 이름 바꾸기 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/views/GalleryView.ts",
    "literal": "\"[charinfo] 아카이브 설정 저장 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/views/GalleryView.ts",
    "literal": "\"[charinfo] 그룹 노트 휴지통 이동 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/views/GalleryView.ts",
    "literal": "\"[charinfo] 그룹 삭제 저장 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/views/GalleryView.ts",
    "literal": "\"[charinfo] 그룹 되돌리기 실패\"",
    "count": 2,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/views/GalleryView.ts",
    "literal": "\"[charinfo] 그룹 이름 되돌리기 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/views/GalleryView.ts",
    "literal": "\"[charinfo] 그룹 이동 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  },
  {
    "file": "src/views/GalleryView.ts",
    "literal": "\"[charinfo] 그룹 속성 저장 실패\"",
    "count": 1,
    "reason": "Console-only diagnostic; not UI text."
  }
] as const;
