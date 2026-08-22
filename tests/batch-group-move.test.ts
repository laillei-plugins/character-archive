/**
 * Freeze the batch group-move transaction and its UI lifecycle.
 *
 * Three layers are locked here, and it is worth knowing which is which.
 *
 * **The transaction.** `batchGroupMove.ts` imports nothing, so `node --test`
 * runs it straight from TypeScript. Everything that decides whether the vault
 * can end up half-moved lives there: which notes are written and in which
 * order, that a failure unwinds in exact reverse, that a no-op is never written
 * and never counted, and that a rollback refuses to overwrite a value it did
 * not make.
 *
 * **The dialog.** `BatchGroupMoveDialog.ts` also has no runtime imports, so the
 * *real* dialog is driven below against a fake DOM narrow enough to fit in this
 * file — focus trap, focus restore, saving lock, listener disposal, and the
 * no-eligible-destination state are exercised on production code, not a copy.
 * The fake models the two focus refusals the contract depends on: a `disabled`
 * control and an `inert` subtree both swallow `focus()` silently.
 *
 * **The view lifecycle.** `GalleryView` cannot be imported without a vault, so
 * the decisions it used to make inline are seams in `batchGroupMove.ts` —
 * `batchModeSurface`, `reconcileBatchSelection`, `disposeBatchDialog`,
 * `batchNoticeLift`, `runBatchTransaction` — and `GalleryView` now calls them.
 * Driving a seam here therefore drives the shipped decision. What still needs a
 * running Obsidian is only the plumbing on the other side of those seams: the
 * frontmatter writer, `Notice` timing, and real layout.
 *
 * Geometry that only a browser can measure is asserted against `styles.css`
 * itself — the 320px sheet cannot be laid out here, but the rules that keep it
 * from overflowing can be read and checked.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  BATCH_NOTICE_GAP_PX,
  BATCH_NOTICE_MIN_LIFT_PX,
  BatchGroupMoveError,
  BatchMoveConflictError,
  BatchMoveDestinationError,
  BatchRefreshFreeze,
  MODAL_INERT_REGIONS,
  batchEscapeAction,
  batchInertActive,
  batchModeSurface,
  batchMoveFailureMessage,
  batchMoveSuccessMessage,
  batchNoticeLift,
  describeDestinations,
  disposeBatchDialog,
  executeBatchGroupMove,
  intersectSelection,
  normalizeMoveGroup,
  planBatchGroupMove,
  reconcileBatchSelection,
  rollbackBatchApplied,
  runBatchTransaction,
  type BatchDestinationRow,
  type BatchMoveEntry,
  type BatchMoveOutcome,
  type BatchMovePlan,
  type BatchMoveRollback,
  type BatchMoveWriter,
  type BatchTransactionSteps,
  type BatchWriteResult,
} from "../src/data/batchGroupMove.ts";
// Runtime-import-free too, so the shipped dialog runs here as-is.
import { BatchGroupMoveDialog } from "../src/ui/BatchGroupMoveDialog.ts";
import { groupAddProblem } from "../src/data/groupRename.ts";
import { resolveGroupRouteOrder } from "../src/data/order.ts";

/** A plan built straight from `(path, group)` pairs. */
function plan(
  pairs: [string, string][],
  destination: string,
): BatchMovePlan {
  return planBatchGroupMove(
    pairs.map(([path, group]) => ({ path, group })),
    destination,
  );
}

/** Run a transaction that must fail, and hand back the typed failure. */
async function failedMove(
  built: BatchMovePlan,
  vault: { write: BatchMoveWriter; rollback: BatchMoveRollback },
): Promise<BatchGroupMoveError> {
  const caught = await executeBatchGroupMove(
    built,
    vault.write,
    vault.rollback,
  ).then(
    () => null,
    (error: unknown) => error,
  );
  if (caught instanceof BatchGroupMoveError) return caught;
  throw new Error(`expected BatchGroupMoveError, got ${String(caught)}`);
}

// ── plan ──────────────────────────────────────────────────────────────────

test("plan: an empty selection plans nothing", () => {
  const result = plan([], "주연");
  assert.equal(result.destination, "주연");
  assert.equal(result.total, 0);
  assert.deepEqual(result.moves, []);
  assert.deepEqual(result.alreadyThere, []);
});

test("plan: a full no-op writes nothing and reports every path", () => {
  const result = plan(
    [
      ["a.md", "주연"],
      ["b.md", "주연"],
    ],
    "주연",
  );
  assert.equal(result.total, 2);
  assert.deepEqual(result.moves, []);
  assert.deepEqual(result.alreadyThere, ["a.md", "b.md"]);
});

test("plan: a partial no-op keeps only the notes that move", () => {
  const result = plan(
    [
      ["a.md", "주연"],
      ["b.md", "조연"],
      ["c.md", "주연"],
    ],
    "주연",
  );
  assert.equal(result.total, 3);
  assert.deepEqual(result.alreadyThere, ["a.md", "c.md"]);
  assert.deepEqual(result.moves, [
    { path: "b.md", expectedGroup: "조연", destination: "주연" },
  ]);
});

test("plan: mixed source groups keep input order and carry their own source", () => {
  const result = plan(
    [
      ["c.md", "조연"],
      ["a.md", ""],
      ["b.md", "기타"],
    ],
    "주연",
  );
  assert.deepEqual(
    result.moves.map((entry) => [entry.path, entry.expectedGroup]),
    [
      ["c.md", "조연"],
      ["a.md", ""],
      ["b.md", "기타"],
    ],
  );
});

test("plan: group names normalize, and a duplicate path collapses to its first", () => {
  const result = plan(
    [
      ["a.md", "  조연 "],
      ["a.md", "주연"],
      ["b.md", "조연"],
    ],
    "  주연  ",
  );
  assert.equal(result.destination, "주연");
  assert.equal(result.total, 2);
  assert.deepEqual(result.moves.map((entry) => entry.path), [
    "a.md",
    "b.md",
  ]);
  assert.equal(result.moves[0]?.expectedGroup, "조연");
});

test("plan: an unnamed destination is refused, never planned as 미분류", () => {
  assert.throws(
    () => plan([["a.md", "주연"]], "   "),
    BatchMoveDestinationError,
  );
});

test("normalizeMoveGroup mirrors `그룹` routing normalization", () => {
  assert.equal(normalizeMoveGroup("  주연 "), "주연");
  assert.equal(normalizeMoveGroup(undefined), "");
  assert.equal(normalizeMoveGroup(null), "");
});

// ── execute ───────────────────────────────────────────────────────────────

/** A writer over an in-memory vault, with optional per-path sabotage. */
function fakeVault(
  groups: Record<string, string>,
  opts: {
    failOn?: string;
    rollbackFailOn?: string;
    missing?: string[];
  } = {},
) {
  const writes: string[] = [];
  const rollbacks: string[] = [];
  const missing = new Set(opts.missing ?? []);

  const write = async (entry: BatchMoveEntry): Promise<BatchWriteResult> => {
    if (entry.path === opts.failOn) {
      throw new Error(`write failed: ${entry.path}`);
    }
    if (missing.has(entry.path)) {
      throw new BatchMoveConflictError(entry.path, "노트를 찾지 못했어요");
    }
    const current = groups[entry.path] ?? "";
    if (current === entry.destination) {
      return { changed: false, previousGroup: current };
    }
    if (current !== entry.expectedGroup) {
      throw new BatchMoveConflictError(entry.path, "그룹이 그 사이에 바뀌었어요");
    }
    groups[entry.path] = entry.destination;
    writes.push(entry.path);
    return { changed: true, previousGroup: current };
  };

  const rollback = async (
    entry: BatchMoveEntry,
    previousGroup: string,
  ): Promise<void> => {
    if (entry.path === opts.rollbackFailOn) {
      throw new Error(`rollback failed: ${entry.path}`);
    }
    if (groups[entry.path] !== entry.destination) {
      throw new BatchMoveConflictError(entry.path, "그룹이 또 바뀌었어요");
    }
    groups[entry.path] = previousGroup;
    rollbacks.push(entry.path);
  };

  return { groups, writes, rollbacks, write, rollback };
}

test("execute: success counts only the notes that actually changed", async () => {
  const vault = fakeVault({ "a.md": "조연", "b.md": "주연", "c.md": "기타" });
  // `b.md` is planned (the plan read a stale group) but is already there.
  const built = plan(
    [
      ["a.md", "조연"],
      ["b.md", "조연"],
      ["c.md", "기타"],
    ],
    "주연",
  );
  const outcome = await executeBatchGroupMove(
    built,
    vault.write,
    vault.rollback,
  );
  assert.equal(outcome.attempted, 3);
  assert.equal(outcome.changed, 2);
  assert.deepEqual(vault.writes, ["a.md", "c.md"]);
  assert.deepEqual(outcome.applied, [
    { path: "a.md", previousGroup: "조연", destination: "주연" },
    { path: "c.md", previousGroup: "기타", destination: "주연" },
  ]);
});

test("execute: writes run in plan order", async () => {
  const vault = fakeVault({ "c.md": "기타", "a.md": "기타", "b.md": "기타" });
  const built = plan(
    [
      ["c.md", "기타"],
      ["a.md", "기타"],
      ["b.md", "기타"],
    ],
    "주연",
  );
  await executeBatchGroupMove(built, vault.write, vault.rollback);
  assert.deepEqual(vault.writes, ["c.md", "a.md", "b.md"]);
});

