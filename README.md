# Character Archive

Card gallery for character notes in your vault. Notes stay local unless you explicitly use Web share.

Each card shows a cover, status, relationships, body text, and prompts. Open the note when you want to edit in depth.

> Korean guide: [README.ko.md](./README.ko.md)

## What it does

- **Gallery** — cards grouped by archive (top name) and group (row title).
- **Cards** — cover and properties at a glance. Click a card to open the peek panel.
- **Properties** — status, relation, bond, affiliation, tags. Rename visible labels in gallery edit → **Property manager** (book icon).
- **Filters** — chips at the top (On / Off and other values).
- **Cover** — the first image in the note becomes the card cover. In gallery edit, tap the cover to change it.
- **New card** — starter sheet with a profile table, appearance / personality / ability sections, and prompt blocks. Guide text only. No images.
- **Extra windows** — the same cards in another tab. This does not create a new subgroup.
- **Web share** (optional) — publish the current gallery as HTML. You host it. The vault stays the source.

## Usage

1. Enable the plugin.
2. Open `Character Archive/Character Archive.md`. That note becomes the gallery.
3. Or use the ribbon **grid** icon, or the command palette entries **Open gallery** / **Open default gallery**.

The first time, one sample card is created in the **Example** archive. You can delete it.

A character is a note with `kind: character` under the library folder.

Turn on the pencil to move cards, add a character, and edit properties. With the pencil off, the gallery is read-only.

Heading sections and tables are read by the gallery. A **Memo** section stays note-only (not shown in the peek panel).

Embed the gallery on any note:

````md
```charinfo
```
````

### Command palette names

The plugin UI is currently Korean-labeled. Matching palette names:

| English (this README) | In Obsidian |
| --- | --- |
| Open gallery | 갤러리 열기 |
| Open default gallery | 기본 갤러리 열기 |
| New gallery window | 새 갤러리 창 |
| Create character note | 캐릭터 노트 만들기 |
| Share gallery | 갤러리 공유 |
| Property manager | 속성 관리 |

Starter sample paths may use Korean names (`예시`, `첫 카드`). Section headings in the bundled template are also Korean.

## Install

### Community plugins

1. Open **Settings → Community plugins**.
2. Browse for **Character Archive**.
3. Install, then enable.

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from [Releases](https://github.com/laillei-plugins/character-archive/releases).
2. Put them in `<vault>/.obsidian/plugins/character-archive/`.
3. Enable **Character Archive** in Community plugins.

## Web share

Web share is optional and runs only when you press a publish button. The globe button shows exactly which cards and panel sections will be included. Publishing uploads the selected card data, selected note sections, prompts when selected, and embedded covers as a public HTML page. Anyone with the link can view it.

By default, the plugin uses the maintainer-operated service at `https://character-archive.pages.dev`. It accepts share creation without an account; updating or deleting a page still requires the separate management key saved by the plugin. Hosted links last 30 days by default; you can choose 7 days, 30 days, or 1 year, and stop a hosted share from the same gallery or character share. You can instead use your own compatible Cloudflare host or publish to GitHub Pages.

Ordinary gallery use has no telemetry and makes no share upload. See [Privacy](./PRIVACY.md) for network use, retention, credentials, and deletion details.

## License

MIT — see [LICENSE](./LICENSE).
