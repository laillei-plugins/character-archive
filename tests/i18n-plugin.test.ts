import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Bundle the real plugin, settings migration and i18n singleton together.
// Only Obsidian's host boundary is replaced; no migrated fields or save methods are reimplemented.
const bundle = await build({
  stdin: {
    contents: `export { default as Plugin } from "./src/main.ts";
      export * from "./src/settings.ts";
      export * from "./src/i18n/index.ts";
      export { GalleryView } from "./src/views/GalleryView.ts";
      export { CharinfoSettingTab } from "./src/ui/SettingTab.ts";
      export { ShareGalleryModal } from "./src/ui/ShareGalleryModal.ts";
      export { renderCleanBody, parseDetailDoc } from "./src/ui/cleanBody.ts";
      export { characterNameProblemMessage } from "./src/data/characterName.ts";
      export { migratedBuiltinBaseline, fieldLabel } from "./src/data/groupSchema.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "cjs", platform: "node", external: ["obsidian"],
});

class HostPlugin {
  app: any;
  manifest = { version: "0.1.29" };
  disposers: (() => void)[] = [];
  commands: any[] = [];
  ribbon = { attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { this.attrs[k] = v; } };
  register(fn: () => void) { this.disposers.push(fn); }
  addCommand(command: any) { command.name = `Character Archive: ${command.name}`; this.commands.push(command); return command; }
  addRibbonIcon(_icon: string, title: string) { this.ribbon.attrs["aria-label"] = title; return this.ribbon; }
  registerView() {} registerEvent() {} registerMarkdownPostProcessor() {} addSettingTab() {}
  registerMarkdownCodeBlockProcessor() {}
}
class HostSettingTab { containerEl = { isShown: () => true }; }
const settingRows: any[] = [];
class HostSetting {
  row: any;
  constructor(_container: unknown) { this.row = {}; settingRows.push(this.row); }
  setName(value: string) { this.row.name = value; return this; }
  setDesc(value: string) { this.row.description = value; return this; }
  addDropdown(build: (dropdown: any) => unknown) {
    const row = this.row;
    row.options = [];
    const dropdown = {
      addOption(id: string, label: string) { row.options.push([id, label]); return this; },
      setValue(value: string) { row.value = value; return this; },
      onChange(callback: (value: string) => Promise<void>) { row.change = callback; return this; },
    };
    build(dropdown); return this;
  }
}
let displayLanguage: unknown = "en";
const host = new Proxy({
  Plugin: HostPlugin, PluginSettingTab: HostSettingTab, Setting: HostSetting,
  getLanguage: () => displayLanguage,
  setIcon() {},
  normalizePath: (s: string) => s,
  debounce: (f: any) => f,
}, { get(target, key) { return Reflect.get(target, key) ?? class {}; } });
const module = { exports: {} as any };
new Function("require", "module", "exports", bundle.outputFiles[0]!.text)(() => host, module, module.exports);
const api = module.exports;

function harness(stored: unknown) {
  const plugin = new api.Plugin();
  let disk = structuredClone(stored);
  let saves = 0;
  let rejectSave = false;
  const gallery = Object.create(api.GalleryView.prototype);
  let renders = 0;
  gallery.refresh = async () => { renders++; };
  plugin.app = {
    workspace: { on: () => ({}), onLayoutReady() {}, getLeavesOfType: () => [{ view: gallery }] },
    metadataCache: { on: () => ({}) }, vault: { on: () => ({}) },
  };
  plugin.loadData = async () => structuredClone(disk);
  plugin.saveData = async (value: unknown) => {
    saves++;
    if (rejectSave) throw Error("disk unavailable");
    disk = structuredClone(value);
  };
  // Unrelated startup maintenance is outside this host double.
  plugin.refreshSchemaRoots = () => {};
  plugin.installGalleryOpenFileHook = () => {};
  plugin.registerLibraryFolderClick = () => {};
  return { plugin, gallery, disk: () => disk as any, saves: () => saves, renders: () => renders,
    failSave: (value: boolean) => { rejectSave = value; }, dispose: () => plugin.disposers.forEach((fn: () => void) => fn()) };
}

test("the real migration keeps existing installs Korean and detects fresh installs once", () => {
  assert.equal(api.migrateSettings({}, () => "en").language, "ko");
  assert.equal(api.migrateSettings(null, () => "ko-KR").language, "ko");
  assert.equal(api.migrateSettings(undefined, () => null).language, "en");
  assert.equal(api.migrateSettings(null, () => "ja").language, "en");
  assert.equal(api.migrateSettings({ language: "en" }, () => "ko").language, "en");
});

test("first load persists the choice; subsequent loads do not re-detect or re-save", async () => {
  displayLanguage = "ko-KR";
  const h = harness(null);
  await h.plugin.loadSettings();
  assert.equal(h.disk().language, "ko");
  assert.equal(h.plugin.hadStoredSettings, false, "saving the default must not turn a fresh install into an update");
  assert.equal(h.saves(), 1);
  displayLanguage = "en";
  await h.plugin.loadSettings();
  assert.equal(h.plugin.settings.language, "ko");
  assert.equal(h.saves(), 1);
  const existing = harness({ libraryFolder: "My library" });
  await existing.plugin.loadSettings();
  assert.equal(existing.disk().language, "ko");
  assert.equal(existing.disk().libraryFolder, "My library");
});

test("changing language saves before notifying, updates commands, ribbon, open gallery and settings", async () => {
  const h = harness({ language: "en" });
  let settingsRenders = 0;
  const previousDisplay = api.CharinfoSettingTab.prototype.display;
  api.CharinfoSettingTab.prototype.display = () => { settingsRenders++; };
  try {
    await h.plugin.onload();
    assert.equal(h.plugin.commands[0].name, "Character Archive: Open gallery");
    const events: string[] = [];
    const off = api.uiLanguage.subscribe((language: string) => {
      assert.equal(h.disk().language, language);
      events.push(language);
    });
    await h.plugin.setLanguage("ko");
    assert.equal(h.plugin.commands[0].name, "Character Archive: 갤러리 열기");
    assert.equal(h.plugin.commands[1].name, "Character Archive: 갤러리 편집 켜기 / 끄기");
    assert.equal(h.plugin.ribbon.attrs["aria-label"], "갤러리 열기");
    assert.equal(h.renders(), 1);
    assert.equal(settingsRenders, 1);
    assert.deepEqual(events, ["ko"]);
    await h.plugin.setLanguage("ko");
    assert.equal(h.saves(), 2);
    assert.equal(h.renders(), 1, "an unchanged language must not trigger a render");
    await h.plugin.setLanguage("en");
    assert.equal(h.plugin.commands[0].name, "Character Archive: Open gallery");
    assert.equal(h.plugin.ribbon.attrs["aria-label"], "Open gallery");
    assert.equal(settingsRenders, 2);
    off();
  } finally {
    h.dispose(); api.CharinfoSettingTab.prototype.display = previousDisplay; api.uiLanguage.set("ko");
  }
});

test("a failed language save restores settings, emits no event and keeps the current UI", async () => {
  const h = harness({ language: "en" });
  await h.plugin.loadSettings();
  h.plugin.knownLibraryFolder = h.plugin.settings.libraryFolder;
  h.failSave(true);
  const events: string[] = [];
  const off = api.uiLanguage.subscribe((language: string) => events.push(language));
  try {
    await assert.rejects(h.plugin.setLanguage("ko"), /disk unavailable/);
    assert.equal(h.plugin.settings.language, "en");
    assert.equal(h.disk().language, "en");
    assert.equal(api.uiLanguage.current, "en");
    assert.deepEqual(events, []);
    h.failSave(false);
    await h.plugin.setLanguage("ko");
    assert.equal(h.disk().language, "ko");
    assert.deepEqual(events, ["ko"]);
  } finally { off(); api.uiLanguage.set("ko"); }
});

test("raw data labels, schema defaults and share-facing field labels stay Korean in English UI", () => {
  try {
    api.uiLanguage.set("en");
    const settings = api.migrateSettings(null, () => "en");
    assert.equal(settings.propertyDisplayNames.status, "상태");
    assert.equal(settings.activeGenre, "예시");
    assert.deepEqual(settings.webSharePanelHeaders, ["속성", "프롬프트"]);
    const baseline = api.migratedBuiltinBaseline(settings);
    const name = baseline.find((field: any) => field.id === "name");
    assert.equal(name.key, "이름");
    assert.equal(name.label, "이름");
    assert.equal(api.fieldLabel(name), "이름");
    assert.equal(api.characterNameProblemMessage("empty"), "Enter a name.");
    api.uiLanguage.set("ko");
    assert.equal(api.characterNameProblemMessage("empty"), "이름을 입력해 주세요.");
  } finally { api.uiLanguage.set("ko"); }
});


test("rapid language choices keep user order even before the first save starts", async () => {
  const h = harness({ language: "en" });
  await h.plugin.loadSettings();
  h.plugin.knownLibraryFolder = h.plugin.settings.libraryFolder;
  try {
    await Promise.all([h.plugin.setLanguage("ko"), h.plugin.setLanguage("en")]);
    assert.equal(h.plugin.settings.language, "en");
    assert.equal(h.disk().language, "en");
    assert.equal(api.uiLanguage.current, "en");
  } finally { api.uiLanguage.set("ko"); }
});

test("the first settings row offers the fixed language labels and saves before repaint", async () => {
  const stop = new Error("stop before unrelated settings");
  const plugin = { settings: { language: "en" }, setLanguage: async (_value: string) => {} };
  const tab = new api.CharinfoSettingTab({}, plugin);
  tab.containerEl = { empty() { settingRows.length = 0; }, createDiv() { throw stop; } };
  const display = api.CharinfoSettingTab.prototype.display;
  try {
    for (const [language, description] of [
      ["en", "Language of the plugin's buttons, menus and field names. Your notes are not changed."],
      ["ko", "플러그인 버튼, 메뉴, 항목 이름의 언어예요. 노트 내용은 바뀌지 않아요."],
    ]) {
      api.uiLanguage.set(language);
      plugin.settings.language = language!;
      assert.throws(() => display.call(tab), (error: unknown) => error === stop);
      assert.equal(settingRows.length, 1, "language precedes even the glossary");
      const row = settingRows[0];
      assert.equal(row.name, "Language / 언어");
      assert.equal(row.description, description);
      assert.equal(row.value, language);
      assert.deepEqual(row.options, [["en", "English"], ["ko", "한국어"]]);
      const order: string[] = [];
      plugin.setLanguage = async (value: string) => { order.push(value); };
      tab.display = () => { order.push("paint"); };
      await row.change(language === "en" ? "ko" : "en");
      assert.deepEqual(order, [language === "en" ? "ko" : "en", "paint"]);
      plugin.setLanguage = async () => { throw Error("save failed"); };
      await assert.rejects(row.change("ko"), /save failed/);
      assert.equal(order.length, 2, "a failed save does not repaint");
    }
  } finally { api.uiLanguage.set("ko"); }
});

test("gallery field names translate built-ins without changing raw schema labels", () => {
  const view = Object.create(api.GalleryView.prototype);
  view.plugin = { settings: { propertyDisplayNames: { status: "상태" } } };
  const field = { id: "status", key: "상태", label: "상태" };
  try {
    api.uiLanguage.set("en");
    assert.equal(view.fieldDisplayLabel(field), "Status");
    assert.equal(field.label, "상태");
    view.plugin.settings.propertyDisplayNames.status = "진행";
    assert.equal(view.fieldDisplayLabel(field), "진행");
    api.uiLanguage.set("ko");
    view.plugin.settings.propertyDisplayNames.status = "상태";
    assert.equal(view.fieldDisplayLabel(field), "상태");
  } finally { api.uiLanguage.set("ko"); }
});

test("share title summaries remain Korean in exported content under English UI", () => {
  const modal = Object.create(api.ShareGalleryModal.prototype);
  modal.records = [{}, {}];
  modal.selectedArchives = new Set(["원본 A", "원본 B"]);
  modal.title = "원본 제목";
  try {
    api.uiLanguage.set("en");
    assert.equal(modal.shareTitle(), "원본 A and 1 more");
    assert.equal(modal.shareTitle("share"), "원본 A 외 1");
    api.uiLanguage.set("ko");
    assert.equal(modal.shareTitle(), "원본 A 외 1");
  } finally { api.uiLanguage.set("ko"); }
});

// Small DOM host for the real note renderer. It records painted text/attributes;
// parsing, translation and render branches remain production code.
class SheetElement {
  tag: string;
  text = "";
  attrs: Record<string, string> = {};
  classes: string[] = [];
  children: SheetElement[] = [];
  constructor(tag = "div", options: any = {}) {
    this.tag = tag; this.text = options.text ?? "";
    this.attrs = { ...options.attr };
    this.classes = (options.cls ?? "").split(" ").filter(Boolean);
  }
  empty() { this.children = []; this.text = ""; }
  addClass(name: string) { this.classes.push(name); }
  setText(text: string) { this.text = text; }
  appendText(text: string) { this.text += text; }
  setAttr(name: string, value: string) { this.attrs[name] = value; }
  addEventListener() {}
  createEl(tag: string, options: any = {}) {
    const child = new SheetElement(tag, options); this.children.push(child); return child;
  }
  createDiv(options: any = {}) { return this.createEl("div", options); }
  createSpan(options: any = {}) { return this.createEl("span", options); }
  all(): SheetElement[] { return [this, ...this.children.flatMap((child) => child.all())]; }
  querySelector() {
    return this.all().find((node) => node.classes.some((cls) => ["charinfo-sheet__block", "charinfo-sheet__meta"].includes(cls))) ?? null;
  }
}

test("note paint localizes peek controls while preserving note content and shared rendering", () => {
  const markdown = '## 신상\n\n**이름:** 원본 이름\n\n## 프롬프트\n\n```\n1.2::original text::\n```';
  const paint = (mode: string) => {
    const root = new SheetElement(); api.renderCleanBody(root, markdown, mode); return root;
  };
  try {
    api.uiLanguage.set("ko");
    const parsed = api.parseDetailDoc(markdown, "peek");
    const shareKorean = paint("share");
    const peekKorean = paint("peek");
    api.uiLanguage.set("en");
    assert.deepEqual(paint("share"), shareKorean, "shared rendering must not follow plugin language");
    assert.deepEqual(api.parseDetailDoc(markdown, "peek"), parsed, "note parsing must not follow plugin language");
    const peekEnglish = paint("peek");
    const copyButtons = (root: SheetElement) => root.all().filter((node) => node.tag === "button");
    assert.ok(copyButtons(peekEnglish).length > 0);
    assert.match(copyButtons(peekKorean)[0]!.attrs["aria-label"]!, / 복사$/);
    assert.match(copyButtons(peekEnglish)[0]!.attrs["aria-label"]!, /^Copy /);
    assert.deepEqual(peekEnglish.all().filter((node) => node.tag === "pre").map((node) => node.text),
      peekKorean.all().filter((node) => node.tag === "pre").map((node) => node.text));
    assert.deepEqual(peekEnglish.all().filter((node) => node.classes.includes("charinfo-sheet__heading")).map((node) => node.text),
      ["신상", "프롬프트"]);
  } finally { api.uiLanguage.set("ko"); }
});
