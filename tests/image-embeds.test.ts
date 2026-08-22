/**
 * The note body owns the cover inventory.
 *
 * `imageEmbeds.ts` imports nothing, so `node --test` runs the whole scan /
 * insert / reorder algebra straight from TypeScript with a fake resolver in
 * place of the vault. What is locked here: document order, candidate identity
 * (a full-path embed and a basename embed are one image), idempotent insertion,
 * and a reorder that permutes only what the note already embeds. The Obsidian
 * side of the rule — embed before pinning, never heal a cover, one `vault.process`
 * write — needs a vault, so it is pinned as a source contract at the end.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  COVER_NONE,
  canonicalRemoteUrl,
  embedKey,
  isCoverNone,
  isImageLink,
  listEmbedIdentities,
  planEmbedInsert,
  planEmbedReorder,
  scanEmbeds,
  splitFrontmatter,
  type VaultImageResolver,
} from "../src/data/imageEmbeds.ts";

const root = join(import.meta.dirname, "..");

const FM = "---\nkind: character\ncover: \n---\n";

/** Files that exist beside `Archive/Rin/Rin.md`, embedded or not. */
const FILES = [
  "Archive/Rin/a.png",
  "Archive/Rin/b.png",
  "Archive/Rin/c.png",
  "Archive/Rin/folder-only.png",
  "Archive/Other/d.png",
];

/** Same resolution shape as `images.ts`: exact path, then same-folder name. */
const resolve: VaultImageResolver = (target) => {
  const cleaned = target.trim().split("|")[0]?.trim() ?? "";
  if (!cleaned || !/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(cleaned)) return null;
  if (FILES.includes(cleaned)) return cleaned;
  const sameFolder = `Archive/Rin/${cleaned}`;
  return FILES.includes(sameFolder) ? sameFolder : null;
};

const keys = (markdown: string): string[] =>
  listEmbedIdentities(markdown, resolve).map(embedKey);

test("mixed wiki and markdown embeds scan in exact source order", () => {
  const note = `${FM}![[a.png]]\ntext\n![](https://i.imgur.com/x.png)\n![[b.png|300]]\n`;
  assert.deepEqual(
    scanEmbeds(note).map((hit) => hit.target),
    ["a.png", "https://i.imgur.com/x.png", "b.png"],
  );
  assert.deepEqual(keys(note), [
    "Archive/Rin/a.png",
    "https://i.imgur.com/x.png",
    "Archive/Rin/b.png",
  ]);
  // Offsets address the whole note, frontmatter included.
  const first = scanEmbeds(note)[0];
  assert.ok(first);
  assert.equal(note.slice(first.start, first.end), "![[a.png]]");
  assert.equal(splitFrontmatter(note).frontmatter, FM);
});

test("a non-image embed is not a cover candidate", () => {
  const note = `${FM}![[Some note]]\n![[missing.png]]\n![[a.png]]\n`;
  assert.deepEqual(keys(note), ["Archive/Rin/a.png"]);
});

test("a full-path embed and a basename embed are one candidate", () => {
  const note = `${FM}![[Archive/Rin/a.png]]\n![[a.png]]\n![](a.png)\n![[b.png]]\n`;
  assert.deepEqual(keys(note), ["Archive/Rin/a.png", "Archive/Rin/b.png"]);
});

test("a vault cover is embedded once and re-picking it changes nothing", () => {
  const first = planEmbedInsert(FM, { syntax: "wiki", target: "a.png" }, resolve);
  assert.equal(first.changed, true);
  assert.equal(first.text, `${FM}![[a.png]]\n`);

  const again = planEmbedInsert(
    first.text,
    { syntax: "wiki", target: "a.png" },
    resolve,
  );
  assert.equal(again.changed, false);
  assert.equal(again.text, first.text);

  // Already embedded by full path — the basename must not add a second embed.
  const equivalent = planEmbedInsert(
    `${FM}![[Archive/Rin/a.png]]\n`,
    { syntax: "wiki", target: "a.png" },
    resolve,
  );
  assert.equal(equivalent.changed, false);

  // A target the vault cannot resolve yet (fresh upload) still dedupes by text.
  const unresolved = planEmbedInsert(
    `${FM}![[brand-new.png]]\n`,
    { syntax: "wiki", target: "brand-new.png" },
    resolve,
  );
  assert.equal(unresolved.changed, false);
});

