import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  AsyncSingleFlight,
  activateDescribedBatchAction,
  batchToggleFocusTarget,
  describeBatchAction,
  foldTierForWidth,
  fullRenderFocusTarget,
  galleryActionRoute,
  responsiveFocusTargetAfterResize,
  type GalleryHeaderAction,
} from "../src/ui/searchDisclosure.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("leaf width maps independently to none, narrow, and compact tiers", () => {
  assert.deepEqual(
    [319, 320, 367, 368, 719, 720].map(foldTierForWidth),
    ["compact", "compact", "compact", "narrow", "narrow", "none"],
  );
});

test("read and edit routes match the exact owner matrix", () => {
  const actions: GalleryHeaderAction[] = [
    "search",
    "edit",
    "batch",
    "attributes",
    "view",
    "share",
    "refresh",
  ];
  const expected = {
    none: ["hidden", "bar", "bar", "bar", "bar", "bar", "hidden"],
    narrow: ["bar", "bar", "bar", "bar", "bar", "popover", "hidden"],
    compact: ["bar", "bar", "bar", "popover", "bar", "popover", "hidden"],
  } as const;
  for (const foldTier of ["none", "narrow", "compact"] as const) {
    assert.deepEqual(
      actions.map((action) =>
        galleryActionRoute(action, {
          foldTier,
          editMode: false,
          batchMode: false,
          searchExpanded: false,
        }),
      ),
      expected[foldTier],
      foldTier,
    );
  }
  assert.equal(
    galleryActionRoute("refresh", {
      foldTier: "narrow",
      editMode: true,
      batchMode: false,
      searchExpanded: false,
    }),
    "popover",
  );
  assert.equal(
    galleryActionRoute("share", {
      foldTier: "narrow",
      editMode: false,
      batchMode: false,
      searchExpanded: false,
    }),
    "popover",
  );
  assert.equal(
    galleryActionRoute("attributes", {
      foldTier: "compact",
      editMode: true,
      batchMode: false,
      searchExpanded: false,
    }),
    "popover",
  );
  assert.equal(
    galleryActionRoute("batch", {
      foldTier: "compact",
      editMode: true,
      batchMode: false,
      searchExpanded: false,
    }),
    "popover",
  );
});

test("expanded narrow search hides every route except active batch exit", () => {
  const actions: GalleryHeaderAction[] = [
    "search",
    "edit",
    "batch",
    "attributes",
    "view",
    "share",
    "refresh",
  ];
  const base = {
    foldTier: "narrow" as const,
    editMode: true,
    searchExpanded: true,
  };
  assert.deepEqual(
    actions.map((action) =>
      galleryActionRoute(action, { ...base, batchMode: false }),
    ),
    ["hidden", "hidden", "hidden", "hidden", "hidden", "hidden", "hidden"],
  );
  assert.deepEqual(
    actions.map((action) =>
      galleryActionRoute(action, { ...base, batchMode: true }),
    ),
    ["hidden", "hidden", "search", "hidden", "hidden", "hidden", "hidden"],
  );
});

test("full-render focus precedence keeps owned search focus ahead of batch", () => {
  assert.equal(
    fullRenderFocusTarget({ searchOwnedFocus: true, batchMode: true }),
    "search",
  );
  assert.equal(
    fullRenderFocusTarget({ searchOwnedFocus: false, batchMode: true }),
    "batch",
  );
  assert.equal(
    fullRenderFocusTarget({ searchOwnedFocus: false, batchMode: false }),
    "none",
  );
});

test("batch toggle restores a visible route after leaving expanded search", () => {
  assert.equal(
    batchToggleFocusTarget({
      enabled: false,
      foldTier: "narrow",
      searchExpanded: true,
    }),
    "search",
  );
  assert.equal(
    batchToggleFocusTarget({
      enabled: true,
      foldTier: "narrow",
      searchExpanded: true,
    }),
    "batch",
  );
  assert.equal(
    batchToggleFocusTarget({
      enabled: false,
      foldTier: "compact",
      searchExpanded: false,
    }),
    "view",
  );
});

