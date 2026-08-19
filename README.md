# Character Archive

Card gallery for character notes in your vault. Notes stay local.

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

The globe button uploads the cards you selected. Host the page yourself (Cloudflare Worker or GitHub Pages) and put the origin plus upload key in settings. This plugin does not ship a public host.

## License

MIT — see [LICENSE](./LICENSE).
