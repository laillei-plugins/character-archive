import {
  authorizeUpload,
  isCharacterArchiveHtml,
  maxBytes,
  parseTtl,
  randomHexToken,
  ttlSeconds,
  type Env,
} from "../../../_lib/share";

/**
 * POST /api/v1/share — create a new share. Returns manageKey once (keep in Obsidian).
 * @param {{ request: Request, env: Env }} context
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!authorizeUpload(request, env)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const buf = await request.arrayBuffer();
  if (!buf.byteLength) {
    return Response.json({ ok: false, error: "empty body" }, { status: 400 });
  }
  if (buf.byteLength > maxBytes(env)) {
    return Response.json({ ok: false, error: "too large" }, { status: 413 });
  }

  const ttl = parseTtl(request.headers.get("x-charinfo-ttl"));
  const seconds = ttlSeconds(ttl);
  const id = randomHexToken(16);
  const manageKey = randomHexToken(32);
  const html = new TextDecoder().decode(buf);
  if (!isCharacterArchiveHtml(html)) {
    return Response.json(
      { ok: false, error: "invalid Character Archive share" },
      { status: 400 },
    );
  }
  const expiresAt =
    ttl === "permanent" ? null : new Date(Date.now() + seconds * 1000).toISOString();

  await env.GALLERIES.put(`g:${id}`, html, {
    expirationTtl: seconds,
    metadata: {
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
    manageKey,
    expiresAt,
    ttl,
  });
};
