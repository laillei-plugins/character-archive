# Character Archive — share host

Optional Cloudflare host for public gallery HTML.

## Upload auth

- **No `UPLOAD_KEY` secret** → anyone can **create** a share (plugin default).
- **`UPLOAD_KEY` set** → create requires `Authorization: Bearer <key>` (self-hosted lock).
- Update/delete always need the per-share `manageKey` (or the upload key when set).

```bash
# Optional — only if you want to lock creates on your own host
npx wrangler secret put UPLOAD_KEY
```

Do not bake a shared secret into the distributed plugin.

## API

- `POST /api/v1/share` — create
- `GET /g/:id` — public HTML
- Storage: Workers KV (`GALLERIES`)

Set `PUBLIC_ORIGIN` if the public URL is not the worker origin.

TTL `permanent` is stored for one year (KV limit). Label it honestly in the UI as 상시 / 1 year.

## Deploy

Point `wrangler.toml` at your own KV namespace, then deploy. The plugin default public origin is `https://character-archive.pages.dev`.
