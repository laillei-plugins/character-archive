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

/** Rename `장르` on every matching character record. Returns how many notes changed. */
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
  await Promise.all(
    targets.map(async (record) => {
      record.장르 = next;
      await app.fileManager.processFrontMatter(record.file, (fm) => {
        fm.장르 = next;
      });
    }),
  );
  return targets.length;
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
