/** Persistence and rollback tests run the shipped plugin commit method with
 * only Obsidian host classes and disk persistence replaced by test doubles.
 * View behavior is exercised by the separate browser integration checks.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents:
      'import Plugin from "./src/main.ts"; export const commitSettings = Plugin.prototype.commitSettings; export * from "./src/settings.ts"; export { ArchiveNameError, listArchives, renameDeclaredArchive, archiveRenameNotice } from "./src/data/archiveRegistry.ts";',
    resolveDir: process.cwd(),
  },
  plugins: [{
    name: "obsidian-host-double",
    setup(b) {
      b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
      b.onLoad({ filter: /.*/, namespace: "host" }, () => ({ contents: `
        export class App {}; export class Component {}; export class FileView {};
        export class WorkspaceLeaf {}; export class TFile {}; export class TFolder {};
        export class Plugin {}; export class PluginSettingTab {}; export class Setting {};
        export class MarkdownRenderChild {}; export class Modal {}; export class Notice {};
        export class Menu {}; export const Platform = {}; export const MarkdownRenderer = {};
        export const setIcon = () => {}; export const normalizePath = s => s;
        export const parseYaml = () => ({}); export const stringifyYaml = () => "";
        export const getFrontMatterInfo = () => ({}); export const requestUrl = async () => ({});
        export const debounce = f => f;
      ` }));
    },
  }],
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
const PAGE = "Character Archive/Character Archive.md";

type Settings = Record<string, any>;

/** Execute the actual queue; only its saveSettings I/O is substituted. */
function commitHarness(initial: Settings, save: (settings: Settings) => Promise<void>) {
  const plugin = {
    settings: initial,
    settingsWrite: Promise.resolve() as Promise<void>,
    saveSettings(): Promise<void> { return save(plugin.settings); },
    commitSettings: api.commitSettings as (mutate: (s: Settings) => void) => Promise<void>,
  };
  return plugin;
}

test("settings without declarations load as an empty registry and backfill nothing", () => {
  assert.deepEqual(api.migrateSettings({}).declaredArchives, []);
  assert.deepEqual(api.migrateSettings(null).declaredArchives, []);
  const legacy = api.migrateSettings({
    activeGenre: "Fearless",
    groupOrderByGenre: { Fearless: ["A"] },
    galleryPageState: { [PAGE]: { activeGenre: "Fearless" } },
    declaredArchives: "not-a-list",
  });
  assert.deepEqual(legacy.declaredArchives, []);
  assert.deepEqual(api.DEFAULT_SETTINGS.declaredArchives, []);
});

test("an empty archive survives save, reload, switching away, and losing its last card", async () => {
  let disk = "";
  const plugin = commitHarness(api.migrateSettings({}), async (settings) => {
    disk = JSON.stringify(settings);
  });
  let created = "";
  await plugin.commitSettings((settings) => {
    created = api.createArchiveForPage(settings, {
      library: LIB,
      name: "  만안 ",
      pagePath: PAGE,
      observed: ["예시"],
      folders: ["_starter"],
    });
  });
  assert.equal(created, "만안");

  const reloaded = api.migrateSettings(JSON.parse(disk));
  assert.deepEqual(reloaded.declaredArchives, [
    { library: LIB, archive: "만안" },
  ]);
  assert.equal(api.getGalleryPageState(reloaded, PAGE).activeGenre, "만안");
  assert.equal(
    api.listArchives(["예시"], reloaded.declaredArchives, LIB).includes("만안"),
    true,
  );

  // Switch to another archive and reload again: the empty one is still listed.
  api.patchGalleryPageState(reloaded, PAGE, { activeGenre: "예시" });
  const again = api.migrateSettings(JSON.parse(JSON.stringify(reloaded)));
  assert.equal(api.getGalleryPageState(again, PAGE).activeGenre, "예시");
  assert.equal(
    api.listArchives(["예시"], again.declaredArchives, LIB).includes("만안"),
    true,
  );

  // First card arrives, then is removed: one entry while it exists, still one after.
  const withCard = api.listArchives(["예시", "만안"], again.declaredArchives, LIB);
  assert.equal(withCard.filter((name: string) => name === "만안").length, 1);
  assert.equal(
    api.listArchives(["예시"], again.declaredArchives, LIB).includes("만안"),
    true,
  );
});

test("creating an archive touches one library and one page", async () => {
  const otherPage = "Second Library/Second Library.md";
  const start = api.migrateSettings({
    galleryPageState: {
      [PAGE]: { activeGenre: "예시" },
      [otherPage]: { activeGenre: "Night" },
    },
    declaredArchives: [{ library: "Second Library", archive: "Night" }],
  });
  const plugin = commitHarness(start, async () => {});
  await plugin.commitSettings((settings) => {
    // The same name is free here: the other library's archive is not ours.
    api.createArchiveForPage(settings, {
      library: LIB,
      name: "Night",
      pagePath: PAGE,
      observed: ["예시"],
      folders: [],
    });
  });
  assert.deepEqual(plugin.settings.declaredArchives, [
    { library: "Second Library", archive: "Night" },
    { library: LIB, archive: "Night" },
  ]);
  assert.equal(api.getGalleryPageState(plugin.settings, PAGE).activeGenre, "Night");
  assert.equal(
    api.getGalleryPageState(plugin.settings, otherPage).activeGenre,
    "Night",
  );
  assert.deepEqual(
    api.listArchives([], plugin.settings.declaredArchives, "Second Library"),
    ["Night"],
  );
});

