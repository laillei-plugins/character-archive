/**
 * Obsidian-free Markdown image-embed layer.
 *
 * The note body owns the cover inventory: what the picker, the image strip and
 * the reorder handle offer is exactly what the note embeds, in document order.
 * That contract has to be exact, so it lives here as pure functions — vault
 * lookups enter through a `VaultImageResolver` supplied by `images.ts`, and
 * `tests/image-embeds.test.ts` runs the whole algebra without a vault.
 */

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/;
/**
 * Wiki `![[a.png|300]]` and Markdown `![alt](a.png "title")` in one pass, so
 * hits come back in true document order instead of wiki-then-markdown.
 */
const EMBED =
  /!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]|!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function blankCode(value: string): string {
  return value.replace(/[^\r\n]/g, " ");
}

/** Mask fenced and inline code while preserving every source offset. */
function maskMarkdownCode(markdown: string): string {
  const lines = markdown.match(/.*(?:\r\n|\n|$)/g) ?? [];
  const out: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;

  for (const line of lines) {
    if (!line) continue;
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      out.push(blankCode(line));
      const close = line.match(
        /^ {0,3}(`{3,}|~{3,})[ \t]*(?:\r?\n)?$/,
      );
      if (
        close &&
        close[1]?.[0] === fence.marker &&
        close[1].length >= fence.length
      ) {
        fence = null;
      }
      continue;
    }
    if (marker?.[1]) {
      fence = {
        marker: marker[1][0] as "`" | "~",
        length: marker[1].length,
      };
      out.push(blankCode(line));
      continue;
    }
    out.push(line.replace(/(`+)([^`\r\n]*?)\1/g, blankCode));
  }
  return out.join("");
}

/**
 * Frontmatter sentinel: card shows no cover while note images stay.
 * Empty `cover` still means “use first image automatically”.
 */
export const COVER_NONE = "__none__";

