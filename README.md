# Character Archive

Card gallery for character notes in your vault. Notes stay local.

Each card shows a cover, status, relationships, body text, and prompts. Open the note when you want to edit in depth.

## What it does

- **Gallery** — cards grouped by archive (top name) and group (row title).
- **Cards** — cover and properties at a glance. Click a card to open the peek panel.
- **Properties** — status, relation, bond, affiliation, tags. Visible labels are renamed in gallery edit → **속성 관리** (book icon).
- **Filters** — chips at the top (On / Off and other values).
- **Cover** — the first image in the note becomes the card cover. In gallery edit, tap the cover to change it.
- **New card** — starter sheet with a 신상 table, 외형 / 성격 / 능력, and prompt blocks. Guide text only. No images.
- **Extra windows** — the same cards in another tab. This does not create a new subgroup.
- **Web share** (optional) — publish the current gallery as HTML. You host it. The vault stays the source.

## Usage

1. Enable the plugin.
2. Open `Character Archive/Character Archive.md`. That note becomes the gallery.
3. Or use the ribbon **grid** icon, or the commands **갤러리 열기** / **기본 갤러리 열기**.

The first time, one sample card is created: **첫 카드** in the **예시** archive. You can delete it.

A character is a note with `kind: character` under the library folder.

Turn on the pencil to move cards, add a character, and edit properties. With the pencil off, the gallery is read-only.

`##` headings and tables are read by the gallery. `## 메모` stays note-only.

Embed the gallery on any note:

````md
```charinfo
```
````

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

## 한국어

보관함 안의 캐릭터 노트를 카드 갤러리로 봅니다. 데이터는 로컬 노트입니다.

- 리본 격자 또는 `Character Archive/Character Archive.md` 로 갤러리를 엽니다.
- 연필을 켜면 카드 이동·새 캐릭터·속성 편집을 합니다.
- 첫 그림이 표지입니다. 갤러리 편집에서 표지를 누르면 바꿉니다.
- 설치: 커뮤니티 플러그인에서 Character Archive를 켜거나, Release의 세 파일을 `.obsidian/plugins/character-archive/`에 넣습니다.
