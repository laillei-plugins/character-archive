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

function randomToken(len = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = "";
  for (const b of bytes) out += b.toString(36);
  return out.slice(0, len);
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
 * POST /api/v1/share — create a new share. Returns manageKey once (keep in Obsidian).
 * @param {{ request: Request, env: Env }} context
 */
export async function onRequestPost({ request, env }) {
  if (!authorizeUpload(request, env)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const buf = await request.arrayBuffer();
  if (!buf.byteLength) {
    return Response.json({ ok: false, error: "empty body" }, { status: 400 });
  }
  if (buf.byteLength > MAX_BYTES) {
    return Response.json({ ok: false, error: "too large" }, { status: 413 });
  }

  const ttl = parseTtl(request.headers.get("x-charinfo-ttl"));
  const seconds = ttlSeconds(ttl);
  const id = randomToken(12);
  const manageKey = randomToken(24);
  const html = new TextDecoder().decode(buf);
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
}
