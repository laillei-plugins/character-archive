import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { hangulAllowlist } from "../src/i18n/hangulAllowlist.ts";

const root = join(import.meta.dirname, "..");
// Phase 2: bundled note content and already bilingual release notes are explicitly excluded.
const excludedData = new Map([
  ["bundledTemplate.ts", "Bundled new-character template and Korean note headings are Phase 2."],
  ["updateNotes.ts", "Release notes are already bilingual and owned by the leader."],
]);

// Phase 1B covers exactly the UI files in the approved write grant.
// src/share is Phase 2. src/page and src/media are outside Phase 1A's write grant.
function scopedFiles() {
  return ["src/main.ts", "src/settings.ts",
    "src/ui/AttrManageModal.ts",
    "src/ui/BatchGroupMoveDialog.ts",
    "src/ui/CharacterNameModal.ts",
    "src/ui/CoverPickerModal.ts",
    "src/ui/CreateGalleryModal.ts",
    "src/ui/GroupRenameDialog.ts",
    "src/ui/RenameGenreModal.ts",
    "src/ui/SettingTab.ts",
    "src/ui/ShareGalleryModal.ts",
    "src/ui/TagChecklistPopover.ts",
    "src/ui/ViewSettingsPopover.ts",
    "src/ui/cleanBody.ts",
    "src/ui/commandSurface.ts",
    "src/ui/holdDrag.ts",
    "src/ui/searchDisclosure.ts",
    "src/views/GalleryView.ts",
    ...readdirSync(join(root, "src/data")).filter((f) => f.endsWith(".ts") && !excludedData.has(f)).map((f) => `src/data/${f}`),
    ...readdirSync(join(root, "src/i18n")).filter((f) => f.endsWith(".ts") && !["messages.ts", "hangulAllowlist.ts"].includes(f)).map((f) => `src/i18n/${f}`),
  ];
}

function scan(file: string): Map<string, number> {
  const source = readFileSync(join(root, file), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found = new Map<string, number>();
  function visit(node: ts.Node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const literal = node.getText(ast);
      if (/[가-힣]/.test(literal)) found.set(literal, (found.get(literal) ?? 0) + 1);
      if (ts.isTemplateExpression(node)) for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return found;
}

test("Phase 1A/1B production sources contain only explicitly justified Hangul literals", () => {
  const unmatched: string[] = [];
  for (const file of scopedFiles()) {
    const literals = scan(file);
    for (const entry of hangulAllowlist.filter((entry) => entry.file === file)) {
      assert.ok(entry.reason.trim(), `${file}: missing reason`);
      assert.equal(literals.get(entry.literal), entry.count, `stale allowlist: ${file} ${entry.literal}`);
      literals.delete(entry.literal);
    }
    for (const [literal] of literals) unmatched.push(`${file}: ${literal}`);
  }
  assert.deepEqual(unmatched, [], "Move UI text to the dictionary; justify data/parsing words explicitly.");
});

// Verify the handoff index against the dictionary without depending on Git at test time.
import { ko } from "../src/i18n/messages.ts";
const decode = (s: string) => s.replace(/&#10;/g, "\n").replace(/&#124;/g, "|").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

test("the call-site index covers every table key and preserves exact Korean source values", () => {
  const index = readFileSync(join(root, "src/i18n/CALLSITES.md"), "utf8");
  const covered = new Set<string>();
  for (const line of index.split("\n").filter((line) => line.startsWith("| <code>"))) {
    const cells = [...line.matchAll(/<code>(.*?)<\/code>/g)].map((m) => decode(m[1]!));
    const [key, _location, raw] = cells;
    assert.ok(key && key in ko, `unknown indexed key: ${key}`);
    assert.ok(raw);
    // Actual source line breaks use HTML entities to keep one Markdown row.
    const ast = ts.createSourceFile("literal.ts", `const value = ${raw};`, ts.ScriptTarget.Latest, true);
    let value: string | undefined;
    function visit(node: ts.Node) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) { value = node.text; return; }
      if (ts.isTemplateExpression(node)) {
        value = node.head.text + node.templateSpans.map((span, i) => `{arg${i + 1}}${span.literal.text}`).join("");
        return;
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.equal(value, ko[key as keyof typeof ko], `${key}: index/table mismatch`);
    covered.add(key);
  }
  const newKeys = ["languageSettingName", "languageKorean", "languageEnglish", "statusOn", "statusOff"];
  for (const key of Object.keys(ko)) assert.ok(covered.has(key) || newKeys.includes(key), `unindexed key: ${key}`);
});
