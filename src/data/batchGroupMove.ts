/**
 * 여러 캐릭터를 한 번에 다른 그룹으로 — plan, execute, rollback.
 *
 * This is the whole decision layer of the batch group move: which notes need a
 * write, in which order, what the destination rows say, and what happens when a
 * write fails halfway. Nothing here touches the DOM, Obsidian, or settings, so
 * the transaction contract can be frozen by tests instead of by hand-running
 * the gallery.
 *
 * Three rules shape every signature below:
 * - **Order is the contract.** Writes run sequentially in input order and roll
 *   back in exact reverse order, so a partial failure unwinds the way it wound.
 * - **Expected group, not current group.** Every entry carries the source group
 *   the plan was built from. The writer must refuse a note that moved under it;
 *   stale data aborts rather than overwrites (`BatchMoveConflictError`).
 * - **Only real changes count.** A note already in the destination is a no-op,
 *   never a write, and never part of the success count.
 *
 * This file imports nothing — `node --test` runs it straight from TypeScript
 * (see `tests/batch-group-move.test.ts`). Keep it that way: a relative import
 * without a `.ts` extension cannot load under Node's test runner.
 */

/** Same normalization `그룹` routing uses everywhere else (`normalizeGroupKey`). */
export function normalizeMoveGroup(raw: unknown): string {
  return String(raw ?? "").trim();
}

/** One selected card, with the group it carries right now. */
export interface BatchMoveCandidate {
  path: string;
  group: string;
}

/** One planned write. `expectedGroup` is what disk must still say. */
export interface BatchMoveEntry {
  path: string;
  expectedGroup: string;
  destination: string;
}

export interface BatchMovePlan {
  /** Normalized destination — never `""`. */
  destination: string;
  /** Every unique candidate the plan saw. */
  total: number;
  /** Writes to perform, in input order. */
  moves: BatchMoveEntry[];
  /** Paths already routing to the destination, in input order. */
  alreadyThere: string[];
}

/** A destination that is not a named group cannot be planned. */
export class BatchMoveDestinationError extends Error {
  constructor(message = "이동할 그룹을 골라 주세요.") {
    super(message);
    this.name = "BatchMoveDestinationError";
  }
}

/**
 * The note on disk is not what the plan expected (moved, renamed, or gone).
 * The writer raises this instead of overwriting a value it did not read.
 */
export class BatchMoveConflictError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(message);
    this.name = "BatchMoveConflictError";
    this.path = path;
  }
}

/**
 * Split the selection into writes and no-ops, preserving input order.
 *
 * Duplicate paths collapse to their first occurrence, so a selection set and a
 * record list can be zipped without the caller de-duplicating first.
 */
export function planBatchGroupMove(
  candidates: readonly BatchMoveCandidate[],
  destination: string,
): BatchMovePlan {
  const to = normalizeMoveGroup(destination);
  if (!to) throw new BatchMoveDestinationError();

  const moves: BatchMoveEntry[] = [];
  const alreadyThere: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const path = String(candidate.path ?? "");
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const from = normalizeMoveGroup(candidate.group);
    if (from === to) {
      alreadyThere.push(path);
      continue;
    }
    moves.push({ path, expectedGroup: from, destination: to });
  }
  return { destination: to, total: seen.size, moves, alreadyThere };
}

/** What one note write actually did. `changed: false` means it was already there. */
export interface BatchWriteResult {
  changed: boolean;
  previousGroup: string;
}

export type BatchMoveWriter = (
  entry: BatchMoveEntry,
) => Promise<BatchWriteResult>;

/** Best-effort return trip for one note. Throwing is reported, never retried. */
export type BatchMoveRollback = (
  entry: BatchMoveEntry,
  previousGroup: string,
) => Promise<void>;

export interface BatchAppliedMove {
  path: string;
  previousGroup: string;
  destination: string;
}

export interface BatchMoveOutcome {
  /** Notes whose `그룹` value actually changed. */
  changed: number;
  applied: BatchAppliedMove[];
  /** Writes attempted, including the ones that reported no change. */
  attempted: number;
}

export interface BatchRollbackFailure {
  path: string;
  error: unknown;
}

/**
 * A write failed and the already-changed notes were put back. `rollbackFailures`
 * lists the ones that refused — those, and only those, are still moved.
 */
