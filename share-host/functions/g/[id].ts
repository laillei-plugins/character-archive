import {
  isValidShareId,
  PUBLIC_PAGE_HEADERS,
  routeId,
  type Env,
} from "../_lib/share";

export const onRequestGet: PagesFunction<Env, "id"> = async ({ env, params }) => {
  const id = routeId(params.id);
  if (!isValidShareId(id)) return new Response("Not found", { status: 404 });
  const html = await env.GALLERIES.get(`g:${id}`);
  if (html == null) return new Response("Not found", { status: 404 });
  return new Response(html, {
    status: 200,
    headers: PUBLIC_PAGE_HEADERS,
  });
};
