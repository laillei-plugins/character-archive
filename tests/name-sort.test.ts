/**
 * 이름순: Korean word order, alphabet, natural numbers on the full card list.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cardNameKey,
  compareCardName,
  sortCharacters,
} from "../src/data/order.ts";
import type { CharacterRecord } from "../src/data/CharacterStore.ts";

function card(
  name: string,
  extras: Partial<CharacterRecord> = {},
): CharacterRecord {
  return {
    file: { basename: name, path: `${name}.md` } as CharacterRecord["file"],
    path: `${name}.md`,
    kind: "character",
    이름: name,
    코드네임: "",
    본명: "",
    소속: "",
    장르: extras.장르 ?? "예시",
    작품: "",
    그룹: extras.그룹 ?? "",
    상태: "",
    관계: "",
    인연: "",
    태그: [],
    cover: "",
    coverPosition: "",
    order: extras.order ?? 0,
    title: extras.title ?? name,
    values: {},
    ...extras,
  };
}

test("이름순 reorders the full list and ignores manual order", () => {
  const records = [
    card("다", { order: 10 }),
    card("가", { order: 20 }),
    card("나", { order: 30 }),
  ];
  assert.deepEqual(
    sortCharacters(records, "name").map((r) => r.이름),
    ["가", "나", "다"],
  );
});

test("이름순 uses Korean word sequence", () => {
  assert.ok(compareCardName("가영", "나영") < 0);
  assert.ok(compareCardName("하준", "가영") > 0);
});

test("이름순 alphabetizes latin names", () => {
  const records = [card("zeta"), card("Alpha"), card("beta")];
  assert.deepEqual(
    sortCharacters(records, "name").map((r) => r.이름),
    ["Alpha", "beta", "zeta"],
  );
});

test("이름순 treats number-only names as numbers, not digit strings", () => {
  const records = [card("10"), card("2"), card("1")];
  assert.deepEqual(
    sortCharacters(records, "name").map((r) => r.이름),
    ["1", "2", "10"],
  );
  assert.ok(compareCardName("2", "10") < 0);
});

test("이름순 uses natural numbers inside a name", () => {
  const records = [card("카드10"), card("카드2"), card("카드1")];
  assert.deepEqual(
    sortCharacters(records, "name").map((r) => r.이름),
    ["카드1", "카드2", "카드10"],
  );
});

test("cardNameKey prefers 이름 over title", () => {
  assert.equal(
    cardNameKey(
      card("표시", { title: "파일명", 이름: "표시" }),
    ),
    "표시",
  );
});