test("execute: a write failure rolls back in exact reverse order", async () => {
  const vault = fakeVault(
    { "a.md": "기타", "b.md": "기타", "c.md": "기타" },
    { failOn: "c.md" },
  );
  const built = plan(
    [
      ["a.md", "기타"],
      ["b.md", "기타"],
      ["c.md", "기타"],
    ],
    "주연",
  );
  const error = await failedMove(built, vault);
  assert.equal(error.failedPath, "c.md");
  assert.equal(error.attempted, 3);
  assert.equal(error.rolledBack, 2);
  assert.deepEqual(error.rollbackFailures, []);
  assert.deepEqual(vault.rollbacks, ["b.md", "a.md"]);
  // Every note is back where it started.
  assert.deepEqual(vault.groups, {
    "a.md": "기타",
    "b.md": "기타",
    "c.md": "기타",
  });
});

test("execute: a later settings failure can unwind every applied note", async () => {
  const vault = fakeVault({ "a.md": "기타", "b.md": "조연" });
  const outcome = await executeBatchGroupMove(
    plan(
      [
        ["a.md", "기타"],
        ["b.md", "조연"],
      ],
      "새 그룹",
    ),
    vault.write,
    vault.rollback,
  );

  // This is the same post-write unwind GalleryView invokes when the single
  // schema/order settings commit fails.
  const failures = await rollbackBatchApplied(outcome.applied, vault.rollback);
  assert.deepEqual(failures, []);
  assert.deepEqual(vault.rollbacks, ["b.md", "a.md"]);
  assert.deepEqual(vault.groups, { "a.md": "기타", "b.md": "조연" });
});

test("settings serialization: competing X/X creation rejects the stale second name", () => {
  let stored = ["기존", ""];
  const persisted = ["기존"];
  const commit = (target: string): boolean => {
    const existing = [...persisted, ...stored];
    if (
      groupAddProblem({
        name: target,
        existing,
        defaultRouteVisible: true,
      })
    ) {
      return false;
    }
    stored = resolveGroupRouteOrder(stored, [...existing, target]);
    persisted.push(target);
    return true;
  };

  assert.equal(commit("X"), true);
  assert.equal(commit("X"), false);
  assert.deepEqual(stored, ["기존", "", "X"]);
  assert.deepEqual(persisted, ["기존", "X"]);
});

test("settings serialization: competing X/Y creation merges the latest order", () => {
  let stored = ["기존", ""];
  const persisted = ["기존"];
  const commit = (target: string): void => {
    const existing = [...persisted, ...stored];
    assert.equal(
      groupAddProblem({
        name: target,
        existing,
        defaultRouteVisible: true,
      }),
      null,
    );
    stored = resolveGroupRouteOrder(stored, [...existing, target]);
    persisted.push(target);
  };

  commit("X");
  commit("Y");
  assert.deepEqual(stored, ["기존", "", "X", "Y"]);
  assert.deepEqual(persisted, ["기존", "X", "Y"]);
});

test("execute: a missing file is a conflict that aborts and unwinds", async () => {
  const vault = fakeVault(
    { "a.md": "기타", "b.md": "기타" },
    { missing: ["b.md"] },
  );
  const built = plan(
    [
      ["a.md", "기타"],
      ["b.md", "기타"],
    ],
    "주연",
  );
  const error = await failedMove(built, vault);
  assert.ok(error.reason instanceof BatchMoveConflictError);
  assert.equal(error.failedPath, "b.md");
  assert.deepEqual(vault.rollbacks, ["a.md"]);
  assert.equal(vault.groups["a.md"], "기타");
});

test("execute: an expected-group mismatch aborts instead of overwriting", async () => {
  // The plan read 「조연」 but the note now says 「기타」 — someone else wrote it.
  const vault = fakeVault({ "a.md": "기타" });
  const built = plan([["a.md", "조연"]], "주연");
  const error = await failedMove(built, vault);
  assert.ok(error.reason instanceof BatchMoveConflictError);
  // Untouched: stale data aborts, it never wins.
  assert.equal(vault.groups["a.md"], "기타");
});

test("execute: a rollback that refuses is reported, and its note stays moved", async () => {
  const vault = fakeVault(
    { "a.md": "기타", "b.md": "기타", "c.md": "기타" },
    { failOn: "c.md", rollbackFailOn: "a.md" },
  );
  const built = plan(
    [
      ["a.md", "기타"],
      ["b.md", "기타"],
      ["c.md", "기타"],
    ],
    "주연",
  );
  const error = await failedMove(built, vault);
  assert.equal(error.rolledBack, 1);
  assert.equal(error.rollbackFailures.length, 1);
  assert.equal(error.rollbackFailures[0]?.path, "a.md");
  assert.equal(vault.groups["a.md"], "주연");
  assert.equal(vault.groups["b.md"], "기타");
});

test("execute: an unchanged note is never rolled back", async () => {
  // `a.md` reports no change, so the failure must not touch it.
  const vault = fakeVault(
    { "a.md": "주연", "b.md": "기타" },
    { failOn: "b.md" },
  );
  const built = plan(
    [
      ["a.md", "조연"],
      ["b.md", "기타"],
    ],
    "주연",
  );
  const error = await failedMove(built, vault);
  assert.deepEqual(vault.rollbacks, []);
  assert.equal(error.rolledBack, 0);
});

test("execute: a plan with no moves writes nothing", async () => {
  const vault = fakeVault({ "a.md": "주연" });
  const built = plan([["a.md", "주연"]], "주연");
  const outcome = await executeBatchGroupMove(
    built,
    vault.write,
    vault.rollback,
  );
  assert.equal(outcome.attempted, 0);
  assert.equal(outcome.changed, 0);
  assert.deepEqual(vault.writes, []);
});

// ── selection scope ───────────────────────────────────────────────────────

test("intersectSelection keeps hidden selections and drops vanished paths", () => {
  const selected = ["b.md", "gone.md", "a.md"];
  // `available` is the whole captured archive — search/chip hide cards, they do
  // not remove them from it.
  const kept = intersectSelection(selected, ["a.md", "b.md", "c.md"]);
  assert.deepEqual(kept, ["a.md", "b.md"]);
});

test("intersectSelection returns scope order, not selection order", () => {
  assert.deepEqual(
    intersectSelection(["c.md", "a.md"], ["a.md", "b.md", "c.md"]),
    ["a.md", "c.md"],
  );
});

// ── destination rows ──────────────────────────────────────────────────────

const memberCounts: Record<string, number> = { 주연: 4, 조연: 2, 기타: 0 };
const countMembers = (group: string) => memberCounts[group] ?? 0;

test("destinations: a full no-op is disabled and says so", () => {
  const rows = describeDestinations(
    ["주연", "조연", "기타"],
    ["주연", "주연"],
    countMembers,
  );
  const 주연 = rows.find((row) => row.group === "주연");
  assert.equal(주연?.eligible, false);
  assert.equal(주연?.meta, "이미 모두 이 그룹에 있어요");
  assert.equal(주연?.total, 4);
});

test("destinations: a partial overlap stays selectable and counts the no-ops", () => {
  const rows = describeDestinations(
    ["주연", "조연", "기타"],
    ["주연", "조연", "조연"],
    countMembers,
  );
  const 주연 = rows.find((row) => row.group === "주연");
  assert.equal(주연?.eligible, true);
  assert.equal(주연?.meta, "선택한 1명은 이미 이 그룹에 있어요");
  const 기타 = rows.find((row) => row.group === "기타");
  assert.equal(기타?.eligible, true);
  assert.equal(기타?.meta, "비어 있는 그룹");
});

test("destinations: a group with cards and no overlap needs no sub-label", () => {
  const rows = describeDestinations(["주연"], ["조연"], countMembers);
  assert.equal(rows[0]?.meta, "");
});

test("destinations: stable group order, deduped, never the unnamed route", () => {
  const rows = describeDestinations(
    ["조연", "", "주연", "조연", "  기타  "],
    [],
    countMembers,
  );
  assert.deepEqual(
    rows.map((row) => row.group),
    ["조연", "주연", "기타"],
  );
  // With nothing selected every named route is still a legal destination.
  assert.ok(rows.every((row) => row.eligible));
});

// ── Escape order ──────────────────────────────────────────────────────────

test("Escape: saving swallows the key", () => {
  assert.equal(
    batchEscapeAction({ saving: true, dialogOpen: true, selecting: true }),
    "consume",
  );
});

test("Escape: the dialog closes before selection mode exits", () => {
  assert.equal(
    batchEscapeAction({ saving: false, dialogOpen: true, selecting: true }),
    "close-dialog",
  );
  assert.equal(
    batchEscapeAction({ saving: false, dialogOpen: false, selecting: true }),
    "exit-selection",
  );
});

test("Escape: nothing batch-owned passes the key on", () => {
  assert.equal(
    batchEscapeAction({ saving: false, dialogOpen: false, selecting: false }),
    "pass",
  );
});

// ── refresh freeze ────────────────────────────────────────────────────────

test("freeze: an unfrozen view refreshes normally", () => {
  const freeze = new BatchRefreshFreeze();
  assert.equal(freeze.active, false);
  assert.equal(freeze.capture(), false);
  assert.equal(freeze.thaw(), false);
});