test("compact active batch returns to the bar or the expanded-search slot", () => {
  const base = {
    foldTier: "compact" as const,
    editMode: true,
    batchMode: true,
  };
  assert.equal(
    galleryActionRoute("batch", { ...base, searchExpanded: false }),
    "bar",
  );
  assert.equal(
    galleryActionRoute("batch", { ...base, searchExpanded: true }),
    "search",
  );
});

test("shared batch descriptor labels, presses, disables, and guards activation", () => {
  assert.deepEqual(
    describeBatchAction({
      editMode: true,
      batchMode: false,
      batchSaving: false,
    }),
    { label: "여러 선택", pressed: false, disabled: false, classes: "" },
  );
  const active = describeBatchAction({
    editMode: true,
    batchMode: true,
    batchSaving: true,
  });
  assert.equal(active.label, "여러 선택 끝내기");
  assert.equal(active.pressed, true);
  assert.equal(active.disabled, true);
  let calls = 0;
  assert.equal(
    activateDescribedBatchAction(active, () => {
      calls += 1;
    }),
    false,
  );
  assert.equal(calls, 0);
});

test("all three batch routes use the shared GalleryView activator", () => {
  const view = readFileSync(join(root, "src/views/GalleryView.ts"), "utf8");
  const header = view.slice(
    view.indexOf("private renderHeader"),
    view.indexOf("private renderEmpty"),
  );
  assert.match(
    header,
    /charinfo-gallery__search-batch[\s\S]*?this\.activateBatchAction\(\)/,
  );
  assert.match(
    header,
    /const batchBtn[\s\S]*?this\.activateBatchAction\(\)/,
  );
  assert.match(
    header,
    /activateBatchAction: \(\) => this\.activateBatchAction\(\)/,
  );
});

test("responsive tier changes map disappearing controls to visible peers", () => {
  const base = { editMode: true, batchMode: false, searchExpanded: false };
  assert.equal(
    responsiveFocusTargetAfterResize({
      ...base,
      owner: "search-trigger",
      nextTier: "none",
    }),
    "search-input",
  );
  assert.equal(
    responsiveFocusTargetAfterResize({
      ...base,
      owner: "search-close",
      nextTier: "narrow",
      searchExpanded: true,
    }),
    "search-close",
  );
  assert.equal(
    responsiveFocusTargetAfterResize({
      ...base,
      owner: "batch",
      nextTier: "compact",
    }),
    "view",
  );
  assert.equal(
    responsiveFocusTargetAfterResize({
      ...base,
      owner: "view-popover",
      nextTier: "narrow",
    }),
    "view",
  );
  assert.equal(
    responsiveFocusTargetAfterResize({
      ...base,
      owner: "batch",
      nextTier: "narrow",
      batchMode: true,
      searchExpanded: true,
    }),
    "batch",
  );
});

test("folded property activation has an explicit batch guard", () => {
  const popover = readFileSync(
    join(root, "src/ui/ViewSettingsPopover.ts"),
    "utf8",
  );
  assert.match(
    popover,
    /if \(this\.responsiveState\.batchMode \|\| !this\.responsiveState\.cardEditActive\) \{\s*return;/,
  );
  assert.match(popover, /"aria-disabled": row\.disabled \? "true" : "false"/);
});

test("manual refresh single-flight deduplicates, clears, and retries", async () => {
  const flight = new AsyncSingleFlight();
  let resolve!: () => void;
  let starts = 0;
  const start = () => {
    starts += 1;
    return new Promise<void>((done) => {
      resolve = done;
    });
  };
  const first = flight.run(start, () => assert.fail("unexpected error"));
  const repeated = flight.run(start, () => assert.fail("unexpected error"));
  assert.equal(first, repeated);
  assert.equal(flight.pending, true);
  await Promise.resolve();
  assert.equal(starts, 1);
  resolve();
  await first;
  assert.equal(flight.pending, false);

  let errors = 0;
  await flight.run(
    () => Promise.reject(new Error("offline")),
    () => {
      errors += 1;
    },
  );
  assert.equal(errors, 1);
  assert.equal(flight.pending, false);
  await flight.run(() => Promise.resolve(), () => assert.fail("unexpected error"));
});