test("two galleries racing for one name: the commit queue lets exactly one win", async () => {
  const secondPage = "Character Archive/_galleries/Second.md";
  const start = api.migrateSettings({
    galleryPageState: {
      [PAGE]: { activeGenre: "예시" },
      [secondPage]: { activeGenre: "예시" },
    },
  });
  let saves = 0;
  const plugin = commitHarness(start, async () => {
    saves += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  const create = (pagePath: string, name: string) =>
    plugin.commitSettings((settings) => {
      api.createArchiveForPage(settings, {
        library: LIB,
        name,
        pagePath,
        observed: ["예시"],
        folders: [],
      });
    });

  // Both dialogs passed their own pre-check; neither has committed yet.
  const [first, second] = await Promise.allSettled([
    create(PAGE, "Night"),
    create(secondPage, "night"),
  ]);
  assert.equal(first.status, "fulfilled");
  assert.equal(second.status, "rejected");
  const reason = (second as PromiseRejectedResult).reason;
  assert.ok(reason instanceof api.ArchiveNameError);
  assert.equal(
    reason.message,
    "「night」 아카이브가 이미 있어요. 다른 이름을 정해 주세요.",
  );
  assert.equal(saves, 1);
  assert.deepEqual(plugin.settings.declaredArchives, [
    { library: LIB, archive: "Night" },
  ]);
  assert.equal(api.getGalleryPageState(plugin.settings, PAGE).activeGenre, "Night");
  // The loser's page was never moved onto an archive it did not create.
  assert.equal(
    api.getGalleryPageState(plugin.settings, secondPage).activeGenre,
    "예시",
  );
});

test("the commit-time check sees a card or folder that arrived after the dialog opened", async () => {
  const plugin = commitHarness(api.migrateSettings({}), async () => {});
  let observed = ["예시"];
  let folders: string[] = [];
  const attempt = () =>
    plugin.commitSettings((settings) => {
      api.createArchiveForPage(settings, {
        library: LIB,
        name: "Night",
        pagePath: PAGE,
        observed,
        folders,
      });
    });

  observed = ["예시", "night"];
  await assert.rejects(attempt, api.ArchiveNameError);
  observed = ["예시"];
  folders = ["NIGHT"];
  await assert.rejects(attempt, /「NIGHT」 폴더가 이미 있어요/);
  assert.deepEqual(plugin.settings.declaredArchives, []);
  assert.equal(api.getGalleryPageState(plugin.settings, PAGE).activeGenre, "예시");

  folders = [];
  await attempt();
  assert.deepEqual(plugin.settings.declaredArchives, [
    { library: LIB, archive: "Night" },
  ]);
});

test("a failed save leaves no declaration and no selection, and the queue keeps working", async () => {
  let failing = true;
  let disk = "";
  const plugin = commitHarness(api.migrateSettings({}), async (settings) => {
    if (failing) throw new Error("disk full");
    disk = JSON.stringify(settings);
  });
  const attempt = () =>
    plugin.commitSettings((settings) => {
      api.createArchiveForPage(settings, {
        library: LIB,
        name: "만안",
        pagePath: PAGE,
        observed: ["예시"],
        folders: [],
      });
    });

  await assert.rejects(attempt, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error instanceof api.ArchiveNameError, false);
    assert.equal(error.message, "disk full");
    return true;
  });
  assert.deepEqual(plugin.settings.declaredArchives, []);
  assert.equal(api.getGalleryPageState(plugin.settings, PAGE).activeGenre, "예시");
  assert.equal(disk, "");

  // Same name, retried from the still-open dialog once saving works again.
  failing = false;
  await attempt();
  assert.deepEqual(JSON.parse(disk).declaredArchives, [
    { library: LIB, archive: "만안" },
  ]);
  assert.equal(api.getGalleryPageState(plugin.settings, PAGE).activeGenre, "만안");
});

test("renaming an empty declared archive: saved means renamed, failed means untouched", async () => {
  const start = () =>
    api.migrateSettings({
      galleryPageState: { [PAGE]: { activeGenre: "만안" } },
      declaredArchives: [
        { library: LIB, archive: "만안" },
        { library: "Second Library", archive: "만안" },
      ],
    });
  const rename = (plugin: ReturnType<typeof commitHarness>) =>
    plugin.commitSettings((settings) => {
      api.renameDeclaredArchive(settings, LIB, "만안", "월하");
      api.patchGalleryPageState(settings, PAGE, { activeGenre: "월하" });
    });

  const ok = commitHarness(start(), async () => {});
  await rename(ok);
  assert.deepEqual(ok.settings.declaredArchives, [
    { library: LIB, archive: "월하" },
    { library: "Second Library", archive: "만안" },
  ]);
  assert.equal(api.getGalleryPageState(ok.settings, PAGE).activeGenre, "월하");
  assert.equal(
    api.archiveRenameNotice({ next: "월하", count: 0, saved: true }),
    "아카이브 이름을 「월하」로 바꿨어요",
  );

  const failed = commitHarness(start(), async () => {
    throw new Error("disk full");
  });
  await assert.rejects(() => rename(failed), /disk full/);
  assert.deepEqual(failed.settings.declaredArchives, [
    { library: LIB, archive: "만안" },
    { library: "Second Library", archive: "만안" },
  ]);
  assert.equal(api.getGalleryPageState(failed.settings, PAGE).activeGenre, "만안");
  const notice = api.archiveRenameNotice({
    next: "월하",
    count: 0,
    saved: false,
    error: "disk full",
  });
  assert.match(notice, /바꾸지 못했어요/);
  assert.doesNotMatch(notice, /바꿨어요/);
});