test("freeze: every request during a transaction collapses into one flush", () => {
  const freeze = new BatchRefreshFreeze();
  freeze.freeze();
  assert.equal(freeze.active, true);
  assert.equal(freeze.capture(), true);
  assert.equal(freeze.capture(), true);
  assert.equal(freeze.capture(), true);
  assert.equal(freeze.pending, true);
  assert.equal(freeze.thaw(), true);
  // Thaw consumes the bit: a second transaction starts clean.
  assert.equal(freeze.active, false);
  assert.equal(freeze.pending, false);
  assert.equal(freeze.thaw(), false);
});

test("freeze: a quiet transaction reports no deferred refresh", () => {
  const freeze = new BatchRefreshFreeze();
  freeze.freeze();
  assert.equal(freeze.thaw(), false);
});

test("freeze: re-freezing drops a stale deferred bit", () => {
  const freeze = new BatchRefreshFreeze();
  freeze.freeze();
  freeze.capture();
  freeze.freeze();
  assert.equal(freeze.pending, false);
});

// ── Notice copy ───────────────────────────────────────────────────────────

test("success Notice counts actual changes, not the selection", () => {
  assert.equal(batchMoveSuccessMessage(1, "주연"), "1명을 주연 그룹으로 옮겼어요.");
  assert.equal(batchMoveSuccessMessage(0, "주연"), "이미 모두 주연 그룹에 있어요.");
});

test("failure Notice distinguishes a clean rollback from a partial one", () => {
  const clean = new BatchGroupMoveError({
    reason: new Error("boom"),
    failedPath: "c.md",
    attempted: 3,
    rolledBack: 2,
    rollbackFailures: [],
  });
  assert.match(clean.message, /boom/);
  assert.match(batchMoveFailureMessage(clean), /모두 원래대로 돌려놓았어요/);

  const partial = new BatchGroupMoveError({
    reason: new Error("boom"),
    failedPath: "c.md",
    attempted: 3,
    rolledBack: 1,
    rollbackFailures: [{ path: "a.md", error: new Error("nope") }],
  });
  assert.match(batchMoveFailureMessage(partial), /1명은 되돌리지 못했어요/);
});

// ── mode surface ──────────────────────────────────────────────────────────
//
// SPEC test 3, first half: selection mode borrows the whole card, so every
// ordinary card affordance and the header's other exit must be off.

const READ = batchModeSurface({ editMode: false, batchMode: false });
const EDIT = batchModeSurface({ editMode: true, batchMode: false });
const PICK = batchModeSurface({ editMode: true, batchMode: true });

test("surface: selection mode binds the pick and nothing else", () => {
  assert.deepEqual(PICK, {
    cardEditActive: false,
    cardPick: true,
    cardDetail: false,
    cardDrag: false,
    cardEditMenu: false,
    cardReadMenu: false,
    cardCoverEdit: false,
    interactiveStatus: false,
    editToggleEnabled: false,
    propertyManageEnabled: false,
    addCardVisible: false,
  });
});

test("surface: the selection icon is the only live exit while selecting", () => {
  // The pencil is the *other* way out of Gallery Edit. Locked here on purpose:
  // two visible exits for one mode is the thing the spec forbids.
  assert.equal(PICK.editToggleEnabled, false);
  assert.equal(EDIT.editToggleEnabled, true);
  assert.equal(READ.editToggleEnabled, true);
});

test("surface: read and edit keep their own card affordances", () => {
  assert.equal(READ.cardDetail, true);
  assert.equal(READ.cardReadMenu, true);
  assert.equal(READ.cardEditMenu, false);
  assert.equal(READ.cardDrag, false);

  assert.equal(EDIT.cardDetail, true);
  assert.equal(EDIT.cardEditMenu, true);
  // Edit mode replaces the read menu, it does not stack a second one.
  assert.equal(EDIT.cardReadMenu, false);
  assert.equal(EDIT.cardDrag, true);
  assert.equal(EDIT.cardCoverEdit, true);
  assert.equal(EDIT.interactiveStatus, true);
});

test("surface: edit and selection never share one affordance", () => {
  for (const editMode of [false, true]) {
    for (const batchMode of [false, true]) {
      const surface = batchModeSurface({ editMode, batchMode });
      const label = `edit=${editMode} batch=${batchMode}`;
      assert.equal(surface.cardPick && surface.cardEditActive, false, label);
      assert.equal(surface.cardPick && surface.cardDetail, false, label);
      assert.equal(surface.cardEditMenu && surface.cardReadMenu, false, label);
      if (!surface.cardPick) continue;
      // Not one edit-side or read-side affordance survives selection mode.
      assert.deepEqual(
        [
          surface.cardDrag,
          surface.cardCoverEdit,
          surface.cardEditMenu,
          surface.cardReadMenu,
          surface.interactiveStatus,
          surface.propertyManageEnabled,
          surface.addCardVisible,
        ],
        [false, false, false, false, false, false, false],
        label,
      );
    }
  }
});

// ── captured scope ────────────────────────────────────────────────────────
//
// SPEC test 3, second half: an archive switch ends the mode; anything else only
// intersects, so search and chips can never silently drop a pick.

const SCOPE = { library: "서재", archive: "판타지" };

test("scope: switching archive tears the mode down instead of re-scoping", () => {
  const verdict = reconcileBatchSelection(
    SCOPE,
    { library: "서재", archive: "무협" },
    ["a.md"],
    ["z.md"],
  );
  assert.deepEqual(verdict, { teardown: true, selection: [] });
});

test("scope: switching library tears the mode down too", () => {
  const verdict = reconcileBatchSelection(
    SCOPE,
    { library: "다른서재", archive: "판타지" },
    ["a.md"],
    ["a.md"],
  );
  assert.equal(verdict.teardown, true);
});

test("scope: a selection with no captured scope cannot survive", () => {
  const verdict = reconcileBatchSelection(null, SCOPE, ["a.md"], ["a.md"]);
  assert.equal(verdict.teardown, true);
});

test("scope: a search-hidden pick stays, a vanished one goes", () => {
  // `scopePaths` is the whole captured archive — search and chips hide cards,
  // they do not remove them from it. Only `gone.md` actually left the vault.
  const verdict = reconcileBatchSelection(
    SCOPE,
    { ...SCOPE },
    ["b.md", "gone.md", "a.md"],
    ["a.md", "b.md", "c.md"],
  );
  assert.deepEqual(verdict, { teardown: false, selection: ["a.md", "b.md"] });
});

test("scope: an out-of-scope record cannot re-enter the selection", () => {
  const verdict = reconcileBatchSelection(
    SCOPE,
    { ...SCOPE },
    ["다른서재/x.md", "a.md"],
    ["a.md"],
  );
  assert.deepEqual(verdict.selection, ["a.md"]);
});

test("scope: a refresh landing mid-write defers, then intersects exactly once", () => {
  // The scenario the lifecycle contract is written for: a note change arrives
  // while the transaction is writing, and the vault it would read is half-done.
  const freeze = new BatchRefreshFreeze();
  let selection = ["a.md", "b.md", "gone.md"];
  const refresh = (scopePaths: string[]): "deferred" | "ran" => {
    if (freeze.capture()) return "deferred";
    selection = reconcileBatchSelection(
      SCOPE,
      { ...SCOPE },
      selection,
      scopePaths,
    ).selection;
    return "ran";
  };

  freeze.freeze();
  // A half-written vault briefly shows one record. It must not be believed.
  assert.equal(refresh(["a.md"]), "deferred");
  assert.equal(refresh(["a.md"]), "deferred");
  assert.deepEqual(selection, ["a.md", "b.md", "gone.md"]);

  assert.equal(freeze.thaw(), true);
  assert.equal(refresh(["b.md", "a.md", "c.md"]), "ran");
  assert.deepEqual(selection, ["b.md", "a.md"]);
});

// ── inert regions ─────────────────────────────────────────────────────────

test("inert: the destination dialog freezes the gallery at every width", () => {
  assert.equal(
    batchInertActive({ isNarrow: false, peekOpen: false, dialogOpen: true }),
    true,
  );
  assert.equal(
    batchInertActive({ isNarrow: true, peekOpen: false, dialogOpen: true }),
    true,
  );
  assert.equal(
    batchInertActive({ isNarrow: true, peekOpen: true, dialogOpen: false }),
    true,
  );
  // Wide + peek is a side panel, not an overlay — nothing is frozen.
  assert.equal(
    batchInertActive({ isNarrow: false, peekOpen: true, dialogOpen: false }),
    false,
  );
  assert.equal(
    batchInertActive({ isNarrow: false, peekOpen: false, dialogOpen: false }),
    false,
  );
  // The bar that opened the dialog is frozen with the rest of the gallery.
  assert.ok(MODAL_INERT_REGIONS.includes(".charinfo-batch-bar"));
});

// ── Notice clearance ──────────────────────────────────────────────────────
//
// SPEC test 6: the phone Notice rail is bottom-anchored, exactly where the
// batch bar sits. The lift is measured, so the guarantee has to be arithmetic.

/** Space actually left between the Notice's top edge and the lifted bar. */
function separation(galleryBottom: number, noticeTop: number): number {
  return batchNoticeLift({ galleryBottom, noticeTop }) - (galleryBottom - noticeTop);
}

