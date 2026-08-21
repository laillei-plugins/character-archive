/**
 * Freeze regressions for the public share projection.
 *
 * `shareProjection.ts` imports nothing, so `node --test` runs it straight from
 * TypeScript. What is locked here is what a public page is *allowed* to show:
 * the schema gates both surfaces, the 보기 eyes gate the card alone, and every
 * chip-axis value publishes its label rather than the stored option id. The
 * Obsidian-side wiring (cover fetch, note body, upload) needs a vault and keeps
 * its rules at the `buildSharePayload` call site.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  projectShareCard,
  projectShareFieldText,
  projectShareStatus,
  projectShareTags,
  publishedTagIds,
  type ShareAxisOptions,
  type ShareFieldInput,
} from "../src/share/shareProjection.ts";
import {
  projectSchemaFields,
  type GroupSchemaRecord,
  type GroupSchemaStore,
} from "../src/data/groupSchema.ts";

/** Vocabularies as `axisFor` hands them over, after a round of renames. */
const AXIS: ShareAxisOptions = {
  status: [
    { id: "On", label: "활동" },
    { id: "Off", label: "휴면" },
  ],
  relation: [{ id: "r_1", label: "라이벌" }],
  bond: [{ id: "b_1", label: "맹약" }],
  affiliation: [{ id: "a_1", label: "제1지부" }],
  tags: [{ id: "t_1", label: "표식" }],
};

function field(patch: Partial<ShareFieldInput> = {}): ShareFieldInput {
  return {
    id: "f_1",
    label: "별명",
    type: "text",
    options: [],
    raw: "",
    cardVisible: true,
    ...patch,
  };
}

/* ------------------------------------------------------------ 1. tag surfaces */

test("an inactive 태그 reaches neither the card nor the panel", () => {
  const projection = projectShareTags({
    tagIds: ["t_1", "t_2"],
    active: false,
    cardVisible: true,
  });
  assert.deepEqual(projection.cardTagIds, []);
  assert.deepEqual(
    projection.detailTagIds,
    [],
    "a schema tombstone must not leak into a public page, eye or no eye",
  );
});

test("an active 태그 with the eye off reaches the panel only", () => {
  const projection = projectShareTags({
    tagIds: ["t_1", "t_2"],
    active: true,
    cardVisible: false,
  });
  assert.deepEqual(projection.cardTagIds, []);
  assert.deepEqual(projection.detailTagIds, ["t_1", "t_2"]);
});

test("an active 태그 with the eye on reaches both surfaces", () => {
  const projection = projectShareTags({
    tagIds: ["t_1"],
    active: true,
    cardVisible: true,
  });
  assert.deepEqual(projection.cardTagIds, ["t_1"]);
  assert.deepEqual(projection.detailTagIds, ["t_1"]);
});

test("blank tag ids never reach a surface", () => {
  const projection = projectShareTags({
    tagIds: ["", "  ", "t_1"],
    active: true,
    cardVisible: true,
  });
  assert.deepEqual(projection.cardTagIds, ["t_1"]);
  assert.deepEqual(projection.detailTagIds, ["t_1"]);
});

test("the published vocabulary is the union of both surfaces", () => {
  const hiddenCard = projectShareTags({
    tagIds: ["t_2"],
    active: true,
    cardVisible: false,
  });
  const shown = projectShareTags({
    tagIds: ["t_1"],
    active: true,
    cardVisible: true,
  });
  const inactive = projectShareTags({
    tagIds: ["t_9"],
    active: false,
    cardVisible: true,
  });
  assert.deepEqual(publishedTagIds([hiddenCard, shown, inactive]), [
    "t_2",
    "t_1",
  ]);
  assert.ok(
    !publishedTagIds([inactive]).includes("t_9"),
    "an id no surface shows is not published",
  );
});

/* ---------------------------------------------------------- 2. select labels */

test("every chip axis publishes its renamed label, not the stored id", () => {
  const cases: { id: string; raw: string | string[]; want: string }[] = [
    { id: "status", raw: "On", want: "활동" },
    { id: "relation", raw: "r_1", want: "라이벌" },
    { id: "bond", raw: "b_1", want: "맹약" },
    { id: "affiliation", raw: "a_1", want: "제1지부" },
    { id: "tags", raw: ["t_1"], want: "표식" },
  ];
  for (const item of cases) {
    assert.equal(
      projectShareFieldText(
        field({ id: item.id, type: "select", raw: item.raw }),
        AXIS,
      ),
      item.want,
      `${item.id} resolves through its axis vocabulary`,
    );
  }
});

test("a custom field resolves against its own options", () => {
  const custom = field({
    id: "f_7",
    type: "multi-select",
    options: [
      { id: "o_1", label: "차분함" },
      { id: "o_2", label: "활발함" },
    ],
    raw: ["o_2", "o_1"],
  });
  assert.equal(projectShareFieldText(custom, AXIS), "활발함, 차분함");
});

test("an unknown id shows itself instead of disappearing", () => {
  assert.equal(
    projectShareFieldText(
      field({ id: "relation", type: "select", raw: "r_9" }),
      AXIS,
    ),
    "r_9",
  );
  assert.equal(
    projectShareFieldText(
      field({ id: "tags", type: "multi-select", raw: ["t_1", "t_9"] }),
      AXIS,
    ),
    "표식, t_9",
  );
  assert.equal(
    projectShareFieldText(
      field({ id: "f_7", type: "select", options: [], raw: "o_3" }),
      AXIS,
    ),
    "o_3",
    "a removed option stays legible",
  );
});