export class BatchGroupMoveError extends Error {
  readonly reason: unknown;
  readonly failedPath: string;
  readonly attempted: number;
  readonly rolledBack: number;
  readonly rollbackFailures: BatchRollbackFailure[];

  constructor(opts: {
    reason: unknown;
    failedPath: string;
    attempted: number;
    rolledBack: number;
    rollbackFailures: BatchRollbackFailure[];
  }) {
    super(
      opts.reason instanceof Error ? opts.reason.message : String(opts.reason),
    );
    this.name = "BatchGroupMoveError";
    this.reason = opts.reason;
    this.failedPath = opts.failedPath;
    this.attempted = opts.attempted;
    this.rolledBack = opts.rolledBack;
    this.rollbackFailures = opts.rollbackFailures;
  }
}

/**
 * Write every planned move in order. On the first failure, reverse-roll back
 * the notes this call actually changed and throw `BatchGroupMoveError`.
 *
 * A note the writer reports as unchanged is not rolled back — nothing was done
 * to it, so touching it again could only introduce a write we never made.
 */
export async function executeBatchGroupMove(
  plan: BatchMovePlan,
  write: BatchMoveWriter,
  rollback: BatchMoveRollback,
): Promise<BatchMoveOutcome> {
  const applied: BatchAppliedMove[] = [];
  let attempted = 0;

  for (const entry of plan.moves) {
    attempted += 1;
    // The handler always throws, so `result` is never the rejected branch.
    const result: BatchWriteResult = await write(entry).catch(
      async (error: unknown): Promise<never> => {
        const failures = await rollbackBatchApplied(applied, rollback);
        throw new BatchGroupMoveError({
          reason: error,
          failedPath: entry.path,
          attempted,
          rolledBack: applied.length - failures.length,
          rollbackFailures: failures,
        });
      },
    );
    if (!result.changed) continue;
    applied.push({
      path: entry.path,
      previousGroup: normalizeMoveGroup(result.previousGroup),
      destination: plan.destination,
    });
  }

  return { changed: applied.length, applied, attempted };
}

/** Reverse-order return trip. Every refusal is collected, never thrown. */
export async function rollbackBatchApplied(
  applied: readonly BatchAppliedMove[],
  rollback: BatchMoveRollback,
): Promise<BatchRollbackFailure[]> {
  const failures: BatchRollbackFailure[] = [];
  for (let i = applied.length - 1; i >= 0; i -= 1) {
    const move = applied[i];
    if (!move) continue;
    try {
      await rollback(
        {
          path: move.path,
          expectedGroup: move.previousGroup,
          destination: move.destination,
        },
        move.previousGroup,
      );
    } catch (error) {
      failures.push({ path: move.path, error });
    }
  }
  return failures;
}

/**
 * Selected paths that still exist in the captured scope, in scope order.
 *
 * A refresh intersects instead of replacing: a card hidden by search or a chip
 * is still in `available`, so typing can never silently drop a selection.
 */
export function intersectSelection(
  selected: Iterable<string>,
  available: Iterable<string>,
): string[] {
  const wanted = new Set(selected);
  const out: string[] = [];
  for (const path of available) {
    if (!wanted.has(path)) continue;
    wanted.delete(path);
    out.push(path);
  }
  return out;
}

/** The `{ library, archive }` a selection was captured against. */
export interface BatchScope {
  library: string;
  archive: string;
}

export interface BatchScopeReconciliation {
  /** The captured archive is gone — selection mode must come down entirely. */
  teardown: boolean;
  /** Paths still inside the captured scope, in scope order. */
  selection: string[];
}

/**
 * What a records change means for a captured selection.
 *
 * Switching library or archive ends the mode outright: the selection belongs to
 * a scope that is no longer on screen. Anything else only intersects, so a card
 * hidden by search or a chip keeps its pick while a vanished one is dropped.
 */
export function reconcileBatchSelection(
  captured: BatchScope | null,
  current: BatchScope,
  selected: Iterable<string>,
  scopePaths: Iterable<string>,
): BatchScopeReconciliation {
  if (
    !captured ||
    captured.library !== current.library ||
    captured.archive !== current.archive
  ) {
    return { teardown: true, selection: [] };
  }
  return {
    teardown: false,
    selection: intersectSelection(selected, scopePaths),
  };
}

