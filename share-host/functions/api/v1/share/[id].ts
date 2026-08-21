import {
  authorizeUpload,
  isCharacterArchiveHtml,
  isValidShareId,
  manageKeyFrom,
  maxBytes,
  parseTtl,
  routeId,
  ttlSeconds,
  type Env,
} from "../../../_lib/share";

/**
 * @param {Request} request
 * @param {Env} env
 * @param {string} id
 */
async function assertCanManage(request: Request, env: Env, id: string) {
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
export const onRequestPut: PagesFunction<Env, "id"> = async ({
  request,
  env,
  params,
}) => {
  const id = routeId(params.id);
  if (!isValidShareId(id)) {
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
  if (buf.byteLength > maxBytes(env)) {
    return Response.json({ ok: false, error: "too large" }, { status: 413 });
  }

  const prevMeta: Record<string, string> =
    gate.meta?.metadata && typeof gate.meta.metadata === "object"
      ? (gate.meta.metadata as Record<string, string>)
      : {};
  const ttl = parseTtl(
    request.headers.get("x-charinfo-ttl") || prevMeta.ttl || "30d",
  );
  const seconds = ttlSeconds(ttl);
  const html = new TextDecoder().decode(buf);
  if (!isCharacterArchiveHtml(html)) {
    return Response.json(
      { ok: false, error: "invalid Character Archive share" },
      { status: 400 },
    );
  }
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
};

/**
 * DELETE /api/v1/share/:id — unpublish (link 404 afterwards).
 * @param {{ request: Request, env: Env, params: { id: string } }} context
 */
export const onRequestDelete: PagesFunction<Env, "id"> = async ({
  request,
  env,
  params,
}) => {
  const id = routeId(params.id);
  if (!isValidShareId(id)) {
    return Response.json({ ok: false, error: "bad id" }, { status: 400 });
  }

  const gate = await assertCanManage(request, env, id);
  if (!gate.ok) {
    return Response.json({ ok: false, error: gate.error }, { status: gate.status });
  }

  await env.GALLERIES.delete(`g:${id}`);
  return Response.json({ ok: true, id, deleted: true });
};