test("a text field publishes what was typed", () => {
  assert.equal(projectShareFieldText(field({ raw: " 냐 " }), AXIS), "냐");
  assert.equal(projectShareFieldText(field({ raw: "" }), AXIS), "");
});

/* ----------------------------------------------------------- 3. two surfaces */

const CARD_FIELDS: ShareFieldInput[] = [
  field({ id: "name", label: "이름", raw: "에트나" }),
  field({ id: "status", label: "상태", type: "select", raw: "On" }),
  field({ id: "tags", label: "태그", type: "multi-select", raw: ["t_1"] }),
  field({ id: "codename", label: "코드네임", raw: "냐", cardVisible: true }),
  field({
    id: "affiliation",
    label: "소속",
    type: "select",
    raw: "a_1",
    cardVisible: false,
  }),
  field({ id: "f_7", label: "별명", raw: "", cardVisible: true }),
];

test("the card strip is schema ∩ eyes; the panel is the schema alone", () => {
  const projection = projectShareCard({
    fields: CARD_FIELDS,
    axisOptions: AXIS,
    panelProps: "all",
    includeAttrs: true,
  });
  assert.deepEqual(projection.props, [{ label: "코드네임", value: "냐" }]);
  assert.deepEqual(projection.detailProps, [
    { label: "코드네임", value: "냐" },
    { label: "소속", value: "제1지부" },
  ]);
});

test("「속성」 off publishes no panel rows at all", () => {
  const projection = projectShareCard({
    fields: CARD_FIELDS,
    axisOptions: AXIS,
    panelProps: "all",
    includeAttrs: false,
  });
  assert.deepEqual(projection.props, [{ label: "코드네임", value: "냐" }]);
  assert.deepEqual(projection.detailProps, []);
});

test("stored 「preview」 projects the same panel as 「all」", () => {
  const preview = projectShareCard({
    fields: CARD_FIELDS,
    axisOptions: AXIS,
    panelProps: "preview",
    includeAttrs: true,
  });
  const all = projectShareCard({
    fields: CARD_FIELDS,
    axisOptions: AXIS,
    panelProps: "all",
    includeAttrs: true,
  });
  assert.deepEqual(
    preview.detailProps,
    all.detailProps,
    "card eyes are a card rule — they never narrow the side panel",
  );
  assert.deepEqual(preview.props, all.props);
});

test("name, status and tags never become property rows", () => {
  const projection = projectShareCard({
    fields: CARD_FIELDS,
    axisOptions: AXIS,
    panelProps: "all",
    includeAttrs: true,
  });
  for (const surface of [projection.props, projection.detailProps]) {
    assert.ok(
      !surface.some((row) => ["이름", "상태", "태그"].includes(row.label)),
      "the card chrome already renders those three",
    );
  }
});

test("public share rows preserve the group's schema order", () => {
  const store: GroupSchemaStore = {
    cardProperties: [],
    groupSchemas: [],
    fieldKeyLedgers: [],
    cardFieldVisibility: [],
    cardFieldOrder: [
      {
        page: "Archive.md",
        archive: "쿠원",
        order: ["affiliation", "codename", "status", "name"],
      },
    ],
  };
  const schema: GroupSchemaRecord = {
    library: "Character Archive",
    archive: "쿠원",
    group: "가이드",
    revision: 1,
    fields: [
      { id: "name", key: "이름", label: "이름", type: "text", active: true, options: [] },
      { id: "status", key: "상태", label: "상태", type: "select", active: true, options: [] },
      { id: "codename", key: "코드네임", label: "코드네임", type: "text", active: true, options: [] },
      { id: "affiliation", key: "소속", label: "소속", type: "select", active: true, options: [] },
    ],
  };
  const order = schema.fields.map((item) => item.id);
  const values: Record<string, string> = {
    name: "에트나",
    status: "On",
    codename: "냐",
    affiliation: "a_1",
  };
  const fields = projectSchemaFields(order, schema).map((item) =>
    field({
      id: item.id,
      label: item.label,
      type: item.type,
      raw: values[item.id] ?? "",
      cardVisible: true,
    }),
  );
  const projection = projectShareCard({
    fields,
    axisOptions: AXIS,
    panelProps: "all",
    includeAttrs: true,
  });
  assert.deepEqual(projection.detailProps, [
    { label: "코드네임", value: "냐" },
    { label: "소속", value: "제1지부" },
  ]);
});

test("inactive status keeps its value dormant but exposes no share surface", () => {
  assert.deepEqual(
    projectShareStatus({ statusId: "On", active: false }),
    { status: "On", showStatus: false, filterValue: "" },
  );
  assert.deepEqual(
    projectShareStatus({ statusId: "On", active: true }),
    { status: "On", showStatus: true, filterValue: "On" },
  );
});

test("generated share runtime suppresses the card pill for dormant status", () => {
  const source = readFileSync(
    new URL("../src/share/webShare.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /card\.showStatus === false && \(DATA\.filterProperty \|\| "status"\) === "status"\s*\? null\s*:\s*makeFilterPill/,
    "the generated runtime must gate the status pill before its empty value can fall back to Off",
  );
});
