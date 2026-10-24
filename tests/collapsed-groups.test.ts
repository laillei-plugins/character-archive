/**
 * Folded group sections: only collapsed rows persist, so absent = open.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["src/data/collapsedGroups.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const api = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0]!.text).toString("base64")
);

const LIB = "Character Archive";

test("a group with no stored row is open by default", () => {
  const store = { collapsedGroups: [] };
  assert.equal(api.isGroupCollapsed(store, LIB, "Fearless", "A"), false);
});

test("collapse is remembered and reopening removes the row", () => {
  const store = { collapsedGroups: [] };
  api.setGroupCollapsed(store, LIB, "Fearless", "A", true);
  assert.equal(api.isGroupCollapsed(store, LIB, "Fearless", "A"), true);
  assert.equal(api.isGroupCollapsed(store, LIB, "Fearless", "B"), false);
  assert.equal(api.isGroupCollapsed(store, LIB, "Other", "A"), false);
  api.setGroupCollapsed(store, LIB, "Fearless", "A", true);
  assert.equal(store.collapsedGroups.length, 1);
  api.setGroupCollapsed(store, LIB, "Fearless", "A", false);
  assert.deepEqual(store.collapsedGroups, []);
});

test("library path and name spacing do not split one group", () => {
  const store = { collapsedGroups: [] };
  api.setGroupCollapsed(store, `${LIB}/`, " Fearless ", " A ", true);
  assert.equal(api.isGroupCollapsed(store, LIB, "Fearless", "A"), true);
});

test("normalize drops malformed and duplicate rows", () => {
  const rows = api.normalizeCollapsedGroups([
    { library: LIB, archive: "Fearless", group: "A" },
    { library: LIB, archive: "Fearless", group: " A " },
    { library: LIB, archive: "Fearless", group: "" },
    { library: LIB, archive: 3, group: "B" },
    null,
  ]);
  assert.deepEqual(rows, [{ library: LIB, archive: "Fearless", group: "A" }]);
  assert.deepEqual(api.normalizeCollapsedGroups(undefined), []);
});
