import { requestUrl } from "obsidian";

export type HostedShareTtl = "7d" | "30d" | "permanent";

export interface HostedShareResult {
  url: string;
  id: string;
  /** Returned on create only — store to update/delete the same link. */
  manageKey?: string;
  expiresAt: string | null;
  ttl: HostedShareTtl;
  updated?: boolean;
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function isHostedShareConfigured(baseUrl: string): boolean {
  const base = normalizeBase(baseUrl);
  return /^https?:\/\//i.test(base);
}

export function hostedShareIdFromUrl(url: string): string {
  const m = url.trim().match(/\/g\/([a-z0-9]+)\/?$/i);
  return m?.[1] ?? "";
}

function authHeaders(
  opts: { uploadKey?: string; manageKey?: string; ttl?: HostedShareTtl },
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    "X-Charinfo-TTL": opts.ttl ?? "30d",
  };
  const upload = opts.uploadKey?.trim();
  if (upload) headers.Authorization = `Bearer ${upload}`;
  const manage = opts.manageKey?.trim();
  if (manage) headers["X-Charinfo-Manage-Key"] = manage;
  return headers;
}

function parseResult(
  res: { status: number; json: unknown; text: string },
  fallbackTtl: HostedShareTtl,
): HostedShareResult {
  if (res.status === 401) {
    throw new Error("권한이 없어요. 이 기기에서 만든 링크인지 확인하세요.");
  }
  if (res.status === 404) {
    throw new Error("링크를 찾을 수 없어요. 만료됐거나 이미 중지됐을 수 있어요.");
  }
  if (res.status === 413) {
    throw new Error("갤러리가 너무 커요. 커버를 줄이거나 카드 수를 줄여 보세요.");
  }
  if (res.status >= 400) {
    const msg =
      typeof res.json === "object" &&
      res.json &&
      "error" in (res.json as object)
        ? String((res.json as { error?: unknown }).error)
        : res.text?.slice(0, 200);
    throw new Error(`공유 서버 실패 (${res.status})${msg ? `: ${msg}` : ""}`);
  }

  const data = res.json as {
    ok?: boolean;
    url?: string;
    id?: string;
    manageKey?: string;
    expiresAt?: string | null;
    ttl?: string;
    updated?: boolean;
  };
  if (!data?.ok || !data.url || !data.id) {
    throw new Error("공유 서버 응답이 이상해요.");
  }

  const ttl: HostedShareTtl =
    data.ttl === "7d" || data.ttl === "30d" || data.ttl === "permanent"
      ? data.ttl
      : fallbackTtl;

  return {
    url: data.url,
    id: data.id,
    manageKey:
      typeof data.manageKey === "string" && data.manageKey
        ? data.manageKey
        : undefined,
    expiresAt: data.expiresAt ?? null,
    ttl,
    updated: Boolean(data.updated),
  };
}

/**
 * Create a new hosted share. Returns manageKey — save it to update/delete later.
 */
export async function uploadToHostedShare(
  html: string,
  opts: {
    baseUrl: string;
    uploadKey?: string;
    ttl?: HostedShareTtl;
  },
): Promise<HostedShareResult> {
  const base = normalizeBase(opts.baseUrl);
  if (!isHostedShareConfigured(base)) {
    throw new Error("공유 서버 주소가 없어요. 설정에서 workers.dev URL을 넣으세요.");
  }

  const res = await requestUrl({
    url: `${base}/api/v1/share`,
    method: "POST",
    headers: authHeaders(opts),
    body: html,
    throw: false,
  });

  return parseResult(res, opts.ttl ?? "30d");
}

/** Overwrite an existing share — public URL stays the same. */
export async function updateHostedShare(
  html: string,
  opts: {
    baseUrl: string;
    id: string;
    manageKey: string;
    uploadKey?: string;
    ttl?: HostedShareTtl;
  },
): Promise<HostedShareResult> {
  const base = normalizeBase(opts.baseUrl);
  const id = opts.id.trim();
  if (!isHostedShareConfigured(base) || !id) {
    throw new Error("업데이트할 링크 정보가 없어요.");
  }
  if (!opts.manageKey.trim() && !opts.uploadKey?.trim()) {
    throw new Error("이 링크를 수정할 열쇠가 없어요. 새 링크를 만들어 주세요.");
  }

  const res = await requestUrl({
    url: `${base}/api/v1/share/${encodeURIComponent(id)}`,
    method: "PUT",
    headers: authHeaders(opts),
    body: html,
    throw: false,
  });

  return parseResult(res, opts.ttl ?? "30d");
}

/** Remove a share so the public URL returns 404. */
export async function deleteHostedShare(opts: {
  baseUrl: string;
  id: string;
  manageKey: string;
  uploadKey?: string;
}): Promise<void> {
  const base = normalizeBase(opts.baseUrl);
  const id = opts.id.trim();
  if (!isHostedShareConfigured(base) || !id) {
    throw new Error("중지할 링크 정보가 없어요.");
  }
  if (!opts.manageKey.trim() && !opts.uploadKey?.trim()) {
    throw new Error("이 링크를 중지할 열쇠가 없어요.");
  }

  const headers: Record<string, string> = {};
  const upload = opts.uploadKey?.trim();
  if (upload) headers.Authorization = `Bearer ${upload}`;
  const manage = opts.manageKey.trim();
  if (manage) headers["X-Charinfo-Manage-Key"] = manage;

  const res = await requestUrl({
    url: `${base}/api/v1/share/${encodeURIComponent(id)}`,
    method: "DELETE",
    headers,
    throw: false,
  });

  if (res.status === 401) {
    throw new Error("권한이 없어요. 이 기기에서 만든 링크인지 확인하세요.");
  }
  if (res.status === 404) {
    return; // already gone
  }
  if (res.status >= 400) {
    const msg =
      typeof res.json === "object" &&
      res.json &&
      "error" in (res.json as object)
        ? String((res.json as { error?: unknown }).error)
        : res.text?.slice(0, 200);
    throw new Error(`공유 중지 실패 (${res.status})${msg ? `: ${msg}` : ""}`);
  }
}
