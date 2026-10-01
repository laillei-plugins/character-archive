/**
 * 아카이브 등록 — an archive the user created on purpose.
 *
 * Archives used to be inferred from cards alone, so an archive with no card
 * could not exist. A declaration is the one extra fact that lets it: a
 * `(library, archive)` row saying "this name is an archive here, cards or not".
 *
 * Ownership rules:
 * - a declaration is scoped to **one library**; the same name in another
 *   library is a different archive and is never touched;
 * - cards stay the authority for spelling — when a card already carries the
 *   name, the list shows the card's spelling, not the declared one;
 * - nothing is backfilled: an archive that was only ever inferred from cards
 *   stays inferred, and disappears with its last card exactly as before;
 * - a declared archive outlives its last card.
 *
 * Stored as an **array**: library and archive are user strings and must never
 * become object keys.
 *
 * Runtime imports are limited to modules that import nothing themselves, so a
 * test can bundle this file without an Obsidian vault.
 */

import {
  characterNameProblem,
  characterNameProblemMessage,
} from "./characterName";
import { UNCLASSIFIED_ARCHIVE, normalizeLibraryKey } from "./groupSchema";

export interface DeclaredArchive {
  library: string;
  archive: string;
}

/** The slice of settings this module reads and writes. */
export interface ArchiveRegistryStore {
  declaredArchives: DeclaredArchive[];
}

/** Subfolder that holds gallery notes (`GALLERY_PAGES_DIR`). */
const GALLERY_PAGES_FOLDER = "_galleries";
/** Subfolder that holds the seeded sample card (`EXAMPLE_FOLDER`). */
const STARTER_FOLDER = "_starter";

export function normalizeArchiveName(raw: unknown): string {
  return String(raw ?? "").normalize("NFC").trim();
}

/** NFC + locale-independent lowercase: two names that cannot share a folder. */
export function archiveIdentity(raw: unknown): string {
  return normalizeArchiveName(raw).toLowerCase();
}