/** Characters that would break a wiki image target or a vault path. */
export function safeImageEmbedFilename(filename: string): string {
  return filename.replace(/[\\/#|\[\]\r\n:*?"<>]/g, "-").trim();
}

/** A pin only wins while its image is still among the note's embeds. */
export function selectCoverCandidateKey(
  candidateKeys: string[],
  pinnedKey: string | null,
): string | null {
  if (pinnedKey && candidateKeys.includes(pinnedKey)) return pinnedKey;
  return candidateKeys[0] ?? null;
}

export type EmbedSyntax = "wiki" | "md";

export interface EmbedHit {
  syntax: EmbedSyntax;
  /** Link target with `#heading` / `|size` and surrounding space removed. */
  target: string;
  /** Source text, kept verbatim so a reorder carries `|300` with its image. */
  raw: string;
  /** Offsets into the markdown handed to `scanEmbeds` (frontmatter included). */
  start: number;
  end: number;
}

/**
 * Candidate identity. A vault image is its resolved path — `![[cover.webp]]`
 * and `![[Archive/Rin/cover.webp]]` are one candidate. A remote image is its
 * URL without the fragment; the query stays because CDNs sign with it.
 */
export type EmbedIdentity =
  | { kind: "vault"; path: string }
  | { kind: "remote"; url: string };

/** Embed target → resolved vault image path, or null when it is not one. */
export type VaultImageResolver = (target: string) => string | null;

export function isCoverNone(raw: string | null | undefined): boolean {
  return (raw ?? "").trim() === COVER_NONE;
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXT.test(path);
}

export function isRemoteCoverUrl(value: string): boolean {
  return /^https:\/\//i.test(value.trim());
}

/** Remote URL without its fragment; query preserved (signed CDN links). */
export function canonicalRemoteUrl(url: string): string {
  const raw = url.trim();
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  } catch {
    const hash = raw.indexOf("#");
    return hash < 0 ? raw : raw.slice(0, hash);
  }
}

/** True when a link looks like a displayable image (path or https URL). */
export function isImageLink(link: string): boolean {
  const raw = link.trim();
  if (!raw) return false;
  if (isRemoteCoverUrl(raw)) {
    // Imgur / CDN often ends with .png (sometimes behind `?w=`); also allow
    // extension-less Imgur links.
    const bare = canonicalRemoteUrl(raw).split("?")[0] ?? "";
    return isImagePath(bare) || /^https:\/\/i\.imgur\.com\//i.test(raw);
  }
  return isImagePath(raw);
}

/** Split leading frontmatter from the body; both halves keep their text. */
export function splitFrontmatter(markdown: string): {
  frontmatter: string;
  body: string;
} {
  const match = markdown.match(FRONTMATTER);
  const frontmatter = match?.[0] ?? "";
  return { frontmatter, body: markdown.slice(frontmatter.length) };
}

function decodeTarget(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Every body image-shaped embed in exact source order. */
export function scanEmbeds(markdown: string): EmbedHit[] {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const offset = frontmatter.length;
  const searchable = maskMarkdownCode(body);
  const hits: EmbedHit[] = [];
  for (const match of searchable.matchAll(EMBED)) {
    const localStart = match.index ?? 0;
    const raw = body.slice(localStart, localStart + match[0].length);
    const start = localStart + offset;
    const end = start + raw.length;
    const wiki = match[1];
    if (wiki != null) {
      const target = wiki.trim();
      if (target) hits.push({ syntax: "wiki", target, raw, start, end });
      continue;
    }
    const md = (match[2] ?? "").trim();
    if (md) hits.push({ syntax: "md", target: decodeTarget(md), raw, start, end });
  }
  return hits;
}

export function embedIdentity(
  target: string,
  resolve: VaultImageResolver,
): EmbedIdentity | null {
  const raw = target.trim();
  if (!raw) return null;
  if (isRemoteCoverUrl(raw)) {
    // Markdown already declared this target as an image. Do not require a
    // filename extension: signed CDNs and image services commonly omit one.
    return { kind: "remote", url: canonicalRemoteUrl(raw) };
  }
  const path = resolve(raw);
  return path ? { kind: "vault", path } : null;
}

export function embedKey(identity: EmbedIdentity): string {
  return identity.kind === "vault" ? identity.path : identity.url;
}

/** Normalize an identity key coming from a caller (vault path or URL). */
export function normalizeEmbedKey(raw: string): string {
  const value = raw.trim();
  return isRemoteCoverUrl(value) ? canonicalRemoteUrl(value) : value;
}

/** Note candidates in document order, deduplicated by identity. */
export function listEmbedIdentities(
  markdown: string,
  resolve: VaultImageResolver,
): EmbedIdentity[] {
  const found: EmbedIdentity[] = [];
  const seen = new Set<string>();
  for (const hit of scanEmbeds(markdown)) {
    const identity = embedIdentity(hit.target, resolve);
    if (!identity) continue;
    const key = embedKey(identity);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(identity);
  }
  return found;
}

export function embedText(embed: { syntax: EmbedSyntax; target: string }): string {
  const target = embed.target.trim();
  return embed.syntax === "wiki" ? `![[${target}]]` : `![](${target})`;
}

/**
 * Insert an embed right after frontmatter unless the note already embeds the
 * same image. Falls back to literal-target matching when the vault cannot
 * resolve the target yet (a just-uploaded file), so the write stays idempotent.
 */
export function planEmbedInsert(
  markdown: string,
  embed: { syntax: EmbedSyntax; target: string },
  resolve: VaultImageResolver,
): { text: string; changed: boolean } {
  const target = embed.target.trim();
  if (!target) return { text: markdown, changed: false };

  const keyOf = (value: string): string => {
    const identity = embedIdentity(value, resolve);
    return identity ? embedKey(identity) : normalizeEmbedKey(value);
  };
  const key = keyOf(target);
  for (const hit of scanEmbeds(markdown)) {
    if (keyOf(hit.target) === key) return { text: markdown, changed: false };
  }

  const { frontmatter } = splitFrontmatter(markdown);
  const separator = frontmatter && !/[\r\n]$/.test(frontmatter) ? "\n" : "";
  const line = `${embedText({ syntax: embed.syntax, target })}\n`;
  return {
    text: frontmatter + separator + line + markdown.slice(frontmatter.length),
    changed: true,
  };
}

/**
 * Batch import appends new images in the picker-returned order. Unlike a cover
 * pick, it never prepends or changes frontmatter, so an existing automatic
 * first-image cover stays where it is. One plan means one vault.process write.
 */
export function planEmbedAppendMany(
  markdown: string,
  embeds: Array<{ syntax: EmbedSyntax; target: string }>,
  resolve: VaultImageResolver,
): { text: string; changed: boolean; added: number } {
  const keyOf = (value: string): string => {
    const identity = embedIdentity(value, resolve);
    return identity ? embedKey(identity) : normalizeEmbedKey(value);
  };
  const seen = new Set(scanEmbeds(markdown).map((hit) => keyOf(hit.target)));
  const lines: string[] = [];
  for (const embed of embeds) {
    const target = embed.target.trim();
    if (!target) continue;
    const key = keyOf(target);
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(embedText({ syntax: embed.syntax, target }));
  }
  if (lines.length === 0) return { text: markdown, changed: false, added: 0 };

  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  const { body } = splitFrontmatter(markdown);
  let separator = "";
  if (markdown && !body) {
    separator = markdown.endsWith(newline) ? "" : newline;
  } else if (body && !markdown.endsWith(`${newline}${newline}`)) {
    separator = markdown.endsWith(newline) ? newline : `${newline}${newline}`;
  }
  return {
    text: markdown + separator + lines.join(newline) + newline,
    changed: true,
    added: lines.length,
  };
}

/**
 * Reorder the note's image embeds to match `orderedKeys` (vault paths and/or
 * remote URLs). Only images the note already embeds move — an unknown key, such
 * as a folder-only file, is never pulled into the body — and each embed keeps
 * its own source text, so sizes and syntax travel with their image. A repeated
 * embed of one image stays where the author put it; the first occurrence is the
 * slot the strip reorders.
 */
export function planEmbedReorder(
  markdown: string,
  orderedKeys: string[],
  resolve: VaultImageResolver,
): { text: string; changed: boolean } {
  const slots: Array<{ hit: EmbedHit; key: string }> = [];
  const known = new Set<string>();
  for (const hit of scanEmbeds(markdown)) {
    const identity = embedIdentity(hit.target, resolve);
    if (!identity) continue;
    const key = embedKey(identity);
    if (known.has(key)) continue;
    known.add(key);
    slots.push({ hit, key });
  }

  const wanted: string[] = [];
  const taken = new Set<string>();
  for (const raw of orderedKeys) {
    const key = normalizeEmbedKey(raw);
    if (!known.has(key) || taken.has(key)) continue;
    taken.add(key);
    wanted.push(key);
  }

  const moving = slots.filter((slot) => taken.has(slot.key));
  const count = Math.min(moving.length, wanted.length);
  if (count < 2) return { text: markdown, changed: false };

  const rawByKey = new Map<string, string>(
    slots.map((slot) => [slot.key, slot.hit.raw]),
  );
  let text = markdown;
  // Right to left so earlier offsets stay valid while we rewrite.
  for (let i = count - 1; i >= 0; i -= 1) {
    const slot = moving[i];
    const key = wanted[i];
    const raw = key == null ? undefined : rawByKey.get(key);
    if (!slot || raw == null) continue;
    text = text.slice(0, slot.hit.start) + raw + text.slice(slot.hit.end);
  }
  return { text, changed: text !== markdown };
}

export interface ImageRemoval {
  before: string;
  text: string;
  key: string;
  removed: string[];
}

/** Remove a displayed identity, including repeated embeds, never its file. */
export function planEmbedRemove(
  markdown: string,
  key: string,
  resolve: VaultImageResolver,
  protectedKey: string | null,
): ImageRemoval {
  const normalized = normalizeEmbedKey(key);
  const plan: ImageRemoval = { before: markdown, text: markdown, key: normalized, removed: [] };
  if (protectedKey === normalized) return plan;
  const ranges: Array<{ start: number; end: number }> = [];
  for (const hit of scanEmbeds(markdown)) {
    const identity = embedIdentity(hit.target, resolve);
    if (!identity || embedKey(identity) !== normalized) continue;
    plan.removed.push(hit.raw);
    const lineStart = markdown.lastIndexOf("\n", hit.start - 1) + 1;
    const nextLine = markdown.indexOf("\n", hit.end);
    const lineEnd = nextLine < 0 ? markdown.length : nextLine + 1;
    const alone = !markdown.slice(lineStart, hit.start).trim() &&
      !markdown.slice(hit.end, lineEnd).trim();
    ranges.push(alone ? { start: lineStart, end: lineEnd } : hit);
  }
  for (const range of ranges.reverse()) {
    plan.text = plan.text.slice(0, range.start) + plan.text.slice(range.end);
  }
  return plan;
}

/** Exact Undo when safe; otherwise append without overwriting intervening edits. */
export function planEmbedRestore(
  markdown: string,
  removal: ImageRemoval,
  resolve: VaultImageResolver,
): { text: string; appended: boolean } {
  if (markdown === removal.text) return { text: removal.before, appended: false };
  if (listEmbedIdentities(markdown, resolve).some((image) => embedKey(image) === removal.key)) {
    return { text: markdown, appended: false };
  }
  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  const text = markdown + (markdown.endsWith(newline) ? newline : newline + newline) +
    removal.removed.join(newline) + newline;
  // An unfinished fenced block can swallow an appended image. Leave the note
  // untouched rather than claiming a successful restore in that case.
  if (!listEmbedIdentities(text, resolve).some((image) => embedKey(image) === removal.key)) {
    throw new Error("노트가 바뀌어 되돌리지 못했어요. 노트에서 이미지를 다시 넣어 주세요.");
  }
  return { text, appended: true };
}
