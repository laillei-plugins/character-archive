/**
 * Where a new character note's folder goes.
 *
 * Vault layout is `library/{장르폴더}/{이름}/{이름}.md`. A new card follows the
 * cards it belongs with, and belonging starts with the archive: a group name
 * is only meaningful inside its own archive, so a same-named group elsewhere
 * is not a sibling.
 *
 * This file imports nothing — `node --test` runs it straight from TypeScript.
 */

/** One existing character note under the library. */
export interface RoutingSibling {
  path: string;
  /** Raw `장르`, trimmed. */
  genre: string;
  /** Raw `그룹`, trimmed. */
  group: string;
}

/**
 * How strongly an existing note pulls a new `(genre, group)` card toward its
 * folder. `0` = no pull. The group and ungrouped bonuses count only inside the
 * same archive; a blank `genre` matches notes whose `장르` is blank too.
 */
export function scoreRoutingSibling(
  sibling: Pick<RoutingSibling, "genre" | "group">,
  genre: string,
  group: string,
): number {
  const sameArchive = sibling.genre === genre;
  let score = 0;
  if (group && sibling.group === group && sameArchive) score += 2;
  if (genre && sameArchive) score += 1;
  if (!group && !sibling.group && sameArchive) score += 1;
  return score;
}

/**
 * Parent folder for a new character note. Prefers the folder where the
 * best-scoring sibling already lives; the first of equal scores wins. With no
 * sibling the archive gets its own folder under the library.
 */
export function resolveCharacterParentFolder(
  library: string,
  siblings: readonly RoutingSibling[],
  genre: string,
  group: string,
): string {
  let best: RoutingSibling | null = null;
  let bestScore = 0;
  for (const sibling of siblings) {
    if (!sibling.path.startsWith(`${library}/`)) continue;
    const score = scoreRoutingSibling(sibling, genre, group);
    if (score > bestScore) {
      bestScore = score;
      best = sibling;
    }
  }

  if (best) {
    const rel = best.path.slice(library.length + 1);
    const parts = rel.split("/").filter(Boolean);
    if (parts.length >= 3) {
      return `${library}/${parts.slice(0, -2).join("/")}`;
    }
    return library;
  }

  if (genre) return `${library}/${genre}`;
  if (group) return `${library}/${group}`;
  return library;
}
