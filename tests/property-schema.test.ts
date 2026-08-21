/**
 * Freeze regressions for the fixed archive schema (고정 아카이브 구조).
 *
 * `propertySchema.ts` imports nothing, so `node --test` runs it straight from
 * TypeScript. Everything that decides *whether* a note gets written — the
 * canonical patch planner, the frontmatter preflight, and the per-path work
 * lane — is locked here. The Obsidian-side wiring (layout-ready scan, closed
 * gallery `vault.modify`, root discovery) cannot run without a vault; those
 * enqueue call sites carry LOCK comments in `main.ts` instead.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CANONICAL_PROPERTY_KEYS,
  HEAL_BIT_ORDER,
  NEVER_CREATE_KEYS,
  PathWorkLane,
  canonicalPropertyDefault,
  parseFrontmatterBlock,
  planCanonicalPropertyPatch,
  type HealBit,
} from "../src/data/propertySchema.ts";

/** Every canonical key present — the shape a healthy note already has. */
function fullCharacter(): Record<string, unknown> {
  const fm: Record<string, unknown> = { kind: "character" };
  for (const key of CANONICAL_PROPERTY_KEYS) {
    fm[key] = canonicalPropertyDefault(key);
  }
  return fm;
}

test("missing 코드네임 is restored as an empty string", () => {
  const fm = fullCharacter();
  delete fm.코드네임;
  assert.deepEqual(planCanonicalPropertyPatch(fm), { 코드네임: "" });
});

test("a complete note plans no patch at all", () => {
  assert.equal(planCanonicalPropertyPatch(fullCharacter()), null);
});

test("custom-template gaps are all restored in one patch", () => {
  // Template wrote only what `createCharacterNote` sets today.
  const fm = {
    kind: "character",
    이름: "에트나",
    상태: "On",
    장르: "쿠원",
    그룹: "",
  };
  assert.deepEqual(planCanonicalPropertyPatch(fm), {
    관계: "",
    인연: "",
    코드네임: "",
    본명: "",
    소속: "",
    태그: [],
  });
});

test("unknown keys are preserved — the patch never mentions them", () => {
  const fm = fullCharacter();
  delete fm.본명;
  fm.내가만든속성 = "지켜야 함";
  fm["custom-field"] = { nested: true };
  const patch = planCanonicalPropertyPatch(fm);
  assert.deepEqual(patch, { 본명: "" });
  assert.ok(patch && !("내가만든속성" in patch));
  assert.ok(patch && !("custom-field" in patch));
});

test("an existing canonical value is never overwritten or coerced", () => {
  const fm = fullCharacter();
  fm.코드네임 = 1;
  fm.태그 = "쿠원";
  fm.소속 = null;
  assert.equal(planCanonicalPropertyPatch(fm), null);
});

test("only the truly absent key is added next to a wrong-typed one", () => {
  const fm = fullCharacter();
  fm.코드네임 = 1;
  delete fm.인연;
  assert.deepEqual(planCanonicalPropertyPatch(fm), { 인연: "" });
});

test("missing 태그 becomes an empty array, not a string", () => {
  const fm = fullCharacter();
  delete fm.태그;
  const patch = planCanonicalPropertyPatch(fm);
  assert.deepEqual(patch, { 태그: [] });
  assert.ok(Array.isArray(patch?.태그));
});

test("the 태그 default is a fresh array per patch", () => {
  const a = planCanonicalPropertyPatch({ kind: "character" });
  const b = planCanonicalPropertyPatch({ kind: "character" });
  assert.notEqual(a?.태그, b?.태그);
  (a?.태그 as string[]).push("오염");
  assert.deepEqual(b?.태그, []);
});

