/**
 * Folded group sections, per `(library, archive, group)`.
 *
 * Only collapsed rows are stored: a missing row means open, so the default
 * stays open and a renamed or deleted group simply falls back to open.
 * Array store on purpose: group names are user strings, never object keys.
 */

import { normalizeLibraryKey } from "./groupSchema";

export interface CollapsedGroup {
  library: string;
  archive: string;
  group: string;
}

/** The slice of settings this module reads and writes. */
export interface CollapsedGroupStore {
  collapsedGroups: CollapsedGroup[];
}

function clean(raw: unknown): string {
  return String(raw ?? "").normalize("NFC").trim();
}

function rowKey(library: string, archive: string, group: string): string {
  return `${normalizeLibraryKey(library)}\n${clean(archive)}\n${clean(group)}`;
}

/** Missing or malformed → `[]`. Duplicate rows collapse to the first. */
export function normalizeCollapsedGroups(raw: unknown): CollapsedGroup[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CollapsedGroup[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const { library, archive, group } = row as Record<string, unknown>;
    if (
      typeof library !== "string" ||
      typeof archive !== "string" ||
      typeof group !== "string"
    ) {
      continue;
    }
    const entry = {
      library: normalizeLibraryKey(library),
      archive: clean(archive),
      group: clean(group),
    };
    if (!entry.group) continue;
    const key = rowKey(entry.library, entry.archive, entry.group);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

export function isGroupCollapsed(
  store: CollapsedGroupStore,
  library: string,
  archive: string,
  group: string,
): boolean {
  const key = rowKey(library, archive, group);
  return store.collapsedGroups.some(
    (row) => rowKey(row.library, row.archive, row.group) === key,
  );
}

export function setGroupCollapsed(
  store: CollapsedGroupStore,
  library: string,
  archive: string,
  group: string,
  collapsed: boolean,
): void {
  const key = rowKey(library, archive, group);
  const rest = store.collapsedGroups.filter(
    (row) => rowKey(row.library, row.archive, row.group) !== key,
  );
  if (collapsed && clean(group)) {
    rest.push({
      library: normalizeLibraryKey(library),
      archive: clean(archive),
      group: clean(group),
    });
  }
  store.collapsedGroups = rest;
}