test("Notice lift: the bar clears a measured Notice by at least 12px", () => {
  const galleryBottom = 800;
  // One line, two lines, a wrapped error, and fractional device-pixel rects.
  for (const noticeTop of [500, 620, 700, 700.4, 719.9, 764.5, 780, 799]) {
    const gap = separation(galleryBottom, noticeTop);
    assert.ok(
      gap >= BATCH_NOTICE_GAP_PX,
      `noticeTop=${noticeTop} left only ${gap}px`,
    );
  }
});

test("Notice lift: rounding up is what buys the guarantee", () => {
  // 800 - 700.4 + 12 = 111.6. Rounded down the bar would sit 111px up and
  // leave 11.4px — a contract miss that no screenshot would catch.
  assert.equal(batchNoticeLift({ galleryBottom: 800, noticeTop: 700.4 }), 112);
  assert.ok(Math.floor(111.6) - (800 - 700.4) < BATCH_NOTICE_GAP_PX);
});

test("Notice lift: a short Notice still lifts to the stylesheet floor", () => {
  assert.equal(
    batchNoticeLift({ galleryBottom: 800, noticeTop: 795 }),
    BATCH_NOTICE_MIN_LIFT_PX,
  );
});

test("Notice lift: a tall wrapped error Notice lifts past the floor", () => {
  // A rollback-partial message wraps to three lines; the floor is not enough.
  assert.equal(batchNoticeLift({ galleryBottom: 800, noticeTop: 620 }), 192);
  assert.ok(separation(800, 620) >= BATCH_NOTICE_GAP_PX);
});

test("Notice lift: an unmeasurable rect falls back to the floor, never NaN", () => {
  assert.equal(
    batchNoticeLift({ galleryBottom: Number.NaN, noticeTop: 0 }),
    BATCH_NOTICE_MIN_LIFT_PX,
  );
});

// ── transaction lifecycle ─────────────────────────────────────────────────
//
// SPEC test 4: refresh requests during a save collapse into one flush, the
// dialog is disposed before that flush paints, a detached view finishes storage
// without touching its DOM, and a failure keeps the selection.

/** A successful write of `changed` notes. */
function moved(changed: number): {
  outcome: BatchMoveOutcome;
  touchedDisk: boolean;
} {
  return {
    outcome: {
      changed,
      applied: Array.from({ length: changed }, (_, i) => ({
        path: `${i}.md`,
        previousGroup: "기타",
        destination: "주연",
      })),
      attempted: changed,
    },
    touchedDisk: true,
  };
}

/** A plan whose every entry was already there: nothing reached disk. */
function noWrites(): { outcome: BatchMoveOutcome; touchedDisk: boolean } {
  return {
    outcome: { changed: 0, applied: [], attempted: 0 },
    touchedDisk: false,
  };
}

interface RefreshPorts {
  /** Stands in for `GalleryView.refresh()`. */
  requestRefresh: () => void;
  /** Stands in for `GalleryView.handleNoteChanged()`. */
  noteChanged: () => boolean;
}

/**
 * A view stand-in for `runBatchTransaction`, wired to the *real*
 * `BatchRefreshFreeze` and guarded exactly the way `GalleryView.refresh()` and
 * `handleNoteChanged()` guard themselves.
 */
function transactionScene(
  opts: {
    perform?: (
      ports: RefreshPorts,
    ) => Promise<{ outcome: BatchMoveOutcome; touchedDisk: boolean }>;
    alive?: () => boolean;
  } = {},
) {
  const log: string[] = [];
  const freeze = new BatchRefreshFreeze();
  const state = {
    saving: true,
    selecting: true,
    refreshes: 0,
    renders: 0,
    dirty: 0,
    commits: 0,
    failures: [] as unknown[],
    successes: [] as BatchMoveOutcome[],
  };

  const requestRefresh = (): void => {
    if (freeze.capture()) {
      log.push("refresh:deferred");
      return;
    }
    log.push("refresh:ran");
    state.refreshes += 1;
  };
  const noteChanged = (): boolean => {
    if (freeze.capture()) {
      log.push("note:deferred");
      return false;
    }
    log.push("note:patched");
    return true;
  };

  const steps: BatchTransactionSteps = {
    freeze: () => {
      log.push("freeze");
      freeze.freeze();
    },
    perform: async () => {
      log.push("perform");
      return opts.perform
        ? await opts.perform({ requestRefresh, noteChanged })
        : moved(2);
    },
    thaw: () => {
      log.push("thaw");
      return freeze.thaw();
    },
    settle: () => {
      log.push("settle");
      state.saving = false;
    },
    commit: () => {
      log.push("commit");
      state.commits += 1;
    },
    uiAlive: () => (opts.alive ? opts.alive() : true),
    markDirty: () => {
      log.push("markDirty");
      state.dirty += 1;
    },
    closeDialog: () => {
      log.push("closeDialog");
    },
    exitSelection: () => {
      log.push("exitSelection");
      state.selecting = false;
    },
    refresh: async () => {
      requestRefresh();
    },
    render: () => {
      log.push("render");
      state.renders += 1;
    },
    reportFailure: (failure) => {
      log.push("reportFailure");
      state.failures.push(failure);
    },
    reportSuccess: (outcome) => {
      log.push("reportSuccess");
      state.successes.push(outcome);
    },
  };

  return { log, state, steps, requestRefresh, noteChanged };
}

test("lifecycle: every refresh request during the write collapses into one flush", async () => {
  const scene = transactionScene({
    perform: async ({ requestRefresh, noteChanged }) => {
      requestRefresh();
      assert.equal(noteChanged(), false);
      requestRefresh();
      return moved(2);
    },
  });
  const result = await runBatchTransaction(scene.steps);

  assert.equal(result.status, "moved");
  assert.equal(result.flushed, true);
  assert.equal(scene.state.refreshes, 1);
  // Not one intermediate repaint: a render here would tear down the dialog.
  assert.equal(scene.state.renders, 0);
  assert.deepEqual(
    scene.log.filter((entry) => entry.endsWith(":deferred")),
    ["refresh:deferred", "note:deferred", "refresh:deferred"],
  );
  assert.equal(
    scene.log.filter((entry) => entry === "refresh:ran").length,
    1,
  );
});

test("lifecycle: the dialog is disposed before the refresh repaints", async () => {
  const scene = transactionScene({
    perform: async ({ requestRefresh }) => {
      requestRefresh();
      return moved(1);
    },
  });
  await runBatchTransaction(scene.steps);
  const at = (entry: string) => scene.log.indexOf(entry);
  assert.ok(at("closeDialog") > -1 && at("refresh:ran") > -1);
  assert.ok(at("closeDialog") < at("refresh:ran"));
  // The saving lock is released before anything paints or commits, so a
  // repaint can never find the view still locked.
  assert.ok(at("settle") < at("commit"));
  assert.ok(at("settle") < at("closeDialog"));
});

test("lifecycle: a schema preflight failure flushes once and keeps the selection", async () => {
  const boom = new Error("그룹 스키마를 저장하지 못했어요");
  const scene = transactionScene({
    perform: async () => {
      throw boom;
    },
  });
  const result = await runBatchTransaction(scene.steps);

  assert.equal(result.status, "failed");
  // Zero notes were touched, yet the contract still wants one authoritative
  // read from disk before the selection is handed back.
  assert.equal(result.flushed, true);
  assert.equal(scene.state.refreshes, 1);
  assert.equal(scene.state.renders, 0);
  assert.equal(scene.state.selecting, true);
  assert.equal(scene.state.commits, 0);
  assert.deepEqual(scene.state.failures, [boom]);
  assert.equal(scene.log.includes("exitSelection"), false);
  assert.equal(scene.state.saving, false);
});

test("lifecycle: a rollback-partial failure keeps the selection for a retry", async () => {
  const failure = new BatchGroupMoveError({
    reason: new Error("boom"),
    failedPath: "c.md",
    attempted: 3,
    rolledBack: 1,
    rollbackFailures: [{ path: "a.md", error: new Error("nope") }],
  });
  const scene = transactionScene({
    perform: async () => {
      throw failure;
    },
  });
  const result = await runBatchTransaction(scene.steps);

  assert.equal(result.status, "failed");
  assert.equal(result.failure, failure);
  assert.equal(scene.state.selecting, true);
  assert.equal(scene.state.refreshes, 1);
  assert.deepEqual(scene.state.successes, []);
});

test("lifecycle: a detached view settles storage and never touches its DOM", async () => {
  const scene = transactionScene({
    perform: async ({ requestRefresh }) => {
      // onUnloadFile fired mid-write; the writes still finished.
      requestRefresh();
      return moved(2);
    },
    alive: () => false,
  });
  const result = await runBatchTransaction(scene.steps);

  assert.equal(result.status, "detached");
  assert.equal(result.flushed, false);
  assert.deepEqual(scene.log, [
    "freeze",
    "perform",
    "refresh:deferred",
    "thaw",
    "settle",
    "commit",
    "markDirty",
  ]);
  // No close, no refresh, no render, no Notice — the DOM is gone.
  assert.equal(scene.state.refreshes, 0);
  assert.equal(scene.state.renders, 0);
  assert.deepEqual(scene.state.successes, []);
  assert.equal(scene.state.dirty, 1);
  // The lock is still released: a reused view must not start out frozen.
  assert.equal(scene.state.saving, false);
});

