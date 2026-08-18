# Character Archive

Card-view character archive for Obsidian. Notes stay in your vault. Optional web share.

## Install

The plugin is these three files:

- `manifest.json`
- `main.js`
- `styles.css`

Copy them into:

`<your vault>/.obsidian/plugins/character-archive/`

Then enable **Character Archive** in Settings → Community plugins.

### Pack (what you send other people)

```bash
npm install
npm run pack
```

That writes `dist/character-archive/` and `dist/character-archive.zip`. Unzip into the `character-archive` plugin folder above.

### From source

```bash
npm install
npm run build
```

Then copy the same three files from the repo root, or run `npm run pack`.

## Open the gallery

**Entry note:** `Character Archive/Character Archive.md`

Opening that note switches it to the gallery. Tab title is **Character Archive**.

| Method | What it does |
|--------|----------------|
| Click the entry note | Open gallery |
| Ribbon **grid** icon | Open the entry note as gallery |
| Command **갤러리 열기** | Same |
| Command **기본 갤러리 열기** | Create the folder and entry note if missing, then open |
| Click the library folder title | Open gallery |

Optional embed on any note:

````md
```charinfo
```
````

**Characters** are notes with `kind: character` under the library folder.

## Starter pack

A new install uses the bundled sheet: basic properties, empty 신상 table, 외형 / 성격 / 능력, and a 프롬프트 block (기본외형 · 의상 · 성격 및 말투). Guide text only. No images.

The first time the default gallery note is created, if that folder has no characters yet, one sample card is written:

`Character Archive/_starter/첫 카드/첫 카드.md`

Archive and group are both **예시**. Delete it anytime.

Copies of the same files live under [`examples/`](./examples/).

Empty template path in settings = bundled starter. Existing vault settings stay as saved.

## Web share

Optional public HTML snapshot. You host it (Cloudflare Worker or GitHub Pages). The vault stays the source.

The plugin does not ship a public host URL. If you deploy `share-host/`, set `UPLOAD_KEY` and put that origin + key in settings.

## Dev

```bash
npm install
npm run build
npm run pack
```

To copy into your own vault:

```bash
# one-time: echo '<vault>/.obsidian/plugins/character-archive' > .vault-plugin-dir
npm run deploy
```

Plugin **id** is `character-archive`. Display name is **Character Archive**. The note embed is still ` ```charinfo `.
