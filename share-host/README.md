# Character Archive — share host

Optional Cloudflare host for public gallery HTML.

## Upload auth

- **No `UPLOAD_KEY` secret** → anyone can **create** a share (plugin default).
- **`UPLOAD_KEY` set** → create requires `Authorization: Bearer <key>` (self-hosted lock).
- Update/delete always need the per-share `manageKey` (or the upload key when set).

```bash
# Optional — only if you want to lock creates on your own host
npx wrangler pages secret put UPLOAD_KEY
```

Do not bake a shared secret into the distributed plugin.
The open default service validates the Character Archive document marker, but
operators should also apply a Cloudflare rate-limit rule to `POST /api/v1/share`.

## API

- `POST /api/v1/share` — create
- `PUT /api/v1/share/:id` — update with its management key
- `DELETE /api/v1/share/:id` — stop with its management key
- `GET /g/:id` — public HTML
- Storage: Workers KV (`GALLERIES`)

TTL `permanent` is the backward-compatible wire value for one-year storage. Label it as `1 year` / `1년`, never as permanent.

## Deploy

Point `wrangler.toml` at your own KV namespace, then run `npm run deploy`. The plugin default public origin is `https://character-archive.pages.dev`.