test("lifecycle: a detached no-op leaves no dirty bit behind", async () => {
  const scene = transactionScene({
    perform: async () => noWrites(),
    alive: () => false,
  });
  const result = await runBatchTransaction(scene.steps);
  assert.equal(result.status, "detached");
  assert.equal(scene.state.dirty, 0);
});

test("lifecycle: a quiet no-op renders instead of re-reading disk", async () => {
  const scene = transactionScene({ perform: async () => noWrites() });
  const result = await runBatchTransaction(scene.steps);

  assert.equal(result.status, "moved");
  assert.equal(result.flushed, false);
  assert.equal(scene.state.renders, 1);
  assert.equal(scene.state.refreshes, 0);
  assert.equal(scene.state.selecting, false);
  assert.deepEqual(scene.state.successes, [
    { changed: 0, applied: [], attempted: 0 },
  ]);
});

test("lifecycle: a refresh deferred by a no-op transaction still flushes once", async () => {
  const scene = transactionScene({
    perform: async ({ requestRefresh }) => {
      requestRefresh();
      return noWrites();
    },
  });
  const result = await runBatchTransaction(scene.steps);
  assert.equal(result.flushed, true);
  assert.equal(scene.state.refreshes, 1);
  assert.equal(scene.state.renders, 0);
});

test("lifecycle: success exits selection and reports the actual changed count", async () => {
  const scene = transactionScene({ perform: async () => moved(3) });
  await runBatchTransaction(scene.steps);
  assert.equal(scene.state.selecting, false);
  assert.equal(scene.state.commits, 1);
  assert.equal(scene.state.successes[0]?.changed, 3);
  assert.deepEqual(scene.state.failures, []);
});

// ── fake DOM ──────────────────────────────────────────────────────────────
//
// Just wide enough for the real `BatchGroupMoveDialog`: Obsidian's element
// helpers, a document with capture-phase keydown, and the two focus refusals
// the contract leans on (`disabled` and `inert`).