test("missing or non-character kind plans nothing", () => {
  assert.equal(planCanonicalPropertyPatch({}), null);
  assert.equal(planCanonicalPropertyPatch({ 이름: "에트나" }), null);
  assert.equal(planCanonicalPropertyPatch({ kind: "gallery" }), null);
  assert.equal(planCanonicalPropertyPatch({ kind: "" }), null);
  assert.equal(planCanonicalPropertyPatch({ kind: 1 }), null);
  assert.equal(planCanonicalPropertyPatch(null), null);
  assert.equal(planCanonicalPropertyPatch(undefined), null);
});

test("kind tolerates surrounding whitespace only", () => {
  assert.deepEqual(planCanonicalPropertyPatch({ kind: " character " }), {
    이름: "",
    상태: "",
    그룹: "",
    관계: "",
    인연: "",
    코드네임: "",
    본명: "",
    소속: "",
    태그: [],
  });
  assert.equal(planCanonicalPropertyPatch({ kind: "characters" }), null);
});

test("never-create keys stay out of every patch", () => {
  const patch = planCanonicalPropertyPatch({ kind: "character" });
  assert.ok(patch);
  for (const key of NEVER_CREATE_KEYS) {
    assert.ok(!(key in patch), `${key} must never be created`);
  }
  // The two lists must not overlap either.
  for (const key of CANONICAL_PROPERTY_KEYS) {
    assert.ok(
      !(NEVER_CREATE_KEYS as readonly string[]).includes(key),
      `${key} cannot be canonical and never-create at once`,
    );
  }
});

/* ---------------------------------------------------------------- preflight */

