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

/* ------------------------------------------------- immediate card reorder */

/**
 * One card's durable rank, captured at drop time.
 *
 * Frozen, and holding a number rather than a record, on purpose: a queued
 * gesture must write the rank *its* drop decided, not whatever `record.order`
 * says by the time the write runs. A later drop has already moved that field.
 */
export interface OrderWrite {
  readonly path: string;
  readonly file: TFile;
  readonly order: number;
}

/** What a card drop means, resolved against the records the user can see. */
export interface CardReorderPlan {
  from: CharacterRecord;
  to: CharacterRecord;
  /** The destination 장르 and 그룹, read off `to` before anything mutates. */
  genre: string;
  group: string;
  genreChanged: boolean;
  groupChanged: boolean;
  /** True when the card also changes which 장르/그룹 schema owns it. */
  moved: boolean;
  /** The destination group's new visible arrangement, `from` already spliced in. */
  ordered: CharacterRecord[];
}

/**
 * The arrangement a card drop implies, or `null` when the drop is not an edit.
 *
 * Pure: nothing is mutated here, so the caller decides when the commit happens
 * — and it can happen synchronously, which is the whole point. `records` must
 * be in view order (`sortCharacters` output), because that is what "the
 * position the card was already in" means.
 *
 * `null` covers the three non-edits: an unknown card, an unknown target, and a
 * drop that lands where the card already sat *and* changes no group or genre.
 * A same-position drop across a group boundary is still a real move, so it is
 * not folded in here.
 */
export function planCardReorder(
  records: readonly CharacterRecord[],
  fromPath: string,
  toPath: string,
  place: "before" | "after",
): CardReorderPlan | null {
  const from = records.find((r) => r.path === fromPath);
  const to = records.find((r) => r.path === toPath);
  if (!from || !to || from === to) return null;

  const genre = to.장르;
  const group = to.그룹.trim();
  const genreChanged = from.장르 !== genre;
  const groupChanged = from.그룹.trim() !== group;
  const moved = genreChanged || groupChanged;

  // Cards are rendered and dragged inside group grids. Rank only the target
  // grid: a card from another group may be numerically interleaved in the
  // genre-wide array, but it is not a visible neighbour and must not turn a
  // same-position drop into a write.
  const inDestination = (record: CharacterRecord): boolean =>
    record.장르 === genre && record.그룹.trim() === group;
  const before = records.filter(inDestination).map((r) => r.path);
  const ordered = records.filter(
    (r) => inDestination(r) && r.path !== fromPath,
  );
  const toIndex = ordered.findIndex((r) => r.path === toPath);
  if (toIndex < 0) return null;
  ordered.splice(place === "before" ? toIndex : toIndex + 1, 0, from);

  if (!moved && sameArrangement(before, ordered)) return null;
  return { from, to, genre, group, genreChanged, groupChanged, moved, ordered };
}

/** True when a reordered list is the arrangement that was already on screen. */
function sameArrangement(
  before: readonly string[],
  after: readonly CharacterRecord[],
): boolean {
  if (before.length !== after.length) return false;
  return after.every((record, index) => record.path === before[index]);
}

/**
 * Commit normalized manual ranks to the records and return what storage owes.
 *
 * Synchronous, and it must stay that way: the sort that rebuilds the gallery
 * reads `record.order`, so assigning after the first `await` is exactly the bug
 * where a repaint rebuilds the pre-drop order. Only changed ranks are returned,
 * so a card that already held its slot is not rewritten.
 */
export function commitOrderValues(
  ordered: readonly CharacterRecord[],
): OrderWrite[] {
  const writes: OrderWrite[] = [];
  ordered.forEach((record, index) => {
    const next = (index + 1) * 10;
    if (record.order === next) return;
    record.order = next;
    writes.push(
      Object.freeze({ path: record.path, file: record.file, order: next }),
    );
  });
  return writes;
}

/** Write one drop's captured ranks. Nothing to write is not a write. */
export async function writeOrderValues(
  app: App,
  writes: readonly OrderWrite[],
): Promise<void> {
  if (writes.length === 0) return;
  const results = await Promise.allSettled(
    writes.map((write) =>
      app.fileManager.processFrontMatter(write.file, (fm) => {
        fm.order = write.order;
      }),
    ),
  );
  // Promise.all would release the serialized lane as soon as one write failed,
  // even though its sibling writes were still running. Wait for every write in
  // this gesture, then fail the gesture so a newer drop cannot be overtaken by
  // an older slow completion.
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
}

/** Brackets on the lane's active window, plus its one report. */
export interface ReorderLaneHooks {
  onActivate?: () => void;
  onDrain?: (outcome: { failed: boolean }) => void;
}

/**
 * Per-view reorder persistence lane.
 *
 * A drop is authoritative in memory and on screen before anything reaches this
 * lane, so the lane owes storage exactly two things.
 *
 * Gesture order: tasks run strictly FIFO, so the newest drop writes last and
 * the durable vault ends up agreeing with the last thing the user did. A
 * rejected task never breaks the chain — the gesture behind it still writes.
 *
 * A window: the lane is `active` from the first enqueue until it drains, and
 * that span is the only one in which the view's own `order` writes can come
 * back as metadata events describing a half-written vault. `onActivate` and
 * `onDrain` bracket exactly that span, so the guard cannot outlive it and
 * cannot silence a refresh the lane is not responsible for.
 *
 * Failure is reported once per span, on drain, with the flag — not per task.
 * Three rapid drops that all fail are one thing that went wrong, not three.
 */
export class ReorderLane {
  private tail: Promise<void> = Promise.resolve();
  private running = 0;
  private failed = false;
  /**
   * Assigned in the body, not as a parameter property: this module is loaded
   * straight from TypeScript by `node --test`, and type stripping cannot emit
   * the assignment a parameter property implies.
   */
  private readonly hooks: ReorderLaneHooks;

  constructor(hooks: ReorderLaneHooks = {}) {
    this.hooks = hooks;
  }

  /** True while at least one gesture is queued or writing. */
  get active(): boolean {
    return this.running > 0;
  }

  /** Gestures still in the lane, including the one writing now. */
  get depth(): number {
    return this.running;
  }

  /**
   * Queue one gesture's persistence.
   *
   * The returned promise settles when *this* gesture is done and never rejects:
   * a drop the user is already looking at cannot be taken back by throwing.
   */
  enqueue(task: () => Promise<void>): Promise<void> {
    if (this.running === 0) {
      this.failed = false;
      this.hooks.onActivate?.();
    }
    this.running += 1;
    const done = this.tail.then(task).catch((error) => {
      this.failed = true;
      console.error("[charinfo] 순서 저장 실패", error);
    });
    this.tail = done;
    return done.then(() => {
      this.running -= 1;
      if (this.running > 0) return;
      const failed = this.failed;
      this.failed = false;
      this.hooks.onDrain?.({ failed });
    });
  }
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
