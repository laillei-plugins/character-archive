/**
 * Freeze the chip color model.
 *
 * `status.ts` imports nothing, so `node --test` runs it straight from
 * TypeScript. What is locked here is the storage contract: every color token a
 * vault already persisted keeps working, a user-picked hex survives settings
 * normalization in one canonical shape, and nothing else can get through —
 * `normalizeStatusColor` is the only door to both persistence and the
 * stylesheets (plugin chips and published share HTML alike).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  STATUS_COLOR_CLASSES,
  STATUS_COLOR_TOKENS,
  STATUS_CUSTOM_COLOR_CLASS,
  isCustomStatusColor,
  isStatusColorPreset,
  normalizeStatusColor,
  normalizeStatuses,
  statusColorClass,
  type StatusColorPreset,
} from "../src/data/status.ts";

/** The eight tokens that shipped before custom colors existed. */
const LEGACY_TOKENS: StatusColorPreset[] = [
  "green",
  "gray",
  "amber",
  "blue",
  "red",
  "violet",
  "cyan",
  "pink",
];

/** The four added by the twelve-preset palette. */
const ADDED_TOKENS: StatusColorPreset[] = ["olive", "indigo", "lime", "yellow"];

test("the palette is twelve presets and keeps every legacy token first", () => {
  const ids = STATUS_COLOR_TOKENS.map((token) => token.id);
  assert.equal(ids.length, 12);
  assert.deepEqual(ids.slice(0, 8), LEGACY_TOKENS);
  assert.deepEqual(ids.slice(8), ADDED_TOKENS);
  // Every preset is offerable: a token with no label cannot be picked.
  for (const token of STATUS_COLOR_TOKENS) {
    assert.ok(token.label.trim(), `${token.id} has no label`);
  }
  assert.equal(new Set(ids).size, ids.length, "duplicate preset id");
});

test("every persisted preset token survives normalization untouched", () => {
  for (const token of [...LEGACY_TOKENS, ...ADDED_TOKENS]) {
    assert.equal(normalizeStatusColor(token), token);
    assert.ok(isStatusColorPreset(token));
    assert.equal(isCustomStatusColor(token), false);
    assert.equal(statusColorClass(token), `is-${token}`);
  }
});

test("a lowercase hex is canonicalized to uppercase #RRGGBB", () => {
  assert.equal(normalizeStatusColor("#7c3aed"), "#7C3AED");
  assert.equal(normalizeStatusColor("#abcdef"), "#ABCDEF");
  // Already canonical, and surrounding whitespace is not a different color.
  assert.equal(normalizeStatusColor("#7C3AED"), "#7C3AED");
  assert.equal(normalizeStatusColor("  #7c3aed  "), "#7C3AED");
  // Normalizing twice must not move — settings load runs it on every open.
  assert.equal(normalizeStatusColor(normalizeStatusColor("#7c3aed")), "#7C3AED");
});

test("a custom color renders through the shared class, never an interpolated one", () => {
  const color = normalizeStatusColor("#7c3aed");
  assert.ok(isCustomStatusColor(color));
  assert.equal(statusColorClass(color), STATUS_CUSTOM_COLOR_CLASS);
  // The painter's clear list must cover every class it can add, or a repaint
  // would leave two color classes fighting on the same chip.
  assert.ok(STATUS_COLOR_CLASSES.includes(STATUS_CUSTOM_COLOR_CLASS));
  for (const token of STATUS_COLOR_TOKENS) {
    assert.ok(STATUS_COLOR_CLASSES.includes(`is-${token.id}`));
  }
});

test("anything that is not a preset or canonical hex falls back to gray", () => {
  const rejected: unknown[] = [
    // Wrong hex shapes.
    "#abc",
    "#abcd",
    "#abcde",
    "#abcdefg",
    "#abcdef0",
    "#ABCDE_",
    "abcdef",
    "##abcdef",
    "#7c3ae",
    "#7c3aedff",
    // CSS text and injection attempts — none of these may reach a stylesheet.
    "rebeccapurple",
    "rgb(255,0,0)",
    "var(--interactive-accent)",
    "url(https://example.com/x.png)",
    "#fff; background: url(x)",
    "expression(alert(1))",
    "",
    "   ",
    // Non-strings.
    null,
    undefined,
    42,
    true,
    {},
    [],
    ["green"],
    { color: "green" },
  ];
  for (const raw of rejected) {
    assert.equal(
      normalizeStatusColor(raw),
      "gray",
      `${JSON.stringify(raw)} should fall back to gray`,
    );
  }
});

test("a custom color round-trips through the stored status list", () => {
  const stored = [
    { id: "On", label: "On", color: "green" },
    { id: "Soon", label: "곧", color: "#7c3aed" },
    { id: "Broken", label: "깨짐", color: "rgb(1,2,3)" },
    { id: "New", label: "새로", color: "olive" },
  ];
  const list = normalizeStatuses(stored);
  assert.deepEqual(
    list.map((s) => s.color),
    ["green", "#7C3AED", "gray", "olive"],
  );
});
