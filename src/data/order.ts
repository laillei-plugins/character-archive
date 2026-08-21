import type { App, TFile } from "obsidian";
import type { CharacterRecord } from "./CharacterStore";
import type { SortMode } from "../settings";

export type { SortMode };

export function sortCharacters(
  records: CharacterRecord[],
  mode: SortMode,
): CharacterRecord[] {
  const copy = [...records];
  copy.sort((a, b) => {
    const genre = a.장르.localeCompare(b.장르, "ko");
    if (genre !== 0) return genre;
    if (mode === "name") {
      return a.title.localeCompare(b.title, "ko");
    }
    if (a.order !== b.order) return a.order - b.order;
    return a.title.localeCompare(b.title, "ko");
  });
  return copy;
}

/** Rewrite `order` only for cards whose value actually changes. */
export async function persistGenreOrder(
  app: App,
  ordered: CharacterRecord[],
): Promise<void> {
  const writes: Promise<void>[] = [];
  ordered.forEach((record, index) => {
    const next = (index + 1) * 10;
    if (record.order === next) return;
    record.order = next;
    writes.push(
      app.fileManager.processFrontMatter(record.file, (fm) => {
        fm.order = next;
      }),
    );
  });
  if (writes.length) await Promise.all(writes);
}

export async function setCharacterGenre(
  app: App,
  file: TFile,
  genre: string,
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.장르 = genre;
  });
}

/**
 * Rename `장르` on every matching character record. Returns how many notes
 * changed.
 *
 * Sequential on purpose: a half-renamed archive would leave the same cards
 * under two names, so a failure mid-way rolls the already-written notes back to
 * `from` (best effort) and rethrows. The caller must then leave every
 * archive-scoped setting untouched — the vault is back where it started.
 */
export async function renameGenre(
  app: App,
  records: CharacterRecord[],
  from: string,
  to: string,
): Promise<number> {
  const next = to.trim();
  const prev = from.trim();
  if (!next || next === prev) return 0;

  const targets = records.filter((r) => r.장르 === prev);
  const written: CharacterRecord[] = [];
  for (const record of targets) {
    try {
      await app.fileManager.processFrontMatter(record.file, (fm) => {
        fm.장르 = next;
      });
    } catch (error) {
      const stranded = await rollbackGenre(app, written, prev);
      throw new Error(
        [
          `「${next}」로 바꾸는 중 ${record.path} 저장에 실패했어요`,
          stranded.length
            ? `되돌리지 못한 노트 ${stranded.length}개: ${stranded.join(", ")}`
            : "바뀐 노트는 되돌렸어요",
          error instanceof Error ? error.message : String(error),
        ].join(" · "),
      );
    }
    record.장르 = next;
    written.push(record);
  }
  return targets.length;
}

/** Put `장르` back on notes this rename already wrote. Returns what stayed wrong. */
async function rollbackGenre(
  app: App,
  written: readonly CharacterRecord[],
  prev: string,
): Promise<string[]> {
  const stranded: string[] = [];
  for (const record of written) {
    try {
      await app.fileManager.processFrontMatter(record.file, (fm) => {
        fm.장르 = prev;
      });
      record.장르 = prev;
    } catch (error) {
      console.error("[charinfo] 아카이브 이름 되돌리기 실패", record.path, error);
      stranded.push(record.path);
    }
  }
  return stranded;
}

/**
 * Merge saved group order with groups present in the current archive.
 * Unknown saved names are dropped; new groups append (ko sort among newcomers).
 */
export function resolveGroupOrder(
  saved: string[] | undefined,
  present: string[],
): string[] {
  const named = [
    ...new Set(present.map((g) => g.trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "ko"));
  const presentSet = new Set(named);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const name of saved ?? []) {
    const n = name.trim();
    if (!n || !presentSet.has(n) || seen.has(n)) continue;
    ordered.push(n);
    seen.add(n);
  }
  for (const name of named) {
    if (seen.has(name)) continue;
    ordered.push(name);
    seen.add(name);
  }
  return ordered;
}

/* ------------------------------------------------------- the default sentinel */

/**
 * The reserved token the empty route travels through storage as.
 *
 * The default route (`""`) has to hold a rank beside its peers, but a stored
 * order is a list of trimmed, non-empty names — every normalizer on the way in
 * drops an empty string. So it is written as one obviously-internal token.
 * Public callers keep passing `""`; only `data.json` ever sees this.
 *
 * It lives here rather than in `settings.ts` because the token exists only for
 * the stored *order*, and this module imports nothing at run time — which is
 * what lets the codec and `resolveGroupRouteOrder` be frozen by one test.
 */
export const DEFAULT_ROUTE_TOKEN = "__charinfo:default__";

/** `""` → the reserved token; a named route → its trimmed name. */
export function encodeGroupRoute(route: string): string {
  return String(route ?? "").trim() || DEFAULT_ROUTE_TOKEN;
}

/** The reserved token → `""`; anything else → its trimmed name. */
export function decodeGroupRoute(stored: string): string {
  const value = String(stored ?? "").trim();
  return value === DEFAULT_ROUTE_TOKEN ? "" : value;
}

/**
 * A canonical route order on its way to storage: encoded and deduped.
 *
 * Deduping is the point. Two chips can never mean one rank, and `""` and a
 * blank string collapse to the same token — writing both would give the default
 * route two slots and make the next read disagree with the drawer.
 */
export function encodeRouteOrder(routes: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const route of routes) {
    const token = encodeGroupRoute(route);
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * A stored order on its way back out.
 *
 * A blank entry is dropped rather than decoded: only the reserved token means
 * the default route, so a legacy list that somehow kept an empty string cannot
 * silently claim 기본's rank.
 */
export function decodeRouteOrder(stored: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of stored) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    const route = value === DEFAULT_ROUTE_TOKEN ? "" : value;
    if (seen.has(route)) continue;
    seen.add(route);
    out.push(route);
  }
  return out;
}

/**
 * The same merge, one route wider: `""` is a peer here, not a tail.
 *
 * `resolveGroupOrder` is left exactly as it is — the public share surfaces read
 * a list of *named* sections and must stay bit-identical. This variant is what
 * the group drawer and the gallery sections rank by: every reachable route in
 * the order the user arranged, with the default route holding a real rank.
 * Unknown saved routes are dropped; newcomers append (ko sort among
 * themselves), and a default route that was never ranked stays last.
 */
export function resolveGroupRouteOrder(
  saved: readonly string[] | undefined,
  present: readonly string[],
): string[] {
  const routes = new Set(present.map((route) => route.trim()));
  // The default route always exists: it is where a note with no 그룹 lands.
  routes.add("");
  const named = [...routes]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ko"));
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const route of saved ?? []) {
    const value = route.trim();
    if (!routes.has(value) || seen.has(value)) continue;
    ordered.push(value);
    seen.add(value);
  }
  for (const name of named) {
    if (seen.has(name)) continue;
    ordered.push(name);
    seen.add(name);
  }
  if (!seen.has("")) ordered.push("");
  return ordered;
}

/** Move one named group relative to another within an order list. */
export function moveInOrder(
  list: string[],
  from: string,
  to: string,
  place: "before" | "after",
): string[] {
  if (from === to) return [...list];
  const next = list.filter((x) => x !== from);
  const toIndex = next.indexOf(to);
  if (toIndex < 0) return [...list];
  const insertAt = place === "before" ? toIndex : toIndex + 1;
  next.splice(insertAt, 0, from);
  return next;
}