/**
 * Which affordances a card and the header rail may carry.
 *
 * The exclusion *is* the interaction contract, so it lives here as one table
 * instead of a dozen inline conditionals: in selection mode a card is a
 * checkbox and nothing else, and the header keeps exactly one live way out —
 * the selection icon itself.
 */
export interface BatchModeSurface {
  /** Card edit affordances as a whole (drag, cover, menu, property controls). */
  cardEditActive: boolean;
  /** The card *is* the checkbox: click and Enter/Space toggle, nothing else. */
  cardPick: boolean;
  /** Card click opens the detail panel. */
  cardDetail: boolean;
  cardDrag: boolean;
  /** Edit-mode card context menu (rename, cover, delete). */
  cardEditMenu: boolean;
  /** Read-mode card context menu — cover discovery only. */
  cardReadMenu: boolean;
  cardCoverEdit: boolean;
  /** Status pills answer a click. */
  interactiveStatus: boolean;
  /** The pencil. Never live while selecting, so it is not a second exit. */
  editToggleEnabled: boolean;
  propertyManageEnabled: boolean;
  addCardVisible: boolean;
}

export function batchModeSurface(state: {
  editMode: boolean;
  batchMode: boolean;
}): BatchModeSurface {
  const cardEditActive = state.editMode && !state.batchMode;
  return {
    cardEditActive,
    cardPick: state.batchMode,
    cardDetail: !state.batchMode,
    cardDrag: cardEditActive,
    cardEditMenu: cardEditActive,
    cardReadMenu: !state.editMode && !state.batchMode,
    cardCoverEdit: cardEditActive,
    interactiveStatus: cardEditActive,
    editToggleEnabled: !state.batchMode,
    propertyManageEnabled: cardEditActive,
    addCardVisible: !state.batchMode,
  };
}

/** One destination row: what it is called, how full it is, how much is a no-op. */
export interface BatchDestinationRow {
  group: string;
  /** Cards this group holds in the captured archive. */
  total: number;
  /** Selected cards already routing here. */
  alreadyThere: number;
  /** False only when the whole selection is already here. */
  eligible: boolean;
  /** Row sub-label, or `""` when the name says everything. */
  meta: string;
}

/**
 * Destination rows in the gallery's stable group order.
 *
 * A full overlap is disabled (there is nothing to move); a partial one stays
 * selectable and says how many are already there, because the rest still move.
 */
export function describeDestinations(
  groups: readonly string[],
  selectedGroups: readonly string[],
  memberCount: (group: string) => number,
): BatchDestinationRow[] {
  const selectedTotal = selectedGroups.length;
  const overlap = new Map<string, number>();
  for (const raw of selectedGroups) {
    const group = normalizeMoveGroup(raw);
    overlap.set(group, (overlap.get(group) ?? 0) + 1);
  }
  const rows: BatchDestinationRow[] = [];
  const seen = new Set<string>();
  for (const raw of groups) {
    const group = normalizeMoveGroup(raw);
    if (!group || seen.has(group)) continue;
    seen.add(group);
    const alreadyThere = overlap.get(group) ?? 0;
    const total = memberCount(group);
    const eligible = selectedTotal === 0 || alreadyThere < selectedTotal;
    rows.push({
      group,
      total,
      alreadyThere,
      eligible,
      meta: destinationMeta({ total, alreadyThere, eligible }),
    });
  }
  return rows;
}

function destinationMeta(row: {
  total: number;
  alreadyThere: number;
  eligible: boolean;
}): string {
  if (!row.eligible) return "이미 모두 이 그룹에 있어요";
  if (row.alreadyThere > 0) {
    return `선택한 ${row.alreadyThere}명은 이미 이 그룹에 있어요`;
  }
  if (row.total === 0) return "비어 있는 그룹";
  return "";
}

/** Success Notice — the number of notes that actually changed, not the selection. */
export function batchMoveSuccessMessage(
  changed: number,
  destination: string,
): string {
  const group = normalizeMoveGroup(destination);
  if (changed === 0) return `이미 모두 ${group} 그룹에 있어요.`;
  return `${changed}명을 ${group} 그룹으로 옮겼어요.`;
}

/**
 * Failure Notice. A clean rollback says so; a partial one names how many notes
 * are still moved, so the user knows the vault is not where they left it.
 */
