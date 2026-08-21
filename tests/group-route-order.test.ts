/**
 * Freeze the canonical route order and the sentinel it is stored through.
 *
 * The group drawer and the gallery sections rank by one list in which `""` —
 * displayed as 기본 — is a peer holding a real rank. A stored order, though, is
 * a list of trimmed non-empty names, so the empty route travels as one reserved
 * token. Everything that could quietly desynchronize the drawer from the
 * gallery after a reload lives in this file: the codec, its dedupe, and the
 * merge that decides what a saved rank still means.
 *
 * `data/order.ts` has only type-level imports, so `node --test` runs it
 * straight from TypeScript. Keep it that way.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_ROUTE_TOKEN,
  decodeGroupRoute,
  decodeRouteOrder,
  encodeGroupRoute,
  encodeRouteOrder,
  moveInOrder,
  resolveGroupOrder,
  resolveGroupRouteOrder,
} from "../src/data/order.ts";

/* ------------------------------------------------------------ 1. the codec */

test("the empty route encodes to the reserved token and back", () => {
  assert.equal(encodeGroupRoute(""), DEFAULT_ROUTE_TOKEN);
  assert.equal(encodeGroupRoute("   "), DEFAULT_ROUTE_TOKEN);
  assert.equal(decodeGroupRoute(DEFAULT_ROUTE_TOKEN), "");
  assert.equal(decodeGroupRoute(`  ${DEFAULT_ROUTE_TOKEN}  `), "");
  // Obviously internal: no user could type it into the 그룹 이름 field and
  // collide with 기본's rank by accident.
  assert.match(DEFAULT_ROUTE_TOKEN, /^__charinfo:/);
});

test("a named route survives the round trip untouched but trimmed", () => {
  for (const name of ["예시", "세계관 · 2부", "기본"]) {
    assert.equal(encodeGroupRoute(name), name);
    assert.equal(decodeGroupRoute(encodeGroupRoute(name)), name);
  }
  assert.equal(encodeGroupRoute("  예시  "), "예시");
  // A *named* group literally called 기본 is its own route, never the sentinel.
  assert.notEqual(encodeGroupRoute("기본"), DEFAULT_ROUTE_TOKEN);
});

/* -------------------------------------------------------- 2. order persistence */

test("persisting a route order encodes 기본 in place and dedupes it", () => {
  assert.deepEqual(encodeRouteOrder(["세계관", "", "예시"]), [
    "세계관",
    DEFAULT_ROUTE_TOKEN,
    "예시",
  ]);
  // `""` and a blank string are the same route; two ranks would let the stored
  // list disagree with the rail about where 기본 sits.
  assert.deepEqual(encodeRouteOrder(["", "  ", "예시", "예시"]), [
    DEFAULT_ROUTE_TOKEN,
    "예시",
  ]);
});

test("reading a stored order decodes the token and drops a blank rank", () => {
  assert.deepEqual(decodeRouteOrder(["예시", DEFAULT_ROUTE_TOKEN, "세계관"]), [
    "예시",
    "",
    "세계관",
  ]);
  // A legacy list that somehow kept an empty entry must not claim 기본's rank:
  // only the reserved token means the default route.
  assert.deepEqual(decodeRouteOrder(["", "예시", "   "]), ["예시"]);
  assert.deepEqual(
    decodeRouteOrder([DEFAULT_ROUTE_TOKEN, "예시", DEFAULT_ROUTE_TOKEN]),
    ["", "예시"],
  );
});

test("what the drawer arranged is what the next read returns", () => {
  const arranged = ["세계관", "", "예시"];
  assert.deepEqual(decodeRouteOrder(encodeRouteOrder(arranged)), arranged);
});

test("reordering 기본 through storage keeps the rank the drag produced", () => {
  // Exactly the drawer's path: encode → move → decode → persist → read back.
  const encoded = ["예시", "세계관", ""].map(encodeGroupRoute);
  const moved = moveInOrder(
    encoded,
    encodeGroupRoute(""),
    encodeGroupRoute("예시"),
    "before",
  );
  assert.deepEqual(moved.map(decodeGroupRoute), ["", "예시", "세계관"]);
  assert.deepEqual(decodeRouteOrder(encodeRouteOrder(moved.map(decodeGroupRoute))), [
    "",
    "예시",
    "세계관",
  ]);
});

/* ----------------------------------------------------------- 3. the merge */

test("the default route holds whatever rank it was saved at", () => {
  assert.deepEqual(
    resolveGroupRouteOrder(["", "세계관", "예시"], ["예시", "세계관"]),
    ["", "세계관", "예시"],
  );
  assert.deepEqual(
    resolveGroupRouteOrder(["세계관", "", "예시"], ["예시", "세계관"]),
    ["세계관", "", "예시"],
  );
  assert.deepEqual(
    resolveGroupRouteOrder(["세계관", "예시", ""], ["예시", "세계관"]),
    ["세계관", "예시", ""],
  );
});

test("기본 exists with no saved rank at all, and lands last", () => {
  assert.deepEqual(resolveGroupRouteOrder(undefined, []), [""]);
  assert.deepEqual(resolveGroupRouteOrder([], ["예시"]), ["예시", ""]);
  assert.deepEqual(resolveGroupRouteOrder(["예시"], ["예시", "세계관"]), [
    "예시",
    "세계관",
    "",
  ]);
});

test("unknown saved routes are dropped and newcomers append in ko order", () => {
  assert.deepEqual(
    resolveGroupRouteOrder(["사라진 그룹", "히읗", ""], ["히읗", "가", "나"]),
    ["히읗", "", "가", "나"],
  );
});

test("a duplicated saved rank is taken once", () => {
  assert.deepEqual(
    resolveGroupRouteOrder(["예시", "예시", "", ""], ["예시"]),
    ["예시", ""],
  );
});

test("the named-only merge is untouched — no empty route leaks into share", () => {
  // `resolveGroupOrder` feeds the public share surfaces, which list *named*
  // sections. The wider variant must not have changed its answer.
  assert.deepEqual(resolveGroupOrder(["예시"], ["예시", "세계관"]), [
    "예시",
    "세계관",
  ]);
  assert.deepEqual(resolveGroupOrder([], ["", "예시"]), ["예시"]);
  assert.ok(!resolveGroupOrder(["", "예시"], ["예시"]).includes(""));
});
