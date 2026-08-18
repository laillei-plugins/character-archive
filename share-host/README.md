# Character Archive — share host

Optional Cloudflare host for public gallery HTML. Deploy your own. Do not point other people at an unlocked worker.

## Required secret

```bash
npx wrangler secret put UPLOAD_KEY
```

Uploads fail closed when this secret is missing. Put the same value in the plugin setting **업로드 열쇠**.

## API

- `POST /api/v1/share` — create (Bearer `UPLOAD_KEY`)
- `GET /g/:id` — public HTML
- Storage: Workers KV (`GALLERIES`)

Set `PUBLIC_ORIGIN` if the public URL is not the worker origin.

TTL `permanent` is stored for one year (KV limit). Label it honestly in the UI as 상시 / 1 year.

## Deploy

Point `wrangler.toml` at your own KV namespace, then deploy the Worker or Pages project you actually use. The plugin only needs the public origin + upload key.
