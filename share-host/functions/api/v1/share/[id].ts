/** @typedef {{ GALLERIES: KVNamespace, UPLOAD_KEY?: string }} Env */

const MAX_BYTES = 12_000_000;

/**
 * @param {string | null} raw
 * @returns {"7d" | "30d" | "permanent"}
 */
function parseTtl(raw) {
  if (raw === "7d" || raw === "30d" || raw === "permanent") return raw;
  return "30d";
}

/** @param {"7d" | "30d" | "permanent"} ttl */
function ttlSeconds(ttl) {
  if (ttl === "7d") return 7 * 86400;
  if (ttl === "30d") return 30 * 86400;
  return 365 * 86400;
}

/**
 * @param {Request} request
 * @param {Env} env
 */
function authorizeUpload(request, env) {
  const key = env.UPLOAD_KEY?.trim();
  if (!key) return false;
  const header = request.headers.get("authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  return Boolean(m && m[1]?.trim() === key);
}

/**
 * @param {Request} request
 */
function manageKeyFrom(request) {
  return (
    request.headers.get("x-charinfo-manage-key")?.trim() ||
    ""
  );
}

/**
 * @param {Request} request
 * @param {Env} env
 * @param {string} id
 */
async function assertCanManage(request, env, id) {
  const meta = await env.GALLERIES.getWithMetadata(`g:${id}`);
  if (meta.value == null) {
    return { ok: false, status: 404, error: "not found", meta: null };
  }
  const stored =
    meta.metadata &&
    typeof meta.metadata === "object" &&
    "manageKey" in meta.metadata
      ? String(/** @type {{ manageKey?: unknown }} */ (meta.metadata).manageKey || "")
      : "";
  const provided = manageKeyFrom(request);
  // Optional site-wide upload key can manage any share.
  if (env.UPLOAD_KEY?.trim() && authorizeUpload(request, env)) {
    return { ok: true, status: 200, error: "", meta };
  }
  if (!stored || !provided || stored !== provided) {
    return { ok: false, status: 401, error: "unauthorized", meta: null };
  }
  return { ok: true, status: 200, error: "", meta };
}

/**
 * PUT /api/v1/share/:id — overwrite HTML; same public URL.
 * @param {{ request: Request, env: Env, params: { id: string } }} context
 */
export async function onRequestPut({ request, env, params }) {
  const id = String(params.id || "").trim();
  if (!/^[a-z0-9]+$/i.test(id)) {
    return Response.json({ ok: false, error: "bad id" }, { status: 400 });
  }

  const gate = await assertCanManage(request, env, id);
  if (!gate.ok) {
    return Response.json({ ok: false, error: gate.error }, { status: gate.status });
  }

  const buf = await request.arrayBuffer();
  if (!buf.byteLength) {
    return Response.json({ ok: false, error: "empty body" }, { status: 400 });
  }
  if (buf.byteLength > MAX_BYTES) {
    return Response.json({ ok: false, error: "too large" }, { status: 413 });
  }

  const prevMeta =
    gate.meta?.metadata && typeof gate.meta.metadata === "object"
      ? /** @type {Record<string, string>} */ (gate.meta.metadata)
      : {};
  const ttl = parseTtl(
    request.headers.get("x-charinfo-ttl") || prevMeta.ttl || "30d",
  );
  const seconds = ttlSeconds(ttl);
  const html = new TextDecoder().decode(buf);
  const expiresAt =
    ttl === "permanent" ? null : new Date(Date.now() + seconds * 1000).toISOString();
  const manageKey = prevMeta.manageKey || manageKeyFrom(request);

  await env.GALLERIES.put(`g:${id}`, html, {
    expirationTtl: seconds,
    metadata: {
      ...prevMeta,
      ttl,
      expiresAt: expiresAt ?? "",
      bytes: String(buf.byteLength),
      manageKey,
      updatedAt: new Date().toISOString(),
    },
  });

  const origin = new URL(request.url).origin;
  return Response.json({
    ok: true,
    id,
    url: `${origin}/g/${id}`,
    expiresAt,
    ttl,
    updated: true,
  });
}

/**
 * DELETE /api/v1/share/:id — unpublish (link 404 afterwards).
 * @param {{ request: Request, env: Env, params: { id: string } }} context
 */
export async function onRequestDelete({ request, env, params }) {
  const id = String(params.id || "").trim();
  if (!/^[a-z0-9]+$/i.test(id)) {
    return Response.json({ ok: false, error: "bad id" }, { status: 400 });
  }

  const gate = await assertCanManage(request, env, id);
  if (!gate.ok) {
    return Response.json({ ok: false, error: gate.error }, { status: gate.status });
  }

  await env.GALLERIES.delete(`g:${id}`);
  return Response.json({ ok: true, id, deleted: true });
}
