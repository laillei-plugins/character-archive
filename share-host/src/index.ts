/**
 * Character Archive share host — Cloudflare Worker + KV.
 * (KV instead of R2 so free accounts can deploy without enabling R2.)
 */
export interface Env {
  GALLERIES: KVNamespace;
  /** Optional shared secret. If set, uploads require Authorization: Bearer <key>. */
  UPLOAD_KEY?: string;
  /** Public origin override, e.g. https://share.example.com (no trailing slash). */
  PUBLIC_ORIGIN?: string;
  /** Max HTML bytes (default 12_000_000). */
  MAX_BYTES?: string;
}

type TtlKind = "7d" | "30d" | "permanent";

const TTL_SECONDS: Record<TtlKind, number> = {
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
  permanent: 365 * 24 * 60 * 60,
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers":
        "authorization, content-type, x-charinfo-ttl, x-charinfo-manage-key",
      "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    },
  });
}

function cors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers":
          "authorization, content-type, x-charinfo-ttl, x-charinfo-manage-key",
        "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
        "access-control-max-age": "86400",
      },
    });
  }
  return null;
}

function originOf(req: Request, env: Env): string {
  const fromEnv = env.PUBLIC_ORIGIN?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  return new URL(req.url).origin;
}

function parseTtl(raw: string | null): TtlKind {
  if (raw === "7d" || raw === "30d" || raw === "permanent") return raw;
  return "30d";
}

function randomToken(len = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = "";
  for (const b of bytes) out += b.toString(36);
  return out.slice(0, len);
}

function authorizeUpload(req: Request, env: Env): boolean {
  const key = env.UPLOAD_KEY?.trim();
  if (!key) return false;
  const header = req.headers.get("authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  return Boolean(m && m[1]?.trim() === key);
}

function manageKeyFrom(req: Request): string {
  return req.headers.get("x-charinfo-manage-key")?.trim() || "";
}

async function assertCanManage(
  req: Request,
  env: Env,
  id: string,
): Promise<
  | { ok: true; meta: KVNamespaceGetWithMetadataResult<string, unknown> }
  | { ok: false; status: number; error: string }
> {
  const meta = await env.GALLERIES.getWithMetadata(`g:${id}`);
  if (meta.value == null) {
    return { ok: false, status: 404, error: "not found" };
  }
  const stored =
    meta.metadata &&
    typeof meta.metadata === "object" &&
    meta.metadata !== null &&
    "manageKey" in meta.metadata
      ? String((meta.metadata as { manageKey?: unknown }).manageKey || "")
      : "";
  if (env.UPLOAD_KEY?.trim() && authorizeUpload(req, env)) {
    return { ok: true, meta };
  }
  const provided = manageKeyFrom(req);
  if (!stored || !provided || stored !== provided) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  return { ok: true, meta };
}

async function handleCreate(req: Request, env: Env): Promise<Response> {
  if (!authorizeUpload(req, env)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const maxBytes = Number(env.MAX_BYTES) || 12_000_000;
  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0) {
    return json({ ok: false, error: "empty body" }, 400);
  }
  if (buf.byteLength > maxBytes) {
    return json(
      { ok: false, error: `too large (max ${maxBytes} bytes)` },
      413,
    );
  }

  const ttl = parseTtl(req.headers.get("x-charinfo-ttl"));
  const id = randomToken(12);
  const manageKey = randomToken(24);
  const now = Date.now();
  const expirationTtl = TTL_SECONDS[ttl];
  const expiresAt =
    ttl === "permanent"
      ? null
      : new Date(now + expirationTtl * 1000).toISOString();

  const html = new TextDecoder().decode(buf);
  await env.GALLERIES.put(`g:${id}`, html, {
    expirationTtl,
    metadata: {
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      expiresAt: expiresAt ?? "",
      ttl,
      bytes: String(buf.byteLength),
      manageKey,
    },
  });

  const url = `${originOf(req, env)}/g/${id}`;
  return json({ ok: true, id, url, manageKey, expiresAt, ttl });
}

async function handleUpdate(
  req: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const gate = await assertCanManage(req, env, id);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  const maxBytes = Number(env.MAX_BYTES) || 12_000_000;
  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0) {
    return json({ ok: false, error: "empty body" }, 400);
  }
  if (buf.byteLength > maxBytes) {
    return json({ ok: false, error: "too large" }, 413);
  }

  const prevMeta =
    gate.meta.metadata && typeof gate.meta.metadata === "object"
      ? (gate.meta.metadata as Record<string, string>)
      : {};
  const ttl = parseTtl(req.headers.get("x-charinfo-ttl") || prevMeta.ttl || "30d");
  const expirationTtl = TTL_SECONDS[ttl];
  const expiresAt =
    ttl === "permanent"
      ? null
      : new Date(Date.now() + expirationTtl * 1000).toISOString();
  const html = new TextDecoder().decode(buf);
  const manageKey = prevMeta.manageKey || manageKeyFrom(req);

  await env.GALLERIES.put(`g:${id}`, html, {
    expirationTtl,
    metadata: {
      ...prevMeta,
      ttl,
      expiresAt: expiresAt ?? "",
      bytes: String(buf.byteLength),
      manageKey,
      updatedAt: new Date().toISOString(),
    },
  });

  return json({
    ok: true,
    id,
    url: `${originOf(req, env)}/g/${id}`,
    expiresAt,
    ttl,
    updated: true,
  });
}

async function handleDelete(
  req: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const gate = await assertCanManage(req, env, id);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);
  await env.GALLERIES.delete(`g:${id}`);
  return json({ ok: true, id, deleted: true });
}

async function handleGet(
  _req: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const html = await env.GALLERIES.get(`g:${id}`);
  if (html == null) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
    },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const preflight = cors(req);
    if (preflight) return preflight;

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/health" && req.method === "GET") {
      return json({ ok: true, service: "charinfo-share-host", store: "kv" });
    }

    if (path === "/api/v1/share" && req.method === "POST") {
      try {
        return await handleCreate(req, env);
      } catch (error) {
        return json(
          {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
          500,
        );
      }
    }

    const shareId = path.match(/^\/api\/v1\/share\/([a-z0-9]+)$/i);
    if (shareId?.[1]) {
      const id = shareId[1];
      try {
        if (req.method === "PUT") return await handleUpdate(req, env, id);
        if (req.method === "DELETE") return await handleDelete(req, env, id);
      } catch (error) {
        return json(
          {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
          500,
        );
      }
    }

    const gallery = path.match(/^\/g\/([a-z0-9]+)$/i);
    if (gallery?.[1] && req.method === "GET") {
      return handleGet(req, env, gallery[1]);
    }

    if (path === "/" && req.method === "GET") {
      return new Response(
        "Character Archive share host (KV). POST /api/v1/share · PUT/DELETE /api/v1/share/:id · GET /g/:id",
        {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        },
      );
    }

    return json({ ok: false, error: "not found" }, 404);
  },
};
