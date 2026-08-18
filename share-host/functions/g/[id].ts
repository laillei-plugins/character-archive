/** @param {{ request: Request, env: { GALLERIES: KVNamespace }, params: { id: string } }} context */
export async function onRequestGet({ env, params }) {
  const id = params.id;
  if (!id) return new Response("Not found", { status: 404 });
  const html = await env.GALLERIES.get(`g:${id}`);
  if (html == null) return new Response("Not found", { status: 404 });
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
