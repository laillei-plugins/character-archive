/**
 * Freeze the immediate card reorder: a drop is authoritative before storage.
 *
 * The failure this file exists to prevent is a card that snaps back. Ranking the
 * records *before* assigning the new `order` values meant the authoritative
 * array still described the pre-drop arrangement, so any repaint that arrived
 * while the frontmatter writes were settling rebuilt the old order and the
 * gesture looked broken. So two things are frozen here: the plan/commit pair is
 * synchronous and self-consistent, and the persistence lane keeps gesture order
 * while holding the refresh guard for exactly as long as its own writes settle.
 *
 * `data/order.ts` has only type-level imports, so `node --test` runs it
 * straight from TypeScript. Keep it that way — no Obsidian at run time.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CharacterRecord } from "../src/data/CharacterStore.ts";
import {
  commitOrderValues,
  planCardReorder,
  ReorderLane,
  sortCharacters,
  writeOrderValues,
} from "../src/data/order.ts";

/* ------------------------------------------------------------- the fixture */

/** A record with only the fields ordering reads. `file` is never dereferenced. */
function card(
  path: string,
  order: number,
  opts?: { genre?: string; group?: string },
): CharacterRecord {
  const title = path.replace(/\.md$/, "");
  return {
    file: { path } as CharacterRecord["file"],
    path,
    kind: "character",
    이름: title,
    코드네임: "",
    본명: "",
    소속: "",
    장르: opts?.genre ?? "본편",
    작품: "",
    그룹: opts?.group ?? "",
    상태: "",
    관계: "",
    인연: "",
    태그: [],
    cover: "",
    coverPosition: "50% 50%",
    order,
    title,
    values: {},
  };
}

/** Three cards of one 장르, already normalized: the ordinary starting point. */
function trio(): CharacterRecord[] {
  return [card("a.md", 10), card("b.md", 20), card("c.md", 30)];
}

const paths = (records: readonly CharacterRecord[]): string[] =>
  records.map((r) => r.path);

