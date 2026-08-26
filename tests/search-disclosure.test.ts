import assert from "node:assert/strict";
import { test } from "node:test";

import {
  transitionSearchDisclosure,
  type SearchDisclosureState,
} from "../src/ui/searchDisclosure.ts";

const narrow = (overrides: Partial<SearchDisclosureState> = {}) => ({
  expanded: false,
  isNarrow: true,
  query: "",
  ...overrides,
});

test("magnifier opens in place and close clears the query", () => {
  const opened = transitionSearchDisclosure(narrow(), { type: "open" });
  assert.equal(opened.state.expanded, true);
  assert.equal(opened.effect, "focus-input");

  const closed = transitionSearchDisclosure(
    narrow({ expanded: true, query: "아리엘" }),
    { type: "close" },
  );
  assert.deepEqual(closed, {
    state: narrow(),
    effect: "close",
  });
});

test("slash expands narrow search and preserves desktop search", () => {
  assert.deepEqual(
    transitionSearchDisclosure(narrow(), { type: "slash" }),
    { state: narrow({ expanded: true }), effect: "focus-input" },
  );
  assert.deepEqual(
    transitionSearchDisclosure(
      { expanded: false, isNarrow: false, query: "desktop" },
      { type: "slash" },
    ),
    {
      state: { expanded: false, isNarrow: false, query: "desktop" },
      effect: "focus-input",
    },
  );
});

test("Escape priority is focus overlay, disclosure, then mode exit", () => {
  const open = narrow({ expanded: true, query: "찾기" });
  assert.equal(
    transitionSearchDisclosure(open, {
      type: "escape",
      priority: "focus-overlay",
    }).effect,
    "focus-overlay",
  );
  assert.deepEqual(
    transitionSearchDisclosure(open, {
      type: "escape",
      priority: "search-disclosure",
    }),
    { state: narrow(), effect: "close" },
  );
  assert.equal(
    transitionSearchDisclosure(narrow(), {
      type: "escape",
      priority: "mode-exit",
    }).effect,
    "mode-exit",
  );
});

test("720px crossing exposes every active query and collapses on desktop", () => {
  const entered = transitionSearchDisclosure(
    { expanded: false, isNarrow: false, query: "active" },
    { type: "resize", isNarrow: true },
  );
  assert.equal(entered.state.expanded, true);
  const left = transitionSearchDisclosure(entered.state, {
    type: "resize",
    isNarrow: false,
  });
  assert.deepEqual(left.state, {
    expanded: false,
    isNarrow: false,
    query: "active",
  });
});

test("desktop to narrow keeps an empty focused search visible", () => {
  const next = transitionSearchDisclosure(
    { expanded: false, isNarrow: false, query: "" },
    {
    type: "resize",
    isNarrow: true,
    inputOwnedFocus: true,
    },
  );
  assert.deepEqual(next.state, {
    expanded: true,
    isNarrow: true,
    query: "",
  });
  assert.equal(next.effect, "focus-input");
});

test("compact, edit, and batch transitions preserve disclosure state", () => {
  const open = narrow({ expanded: true });
  for (const type of [
    "compact-change",
    "edit-change",
    "batch-change",
  ] as const) {
    assert.deepEqual(
      transitionSearchDisclosure(open, { type }).state,
      open,
      type,
    );
  }
});

test("full render rehydrates state and only restores owned input focus", () => {
  const open = narrow({ expanded: true, query: "검색" });
  assert.deepEqual(
    transitionSearchDisclosure(open, {
      type: "full-render",
      inputOwnedFocus: true,
    }),
    { state: open, effect: "focus-input" },
  );
  assert.equal(
    transitionSearchDisclosure(open, {
      type: "full-render",
      inputOwnedFocus: false,
    }).effect,
    "none",
  );
});

test("archive and external clears collapse while archive/edit/batch invariants hold", () => {
  const open = narrow({ expanded: true, query: "검색" });
  assert.deepEqual(
    transitionSearchDisclosure(open, { type: "archive-change" }).state,
    narrow(),
  );
  assert.deepEqual(
    transitionSearchDisclosure(open, {
      type: "external-query",
      query: "",
    }).state,
    narrow(),
  );
  assert.equal(
    transitionSearchDisclosure(narrow(), {
      type: "external-query",
      query: "새 검색",
    }).state.expanded,
    true,
  );
});
