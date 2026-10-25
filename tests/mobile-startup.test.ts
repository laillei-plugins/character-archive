/** Execute production startup/listener/hook code with a minimal Obsidian host. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `export { default as Plugin } from "./src/main.ts";
      export { fileHasGalleryFrontmatter } from "./src/page/galleryPage.ts";
      export { migrateSettings, DEFAULT_SETTINGS } from "./src/settings.ts";
      export { WorkspaceLeaf, TFile, Platform } from "obsidian";`,
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
        export class Menu {}; export const Platform = { isMobile: false }; export const MarkdownRenderer = {};
        export const setIcon = () => {}; export const normalizePath = s => s;
        export const parseYaml = () => ({ charinfo: "gallery" }); export const stringifyYaml = () => "";
        export const getFrontMatterInfo = () => ({}); export const requestUrl = async () => ({});
        export const debounce = f => f;
      ` }));
    },
  }],
  bundle: true, write: false, format: "esm", platform: "node",
});
const api = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0]!.text).toString("base64"));

function file(path: string, extension = "md") {
  return Object.assign(new api.TFile(), { path, extension, stat: { mtime: 1, size: 2 } });
}

function pluginHarness() {
  const plugin = new api.Plugin();
  const disposers: Array<() => void> = [];
  plugin.register = (dispose: () => void) => disposers.push(dispose);
  plugin.settings = api.migrateSettings({ language: "en" });
  return { plugin, dispose: () => disposers.reverse().forEach((dispose) => dispose()) };
}

test("settings migration removes the old synced cache without mutating stored data", () => {
  const stored = { language: "en", schemaScanCache: { signature: "old", files: {} }, libraryFolder: "My Characters" };
  const settings = api.migrateSettings(stored);
  assert.equal("schemaScanCache" in settings, false);
  assert.equal("schemaScanCache" in api.DEFAULT_SETTINGS, false);
  assert.equal(settings.libraryFolder, stored.libraryFolder);
  assert.equal(stored.schemaScanCache.signature, "old");
});

test("gallery probe rejects binary files before metadata or disk access", async () => {
  let reads = 0;
  const plugin = { app: {
    metadataCache: { getFileCache: () => { reads++; throw new Error("unexpected cache read"); } },
    vault: { cachedRead: () => { reads++; throw new Error("unexpected disk read"); } },
  } };
  for (const extension of ["pdf", "png", "jpg", ""]) {
    assert.equal(await api.fileHasGalleryFrontmatter(plugin, file(`Other/file.${extension}`, extension)), false);
  }
  assert.equal(reads, 0);
});

test("loading settings drops the legacy cache without an extra migration save", async () => {
  const { plugin } = pluginHarness();
  const stored = { language: "en", schemaScanCache: { signature: "legacy", files: {} } };
  plugin.loadData = async () => stored;
  let saves = 0;
  plugin.saveData = async () => { saves++; };
  await plugin.loadSettings();
  assert.equal(saves, 0);
  assert.equal("schemaScanCache" in plugin.settings, false);
});

test("schema scans persist locally and skip unchanged notes without settings writes", async () => {
  const { plugin } = pluginHarness();
  const note = file("Character Archive/A.md");
  const writes: unknown[] = [];
  let reconciled = 0;
  plugin.manifest = { version: "0.1.30" };
  plugin.identityRoots = plugin.schemaRoots = ["Character Archive"];
  plugin.app = {
    vault: { getMarkdownFiles: () => [note], getAbstractFileByPath: () => note },
    saveLocalStorage: (_key: string, value: unknown) => { writes.push(value); },
  };
  plugin.commitSettings = () => assert.fail("scan wrote synced settings");
  plugin.healLane = { enqueue: async (path: string) => {
    reconciled++;
    plugin.schemaOutcomes.set(path, "clean");
  } };
  await plugin.scanSchemaRoots(["Character Archive"]);
  assert.equal(reconciled, 1);
  assert.equal(writes.length, 1);
  assert.equal(plugin.schemaScanCache.files[note.path], "1:2");
  await plugin.scanSchemaRoots(["Character Archive"]);
  assert.equal(reconciled, 1);
  assert.equal(writes.length, 1);
});

test("gallery probe retains cache and Markdown cache-miss behavior", async () => {
  let reads = 0;
  let cache: unknown = null;
  const plugin = { settings: { libraryFolder: "Characters" }, app: {
    metadataCache: { getFileCache: () => cache },
    vault: { cachedRead: async () => { reads++; return "---\ncharinfo: gallery\n---\n"; } },
  } };
  const note = file("Elsewhere/Gallery.md");
  assert.equal(await api.fileHasGalleryFrontmatter(plugin, note), true);
  assert.equal(reads, 1);
  cache = { frontmatter: { charinfo: "gallery" } };
  assert.equal(await api.fileHasGalleryFrontmatter(plugin, note), true);
  cache = { frontmatter: { kind: "character" } };
  assert.equal(await api.fileHasGalleryFrontmatter(plugin, note), false);
  assert.equal(reads, 1);
});

test("openFile uninstall restores its own wrapper and preserves earlier wrappers", async () => {
  const { plugin, dispose } = pluginHarness();
  const calls: unknown[][] = [];
  const original = function (...args: unknown[]) { calls.push([this, ...args]); return Promise.resolve("native"); };
  api.WorkspaceLeaf.prototype.openFile = original;
  plugin.installGalleryOpenFileHook();
  plugin.installGalleryOpenFileHook(); // idempotent
  const leaf = new api.WorkspaceLeaf();
  const target = {};
  const state = { active: false };
  assert.equal(await leaf.openFile(target, state), "native");
  assert.deepEqual(calls, [[leaf, target, state]]);
  dispose();
  assert.equal(api.WorkspaceLeaf.prototype.openFile, original);
});

test("a later wrapper survives uninstall and the retained hook passes through", async () => {
  const { plugin, dispose } = pluginHarness();
  const calls: unknown[][] = [];
  api.WorkspaceLeaf.prototype.openFile = function (...args: unknown[]) {
    calls.push([this, ...args]); return Promise.resolve("native");
  };
  plugin.installGalleryOpenFileHook();
  const ours = api.WorkspaceLeaf.prototype.openFile;
  let laterCalls = 0;
  const later = function (...args: unknown[]) { laterCalls++; return ours.apply(this, args); };
  api.WorkspaceLeaf.prototype.openFile = later;
  dispose();
  assert.equal(api.WorkspaceLeaf.prototype.openFile, later);
  plugin.isSidebarLeaf = () => { assert.fail("inactive hook inspected the leaf"); };
  const leaf = new api.WorkspaceLeaf();
  const target = file("Characters/Gallery.md");
  const state = { active: false };
  assert.equal(await leaf.openFile(target, state), "native");
  assert.equal(laterCalls, 1);
  assert.deepEqual(calls, [[leaf, target, state]]);
});

test("active openFile hook still routes gallery notes to the gallery view", async () => {
  const { plugin, dispose } = pluginHarness();
  plugin.app = { metadataCache: { getFileCache: () => ({ frontmatter: { charinfo: "gallery" } }) } };
  plugin.isSidebarLeaf = () => false;
  let nativeCalls = 0;
  api.WorkspaceLeaf.prototype.openFile = async () => { nativeCalls++; };
  plugin.installGalleryOpenFileHook();
  const states: any[] = [];
  const leaf = new api.WorkspaceLeaf();
  leaf.setViewState = async (...args: unknown[]) => { states.push(args); };
  try {
    await leaf.openFile(file("Elsewhere/Gallery.md"), { active: false, eState: { focus: true } });
    assert.equal(nativeCalls, 0);
    assert.equal(states[0][0].state.file, "Elsewhere/Gallery.md");
    assert.equal(states[0][0].active, false);
    assert.deepEqual(states[0][1], { focus: true });
  } finally { dispose(); }
});

test("uninstall during an awaited gallery probe prevents late interception", async () => {
  const { plugin, dispose } = pluginHarness();
  let finish!: (text: string) => void;
  plugin.app = {
    metadataCache: { getFileCache: () => null },
    vault: { cachedRead: () => new Promise<string>((resolve) => { finish = resolve; }) },
  };
  plugin.isSidebarLeaf = () => false;
  api.WorkspaceLeaf.prototype.openFile = async () => "native";
  plugin.installGalleryOpenFileHook();
  const leaf = new api.WorkspaceLeaf();
  leaf.setViewState = () => assert.fail("unloaded hook intercepted the note");
  const pending = leaf.openFile(file("Elsewhere/Gallery.md"));
  dispose();
  finish("---\ncharinfo: gallery\n---\n");
  assert.equal(await pending, "native");
});

async function startupHarness(mobile: boolean) {
  const { plugin, dispose } = pluginHarness();
  let layoutReady!: () => void;
  let changed!: (file: unknown, data: string, cache: unknown) => void;
  const scans: unknown[] = [];
  const observed: unknown[] = [];
  const timers = new Map<number, () => void>();
  const delays: number[] = [];
  let id = 0;
  const oldWindow = globalThis.window;
  globalThis.window = {
    setTimeout(cb: () => void, delay: number) { delays.push(delay); timers.set(++id, cb); return id; },
    clearTimeout(timer: number) { timers.delete(timer); },
  } as any;
  api.Platform.isMobile = mobile;
  plugin.app = {
    workspace: { onLayoutReady: (cb: () => void) => { layoutReady = cb; }, on: () => ({}) },
    metadataCache: {
      on: (_name: string, cb: typeof changed) => { changed = cb; return {}; },
      getFileCache: () => ({ frontmatter: { kind: "character" } }),
    },
    vault: { on: () => ({}) },
  };
  plugin.loadSettings = async () => {};
  plugin.refreshSchemaRoots = (opts: unknown) => { if (opts) scans.push(opts); };
  plugin.installGalleryOpenFileHook = () => {};
  plugin.registerLibraryFolderClick = () => {};
  plugin.registerView = plugin.registerEvent = plugin.registerMarkdownCodeBlockProcessor = () => {};
  plugin.addRibbonIcon = () => ({ setAttribute() {} });
  plugin.addCommand = () => ({ name: "command" });
  plugin.addSettingTab = plugin.registerMarkdownPostProcessor = () => {};
  plugin.claimLegacyWebShareAfterMetadata = async () => {};
  plugin.seedCharacterNameBaselines = () => {};
  plugin.reclaimGalleryLeaves = plugin.openUpdateNotesIfNeeded = async () => {};
  plugin.observeCharacterNameProperty = async (note: unknown) => { observed.push(note); };
  plugin.fileTouchesAnyOpenGallery = () => false;
  try {
    await plugin.onload();
  } catch (error) {
    globalThis.window = oldWindow;
    throw error;
  }
  return {
    plugin, scans, observed, timers, delays,
    layout: () => layoutReady(), changed: (...args: Parameters<typeof changed>) => changed(...args),
    cleanup() { plugin.onunload(); dispose(); globalThis.window = oldWindow; },
  };
}

test("metadata changes observe names only for cached character notes", async () => {
  const h = await startupHarness(false);
  try {
    const note = file("Characters/A.md");
    for (const cache of [undefined, {}, { frontmatter: {} }, { frontmatter: { kind: "daily" } }]) {
      h.changed(note, "", cache);
    }
    assert.equal(h.observed.length, 0);
    h.changed(note, "", { frontmatter: { kind: " character " } });
    assert.deepEqual(h.observed, [note]);
  } finally { h.cleanup(); }
});

test("mobile startup delays the scan and clears its timer on unload", async () => {
  const h = await startupHarness(true);
  try {
    h.layout();
    assert.deepEqual(h.scans, []);
    assert.deepEqual(h.delays, [3000]);
    assert.equal(h.timers.size, 1);
    const callback = [...h.timers.values()][0]!;
    h.plugin.onunload();
    assert.equal(h.timers.size, 0);
    callback(); // even an already-dispatched timeout cannot start stale work
    assert.deepEqual(h.scans, []);
  } finally { h.cleanup(); }
});

test("mobile timer starts the unchanged scan and desktop starts immediately", async () => {
  for (const mobile of [true, false]) {
    const h = await startupHarness(mobile);
    try {
      h.layout();
      if (mobile) {
        [...h.timers.values()][0]!();
        assert.equal(h.plugin.startupSchemaScanTimer, null);
      } else {
        assert.deepEqual(h.delays, []);
      }
      assert.deepEqual(h.scans, [{ scanNew: true }]);
    } finally { h.cleanup(); }
  }
});

test("root discovery while the mobile timer is pending defers all scans", () => {
  const { plugin } = pluginHarness();
  plugin.app = { vault: { getMarkdownFiles: () => [] } };
  plugin.startupSchemaScanTimer = 1;
  const queued: string[][] = [];
  plugin.queueSchemaScan = (roots: string[]) => { queued.push(roots); };
  plugin.refreshSchemaRoots({ scanNew: true });
  assert.deepEqual(queued, []);
  assert.deepEqual(plugin.identityRoots, ["Character Archive"]);
  plugin.startupSchemaScanTimer = null;
  plugin.refreshSchemaRoots({ scanNew: true });
  assert.deepEqual(queued, [["Character Archive"]]);
});

test("folder click listener avoids vault enumeration until a title has a path", () => {
  const { plugin } = pluginHarness();
  const previous = { document: globalThis.document, Element: globalThis.Element, HTMLElement: globalThis.HTMLElement };
  class FakeElement {
    title: FakeElement | null;
    path: string | null;
    chevron: boolean;
    constructor(title: FakeElement | null = null, path: string | null = null, chevron = false) {
      this.title = title; this.path = path; this.chevron = chevron;
    }
    closest(selector: string) { return selector === ".nav-folder-title" ? this.title : (this.chevron ? this : null); }
    getAttribute() { return this.path; }
  }
  Object.assign(globalThis, { document: {}, Element: FakeElement, HTMLElement: FakeElement });
  let listener!: (event: any) => void;
  plugin.registerDomEvent = (_doc: unknown, _event: string, cb: typeof listener) => { listener = cb; };
  let enumerations = 0;
  plugin.app = { vault: { getMarkdownFiles: () => { enumerations++; return []; } } };
  const opened: string[] = [];
  plugin.openLibraryFolderGallery = async (path: string) => { opened.push(path); };
  let prevented = 0;
  const click = (target: unknown, extra = {}) => listener({
    button: 0, target, preventDefault: () => { prevented++; }, stopPropagation() {}, ...extra,
  });
  try {
    plugin.registerLibraryFolderClick();
    click(null);
    click(new FakeElement());
    click(new FakeElement(new FakeElement()));
    click(new FakeElement(new FakeElement(null, "")));
    assert.equal(enumerations, 0);
    const title = new FakeElement(null, "Character Archive");
    click(new FakeElement(title), { ctrlKey: true });
    click(new FakeElement(title), { button: 1 });
    assert.equal(enumerations, 0);
    click(new FakeElement(title));
    assert.equal(enumerations, 1);
    assert.deepEqual(opened, ["Character Archive"]);
    assert.equal(prevented, 1);
    click(new FakeElement(title, null, true));
    click(new FakeElement(new FakeElement(null, "Unrelated")));
    assert.equal(prevented, 1);
    assert.deepEqual(opened, ["Character Archive"]);
  } finally { Object.assign(globalThis, previous); }
});
