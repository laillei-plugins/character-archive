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
  if (problem === "empty") return "이름을 입력해 주세요.";
  if (problem === "duplicate") {
    return "이미 같은 이름의 그룹이 있어요. 다른 이름을 입력해 주세요.";
  }
  if (problem === "reserved") {
    return `「${DEFAULT_ROUTE_LABEL}」은 기본 그룹의 이름이라 쓸 수 없어요. 다른 이름을 입력해 주세요.`;
  }
  return "기본은 그룹이 아니라서 이름을 바꿀 수 없어요.";
}

export function groupRenameSuccessMessage(
  from: string,
  to: string,
  notes: number,
): string {
  const suffix = notes > 0 ? `노트 ${notes}개` : "빈 그룹";
  const source = normalizeRenameInput(from) || DEFAULT_ROUTE_LABEL;
  return `「${source}」 그룹 이름을 「${normalizeRenameInput(to)}」로 바꿨어요 · ${suffix}`;
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
