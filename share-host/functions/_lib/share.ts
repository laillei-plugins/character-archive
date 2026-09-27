export interface Env {
  GALLERIES: KVNamespace;
  UPLOAD_KEY?: string;
  MAX_BYTES?: string;
}

export type TtlKind = "7d" | "30d" | "permanent";

const DEFAULT_MAX_BYTES = 20_000_000;

export function maxBytes(env: Env): number {
  const configured = Number(env.MAX_BYTES);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(configured, DEFAULT_MAX_BYTES)
    : DEFAULT_MAX_BYTES;
}

export function parseTtl(raw: string | null): TtlKind {
  if (raw === "7d" || raw === "30d" || raw === "permanent") return raw;
  return "30d";
}

export function ttlSeconds(ttl: TtlKind): number {
  if (ttl === "7d") return 7 * 86400;
  if (ttl === "30d") return 30 * 86400;
  return 365 * 86400;
}

/** Uniform lowercase hex: 16 bytes for ids, 32 bytes for manage keys. */
export function randomHexToken(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function authorizeUpload(request: Request, env: Env): boolean {
  const key = env.UPLOAD_KEY?.trim();
  // No server secret → public create (the distributed plugin has no shared key).
  if (!key) return true;
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return Boolean(match && match[1]?.trim() === key);
}

export function manageKeyFrom(request: Request): string {
  return request.headers.get("x-charinfo-manage-key")?.trim() || "";
}

export function routeId(value: string | string[]): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() || "";
}

export function isValidShareId(id: string): boolean {
  return /^[a-z0-9]{8,64}$/i.test(id);
}

/** Reject accidental arbitrary-file hosting; public create still needs edge rate limiting. */
export function isCharacterArchiveHtml(html: string): boolean {
  const head = html.slice(0, 4096);
  return (
    /^<!DOCTYPE html>/i.test(head) &&
    /<html[^>]+data-charinfo-share="\d+"/i.test(head) &&
    /<meta name="generator" content="charinfo-share\/\d+"\s*\/?>/i.test(head)
  );
}

export const PUBLIC_PAGE_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=300",
  "content-security-policy":
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, noarchive",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};
