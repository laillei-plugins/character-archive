import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..");
const modal = readFileSync(join(root, "src/ui/AttrManageModal.ts"), "utf8");
const css = readFileSync(join(root, "styles.css"), "utf8");

test("the group drawer exposes one peer contract for every route", () => {
  assert.match(modal, /const ROOT_TITLE = "그룹 · 속성 관리"/);
  assert.match(modal, /setIcon\(grip, "grip-vertical"\)/);
  assert.match(modal, /setIcon\(rename, "pencil"\)/);
  assert.match(modal, /setIcon\(remove, "trash-2"\)/);
  assert.match(modal, /attachHoldDrag\(chip, encodeGroupRoute\(route\)/);
  assert.match(modal, /cls: "charinfo-group-chip" \+ \(selected \? " is-selected" : ""\)/);
  assert.match(modal, /if \(selected\) \{[\s\S]*charinfo-group-chip__rename[\s\S]*charinfo-group-chip__delete/);
});

test("the drawer uses a divider count and a full-width non-overlapping editor", () => {
  assert.match(css, /\.charinfo-group-chip__count::before\s*\{[\s\S]*width: 1px;[\s\S]*height: 12px;/);
  assert.match(css, /\.charinfo-group-chip-editor\s*\{[\s\S]*flex: 1 0 100%;/);
  assert.match(css, /\.charinfo-group-chip-editor[\s\S]*\.charinfo-attr-modal__add-submit,[\s\S]*\.charinfo-group-chip-editor[\s\S]*\.charinfo-attr-modal__row-remove\s*\{[\s\S]*grid-column: auto;/);
  assert.match(css, /\.charinfo-attr-modal__group-rail\s*\{[\s\S]*padding: 0;[\s\S]*border: 0;/);
});

test("the selected group chip has a visible state and trailing action inset", () => {
  assert.match(css, /\.charinfo-attr-modal__group-rail \.charinfo-group-chip\.is-selected\s*\{[\s\S]*padding-inline-end: var\(--charinfo-space-xs\);[\s\S]*border-color: var\(--charinfo-accent\);[\s\S]*background: var\(--background-modifier-hover\);/);
});

test("the root header shares the body anchor and keeps Obsidian's single close button", () => {
  assert.match(modal, /this\.titleRow\?\.toggleClass\("is-root", home\)/);
  assert.match(css, /\.charinfo-attr-modal__title-row\s*\{[\s\S]*margin: 0;[\s\S]*padding: 0 calc/);
  assert.match(css, /\.charinfo-attr-modal__group-rail\s*\{[\s\S]*margin: 0 0/);
  assert.doesNotMatch(modal, /setIcon\([^\n]*, "x"\)[\s\S]{0,160}(close|modal)/i);
  assert.match(css, /> \.modal-header-button\s*\{/);
});

test("the property type picker keeps its existing three choices and one menu", () => {
  assert.match(modal, /const FIELD_TYPE_CHOICES: FieldTypeChoice\[\] = \[[\s\S]*"text"[\s\S]*"select"[\s\S]*"multi-select"/);
  assert.match(modal, /private renderTypeControl\(/);
  assert.match(modal, /private openTypeMenu\(/);
  assert.match(modal, /placeTypeMenu\(/);
  // Both entry points still reach the one control: the ledger row and the
  // property detail. The picker's own layout is out of the drawer's scope.
  assert.match(modal, /this\.renderTypeControl\(row, field, `field-type-\$\{field\.id\}`\)/);
  assert.match(modal, /this\.renderTypeControl\(typeRow, field, "detail-type", "detail"\)/);
});

test("the one picker line that moved reads the peer inventory, not the old flags", () => {
  // The ownership hint is worth saying only when there is more than one route
  // to be confused between — which is exactly `switchable` on the peer rail.
  assert.match(modal, /this\.isAxisField\(field\) && this\.routes\(\)\.switchable/);
  assert.match(modal, /charinfo-attr-modal__ownership/);
  // `silent`, `showDefault` and `scopes` belonged to the pre-peer inventory,
  // where 기본 had to earn a slot. Every route is a peer now, so they are gone.
  assert.doesNotMatch(modal, /routes\(\)\.(silent|scopes|showDefault)/);
  assert.doesNotMatch(modal, /\.showDefault\b/);
});

test("group note mutations refuse stale paths and stale membership", () => {
  const view = readFileSync(join(root, "src/views/GalleryView.ts"), "utf8");
  assert.match(view, /throw new Error\(`노트를 찾지 못했어요: \$\{path\}`\)/);
  assert.match(view, /if \(current !== expected\)/);
  assert.match(view, /\[\.\.\.rewritten\]\.reverse\(\)/);
  assert.match(view, /되돌리지 못한 노트/);
});
