# Character Archive — plugin design system

Base (Obsidian open source):

- [About styling](https://docs.obsidian.md/Reference/CSS+variables/About+styling) — use built-in CSS variables so themes still work
- [Spacing](https://docs.obsidian.md/Reference/CSS+variables/Foundations/Spacing) — 4px grid, `--size-4-*` / `--size-2-*`
- [Icons](https://docs.obsidian.md/Reference/CSS+variables/Foundations/Icons) — Lucide + `--icon-*` + `clickable-icon`
- [Radiuses](https://docs.obsidian.md/Reference/CSS+variables/Foundations/Radiuses) — `--radius-s/m/l`
- [Typography](https://docs.obsidian.md/Reference/CSS+variables/Foundations/Typography) — `--font-ui-*` for chrome
- [Button](https://docs.obsidian.md/Reference/CSS+variables/Components/Button) / [Modal](https://docs.obsidian.md/Reference/CSS+variables/Components/Modal)

---

## 1. Tokens (aliases only)

Declare aliases on `:root` (not only the gallery shell). Do not invent hex colors for chrome. Map to Obsidian vars.

**Spacing grammar (one rule):** use the Obsidian scale (`--size-4-*`). `--size-2-1` (2) and `--size-2-3` (6) are named exceptions for tight chrome only. No raw `rem` gaps. Literals allowed only for `1px` borders and a **44px project preference** on primary text rows (WCAG 2.2 AA floor is 24×24).

| Role | Token | Source |
|---|---|---|
| Space 2 | `--charinfo-space-xxs` | `--size-2-1` (2) |
| Space 4 | `--charinfo-space-xs` | `--size-4-1` (4) |
| Space 6 | `--charinfo-space-sm` | `--size-2-3` (6, rare) |
| Space 8 | `--charinfo-space-md` | `--size-4-2` (8) |
| Space 12 | `--charinfo-space-base` | `--size-4-3` (12) |
| Space 16 | `--charinfo-space-lg` | `--size-4-4` (16) |
| Space 24 | `--charinfo-space-xl` | `--size-4-6` (24) |
| Icon hit | `--size-4-8` (32) | official |
| Primary hit | 44px text row / 32px icon | project preference, not WCAG floor |
| Radius sm | `--radius-s` (4) | official |
| Radius md | `--radius-m` (8) | official |
| Ink / muted / line / surface / accent | `--text-normal` / `--text-muted` / `--background-modifier-border` / `--background-secondary` / `--interactive-accent` | official |
| Icon | `--icon-color`, `--icon-color-hover`, `--icon-size`, `--icon-stroke`, `--clickable-icon-radius` | official |
| UI type | `--font-ui-small` (13) body, `--font-ui-medium` (15) title | official |

**Forbidden in new CSS:** raw `rem` gaps (`0.55rem`, `0.85rem`), `1rem` padding, underlined text-as-button, a second color system.

---

## 2. Components (one pattern each)

### Icon button (nav, header, back)

Class: `clickable-icon charinfo-icon-btn`

- Lucide via `setIcon`. **No text beside the icon.**
- Size 32×32 (`--size-4-8`). Glyph `--icon-m` (18) / stroke 1.75.
- Color `--icon-color` → hover `--icon-color-hover` + `--background-modifier-hover`.
- Accessible name: `aria-label` + `title` only (e.g. Back = `속성 목록으로 돌아가기`).
- Back icon: `arrow-left` (same job everywhere — peek “close” stays `x`, not a second Back).
- Lives in the modal **title row**, left of the title. Hidden on the root screen.
- When Back is visible, the **title text is the place name** (property or `이 페이지 필터`). Do not repeat that name as an `h3` in the body.

### Text button (named action)

Class: `charinfo-text-btn` (implement this class; do not invent a sibling)

- Min height 44. Padding `--size-4-2` `--size-4-3`.
- Radius `--radius-s`. Border `--background-modifier-border`.
- Hover / focus / pressed / disabled: inherit native Obsidian `button`. Document only project exceptions.
- Use for: pick a property, `새 값 추가`, confirm actions. Mini (32) is only for in-row `색 바꾸기`.

### Quiet fold

Class: `charinfo-attr-modal__fold`

- Muted text + `▸`/`▾`. Never styled like Back.
- Not a navigation control.

### Field

Label `--font-ui-small` + `--text-muted`. Input uses Obsidian default control chrome. Helper under field, muted.

### Modal shell

- One title, one X. No Cancel+X unless destructive confirm (already has `취소`).
- Width: `min(92vw, 30rem)` — explicit. Do **not** use `--modal-max-width-narrow` (Obsidian 1.13 sets that to 800px).
- **Inset owner:** Obsidian `.modal` chrome owns the outer pad. Do not also dump `--size-4-4` on `.modal-content`.
- Vertical stack gap: `--size-4-3`.
- Title row: flex, gap `--size-4-2`, align center, min-height 32.
- Save / live region: hide (no min-height, no pad) when empty.

---

## 3. Rules (so we do not re-order this)

1. **Back is an icon button.** Never “← 속성 목록” text.
2. **Spacing follows §1 grammar.** 4px grid; 2/6 only as named exceptions.
3. **Same job → same component.** Header actions, modal Back, peek icons = `charinfo-icon-btn`.
4. **Themes win.** No hard-coded light-only chrome colors.
5. **One X.** PRODUCT_TASTE.
6. **New screens reuse this file.** If a control is missing, add it here first, then implement.

---

## 4. First consumer

`속성 관리` (`AttrManageModal` + `.charinfo-attr-modal-*`) must match §2–3 before any other restyle.
