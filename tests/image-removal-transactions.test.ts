import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

// Exercise the production vault transactions with a tiny in-memory Obsidian
// adapter. Parsing is stubbed; ordering, guards and persistence are real code.
const bundle = await build({
  stdin: { contents: 'export * from "./src/data/images.ts"; export { TFile } from "obsidian";', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'memory-obsidian', setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
      export class App {} export class TFolder {}
      export class TFile { constructor(path) { this.path=path; this.name=path.split('/').pop(); } }
      export const normalizePath = path => path;
      export function getFrontMatterInfo(text) { const m=text.match(/^---\\r?\\n([\\s\\S]*?)\\r?\\n---(?:\\r?\\n|$)/); return {exists:!!m,frontmatter:m?.[1]??''}; }
      export function parseYaml(text) { const m=text.match(/^cover:\\s*(.*)$/m); return {cover:(m?.[1]??'').trim().replace(/^['"]|['"]$/g,'')}; }
    ` }));
  } }],
});
const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0]!.text).toString('base64'));
function vault(initial: string) {
  let text = initial;
  const note = new api.TFile('Rin.md');
  const files = ['a.png', 'b.png', 'c.png'].map(path => new api.TFile(path));
  const app = {
    vault: {
      read: async () => text,
      process: async (_file: unknown, transform: (s: string) => string) => { text = transform(text); },
      getAbstractFileByPath: (path: string) => files.find(file => file.path === path),
    },
    metadataCache: { getFirstLinkpathDest: (path: string) => files.find(file => file.path === path) },
    fileManager: { processFrontMatter: async (_file: unknown, mutate: (fm: Record<string,string>) => void) => {
      const fm: Record<string,string> = {};
      mutate(fm);
      text = text.replace(/^---\n[\s\S]*?\n---\n/, '') ;
      text = '---\ncover: '+fm.cover+'\n---\n'+text;
    } },
  };
  return { app, note, files, read: () => text, edit: (value: string) => { text = value; } };
}

test('queued cover pick is persisted before removal rechecks protection', async () => {
  const v = vault('![[a.png]]\n![[b.png]]\n');
  const picking = api.setCharacterCover(v.app, v.note, v.files[1]);
  const removing = api.removeNoteImage(v.app, v.note, 'b.png');
  await picking;
  await assert.rejects(removing, /현재 커버/);
  assert.ok(v.read().includes('![[b.png]]'));
  // A failed operation releases the lane; another non-cover image can be removed.
  const removed = await api.removeNoteImage(v.app, v.note, 'a.png');
  assert.ok(removed);
  assert.equal(v.read().includes('![[a.png]]'), false);
  assert.equal(v.files.length, 3);
});

test('removal checks fresh frontmatter and preserves unrelated concurrent prose', async () => {
  const v = vault('---\ncover: "[[c.png]]"\n---\n![[a.png]]\n![[b.png]]\n![[c.png]]\nNew prose\n');
  await assert.rejects(api.removeNoteImage(v.app, v.note, 'c.png'), /현재 커버/);
  const removed = await api.removeNoteImage(v.app, v.note, 'b.png');
  assert.ok(v.read().endsWith('![[c.png]]\nNew prose\n'));
  v.edit(v.read() + 'Typed after removal\n');
  assert.equal(await api.restoreNoteImage(v.app, v.note, removed), true);
  assert.ok(v.read().includes('Typed after removal'));
  assert.equal(api.noteImageState(v.app, v.note, v.read()).key, 'c.png');
});

test('Undo refuses an intervening missing pin that would steal the current cover', async () => {
  const v = vault('![[a.png]]\n![[b.png]]\n');
  const removed = await api.removeNoteImage(v.app, v.note, 'b.png');
  v.edit('---\ncover: "[[b.png]]"\n---\n'+v.read());
  const before = v.read();
  await assert.rejects(api.restoreNoteImage(v.app, v.note, removed), /커버가 바뀌어/);
  assert.equal(v.read(), before);
});

test('hidden-cover last image removal and exact Undo do not delete attachment files', async () => {
  const initial = '---\ncover: __none__\n---\n![[b.png|320]]\n';
  const v = vault(initial);
  const removed = await api.removeNoteImage(v.app, v.note, 'b.png');
  assert.equal(v.read(), '---\ncover: __none__\n---\n');
  assert.equal(await api.restoreNoteImage(v.app, v.note, removed), false);
  assert.equal(v.read(), initial);
  assert.equal(v.files.length, 3);
});


test('Undo refuses a removed attachment without inserting a broken embed', async () => {
  const v = vault('![[a.png]]\n![[b.png]]\n');
  const removed = await api.removeNoteImage(v.app, v.note, 'b.png');
  v.files.splice(1, 1);
  const before = v.read();
  await assert.rejects(api.restoreNoteImage(v.app, v.note, removed), /파일을 찾을 수 없어/);
  assert.equal(v.read(), before);
});

test('background heal uses current content after a simultaneous removal', async () => {
  for (const [heal, initial] of [
    [api.healCollapsedImageEmbeds, '![[a.png|0]]\n![[b.png]]\n'],
    [api.healNaiPromptEmphasis, '![[a.png]]\n![[b.png]]\n## 프롬프트\n```\n1.2==blue==\n```\n'],
  ] as const) {
    const v = vault(initial);
    v.app.vault.read = async () => {
      const stale = v.read();
      await api.removeNoteImage(v.app, v.note, 'b.png');
      return stale;
    };
    assert.equal(await heal(v.app, v.note), true);
    assert.equal(v.read().includes('![[b.png]]'), false);
    assert.equal(v.read().includes('|0'), false);
    assert.equal(v.read().includes('=='), false);
  }
});
