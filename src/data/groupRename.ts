// @ts-expect-error TS5097: native Node TS tests require explicit extensions.
import { t } from "../i18n/index.ts";
/** The default route's visible name. A named group may never claim it. */
export const DEFAULT_ROUTE_LABEL = "기본";

/** Storage-only identity used for the empty route's position. */
const DEFAULT_ROUTE_TOKEN = "__charinfo:default__";

function isReservedRouteName(name: string): boolean {
  return name === DEFAULT_ROUTE_LABEL || name === DEFAULT_ROUTE_TOKEN;
}

export type GroupRenameProblem =
  | "empty"
  | "unnamed-source"
  | "duplicate"
  | "reserved";

export function normalizeRenameInput(raw: string): string {
  return String(raw ?? "").trim();
}

export function groupRenameProblem(input: {
  from: string;
  to: string;
  existing: readonly string[];
  /**
   * The caller can rename the default route (the group drawer can; the
   * gallery's per-section pencil cannot, because it only exists on a named
   * header).
   */
  allowDefaultSource?: boolean;
  /** A visible 기본 chip is on screen, so that label is taken. */
  defaultRouteVisible?: boolean;
}): GroupRenameProblem | null {
  const from = normalizeRenameInput(input.from);
  const to = normalizeRenameInput(input.to);
  if (!from && !input.allowDefaultSource) return "unnamed-source";
  if (!to) return "empty";
  if (from === to) return null;
  if (input.defaultRouteVisible && isReservedRouteName(to)) return "reserved";
  const occupied = new Set(input.existing.map(normalizeRenameInput).filter(Boolean));
  occupied.delete(from);
  return occupied.has(to) ? "duplicate" : null;
}

/** Same vocabulary, for a group that does not exist yet. */
export function groupAddProblem(input: {
  name: string;
  existing: readonly string[];
  defaultRouteVisible?: boolean;
}): GroupRenameProblem | null {
  const name = normalizeRenameInput(input.name);
  if (!name) return "empty";
  if (input.defaultRouteVisible && isReservedRouteName(name)) {
    return "reserved";
  }
  const occupied = new Set(input.existing.map(normalizeRenameInput).filter(Boolean));
  return occupied.has(name) ? "duplicate" : null;
}

export function groupRenameErrorMessage(problem: GroupRenameProblem): string {
  if (problem === "empty") return t("enterAName");
  if (problem === "duplicate") {
    return t("aGroupWithThisNameAlreadyExistsEnter");
  }
  if (problem === "reserved") {
    return t("valueIsReservedForTheDefaultGroupEnter", { arg1: DEFAULT_ROUTE_LABEL });
  }
  return t("theDefaultRouteIsNotAGroupAnd");
}

export function groupRenameSuccessMessage(
  from: string,
  to: string,
  notes: number,
): string {
  const suffix = notes > 0 ? t("valueNotes", { arg1: notes }) : t("emptyGroup2");
  const source = normalizeRenameInput(from) || DEFAULT_ROUTE_LABEL;
  return t("renamedGroupValueToValueValue", { arg1: source, arg2: normalizeRenameInput(to), arg3: suffix });
}

/** Replace a group identity without moving its position in the list. */
export function renameGroupOrderList(
  order: readonly string[],
  from: string,
  to: string,
): string[] {
  const source = normalizeRenameInput(from);
  const target = normalizeRenameInput(to);
  if (!source || !target || source === target) return [...order];
  return order.map((name) =>
    normalizeRenameInput(name) === source ? target : name,
  );
}