/** Settle every queued microtask — the lane is promise-driven, never timed. */
async function drain(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

/** A promise plus its resolvers, so a test decides when a write finishes. */
function gate(): { promise: Promise<void>; open: () => void; fail: (e: Error) => void } {
  let open = () => {};
  let fail = (_: Error) => {};
  const promise = new Promise<void>((resolve, reject) => {
    open = () => resolve();
    fail = (error) => reject(error);
  });
  return { promise, open, fail };
}

/* ------------------------------------------------ 1. the synchronous commit */

test("a drop's ranks are committed before anything is awaited", () => {
  const records = trio();
  const plan = planCardReorder(records, "c.md", "a.md", "before");
  assert.ok(plan);
  assert.deepEqual(paths(plan.ordered), ["c.md", "a.md", "b.md"]);

  // The commit is the whole contract: after it, and with no await in between,
  // the manual sort already answers with the dropped arrangement.
  const writes = commitOrderValues(plan.ordered);
  assert.deepEqual(paths(sortCharacters(records, "manual")), [
    "c.md",
    "a.md",
    "b.md",
  ]);
  assert.deepEqual(
    writes.map((w) => [w.path, w.order]),
    [
      ["c.md", 10],
      ["a.md", 20],
      ["b.md", 30],
    ],
  );
});

test("ranking before assigning is what used to rebuild the old order", () => {
  // The regression, spelled out: sort first and the array is still pre-drop,
  // because `sortCharacters` ranks by the `order` the commit has not written yet.
  const records = trio();
  const plan = planCardReorder(records, "c.md", "a.md", "before");
  assert.ok(plan);
  assert.deepEqual(paths(sortCharacters(records, "manual")), [
    "a.md",
    "b.md",
    "c.md",
  ]);
  commitOrderValues(plan.ordered);
  assert.deepEqual(paths(sortCharacters(records, "manual")), [
    "c.md",
    "a.md",
    "b.md",
  ]);
});

test("captured writes never re-read a rank a later drop has moved", () => {
  const records = trio();
  const first = planCardReorder(records, "c.md", "a.md", "before");
  assert.ok(first);
  const firstWrites = commitOrderValues(first.ordered);
  records.splice(0, records.length, ...sortCharacters(records, "manual"));

  const second = planCardReorder(records, "b.md", "c.md", "before");
  assert.ok(second);
  commitOrderValues(second.ordered);

  // `a.md` moved again, but the first gesture's snapshot still says what *it*
  // decided. Sharing the record would have let the older write win on disk.
  const a = firstWrites.find((w) => w.path === "a.md");
  assert.equal(a?.order, 20);
  assert.equal(records.find((r) => r.path === "a.md")?.order, 30);
  assert.throws(() => {
    (a as { order: number }).order = 999;
  }, TypeError);
});

test("dropping onto a neighbour lands after it when place says after", () => {
  const records = trio();
  const plan = planCardReorder(records, "a.md", "c.md", "after");
  assert.ok(plan);
  commitOrderValues(plan.ordered);
  assert.deepEqual(paths(sortCharacters(records, "manual")), [
    "b.md",
    "c.md",
    "a.md",
  ]);
});

/* --------------------------------------------------- 2. drops that are not */

test("a same-position drop is not an edit", () => {
  // Both spellings of "put it back": before its successor, after its
  // predecessor. Neither may plan work, so neither can write.
  assert.equal(planCardReorder(trio(), "a.md", "b.md", "before"), null);
  assert.equal(planCardReorder(trio(), "b.md", "a.md", "after"), null);
});

test("a same-position drop writes nothing even from a denormalized archive", () => {
  // Ranks a human typed by hand: normalizing them would be a write, and a drop
  // that changed nothing has no right to one.
  const records = [card("a.md", 1), card("b.md", 2), card("c.md", 3)];
  assert.equal(planCardReorder(records, "b.md", "c.md", "before"), null);
  assert.deepEqual(
    records.map((r) => r.order),
    [1, 2, 3],
  );
});

test("a visually unchanged drop ignores cards interleaved from another group", () => {
  const records = [
    card("a.md", 10, { group: "A" }),
    card("x.md", 20, { group: "B" }),
    card("b.md", 30, { group: "A" }),
  ];
  // Group A already displays a, b. The hidden-in-this-grid B card must not
  // make dropping a before b look like a change or rewrite any rank.
  assert.equal(planCardReorder(records, "a.md", "b.md", "before"), null);
});

test("an unknown card or target plans nothing", () => {
  assert.equal(planCardReorder(trio(), "zz.md", "a.md", "before"), null);
  assert.equal(planCardReorder(trio(), "a.md", "zz.md", "before"), null);
  assert.equal(planCardReorder(trio(), "a.md", "a.md", "before"), null);
});

/* ------------------------------------------------------- 3. crossing groups */

test("a cross-group drop keeps the destination's group and genre", () => {
  const records = [
    card("a.md", 10, { group: "1부" }),
    card("b.md", 20, { group: "1부" }),
    card("c.md", 30, { group: "2부" }),
  ];
  const plan = planCardReorder(records, "a.md", "c.md", "before");
  assert.ok(plan);
  assert.equal(plan.group, "2부");
  assert.equal(plan.groupChanged, true);
  assert.equal(plan.genreChanged, false);
  assert.equal(plan.moved, true);
  // `b` already precedes the target; moving `a` immediately before `c` yields
  // the same placement the DOM performs: b, a, c.
  assert.deepEqual(paths(plan.ordered), ["a.md", "c.md"]);
});

test("a cross-group drop that does not move the card is still a real move", () => {
  // Same arrangement, new owner: `a.md` already sat before `c.md`, but the drop
  // hands it 2부, so the same-position shortcut must not swallow it.
  const records = [
    card("a.md", 10, { group: "1부" }),
    card("c.md", 20, { group: "2부" }),
  ];
  const plan = planCardReorder(records, "a.md", "c.md", "before");
  assert.ok(plan);
  assert.equal(plan.moved, true);
  assert.equal(plan.group, "2부");
});

test("a cross-genre drop ranks inside the destination genre only", () => {
  const records = [
    card("a.md", 10, { genre: "본편" }),
    card("b.md", 20, { genre: "본편" }),
    card("x.md", 10, { genre: "외전" }),
    card("y.md", 20, { genre: "외전" }),
  ];
  const plan = planCardReorder(records, "a.md", "y.md", "before");
  assert.ok(plan);
  assert.equal(plan.genre, "외전");
  assert.equal(plan.genreChanged, true);
  assert.deepEqual(paths(plan.ordered), ["x.md", "a.md", "y.md"]);

  // The view commits 장르 with the ranks, in the same synchronous step — so the
  // sort has to place the card under its new archive right away.
  plan.from.장르 = plan.genre;
  const writes = commitOrderValues(plan.ordered);
  assert.deepEqual(
    writes.map((w) => [w.path, w.order]),
    [
      ["a.md", 20],
      ["y.md", 30],
    ],
  );
  assert.deepEqual(paths(sortCharacters(records, "manual")), [
    "b.md",
    "x.md",
    "a.md",
    "y.md",
  ]);
  // The source genre keeps a gap where the card was. Monotonic is all it owes.
  assert.equal(records.find((r) => r.path === "b.md")?.order, 20);
});

/* -------------------------------------------------------------- 4. the lane */

test("rapid drops persist in gesture order and the newest wins", async () => {
  const written: string[] = [];
  const lane = new ReorderLane();
  const first = gate();
  const second = gate();

  void lane.enqueue(async () => {
    written.push("first:start");
    await first.promise;
    written.push("first:done");
  });
  void lane.enqueue(async () => {
    written.push("second:start");
    await second.promise;
    written.push("second:done");
  });

  await drain();
  // Serialized, not parallel: the second gesture has not touched storage yet.
  assert.deepEqual(written, ["first:start"]);
  assert.equal(lane.depth, 2);

  first.open();
  await drain();
  assert.deepEqual(written, ["first:start", "first:done", "second:start"]);

  second.open();
  await drain();
  assert.deepEqual(written, [
    "first:start",
    "first:done",
    "second:start",
    "second:done",
  ]);
  assert.equal(lane.active, false);
});

test("a failed rank waits for its slow siblings before the next gesture", async () => {
  const events: string[] = [];
  const slow = gate();
  const app = {
    fileManager: {
      processFrontMatter: async (file: { path: string }) => {
        events.push(`start:${file.path}`);
        if (file.path === "old-fail.md") throw new Error("locked");
        if (file.path === "old-slow.md") await slow.promise;
        events.push(`finish:${file.path}`);
      },
    },
  } as Parameters<typeof writeOrderValues>[0];
  const write = (path: string, order: number) =>
    Object.freeze({ path, file: { path }, order }) as Parameters<
      typeof writeOrderValues
    >[1][number];
  const lane = new ReorderLane();

  const oldGesture = lane.enqueue(() =>
    writeOrderValues(app, [
      write("old-fail.md", 10),
      write("old-slow.md", 20),
    ]),
  );
  const newGesture = lane.enqueue(() =>
    writeOrderValues(app, [write("new.md", 10)]),
  );

  await drain();
  assert.deepEqual(events, ["start:old-fail.md", "start:old-slow.md"]);

  slow.open();
  await Promise.all([oldGesture, newGesture]);
  assert.deepEqual(events, [
    "start:old-fail.md",
    "start:old-slow.md",
    "finish:old-slow.md",
    "start:new.md",
    "finish:new.md",
  ]);
});

test("a failed gesture does not cancel the gesture behind it", async () => {
  const written: string[] = [];
  const drains: boolean[] = [];
  const lane = new ReorderLane({ onDrain: ({ failed }) => drains.push(failed) });

  const settled = await Promise.all([
    lane.enqueue(async () => {
      throw new Error("frontmatter locked");
    }),
    lane.enqueue(async () => {
      written.push("second");
    }),
  ]);

  assert.deepEqual(written, ["second"]);
  // Never rejects: a drop the user is already looking at cannot be thrown at.
  assert.deepEqual(settled, [undefined, undefined]);
  assert.deepEqual(drains, [true]);
});

test("the guard spans the whole lane and expires when it drains", async () => {
  const events: string[] = [];
  const lane = new ReorderLane({
    onActivate: () => events.push("freeze"),
    onDrain: ({ failed }) => events.push(`thaw:${failed}`),
  });
  const first = gate();
  const second = gate();

  void lane.enqueue(() => first.promise);
  await drain();
  assert.deepEqual(events, ["freeze"]);

  // A second drop lands mid-write: one guard span, not two.
  void lane.enqueue(() => second.promise);
  await drain();
  assert.deepEqual(events, ["freeze"]);
  assert.equal(lane.depth, 2);

  first.open();
  await drain();
  assert.deepEqual(events, ["freeze"], "the lane is still writing");

  second.open();
  await drain();
  assert.deepEqual(events, ["freeze", "thaw:false"]);
  assert.equal(lane.active, false);

  // Expired, not exhausted: the next drop opens a fresh span.
  const third = gate();
  void lane.enqueue(() => third.promise);
  await drain();
  assert.deepEqual(events, ["freeze", "thaw:false", "freeze"]);
  third.open();
  await drain();
  assert.deepEqual(events, ["freeze", "thaw:false", "freeze", "thaw:false"]);
});

test("one failed span reports once, and the next span starts clean", async () => {
  const drains: boolean[] = [];
  const lane = new ReorderLane({ onDrain: ({ failed }) => drains.push(failed) });

  await Promise.all([
    lane.enqueue(async () => {
      throw new Error("one");
    }),
    lane.enqueue(async () => {
      throw new Error("two");
    }),
  ]);
  // Three rapid drops that all fail are one thing that went wrong.
  assert.deepEqual(drains, [true]);

  await lane.enqueue(async () => {});
  assert.deepEqual(drains, [true, false]);
});