test("a remote cover is embedded once, fragments aside", () => {
  const url = "https://i.imgur.com/x.png";
  const first = planEmbedInsert(FM, { syntax: "md", target: url }, resolve);
  assert.equal(first.changed, true);
  assert.equal(first.text, `${FM}![](${url})\n`);

  assert.equal(
    planEmbedInsert(first.text, { syntax: "md", target: url }, resolve).changed,
    false,
  );
  // Fragment is not identity; the query is.
  assert.equal(
    planEmbedInsert(
      first.text,
      { syntax: "md", target: `${url}#anchor` },
      resolve,
    ).changed,
    false,
  );
  assert.equal(
    planEmbedInsert(first.text, { syntax: "md", target: `${url}?w=64` }, resolve)
      .changed,
    true,
  );
  assert.equal(canonicalRemoteUrl(`${url}?w=64#anchor`), `${url}?w=64`);
  assert.equal(isImageLink(`${url}?w=64`), true);
});

test("extensionless https image embeds are candidates and normalize identity", () => {
  const note = `${FM}![](HTTPS://CDN.Example.com/render?id=7#preview)\n`;
  assert.deepEqual(keys(note), ["https://cdn.example.com/render?id=7"]);
});

test("frontmatter splitting preserves CRLF notes", () => {
  const frontmatter = "---\r\nkind: character\r\n---\r\n";
  const note = `${frontmatter}![[a.png]]\r\n`;
  assert.equal(splitFrontmatter(note).frontmatter, frontmatter);
  assert.deepEqual(keys(note), ["Archive/Rin/a.png"]);
});

test("an exact frontmatter block gains a safe line before insertion", () => {
  const note = "---\nkind: character\n---";
  assert.equal(
    planEmbedInsert(note, { syntax: "wiki", target: "a.png" }, resolve).text,
    "---\nkind: character\n---\n![[a.png]]\n",
  );
});

test("image-shaped text inside fenced and inline code is never inventory", () => {
  const note = `${FM}\`![[a.png]]\`\n\`\`\`text\n![[b.png]]\n\`\`\`nested-example\n![[a.png]]\n\`\`\`\n~~~\n![](https://i.imgur.com/x.png)\n~~~\n![[c.png]]\n`;
  assert.deepEqual(keys(note), ["Archive/Rin/c.png"]);
});

test("insertion lands right after frontmatter, and with no frontmatter at the top", () => {
  const note = `${FM}# 프로필\n`;
  assert.equal(
    planEmbedInsert(note, { syntax: "wiki", target: "a.png" }, resolve).text,
    `${FM}![[a.png]]\n# 프로필\n`,
  );
  assert.equal(
    planEmbedInsert("body\n", { syntax: "wiki", target: "a.png" }, resolve).text,
    "![[a.png]]\nbody\n",
  );
});

test("removing an embed removes the candidate while the file stays", () => {
  const before = `${FM}![[a.png]]\n![[b.png]]\n`;
  const after = `${FM}![[b.png]]\n`;
  assert.deepEqual(keys(before), ["Archive/Rin/a.png", "Archive/Rin/b.png"]);
  assert.deepEqual(keys(after), ["Archive/Rin/b.png"]);
  // The file is still resolvable — only the note stopped offering it.
  assert.equal(resolve("a.png"), "Archive/Rin/a.png");
});

test("a folder-only file is never a candidate", () => {
  const note = `${FM}![[a.png]]\n`;
  assert.equal(resolve("folder-only.png"), "Archive/Rin/folder-only.png");
  assert.deepEqual(keys(note), ["Archive/Rin/a.png"]);
});