export function batchMoveFailureMessage(error: BatchGroupMoveError): string {
  const detail = error.message.trim();
  const tail = detail ? ` · ${detail}` : "";
  if (error.rollbackFailures.length > 0) {
    return `그룹을 바꾸지 못했어요 · ${error.rollbackFailures.length}명은 되돌리지 못했어요. 노트를 확인해 주세요.${tail}`;
  }
  return `그룹을 바꾸지 못했어요. 모두 원래대로 돌려놓았어요.${tail}`;
}

export type BatchEscapeAction =
  /** Saving: consume the key and do nothing. */
  | "consume"
  | "close-dialog"
  | "exit-selection"
  /** Nothing batch-owned is open — the view's own Escape order continues. */
  | "pass";

/**
 * Escape priority, exactly: saving wins, then the destination dialog, then
 * selection mode. Anything else is not ours to handle.
 */
export function batchEscapeAction(state: {
  saving: boolean;
  dialogOpen: boolean;
  selecting: boolean;
}): BatchEscapeAction {
  if (state.saving) return "consume";
  if (state.dialogOpen) return "close-dialog";
  if (state.selecting) return "exit-selection";
  return "pass";
}

/**
 * Per-view refresh freeze for the write transaction.
 *
 * The plugin-wide `suppressGalleryRefresh` flag does not stop an external
 * refresh, so it cannot guard a multi-note transaction. This does: while frozen,
 * every refresh request collapses into one deferred bit, and thawing reports
 * whether that bit was ever set. It is deliberately not re-entrant — a second
 * `freeze()` while frozen is a programming error, not a nesting level.
 */
export class BatchRefreshFreeze {
  private frozen = false;
  private deferred = false;

  get active(): boolean {
    return this.frozen;
  }

  get pending(): boolean {
    return this.deferred;
  }

  freeze(): void {
    this.frozen = true;
    this.deferred = false;
  }

  /**
   * Called by every refresh path. True means "record it and return" — the
   * caller must not scan, patch, or render.
   */
  capture(): boolean {
    if (!this.frozen) return false;
    this.deferred = true;
    return true;
  }

  /** Ends the freeze. True when at least one refresh was deferred. */
  thaw(): boolean {
    const pending = this.deferred;
    this.frozen = false;
    this.deferred = false;
    return pending;
  }
}

/**
 * Regions frozen behind a modal surface: the header, the grid, and the batch
 * bar that opened the dialog. Focus must not be returned into any of them while
 * the attribute is still set — `focus()` on an `inert` subtree lands nowhere.
 */
export const MODAL_INERT_REGIONS = [
  ".charinfo-gallery__header",
  ".charinfo-gallery__main",
  ".charinfo-batch-bar",
] as const;

/**
 * Whether the gallery underneath is frozen. The destination dialog is modal at
 * every width, so it freezes the same regions the narrow peek sheet does.
 */
export function batchInertActive(state: {
  isNarrow: boolean;
  peekOpen: boolean;
  dialogOpen: boolean;
}): boolean {
  return (state.isNarrow && state.peekOpen) || state.dialogOpen;
}

/**
 * Close order for the destination dialog, which is the whole reason this is a
 * function: dispose the modal DOM, *then* release `inert`, and only then return
 * focus. Restoring focus first would aim it into a still-inert batch bar and
 * silently drop it on the document.
 */
export function disposeBatchDialog(steps: {
  dispose: () => void;
  releaseInert: () => void;
  restoreFocus?: (() => void) | null;
}): void {
  steps.dispose();
  steps.releaseInert();
  steps.restoreFocus?.();
}

/** Visual separation the batch bar keeps from a native Notice. */
export const BATCH_NOTICE_GAP_PX = 12;

/** Lift floor, matching the stylesheet's `--charinfo-batch-notice-lift` default. */
export const BATCH_NOTICE_MIN_LIFT_PX = 80;

/**
 * How far to lift the batch bar so a measured Notice keeps its clearance.
 *
 * The return value is the bar's `bottom` in px from the gallery's bottom edge.
 * Rounding is deliberately *up*: a fractional measurement rounded down would
 * spend the guarantee, leaving 11.6px where the contract says 12.
 */