/** Missing or malformed → `[]`. First row wins a per-library identity clash. */
export function normalizeDeclaredArchives(raw: unknown): DeclaredArchive[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: DeclaredArchive[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const { library: rawLibrary, archive: rawArchive } = row as {
      library?: unknown;
      archive?: unknown;
    };
    if (typeof rawLibrary !== "string" || typeof rawArchive !== "string") {
      continue;
    }
    const library = normalizeLibraryKey(rawLibrary);
    const archive = normalizeArchiveName(rawArchive);
    if (!library || !archive) continue;
    const key = `${library}\n${archiveIdentity(archive)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ library, archive });
  }
  return out;
}

/** Declared archive names of one library, in stored order. */
export function declaredArchiveNames(
  declared: readonly DeclaredArchive[],
  library: string,
): string[] {
  const lib = normalizeLibraryKey(library);
  return declared
    .filter((row) => normalizeLibraryKey(row.library) === lib)
    .map((row) => row.archive);
}

/**
 * Every archive of one library: what the cards carry, plus what was declared.
 * A declaration whose name a card already carries adds nothing — the card's
 * spelling stands. Sorted once, with the same rule the header always used.
 */
export function listArchives(
  observed: readonly string[],
  declared: readonly DeclaredArchive[],
  library: string,
): string[] {
  const names = new Set<string>();
  const identities = new Set<string>();
  for (const name of observed) {
    if (!name) continue;
    names.add(name);
    identities.add(archiveIdentity(name));
  }
  for (const name of declaredArchiveNames(declared, library)) {
    const identity = archiveIdentity(name);
    if (identities.has(identity)) continue;
    identities.add(identity);
    names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "ko"));
}

/**
 * The listed spelling of a remembered archive: the exact name when it is
 * listed, else the listed name with the same identity, else `""`.
 */
export function resolveArchiveSpelling(
  archives: readonly string[],
  pick: string,
): string {
  if (!pick) return "";
  if (archives.includes(pick)) return pick;
  const identity = archiveIdentity(pick);
  return archives.find((name) => archiveIdentity(name) === identity) ?? "";
}

/** First folder under the library that holds this path, or `""` at its root. */
export function topLevelFolderOf(library: string, path: string): string {
  const lib = normalizeLibraryKey(library);
  const target = normalizeLibraryKey(path);
  const rel = lib
    ? target.startsWith(`${lib}/`)
      ? target.slice(lib.length + 1)
      : ""
    : target;
  const parts = rel.split("/").filter(Boolean);
  return parts.length > 1 ? (parts[0] ?? "") : "";
}

/** Why a name is kept for the plugin itself, or `null` when it is free. */
function reservedArchiveReason(name: string): string | null {
  const identity = archiveIdentity(name);
  if (identity === archiveIdentity(UNCLASSIFIED_ARCHIVE)) {
    return `「${name}」는 아카이브가 없는 카드를 모아 두는 이름이라 쓸 수 없어요.`;
  }
  if (identity === GALLERY_PAGES_FOLDER) {
    return `「${name}」는 갤러리 노트 폴더 이름이라 쓸 수 없어요.`;
  }
  if (identity === STARTER_FOLDER) {
    return `「${name}」는 예시 카드 폴더 이름이라 쓸 수 없어요.`;
  }
  // Archive names index plain objects (templates, group order). A name every
  // object already answers to would read a built-in instead of user data.
  if (Object.getOwnPropertyNames(Object.prototype).includes(name)) {
    return `「${name}」는 플러그인 안에서 쓰는 이름이라 쓸 수 없어요.`;
  }
  return null;
}

export interface ArchiveNameCheck {
  name: unknown;
  /** Observed and declared archive names of this library. */
  existing: readonly string[];
  /** Names of the folders directly under this library. */
  folders: readonly string[];
  /** Rename only: the exact archive being renamed. */
  source?: string;
  /** Rename only: top-level folders that already hold the source's cards. */
  sourceFolders?: readonly string[];
}

/**
 * The message to show for a name that cannot be an archive here, or `null`.
 *
 * A new archive's first card lands in `library/{name}`, so the name must be a
 * portable folder name that no other archive and no existing folder already
 * owns — a folder can hold another archive's cards under a different display
 * name. On rename the source itself is exempt, by exact name, so a case-only
 * rename works; so are the folders the source already lives in.
 */
export function archiveNameProblem(check: ArchiveNameCheck): string | null {
  const name = normalizeArchiveName(check.name);
  const problem = characterNameProblem(name);
  if (problem) return characterNameProblemMessage(problem);

  const reserved = reservedArchiveReason(name);
  if (reserved) return reserved;

  const identity = archiveIdentity(name);
  const duplicate = check.existing.some(
    (other) => other !== check.source && archiveIdentity(other) === identity,
  );
  if (duplicate) {
    return `「${name}」 아카이브가 이미 있어요. 다른 이름을 정해 주세요.`;
  }

  const own = new Set(
    (check.sourceFolders ?? []).map((folder) => archiveIdentity(folder)),
  );
  if (check.source !== undefined) own.add(archiveIdentity(check.source));
  const folder = check.folders.find(
    (other) => archiveIdentity(other) === identity,
  );
  if (folder !== undefined && !own.has(identity)) {
    return `「${folder}」 폴더가 이미 있어요. 다른 이름을 정해 주세요.`;
  }
  return null;
}

/** A name the user has to change; its message is ready to show as-is. */
export class ArchiveNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveNameError";
  }
}

/**
 * Declare one archive, checking the name against the store it is about to
 * write. Call this **inside** the serialized settings commit: the declarations
 * read here are then the freshest ones, so two galleries racing for one name
 * cannot both win.
 */
export function declareArchive(
  store: ArchiveRegistryStore,
  input: {
    library: string;
    name: unknown;
    /** Archive names the library's cards carry right now. */
    observed: readonly string[];
    folders: readonly string[];
  },
): string {
  const library = normalizeLibraryKey(input.library);
  const archive = normalizeArchiveName(input.name);
  const problem = archiveNameProblem({
    name: archive,
    existing: listArchives(input.observed, store.declaredArchives, library),
    folders: input.folders,
  });
  if (problem) throw new ArchiveNameError(problem);
  store.declaredArchives = [...store.declaredArchives, { library, archive }];
  return archive;
}

/**
 * Move a declaration to the archive's new name, inside its own library only.
 * An archive that was never declared stays undeclared. Returns true when a
 * row changed.
 */
export function renameDeclaredArchive(
  store: ArchiveRegistryStore,
  library: string,
  from: string,
  to: string,
): boolean {
  const lib = normalizeLibraryKey(library);
  const source = archiveIdentity(from);
  const archive = normalizeArchiveName(to);
  if (!archive) return false;
  const isSource = (row: DeclaredArchive): boolean =>
    normalizeLibraryKey(row.library) === lib &&
    archiveIdentity(row.archive) === source;
  if (!store.declaredArchives.some(isSource)) return false;
  store.declaredArchives = normalizeDeclaredArchives(
    store.declaredArchives.map((row) =>
      isSource(row) ? { library: lib, archive } : row,
    ),
  );
  return true;
}

/** The one notice an archive rename ends with. */
export function archiveRenameNotice(result: {
  next: string;
  /** Notes whose `장르` was rewritten. */
  count: number;
  /** Whether the archive-scoped settings commit was saved. */
  saved: boolean;
  error?: string;
}): string {
  const { next, count } = result;
  if (result.saved) {
    return count
      ? `아카이브 이름을 「${next}」로 바꿨어요 · 노트 ${count}개`
      : `아카이브 이름을 「${next}」로 바꿨어요`;
  }
  const reason = result.error ? ` · ${result.error}` : "";
  return count
    ? `노트는 「${next}」로 바꿨지만 설정 저장에 실패했어요${reason}`
    : `아카이브 이름을 바꾸지 못했어요 · 설정 저장에 실패했어요${reason}`;
}