test("reorder permutes vault and remote candidates and keeps their source text", () => {
  const url = "https://i.imgur.com/x.png";
  const note = `${FM}![[a.png|300]]\n\n## 프로필\n본문\n\n![](${url})\n![[b.png]]\n`;
  const next = planEmbedReorder(
    note,
    [url, "Archive/Rin/b.png", "Archive/Rin/a.png"],
    resolve,
  );
  assert.equal(next.changed, true);
  assert.equal(
    next.text,
    `${FM}![](${url})\n\n## 프로필\n본문\n\n![[b.png]]\n![[a.png|300]]\n`,
  );
  assert.deepEqual(keys(next.text), [
    url,
    "Archive/Rin/b.png",
    "Archive/Rin/a.png",
  ]);
  // Same multiset, non-image content untouched.
  assert.deepEqual(new Set(keys(next.text)), new Set(keys(note)));
  assert.ok(next.text.includes("## 프로필\n본문"));
  // A remote candidate is addressable with its fragment-bearing form too.
  assert.equal(
    planEmbedReorder(
      next.text,
      [`${url}#a`, "Archive/Rin/a.png", "Archive/Rin/b.png"],
      resolve,
    ).changed,
    true,
  );
});

test("reorder never pulls an unembedded image into the note", () => {
  const note = `${FM}![[a.png]]\n![[b.png]]\n`;
  const withFolderFile = planEmbedReorder(
    note,
    ["Archive/Rin/folder-only.png", "Archive/Rin/b.png", "Archive/Rin/a.png"],
    resolve,
  );
  assert.equal(withFolderFile.text.includes("folder-only.png"), false);
  assert.deepEqual(keys(withFolderFile.text), [
    "Archive/Rin/b.png",
    "Archive/Rin/a.png",
  ]);

  // Nothing known to reorder → no write at all.
  assert.equal(
    planEmbedReorder(note, ["Archive/Rin/folder-only.png"], resolve).changed,
    false,
  );
  assert.equal(planEmbedReorder(note, [], resolve).changed, false);
  assert.equal(
    planEmbedReorder(note, ["Archive/Rin/a.png", "Archive/Rin/b.png"], resolve)
      .changed,
    false,
  );
});

test("a repeated embed of one image stays where the author put it", () => {
  const note = `${FM}![[a.png]]\n![[b.png]]\n![[a.png]]\n`;
  const next = planEmbedReorder(
    note,
    ["Archive/Rin/b.png", "Archive/Rin/a.png"],
    resolve,
  );
  assert.equal(next.text, `${FM}![[b.png]]\n![[a.png]]\n![[a.png]]\n`);
});

test("the no-cover sentinel stays a sentinel", () => {
  assert.equal(COVER_NONE, "__none__");
  assert.equal(isCoverNone("__none__"), true);
  assert.equal(isCoverNone(" __none__ "), true);
  assert.equal(isCoverNone(""), false);
  assert.equal(isCoverNone(undefined), false);
});

test("the vault side embeds before it pins, and heals no cover", () => {
  const images = readFileSync(join(root, "src/data/images.ts"), "utf8");
  const store = readFileSync(join(root, "src/data/CharacterStore.ts"), "utf8");

  // A gallery pick reaches the note body first, frontmatter second.
  assert.match(
    images,
    /export async function setCharacterCover\([\s\S]*?ensureCoverEmbed\([\s\S]*?processFrontMatter/,
  );
  assert.match(
    images,
    /export async function setCharacterCoverUrl\([\s\S]*?ensureCoverEmbed\([\s\S]*?processFrontMatter/,
  );
  // Body writes re-read inside the write, so a concurrent edit is not clobbered.
  assert.match(images, /async function ensureCoverEmbed\([\s\S]*?vault\.process\(/);
  assert.match(images, /export async function reorderNoteImages\([\s\S]*?vault\.process\(/);
  // Empty cover and `__none__` are live states — healing only migrates 언급.
  const heal = images.slice(images.indexOf("export async function healCharacterCardFields("));
  assert.doesNotMatch(heal.slice(0, heal.indexOf("\n}\n")), /cover/i);
  // Inventory comes from the note; folder scanning stays a display fallback.
  assert.match(images, /export function listNoteCoverCandidates\(/);
  assert.doesNotMatch(
    images.slice(images.indexOf("export async function reorderNoteImages(")),
    /listFolderImages|listCharacterImages/,
  );
  assert.match(store, /listNoteCoverCandidates\(this\.app, file, text\)\[0\]/);
});