const YAML = (raw: string): unknown => {
  // Tiny `key: value` subset — enough to prove the block/kind handling.
  const out: Record<string, unknown> = {};
  for (const line of raw.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const hit = /^([^:\s][^:]*):(.*)$/.exec(line);
    if (!hit) throw new Error(`bad yaml line: ${line}`);
    const value = (hit[2] ?? "").trim().replace(/^["']|["']$/g, "");
    out[(hit[1] ?? "").trim()] = value;
  }
  return out;
};

test("a closed frontmatter block parses to fm + kind", () => {
  const parsed = parseFrontmatterBlock(
    ['---', 'kind: "character"', '이름: "에트나"', '---', '', '# 에트나'].join("\n"),
    YAML,
  );
  assert.ok(parsed.ok);
  assert.equal(parsed.kind, "character");
  assert.equal(parsed.fm.이름, "에트나");
  assert.equal(planCanonicalPropertyPatch(parsed.fm)?.코드네임, "");
});

test("no frontmatter block is absent, not malformed", () => {
  const parsed = parseFrontmatterBlock("# 에트나\n\n본문.", YAML);
  assert.deepEqual(parsed, { ok: false, reason: "absent" });
});

test("an unclosed block is malformed — zero writes", () => {
  const parsed = parseFrontmatterBlock('---\nkind: "character"\n이름: 에트나', YAML);
  assert.deepEqual(parsed, { ok: false, reason: "malformed" });
});

test("a throwing parser is malformed — zero writes", () => {
  const parsed = parseFrontmatterBlock(
    ["---", "kind: character", "  이런: [ 깨진", "---"].join("\n"),
    () => {
      throw new Error("yaml exploded");
    },
  );
  assert.deepEqual(parsed, { ok: false, reason: "malformed" });
});

test("a non-mapping document is malformed", () => {
  assert.deepEqual(
    parseFrontmatterBlock("---\n- a\n- b\n---\n", () => ["a", "b"]),
    { ok: false, reason: "malformed" },
  );
  assert.deepEqual(parseFrontmatterBlock("---\n42\n---\n", () => 42), {
    ok: false,
    reason: "malformed",
  });
});

test("an empty block parses to an empty mapping with no kind", () => {
  const parsed = parseFrontmatterBlock("---\n---\n# 제목", YAML);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.fm, {});
  assert.equal(parsed.kind, "");
  assert.equal(planCanonicalPropertyPatch(parsed.fm), null);
});

test("CRLF notes preflight the same as LF notes", () => {
  const parsed = parseFrontmatterBlock(
    '---\r\nkind: "character"\r\n---\r\n\r\n# 에트나\r\n',
    YAML,
  );
  assert.ok(parsed.ok);
  assert.equal(parsed.kind, "character");
});

/* ----------------------------------------------------------------- the lane */

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

/** A gate the fake runner blocks on until the test opens it. */
function deferred(): { promise: Promise<void>; open: () => void } {
  let open = (): void => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

test("different paths heal concurrently", async () => {
  const started: string[] = [];
  const gate = deferred();
  const lane = new PathWorkLane(async (path) => {
    started.push(path);
    await gate.promise;
  });

  const a = lane.enqueue("A.md", "schema");
  const b = lane.enqueue("B.md", "schema");
  await tick();
  assert.deepEqual(started, ["A.md", "B.md"], "B must not wait behind A");
  gate.open();
  await Promise.all([a, b]);
  assert.equal(lane.busyPaths, 0);
});

test("a same-path burst coalesces into one run behind the in-flight one", async () => {
  const runs: HealBit[][] = [];
  const gate = deferred();
  const lane = new PathWorkLane(async (_path, bits) => {
    runs.push(bits);
    if (runs.length === 1) await gate.promise;
  });

  const first = lane.enqueue("A.md", "schema");
  await tick();
  const burst = [
    lane.enqueue("A.md", "schema"),
    lane.enqueue("A.md", "content"),
    lane.enqueue("A.md", "schema"),
  ];
  gate.open();
  await Promise.all([first, ...burst]);

  assert.deepEqual(runs, [["schema"], ["schema", "content"]]);
  assert.equal(lane.busyPaths, 0);
});

test("bits requested in one tick share a pass, schema before content", async () => {
  const runs: HealBit[][] = [];
  const lane = new PathWorkLane(async (_path, bits) => {
    runs.push(bits);
  });
  const content = lane.enqueue("A.md", "content");
  await Promise.all([content, lane.enqueue("A.md", "schema")]);
  assert.deepEqual(runs, [HEAL_BIT_ORDER.slice()]);
});

test("a transient failure retries exactly once, then succeeds", async () => {
  let calls = 0;
  const lane = new PathWorkLane(async () => {
    calls += 1;
    if (calls === 1) throw new Error("EBUSY");
  });
  await lane.enqueue("A.md", "schema");
  assert.equal(calls, 2);
});

test("a second throw surfaces to the caller and stops retrying", async () => {
  let calls = 0;
  const lane = new PathWorkLane(async () => {
    calls += 1;
    throw new Error("계속 실패");
  });
  await assert.rejects(lane.enqueue("A.md", "schema"), /계속 실패/);
  assert.equal(calls, 2);
  assert.equal(lane.busyPaths, 0);

  // A later event retries the path from scratch — no permanent block.
  await assert.rejects(lane.enqueue("A.md", "schema"), /계속 실패/);
  assert.equal(calls, 4);
});

test("a failed path does not poison another path", async () => {
  const lane = new PathWorkLane(async (path) => {
    if (path === "bad.md") throw new Error("nope");
  });
  const bad = assert.rejects(lane.enqueue("bad.md", "schema"), /nope/);
  await lane.enqueue("good.md", "schema");
  await bad;
});

test("dispose drops queued work (unload)", async () => {
  const runs: string[] = [];
  const gate = deferred();
  const lane = new PathWorkLane(async (path) => {
    runs.push(path);
    if (runs.length === 1) await gate.promise;
  });

  const first = lane.enqueue("A.md", "schema");
  await tick();
  const queued = lane.enqueue("A.md", "content");
  lane.dispose();
  gate.open();
  await Promise.all([first, queued]);
  assert.deepEqual(runs, ["A.md"], "queued bits must not run after unload");
  await lane.enqueue("B.md", "schema");
  assert.deepEqual(runs, ["A.md"], "no new work after unload");
});