interface FakeEvent {
  key?: string;
  shiftKey: boolean;
  defaultPrevented: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

function fakeEvent(init: { key?: string; shiftKey?: boolean } = {}): FakeEvent {
  const event: FakeEvent = {
    key: init.key,
    shiftKey: init.shiftKey ?? false,
    defaultPrevented: false,
    preventDefault: () => {
      event.defaultPrevented = true;
    },
    stopPropagation: () => {},
  };
  return event;
}

type FakeListener = (event: FakeEvent) => void;

interface DomInfo {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
}

/** `data-group` → `group`, the one dataset key the dialog reads. */
function datasetKey(name: string): string {
  return name.slice(5).replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

function matchesPart(node: FakeNode, part: string): boolean {
  if (part.startsWith("[")) {
    const inner = part.slice(1, -1);
    const eq = inner.indexOf("=");
    if (eq < 0) return node.hasAttribute(inner);
    return (
      node.getAttribute(inner.slice(0, eq)) ===
      inner.slice(eq + 1).replace(/^["']|["']$/g, "")
    );
  }
  if (part.startsWith(".")) return node.classes.has(part.slice(1));
  return node.tagName === part.toUpperCase();
}

class FakeNode {
  readonly tagName: string;
  readonly children: FakeNode[] = [];
  readonly classes = new Set<string>();
  readonly attrs = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly classList = { contains: (name: string) => this.classes.has(name) };
  parent: FakeNode | null = null;
  /** Only the harness root is connected; everything else inherits from it. */
  isRoot = false;
  textContent = "";
  value = "";
  disabled = false;
  private readonly handlers = new Map<string, FakeListener[]>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get isConnected(): boolean {
    for (let node: FakeNode | null = this; node; node = node.parent) {
      if (node.isRoot) return true;
    }
    return false;
  }

  createDiv(info?: DomInfo): FakeNode {
    return this.appendNew("div", info);
  }

  createSpan(info?: DomInfo): FakeNode {
    return this.appendNew("span", info);
  }

  createEl(tag: string, info?: DomInfo): FakeNode {
    return this.appendNew(tag, info);
  }

  private appendNew(tag: string, info?: DomInfo): FakeNode {
    const child = tag === "button" ? new FakeButton() : new FakeNode(tag);
    child.parent = this;
    this.children.push(child);
    if (info?.cls) {
      for (const name of info.cls.split(/\s+/)) if (name) child.classes.add(name);
    }
    if (info?.text != null) child.textContent = info.text;
    for (const [key, value] of Object.entries(info?.attr ?? {})) {
      child.setAttribute(key, String(value));
    }
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
    if (name === "value") this.value = value;
    if (name.startsWith("data-")) this.dataset[datasetKey(name)] = value;
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
    if (name.startsWith("data-")) delete this.dataset[datasetKey(name)];
  }

  addClass(...names: string[]): void {
    for (const name of names) this.classes.add(name);
  }

  removeClass(...names: string[]): void {
    for (const name of names) this.classes.delete(name);
  }

  toggleClass(name: string, on: boolean): void {
    if (on) this.classes.add(name);
    else this.classes.delete(name);
  }

  setText(text: string): void {
    this.textContent = text;
  }

  empty(): void {
    for (const child of this.children) child.parent = null;
    this.children.length = 0;
  }

  remove(): void {
    const parent = this.parent;
    if (!parent) return;
    const at = parent.children.indexOf(this);
    if (at >= 0) parent.children.splice(at, 1);
    this.parent = null;
  }

  contains(other: FakeNode | null): boolean {
    for (let node = other; node; node = node.parent) {
      if (node === this) return true;
    }
    return false;
  }

  /**
   * The two refusals the dialog and the close order depend on: a `disabled`
   * control and anything inside an `inert` subtree swallow focus silently.
   */
  focus(): void {
    if (this.disabled) return;
    for (let node: FakeNode | null = this; node; node = node.parent) {
      if (node.hasAttribute("inert")) return;
    }
    fakeDoc.activeElement = this;
  }

  descendants(): FakeNode[] {
    const out: FakeNode[] = [];
    const walk = (node: FakeNode): void => {
      for (const child of node.children) {
        out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  /** Tree order, deduped, over a comma-separated list of simple selectors. */
  querySelectorAll(selector: string): FakeNode[] {
    const parts = selector
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    return this.descendants().filter((node) =>
      parts.some((part) => matchesPart(node, part)),
    );
  }

  querySelector(selector: string): FakeNode | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  addEventListener(type: string, handler: FakeListener): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  removeEventListener(type: string, handler: FakeListener): void {
    const list = this.handlers.get(type);
    if (!list) return;
    const at = list.indexOf(handler);
    if (at >= 0) list.splice(at, 1);
  }

  /**
   * Dispatch without bubbling — every handler the dialog registers is direct.
   * This ignores `disabled`, which is the point: a few tests below need to
   * prove the guard *inside* a handler, not the browser's guard around it.
   */
  dispatch(type: string, event: FakeEvent = fakeEvent()): FakeEvent {
    for (const handler of [...(this.handlers.get(type) ?? [])]) handler(event);
    return event;
  }

  /** What a user can actually do: a disabled control takes no click. */
  click(): FakeEvent {
    const event = fakeEvent();
    if (this.disabled) return event;
    return this.dispatch("click", event);
  }
}

class FakeButton extends FakeNode {
  constructor() {
    super("button");
  }
}

class FakeDocument {
  readonly body = new FakeNode("body");
  activeElement: FakeNode | null;
  private readonly handlers = new Map<string, FakeListener[]>();

  constructor() {
    this.body.isRoot = true;
    this.activeElement = this.body;
  }

  addEventListener(type: string, handler: FakeListener): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  removeEventListener(type: string, handler: FakeListener): void {
    const list = this.handlers.get(type);
    if (!list) return;
    const at = list.indexOf(handler);
    if (at >= 0) list.splice(at, 1);
  }

  listenerCount(type: string): number {
    return (this.handlers.get(type) ?? []).length;
  }

  press(key: string, opts: { shiftKey?: boolean } = {}): FakeEvent {
    const event = fakeEvent({ key, shiftKey: opts.shiftKey });
    for (const handler of [...(this.handlers.get("keydown") ?? [])]) {
      handler(event);
    }
    return event;
  }

  reset(): void {
    this.handlers.clear();
    this.body.children.length = 0;
    this.activeElement = this.body;
  }
}

const fakeDoc = new FakeDocument();
Object.assign(globalThis, {
  document: fakeDoc,
  HTMLElement: FakeNode,
  HTMLButtonElement: FakeButton,
});

// ── the real dialog, on the fake DOM ──────────────────────────────────────
//
// SPEC test 5 and the DOM half of test 4.

const COUNTS: Record<string, number> = { 주연: 4, 조연: 2, 기타: 0 };
const rowsFor = (groups: string[], selectedGroups: string[]) =>
  describeDestinations(groups, selectedGroups, (group) => COUNTS[group] ?? 0);

/**
 * A gallery with the three inert regions and a live 그룹 이동 opener, then the
 * real dialog opened over it in `GalleryView`'s order: focus the opener, open,
 * *then* freeze the gallery.
 */
function openScene(
  rows: readonly BatchDestinationRow[],
  opts: {
    selectedCount?: number;
    validateNewGroup?: (name: string) => string | null;
    initialCreateName?: string;
  } = {},
) {
  fakeDoc.reset();
  const root = fakeDoc.body.createDiv({ cls: "charinfo-gallery" });
  const header = root.createDiv({ cls: "charinfo-gallery__header" });
  const main = root.createDiv({ cls: "charinfo-gallery__main" });
  const bar = root.createDiv({ cls: "charinfo-batch-bar" });
  const opener = bar.createEl("button", {
    cls: "charinfo-text-btn charinfo-batch-bar__move",
    text: "그룹 이동",
  });
  opener.focus();

  const events: string[] = [];
  const dialog = new BatchGroupMoveDialog({
    host: root as unknown as HTMLElement,
    selectedCount: opts.selectedCount ?? Math.max(rows.length, 1),
    rows,
    initialCreateName: opts.initialCreateName,
    setIcon: (el, icon) => el.setAttribute("data-icon", icon),
    validateNewGroup: opts.validateNewGroup ?? (() => null),
    onCancel: () => events.push("cancel"),
    onConfirm: (destination) => events.push(`confirm:${destination}`),
    onCreate: (name) => events.push(`create:${name}`),
  });
  dialog.open();

  const setInert = (on: boolean): void => {
    for (const region of [header, main, bar]) {
      if (on) region.setAttribute("inert", "");
      else region.removeAttribute("inert");
    }
  };
  setInert(true);

  const find = (selector: string): FakeNode => {
    const node = root.querySelector(selector);
    assert.ok(node, `missing ${selector}`);
    return node;
  };
  return {
    root,
    opener,
    dialog,
    events,
    setInert,
    find,
    all: (selector: string) => root.querySelectorAll(selector),
    dests: () => root.querySelectorAll(".charinfo-batch-dialog__dest"),
  };
}

test("dialog: 취소 and 이동 are the whole vocabulary — no injected X", () => {
  const scene = openScene(rowsFor(["주연", "조연", "기타"], ["조연"]), {
    selectedCount: 1,
  });
  // Three destinations, 새 그룹 만들기, two footer actions, and the opener.
  assert.equal(scene.all("button").length, 7);
  for (const button of scene.all("button")) {
    const label = [
      button.textContent,
      button.getAttribute("aria-label") ?? "",
      [...button.classes].join(" "),
    ].join(" ");
    assert.ok(!/close|dismiss|닫기/i.test(label), label);
  }
  const dialog = scene.find(".charinfo-batch-dialog");
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(dialog.getAttribute("role"), "dialog");
});

test("dialog: focus opens on the first eligible destination", () => {
  // 주연 is a full no-op, so the initial focus must skip it.
  const scene = openScene(rowsFor(["주연", "조연", "기타"], ["주연", "주연"]), {
    selectedCount: 2,
  });
  const active = fakeDoc.activeElement;
  assert.equal(active?.dataset.group, "조연");
  assert.equal(active?.getAttribute("aria-checked"), "true");
  assert.equal(scene.dests()[0]?.disabled, true);
  assert.equal(scene.dests()[0]?.getAttribute("tabindex"), "-1");
});

test("dialog: Tab is trapped at both ends", () => {
  const scene = openScene(rowsFor(["주연", "조연"], []), { selectedCount: 2 });
  // Tabbable: the chosen radio, 새 그룹 만들기, 취소, 이동. The unchosen row
  // carries tabindex="-1", so Tab never stops on it.
  const chosen = scene.dests()[0];
  assert.equal(scene.dests()[1]?.getAttribute("tabindex"), "-1");
  const cancel = scene.find(".charinfo-batch-dialog__cancel");
  const confirm = scene.find(".charinfo-batch-dialog__confirm");
  assert.equal(fakeDoc.activeElement, chosen);

  confirm.focus();
  const forward = fakeDoc.press("Tab");
  assert.equal(forward.defaultPrevented, true);
  assert.equal(fakeDoc.activeElement, chosen);

  const back = fakeDoc.press("Tab", { shiftKey: true });
  assert.equal(back.defaultPrevented, true);
  assert.equal(fakeDoc.activeElement, confirm);

  // Focus dragged out by any means comes straight back to the first stop.
  fakeDoc.activeElement = fakeDoc.body;
  const recover = fakeDoc.press("Tab");
  assert.equal(recover.defaultPrevented, true);
  assert.equal(fakeDoc.activeElement, chosen);
  assert.equal(cancel.getAttribute("tabindex"), null);
});

test("dialog: arrows move the choice and skip a full no-op row", () => {
  const scene = openScene(rowsFor(["주연", "조연", "기타"], ["조연", "조연"]), {
    selectedCount: 2,
  });
  const [주연, 조연, 기타] = scene.dests();
  assert.equal(조연?.disabled, true);
  assert.equal(fakeDoc.activeElement, 주연);

  const down = fakeDoc.press("ArrowDown");
  assert.equal(down.defaultPrevented, true);
  assert.equal(fakeDoc.activeElement, 기타);
  assert.equal(기타?.getAttribute("aria-checked"), "true");
  assert.equal(주연?.getAttribute("aria-checked"), "false");

  // Two eligible rows, so the next step wraps rather than landing on 조연.
  fakeDoc.press("ArrowDown");
  assert.equal(fakeDoc.activeElement, 주연);
  assert.equal(조연?.getAttribute("aria-checked"), "false");
});

test("dialog: saving locks every control and swallows Tab", () => {
  const scene = openScene(rowsFor(["주연", "조연"], []), { selectedCount: 5 });
  scene.dialog.beginSaving();

  const dialog = scene.find(".charinfo-batch-dialog");
  assert.ok(dialog.classes.has("is-saving"));
  assert.equal(dialog.getAttribute("aria-busy"), "true");
  const saying = scene.find(".charinfo-batch-dialog__saving-text");
  assert.equal(saying.textContent, "5명의 그룹을 바꾸는 중…");
  assert.equal(saying.getAttribute("role"), "status");
  assert.equal(
    scene.find(".charinfo-batch-dialog__saving").getAttribute("aria-hidden"),
    null,
  );

  for (const dest of scene.dests()) assert.equal(dest.disabled, true);
  assert.equal(scene.find(".charinfo-batch-dialog__cancel").disabled, true);
  assert.equal(scene.find(".charinfo-batch-dialog__confirm").disabled, true);

  // Tab is consumed, not trapped: focus must not travel during a write.
  assert.equal(fakeDoc.press("Tab").defaultPrevented, true);
  // `dispatch` on purpose: the guards inside the handlers must hold on their
  // own, so the lock does not depend on the disabled attribute alone.
  scene.find(".charinfo-batch-scrim").dispatch("click");
  scene.find(".charinfo-batch-dialog__cancel").dispatch("click");
  scene.dialog.cancel();
  // …and the write cannot be submitted twice.
  scene.find(".charinfo-batch-dialog__confirm").dispatch("click");
  scene.dests()[0]?.dispatch("click");
  assert.deepEqual(scene.events, []);

  scene.dialog.beginSaving();
  assert.deepEqual(scene.events, []);
});

test("dialog: Escape is not the dialog's to handle, saving or not", () => {
  const scene = openScene(rowsFor(["주연"], []), { selectedCount: 1 });
  // GalleryView owns the order, so the dialog must leave the key untouched —
  // `batchEscapeAction` is the single authority.
  const open = fakeDoc.press("Escape");
  assert.equal(open.defaultPrevented, false);
  assert.deepEqual(scene.events, []);
  assert.equal(scene.dialog.isOpen, true);
  assert.equal(
    batchEscapeAction({ saving: false, dialogOpen: true, selecting: true }),
    "close-dialog",
  );

  scene.dialog.beginSaving();
  assert.equal(fakeDoc.press("Escape").defaultPrevented, false);
  assert.deepEqual(scene.events, []);
  assert.equal(
    batchEscapeAction({ saving: true, dialogOpen: true, selecting: true }),
    "consume",
  );
});

test("dialog: 취소 and the scrim both cancel while idle", () => {
  const scene = openScene(rowsFor(["주연"], []), { selectedCount: 1 });
  scene.find(".charinfo-batch-dialog__cancel").click();
  scene.find(".charinfo-batch-scrim").click();
  assert.deepEqual(scene.events, ["cancel", "cancel"]);
});

test("dialog: 이동 confirms the chosen destination exactly once", () => {
  const scene = openScene(rowsFor(["주연", "조연"], []), { selectedCount: 2 });
  const confirm = scene.find(".charinfo-batch-dialog__confirm");
  assert.equal(confirm.textContent, "2명 옮기기");
  assert.equal(confirm.disabled, false);
  scene.dests()[1]?.click();
  confirm.click();
  assert.deepEqual(scene.events, ["confirm:조연"]);

  // The click is spent the moment saving starts.
  scene.dialog.beginSaving();
  confirm.click();
  assert.deepEqual(scene.events, ["confirm:조연"]);
});

test("dialog: 새 그룹 만들기는 radiogroup 밖의 명확한 다음 단계다", () => {
  const scene = openScene(rowsFor(["주연", "조연"], []), {
    selectedCount: 2,
  });
  const create = scene.find(".charinfo-batch-dialog__create");
  const list = scene.find(".charinfo-batch-dialog__list");
  assert.equal(create.parent, list.parent);
  assert.ok(!list.contains(create));
  assert.equal(
    scene.find(".charinfo-batch-dialog__create-name").textContent,
    "새 그룹 만들기",
  );
  assert.equal(
    scene.find(".charinfo-batch-dialog__create-meta").textContent,
    "이름을 정하고 바로 옮겨요",
  );
  assert.equal(
    scene.find(".charinfo-batch-dialog__create-icon").getAttribute("data-icon"),
    "plus",
  );
  assert.equal(
    scene
      .find(".charinfo-batch-dialog__create-chevron")
      .getAttribute("data-icon"),
    "chevron-right",
  );
});

test("dialog: create state focuses the name and submits a valid name with Enter", () => {
  const scene = openScene(rowsFor(["주연"], []), { selectedCount: 2 });
  scene.find(".charinfo-batch-dialog__create").click();

  const input = scene.find(".charinfo-batch-dialog__input");
  const confirm = scene.find(".charinfo-batch-dialog__confirm");
  assert.equal(fakeDoc.activeElement, input);
  assert.equal(input.getAttribute("placeholder"), "예: 조연");
  assert.equal(confirm.textContent, "만들고 2명 옮기기");
  assert.equal(confirm.disabled, true);
  assert.equal(
    scene.find(".charinfo-batch-dialog__hint").textContent,
    "새 그룹을 만들고 선택한 2명을 바로 옮겨요.",
  );

  input.value = "  새 그룹  ";
  input.dispatch("input");
  assert.equal(confirm.disabled, false);
  const enter = fakeDoc.press("Enter");
  assert.equal(enter.defaultPrevented, true);
  assert.deepEqual(scene.events, ["create:새 그룹"]);
});

test("dialog: create validation distinguishes selectable and no-op duplicates", () => {
  const selectable = openScene(rowsFor(["주연", "조연"], ["주연"]), {
    selectedCount: 2,
  });
  selectable.find(".charinfo-batch-dialog__create").click();
  const selectableInput = selectable.find(".charinfo-batch-dialog__input");
  selectableInput.value = "조연";
  selectableInput.dispatch("input");
  assert.equal(
    selectable.find(".charinfo-batch-dialog__error").textContent,
    "이미 있는 그룹이에요. 그룹 목록에서 선택해 주세요.",
  );
  assert.equal(selectableInput.getAttribute("aria-invalid"), "true");

  const noOp = openScene(rowsFor(["주연"], ["주연", "주연"]), {
    selectedCount: 2,
  });
  noOp.find(".charinfo-batch-dialog__create").click();
  const noOpInput = noOp.find(".charinfo-batch-dialog__input");
  noOpInput.value = "주연";
  noOpInput.dispatch("input");
  assert.equal(
    noOp.find(".charinfo-batch-dialog__error").textContent,
    "선택한 캐릭터가 이미 모두 ‘주연’ 그룹에 있어요. 다른 이름을 입력해 주세요.",
  );
});

test("dialog: canonical name errors stay inline and Back preserves the draft", () => {
  const scene = openScene(rowsFor(["주연"], []), {
    selectedCount: 1,
    validateNewGroup: (name) =>
      name === "금지" ? "이 이름은 사용할 수 없어요." : null,
  });
  scene.find(".charinfo-batch-dialog__create").click();
  let input = scene.find(".charinfo-batch-dialog__input");
  input.value = "금지";
  input.dispatch("input");
  assert.equal(
    scene.find(".charinfo-batch-dialog__error").textContent,
    "이 이름은 사용할 수 없어요.",
  );
  assert.equal(scene.find(".charinfo-batch-dialog__confirm").disabled, true);

  scene.find(".charinfo-batch-dialog__back").click();
  assert.ok(
    fakeDoc.activeElement?.classes.has("charinfo-batch-dialog__create"),
  );
  scene.find(".charinfo-batch-dialog__create").click();
  input = scene.find(".charinfo-batch-dialog__input");
  assert.equal(input.value, "금지");
});

test("dialog: saving in create state locks Back, input, and both footer actions", () => {
  const scene = openScene([], { selectedCount: 3 });
  scene.find(".charinfo-batch-dialog__create").click();
  const input = scene.find(".charinfo-batch-dialog__input");
  input.value = "새 그룹";
  input.dispatch("input");
  scene.dialog.beginSaving();

  assert.equal(scene.find(".charinfo-batch-dialog__back").disabled, true);
  assert.equal(input.disabled, true);
  assert.equal(scene.find(".charinfo-batch-dialog__cancel").disabled, true);
  assert.equal(scene.find(".charinfo-batch-dialog__confirm").disabled, true);
  fakeDoc.press("Enter");
  assert.deepEqual(scene.events, []);
});

test("dialog: a recoverable failure can reopen the create state with its draft", () => {
  const scene = openScene(rowsFor(["주연"], []), {
    selectedCount: 2,
    initialCreateName: "새 그룹",
  });
  const input = scene.find(".charinfo-batch-dialog__input");
  assert.equal(input.value, "새 그룹");
  assert.equal(fakeDoc.activeElement, input);
  assert.equal(
    scene.find(".charinfo-batch-dialog__confirm").textContent,
    "만들고 2명 옮기기",
  );
});

test("dialog: close disposes its document listener and is idempotent", () => {
  const scene = openScene(rowsFor(["주연"], []), { selectedCount: 1 });
  assert.equal(fakeDoc.listenerCount("keydown"), 1);

  scene.dialog.close();
  assert.equal(fakeDoc.listenerCount("keydown"), 0);
  assert.equal(scene.dialog.isOpen, false);
  assert.equal(scene.all(".charinfo-batch-dialog").length, 0);
  assert.equal(scene.all(".charinfo-batch-scrim").length, 0);
  // A key arriving after teardown reaches nothing at all.
  assert.equal(fakeDoc.press("Escape").defaultPrevented, false);

  scene.dialog.close();
  scene.dialog.close({ restoreFocus: true });
  assert.equal(fakeDoc.listenerCount("keydown"), 0);
  assert.deepEqual(scene.events, []);
});

test("close order: focus returns to the opener only after inert is released", () => {
  const scene = openScene(rowsFor(["주연", "조연"], []), { selectedCount: 2 });
  const order: string[] = [];
  disposeBatchDialog({
    dispose: () => {
      order.push("dispose");
      scene.dialog.close();
    },
    releaseInert: () => {
      order.push("releaseInert");
      scene.setInert(false);
    },
    restoreFocus: () => {
      order.push("restoreFocus");
      scene.opener.focus();
    },
  });
  assert.deepEqual(order, ["dispose", "releaseInert", "restoreFocus"]);
  assert.equal(fakeDoc.activeElement, scene.opener);
});

test("close order: restoring focus into a still-inert bar lands nowhere", () => {
  // Why the order above is the contract and not a preference.
  const scene = openScene(rowsFor(["주연", "조연"], []), { selectedCount: 2 });
  const chosen = fakeDoc.activeElement;
  scene.opener.focus();
  assert.notEqual(fakeDoc.activeElement, scene.opener);
  assert.equal(fakeDoc.activeElement, chosen);
});

test("close order: skipping restore leaves focus alone", () => {
  const scene = openScene(rowsFor(["주연"], []), { selectedCount: 1 });
  disposeBatchDialog({
    dispose: () => scene.dialog.close(),
    releaseInert: () => scene.setInert(false),
    restoreFocus: null,
  });
  assert.notEqual(fakeDoc.activeElement, scene.opener);
});

test("dialog: its own restore returns focus to the opener, and skips a detached one", () => {
  const kept = openScene(rowsFor(["주연"], []), { selectedCount: 1 });
  kept.setInert(false);
  kept.dialog.close({ restoreFocus: true });
  assert.equal(fakeDoc.activeElement, kept.opener);

  const lost = openScene(rowsFor(["주연"], []), { selectedCount: 1 });
  lost.setInert(false);
  const chosen = fakeDoc.activeElement;
  lost.opener.remove();
  lost.dialog.close({ restoreFocus: true });
  assert.equal(fakeDoc.activeElement, chosen);
});

test("dialog: no eligible destination keeps the reason and offers 새 그룹 만들기", () => {
  const scene = openScene(rowsFor(["주연"], ["주연", "주연"]), {
    selectedCount: 2,
  });
  const dest = scene.dests()[0];
  assert.equal(dest?.disabled, true);
  assert.equal(
    dest?.querySelector(".charinfo-batch-dialog__dest-meta")?.textContent,
    "이미 모두 이 그룹에 있어요",
  );
  const confirm = scene.find(".charinfo-batch-dialog__confirm");
  assert.equal(confirm.disabled, true);
  // Focus advances to the only productive action — never onto a disabled row.
  assert.ok(
    fakeDoc.activeElement?.classes.has("charinfo-batch-dialog__create"),
  );

  // Even reaching past the disabled attribute, there is nothing to confirm.
  confirm.dispatch("click");
  // The row itself takes no click, so no destination can become chosen.
  dest?.click();
  confirm.dispatch("click");
  // Arrow keys find no eligible row to move to, and 취소 is not one.
  assert.equal(fakeDoc.press("ArrowDown").defaultPrevented, false);
  assert.deepEqual(scene.events, []);
});

test("dialog: an archive with no named group still offers 새 그룹 만들기", () => {
  const scene = openScene([], { selectedCount: 3 });
  assert.equal(scene.dests().length, 0);
  const confirm = scene.find(".charinfo-batch-dialog__confirm");
  assert.equal(confirm.disabled, true);
  confirm.dispatch("click");
  assert.deepEqual(scene.events, []);
  // The radiogroup stays empty; the create action is a button outside it.
  const list = scene.find(".charinfo-batch-dialog__list");
  assert.equal(list.getAttribute("role"), "radiogroup");
  assert.equal(list.children.length, 0);
  const create = scene.find(".charinfo-batch-dialog__create");
  assert.equal(create.parent, list.parent);
  assert.equal(fakeDoc.activeElement, create);
});

test("dialog: two galleries can hold a dialog without colliding label ids", () => {
  const first = openScene(rowsFor(["주연"], []), { selectedCount: 1 });
  const firstId = first.find(".charinfo-batch-dialog").getAttribute(
    "aria-labelledby",
  );
  const second = openScene(rowsFor(["주연"], []), { selectedCount: 1 });
  const secondId = second.find(".charinfo-batch-dialog").getAttribute(
    "aria-labelledby",
  );
  assert.notEqual(firstId, secondId);
  assert.equal(
    second.find(".charinfo-batch-dialog__title").getAttribute("id"),
    secondId,
  );
});

// ── stylesheet geometry ───────────────────────────────────────────────────
//
// SPEC test 5's 320px/no-overflow clause and the CSS half of test 6. Layout
// itself needs a browser; the rules that make the layout safe do not.

// Comments go first: a rule's selector is whatever sits between the previous
// `}` and its own `{`, and a doc comment there would ride along with it.
const CSS_TEXT = readFileSync(
  join(import.meta.dirname, "..", "styles.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Every rule whose selector mentions the batch surface.
 *
 * Innermost-first: the pattern only matches a `{ … }` with no nested braces, so
 * an `@media` wrapper never matches and the rules inside it do.
 */
function batchRules(): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(CSS_TEXT)) != null) {
    const selector = (match[1] ?? "").replace(/\s+/g, " ").trim();
    if (!/charinfo-batch|is-batch/.test(selector)) continue;
    out.push({ selector, body: match[2] ?? "" });
  }
  return out;
}

/**
 * Every declaration written for one selector, base and `@media` alike. Joined
 * rather than picked, so a rule split across a media query still reads whole.
 */
function rule(selector: string): string {
  const bodies = batchRules()
    .filter((entry) => entry.selector === selector)
    .map((entry) => entry.body);
  assert.ok(bodies.length > 0, `no rule for ${selector}`);
  return bodies.join("\n");
}

test("geometry: the batch surface has styles at all", () => {
  // Guards the extractor: a silent zero here would pass every test below.
  assert.ok(batchRules().length > 20);
});

test("geometry: the desktop dialog can never outgrow its gallery", () => {
  const dialog = rule(".charinfo-batch-dialog");
  assert.match(dialog, /width:\s*min\(/);
  assert.match(dialog, /width:\s*min\([^;]*100%/);
  assert.match(dialog, /min-width:\s*0/);
  assert.match(dialog, /overflow:\s*hidden/);
  assert.match(dialog, /max-height:\s*calc\(100%/);
});

test("geometry: at 320px the sheet fills the width edge to edge", () => {
  const sheet = rule(".charinfo-gallery.is-narrow .charinfo-batch-dialog");
  assert.match(sheet, /width:\s*100%/);
  assert.match(sheet, /left:\s*0/);
  assert.match(sheet, /right:\s*0/);
  assert.match(sheet, /bottom:\s*0/);
});

test("geometry: no batch rule reserves more width than a 320px screen has", () => {
  for (const { selector, body } of batchRules()) {
    const decls = body.matchAll(
      /(?:^|[\s;])(min-width|width)\s*:\s*([^;}]+)/g,
    );
    for (const [, prop, raw] of decls) {
      const value = (raw ?? "").trim();
      for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) {
        if (Number(px) <= 320) continue;
        // A wider intrinsic size is only safe inside a `min()` clamp.
        assert.match(
          value,
          /min\(/,
          `${selector} { ${prop}: ${value} } can overflow 320px`,
        );
      }
    }
  }
});

test("geometry: a long destination name wraps instead of widening the row", () => {
  // `nowrap` on the count column is only safe because the text column can
  // shrink to zero and the name itself may break anywhere.
  assert.match(
    rule(".charinfo-batch-dialog__dest"),
    /grid-template-columns:\s*18px minmax\(0, 1fr\) auto/,
  );
  assert.match(rule(".charinfo-batch-dialog__dest"), /white-space:\s*normal/);
  const text = rule(".charinfo-batch-dialog__dest-text");
  assert.match(text, /min-width:\s*0/);
  assert.match(text, /white-space:\s*normal/);
  assert.match(
    rule(".charinfo-batch-dialog__dest-name"),
    /overflow-wrap:\s*anywhere/,
  );
  assert.match(
    rule(".charinfo-batch-dialog__dest-meta"),
    /overflow-wrap:\s*anywhere/,
  );
  assert.match(
    rule(".charinfo-batch-dialog__dest-total"),
    /white-space:\s*nowrap/,
  );
});

test("geometry: the bar wraps rather than overflowing a narrow screen", () => {
  assert.match(rule(".charinfo-batch-bar"), /flex-wrap:\s*wrap/);
  assert.match(rule(".charinfo-batch-bar__count"), /min-width:\s*0/);
  assert.match(rule(".charinfo-batch-bar__actions"), /min-width:\s*0/);
  const narrow = rule(".charinfo-gallery.is-narrow .charinfo-batch-bar");
  assert.match(narrow, /width:\s*auto/);
  assert.match(narrow, /max-width:\s*none/);
});

test("geometry: destination rows keep the 44px touch row", () => {
  const dest = rule(".charinfo-batch-dialog__dest");
  assert.match(dest, /min-height:\s*44px/);
  assert.match(dest, /height:\s*auto/);
});

test("geometry: destination rows separate by 8px and keep a 16px shell edge", () => {
  const list = rule(".charinfo-batch-dialog__list");
  assert.match(list, /display:\s*flex/);
  assert.match(list, /flex-direction:\s*column/);
  assert.match(list, /gap:\s*var\(--charinfo-space-md\)/);
  assert.match(list, /padding:\s*var\(--charinfo-space-xs\)/);

  const dest = rule(".charinfo-batch-dialog__dest");
  assert.match(
    dest,
    /padding:\s*var\(--charinfo-space-md\)\s+var\(--charinfo-space-base\)/,
  );
  assert.match(dest, /scroll-margin:\s*var\(--charinfo-space-xs\)/);

});

test("geometry: create controls keep safe width, alignment, and touch size", () => {
  const create = rule(".charinfo-batch-dialog__create");
  assert.match(create, /width:\s*auto/);
  assert.match(create, /min-height:\s*44px/);
  assert.match(
    create,
    /margin:\s*0 var\(--charinfo-space-xs\) var\(--charinfo-space-xs\)/,
  );
  assert.match(rule(".charinfo-batch-dialog__back"), /min-height:\s*44px/);
  assert.match(rule(".charinfo-batch-dialog__input"), /height:\s*44px/);
  assert.match(rule(".charinfo-batch-dialog__form"), /min-width:\s*0/);
  assert.match(rule(".charinfo-batch-dialog__confirm"), /white-space:\s*normal/);
});

test("geometry: the narrow sheet and bar respect the safe area", () => {
  assert.match(
    rule(".charinfo-gallery.is-narrow .charinfo-batch-bar"),
    /env\(safe-area-inset-bottom/,
  );
  assert.match(
    rule(".charinfo-gallery.is-narrow .charinfo-batch-dialog__foot"),
    /env\(safe-area-inset-bottom/,
  );
  // The grid reserves clearance equal to the bar's own footprint.
  assert.match(
    rule(".charinfo-gallery.is-narrow.is-batch .charinfo-gallery__main"),
    /padding-bottom:\s*calc\(\s*64px/,
  );
});

test("geometry: the stylesheet consumes the measured lift with the same floor", () => {
  const lifted = rule(
    ".charinfo-gallery.is-narrow.is-batch-notice .charinfo-batch-bar",
  );
  assert.match(
    lifted,
    new RegExp(
      `bottom:\\s*var\\(--charinfo-batch-notice-lift, ${BATCH_NOTICE_MIN_LIFT_PX}px\\)`,
    ),
  );
});

test("geometry: reduced motion drops the scrim, sheet, and spinner animation", () => {
  const still = batchRules().filter((entry) =>
    /animation:\s*none/.test(entry.body),
  );
  assert.ok(
    still.some((entry) => entry.selector.includes(".charinfo-batch-scrim")),
  );
  assert.ok(
    still.some((entry) =>
      entry.selector.includes(".charinfo-gallery.is-narrow .charinfo-batch-dialog"),
    ),
  );
  assert.ok(
    still.some((entry) =>
      entry.selector.includes(".charinfo-batch-dialog__spinner"),
    ),
  );
});

test("geometry: focus stays visible on a destination row", () => {
  assert.match(
    rule(".charinfo-batch-dialog__dest:focus-visible"),
    /outline:\s*2px solid/,
  );
});