export function batchNoticeLift(geometry: {
  galleryBottom: number;
  noticeTop: number;
  gap?: number;
  minLift?: number;
}): number {
  const gap = geometry.gap ?? BATCH_NOTICE_GAP_PX;
  const floor = geometry.minLift ?? BATCH_NOTICE_MIN_LIFT_PX;
  const needed = Math.ceil(geometry.galleryBottom - geometry.noticeTop + gap);
  if (!Number.isFinite(needed)) return floor;
  return Math.max(floor, needed);
}

export type BatchTransactionStatus =
  /** The leaf went away mid-write; storage settled, nothing painted. */
  | "detached"
  | "failed"
  | "moved";

export interface BatchTransactionResult {
  status: BatchTransactionStatus;
  /** True when the one real post-transaction refresh ran. */
  flushed: boolean;
  outcome: BatchMoveOutcome | null;
  failure: unknown;
}

/**
 * The view-side steps of a batch write, in the only order that cannot leave a
 * half-move on screen. Every step is injected so the sequence can be driven
 * without a vault; `GalleryView` supplies the real ones.
 */
export interface BatchTransactionSteps {
  /** Freeze this view's refresh before the first write. */
  freeze: () => void;
  /**
   * Destination-schema preflight plus the note writes. Throwing is the entire
   * failure channel; `touchedDisk` says whether a note write was attempted.
   */
  perform: () => Promise<{ outcome: BatchMoveOutcome; touchedDisk: boolean }>;
  /** Ends the freeze. True when at least one refresh was deferred. */
  thaw: () => boolean;
  /** Saving is over — unlock the mode before anything paints. */
  settle: () => void;
  /** Success only: patch in-memory records and reconcile the destination. */
  commit: (outcome: BatchMoveOutcome) => void;
  /** False once the DOM the transaction started against is gone. */
  uiAlive: () => boolean;
  /** Detached: the vault is settled, so leave only the dirty bit behind. */
  markDirty: () => void;
  /** Dispose the dialog — a refresh must never repaint around a live modal. */
  closeDialog: () => void;
  /** Success only. A failure keeps the selection so it can be retried. */
  exitSelection: () => void;
  /** The single authoritative refresh. */
  refresh: () => Promise<void>;
  /** Repaint without re-reading disk, when nothing needs a flush. */
  render: () => void;
  reportFailure: (failure: unknown) => void;
  reportSuccess: (outcome: BatchMoveOutcome) => void;
}

/**
 * Run the transaction lifecycle.
 *
 * 1. freeze — an external repaint must not land mid-write;
 * 2. perform — preflight, then the sequential writes;
 * 3. thaw and unlock, collapsing every deferred request into one bit;
 * 4. commit in-memory state, success only;
 * 5. if the DOM is gone, leave the dirty bit and stop — the storage guarantee
 *    already finished or rolled back;
 * 6. dispose the dialog, leave selection mode on success, then flush exactly
 *    one refresh (or plain-render when nothing touched disk);
 * 7. report.
 */
export async function runBatchTransaction(
  steps: BatchTransactionSteps,
): Promise<BatchTransactionResult> {
  steps.freeze();

  let outcome: BatchMoveOutcome | null = null;
  let failure: unknown = null;
  /** True once a note write was attempted — disk may differ from `records`. */
  let touchedDisk = false;
  try {
    const done = await steps.perform();
    outcome = done.outcome;
    touchedDisk = done.touchedDisk;
  } catch (error) {
    failure = error;
  }

  const deferred = steps.thaw();
  steps.settle();

  if (!failure && outcome) steps.commit(outcome);

  // A failed schema preflight may not have touched a note, but the contract
  // still requires one authoritative disk refresh before the selection is
  // handed back for a retry.
  const mustFlush = deferred || touchedDisk || failure != null;

  if (!steps.uiAlive()) {
    if (mustFlush) steps.markDirty();
    return { status: "detached", flushed: false, outcome, failure };
  }

  steps.closeDialog();
  if (!failure) steps.exitSelection();
  if (mustFlush) await steps.refresh();
  else steps.render();

  if (failure) {
    steps.reportFailure(failure);
    return { status: "failed", flushed: mustFlush, outcome, failure };
  }
  steps.reportSuccess(outcome ?? { changed: 0, applied: [], attempted: 0 });
  return { status: "moved", flushed: mustFlush, outcome, failure: null };
}
