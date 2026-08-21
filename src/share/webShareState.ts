export interface VersionedWebShareState {
  htmlVersion: number;
}

export interface LegacyWebShareFields {
  webShareLastUrl: string;
  webShareLastId: string;
  webShareLastManageKey: string;
  webShareLastAt: string;
  webShareHtmlVersion: number;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

/** Separate a character share from the gallery page that launched it. */
export function characterWebShareStatePath(characterPath: string): string {
  const path = normalizePath(characterPath.trim());
  return path ? `@character/${path}` : "";
}

/** A version check must never mutate or discard the share's management key. */
export function isWebShareStateStale(
  state: VersionedWebShareState | null,
  currentHtmlVersion: number,
): boolean {
  return Boolean(state && state.htmlVersion !== currentHtmlVersion);
}

/** Public page origin used by the hosted-share API. */
export function hostedShareBaseFromUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    return /^https?:$/i.test(parsed.protocol) ? parsed.origin : "";
  } catch {
    return "";
  }
}

/** Never send one configured host's bearer secret to a different origin. */
export function uploadKeyForHostedTarget(
  targetBaseUrl: string,
  configuredBaseUrl: string,
  configuredUploadKey: string,
): string | undefined {
  const targetOrigin = hostedShareBaseFromUrl(targetBaseUrl);
  const configuredOrigin = hostedShareBaseFromUrl(configuredBaseUrl);
  const key = configuredUploadKey.trim();
  return key && targetOrigin && targetOrigin === configuredOrigin
    ? key
    : undefined;
}

/** An id/key pair marks a pre-page-scoped credential that must be recovered. */
export function hasUnclaimedLegacyWebShare(
  fields: LegacyWebShareFields,
): boolean {
  return Boolean(
    fields.webShareLastId.trim() && fields.webShareLastManageKey.trim(),
  );
}

/**
 * Refresh the read-only last-link mirror without overwriting an unclaimed
 * legacy credential. The per-page map remains the source of ownership.
 */
export function recordLastShareUnlessLegacy(
  fields: LegacyWebShareFields,
  url: string,
  at: string,
  htmlVersion: number,
): boolean {
  if (hasUnclaimedLegacyWebShare(fields)) return false;
  fields.webShareLastUrl = url.trim();
  fields.webShareLastId = "";
  fields.webShareLastManageKey = "";
  fields.webShareLastAt = at.trim();
  fields.webShareHtmlVersion = htmlVersion;
  return true;
}

/** Clear legacy/mirror fields only when the server-confirmed deletion matches. */
export function clearLastShareIfSameUrl(
  fields: LegacyWebShareFields,
  deletedUrl: string,
): boolean {
  const target = deletedUrl.trim();
  if (!target || fields.webShareLastUrl.trim() !== target) return false;
  fields.webShareLastUrl = "";
  fields.webShareLastId = "";
  fields.webShareLastManageKey = "";
  fields.webShareLastAt = "";
  return true;
}

/**
 * Move one credential record with a note only when the destination is empty.
 * A path collision may make ownership ambiguous, but it must never discard a
 * management key for a public link that can still be live.
 */
export function remapWebShareRecord<T>(
  records: Record<string, T>,
  fromPath: string,
  toPath: string,
): { records: Record<string, T>; changed: boolean } {
  const from = normalizePath(fromPath.trim());
  const to = normalizePath(toPath.trim());
  if (!from || !to || from === to || !(from in records) || to in records) {
    return { records, changed: false };
  }
  const prev = records[from]!;
  const { [from]: _drop, ...rest } = records;
  return { records: { ...rest, [to]: prev }, changed: true };
}
