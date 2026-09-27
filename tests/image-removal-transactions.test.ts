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
function vault(initial: string, paths = ['a.png', 'b.png', 'c.png']) {
  let text = initial;
  const note = new api.TFile('Rin.md');
  const files = paths.map(path => new api.TFile(path));
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

const FOUR = ['a.png', 'b.png', 'c.png', 'd.png'];
const keysOf = (v: ReturnType<typeof vault>) =>
  api.noteImageState(v.app, v.note, v.read()).images.map(api.coverRefKey);

test('rapid queued directional moves compose on the latest order', async () => {
  const fm = '---\ncover: "[[b.png]]"\n---\n';
  const v = vault(fm + 'Intro\n![[a.png|320]]\n![[b.png]]\nMiddle prose\n![[c.png|120]]\n![[d.png]]\n', FOUR);
  // Not awaited in between: a stale full-order snapshot would land d second-to-last.
  const steps = await Promise.all([1, 2, 3, 4].map(() =>
    api.moveNoteImage(v.app, v.note, 'd.png', { direction: -1 })));
  assert.deepEqual(steps, [
    ['a.png', 'b.png', 'd.png', 'c.png'],
    ['a.png', 'd.png', 'b.png', 'c.png'],
    ['d.png', 'a.png', 'b.png', 'c.png'],
    ['d.png', 'a.png', 'b.png', 'c.png'],
  ]);
  // Prose stays put, sizes travel with their image, the pin is untouched.
  assert.equal(v.read(), fm + 'Intro\n![[d.png]]\n![[a.png|320]]\nMiddle prose\n![[b.png]]\n![[c.png|120]]\n');
  assert.equal(api.noteImageState(v.app, v.note, v.read()).key, 'b.png');
  await Promise.all([
    api.moveNoteImage(v.app, v.note, 'a.png', { direction: 1 }),
    api.moveNoteImage(v.app, v.note, 'a.png', { direction: 1 }),
    api.moveNoteImage(v.app, v.note, 'd.png', { direction: 1 }),
  ]);
  assert.deepEqual(keysOf(v), ['b.png', 'd.png', 'c.png', 'a.png']);
  assert.equal(v.files.length, 4);
});

test('a move is recomputed on note text edited after it was queued', async () => {
  const v = vault('![[a.png]]\n![[b.png]]\n![[c.png]]\n', FOUR);
  const processV = v.app.vault.process;
  v.app.vault.process = async (file, transform) => {
    v.edit(v.read() + 'Typed while moving\n![[d.png]]\n');
    await processV(file, transform);
  };
  assert.deepEqual(await api.moveNoteImage(v.app, v.note, 'c.png', { direction: -1 }),
    ['a.png', 'c.png', 'b.png', 'd.png']);
  assert.equal(v.read(), '![[a.png]]\n![[c.png]]\n![[b.png]]\nTyped while moving\n![[d.png]]\n');

  // The source disappears between the lane's snapshot and the write: no-op, no resurrection.
  const w = vault('![[a.png]]\n![[b.png]]\n![[c.png]]\n');
  const processW = w.app.vault.process;
  w.app.vault.process = async (file, transform) => {
    w.edit('![[a.png]]\n![[b.png]]\nEdited\n');
    await processW(file, transform);
  };
  assert.deepEqual(await api.moveNoteImage(w.app, w.note, 'c.png', { direction: -1 }), ['a.png', 'b.png']);
  assert.equal(w.read(), '![[a.png]]\n![[b.png]]\nEdited\n');
});

test('anchor moves follow queued adds and deletes', async () => {
  const v = vault('![[a.png]]\n![[b.png]]\n![[c.png]]\n', FOUR);
  const adding = api.appendNoteImages(v.app, v.note, [{ kind: 'vault', file: v.files[3] }]);
  const moving = api.moveNoteImage(v.app, v.note, 'a.png', { anchor: 'd.png', place: 'after' });
  assert.equal(await adding, 1);
  assert.deepEqual(await moving, ['b.png', 'c.png', 'd.png', 'a.png']);
  assert.equal(v.read(), '![[b.png]]\n![[c.png]]\n![[d.png]]\n\n![[a.png]]\n');
  assert.deepEqual(await api.moveNoteImage(v.app, v.note, 'a.png', { anchor: 'c.png', place: 'before' }),
    ['b.png', 'a.png', 'c.png', 'd.png']);

  // Anchor or source deleted by an earlier queued removal: safe no-op.
  const removingAnchor = api.removeNoteImage(v.app, v.note, 'c.png');
  const toMissingAnchor = api.moveNoteImage(v.app, v.note, 'd.png', { anchor: 'c.png', place: 'before' });
  const removingSource = api.removeNoteImage(v.app, v.note, 'd.png');
  const missingSource = api.moveNoteImage(v.app, v.note, 'd.png', { anchor: 'b.png', place: 'before' });
  assert.ok(await removingAnchor);
  assert.deepEqual(await toMissingAnchor, ['b.png', 'a.png', 'd.png']);
  assert.ok(await removingSource);
  assert.deepEqual(await missingSource, ['b.png', 'a.png']);
  // The blank line the append added stays; only embed lines are removed.
  assert.equal(v.read(), '![[b.png]]\n![[a.png]]\n\n');
  assert.equal(v.files.length, 4);
});

test('endpoints and missing identities leave the note unchanged', async () => {
  const initial = '---\ncover: "[[b.png]]"\n---\n![[a.png]]\n![[b.png]]\n![[c.png]]\n';
  const v = vault(initial);
  for (const [key, movement] of [
    ['a.png', { direction: -1 }],
    ['c.png', { direction: 1 }],
    ['z.png', { direction: 1 }],
    ['a.png', { anchor: 'z.png', place: 'after' }],
    ['a.png', { anchor: 'a.png', place: 'after' }],
    ['a.png', { anchor: 'b.png', place: 'before' }],
    ['c.png', { anchor: 'b.png', place: 'after' }],
  ] as const) {
    assert.deepEqual(await api.moveNoteImage(v.app, v.note, key, movement), ['a.png', 'b.png', 'c.png']);
  }
  assert.equal(v.read(), initial);
});

test('moves keep pinned, hidden and automatic cover semantics', async () => {
  const pinned = vault('---\ncover: "[[c.png]]"\n---\n![[a.png|320]]\nText ![[b.png]] inline.\n![[c.png|100]]\n');
  await api.moveNoteImage(pinned.app, pinned.note, 'c.png', { anchor: 'a.png', place: 'before' });
  assert.equal(pinned.read(), '---\ncover: "[[c.png]]"\n---\n![[c.png|100]]\nText ![[a.png|320]] inline.\n![[b.png]]\n');
  await api.moveNoteImage(pinned.app, pinned.note, 'a.png', { direction: -1 });
  assert.equal(api.noteImageState(pinned.app, pinned.note, pinned.read()).key, 'c.png');

  const hidden = vault('---\ncover: __none__\n---\n![[a.png]]\n![[b.png]]\n');
  await api.moveNoteImage(hidden.app, hidden.note, 'b.png', { direction: -1 });
  assert.equal(hidden.read(), '---\ncover: __none__\n---\n![[b.png]]\n![[a.png]]\n');
  assert.equal(api.noteImageState(hidden.app, hidden.note, hidden.read()).key, null);

  // Automatic mode follows the first image; a repeated embed stays where it was.
  const auto = vault('![[a.png]]\n![[b.png]]\n![[a.png|50]]\n');
  await api.moveNoteImage(auto.app, auto.note, 'b.png', { direction: -1 });
  assert.equal(auto.read(), '![[b.png]]\n![[a.png]]\n![[a.png|50]]\n');
  assert.equal(api.noteImageState(auto.app, auto.note, auto.read()).key, 'b.png');

  const remote = vault('![](https://Example.com/x.png#one)\n![[a.png]]\n');
  assert.deepEqual(
    await api.moveNoteImage(remote.app, remote.note, 'https://example.com/x.png#two', { direction: 1 }),
    ['a.png', 'https://example.com/x.png'],
  );
  assert.equal(remote.read(), '![[a.png]]\n![](https://Example.com/x.png#one)\n');
});

test('the sole image can be removed in any cover mode and Undo is exact', async () => {
  for (const [initial, after, restoredKey] of [
    ['Intro\n![[b.png|320]]\nOutro\n', 'Intro\nOutro\n', 'b.png'],
    ['---\ncover: "[[b.png]]"\n---\n![[b.png]]\nText ![[b.png|40]] again\n', '---\ncover: "[[b.png]]"\n---\nText  again\n', 'b.png'],
    ['---\ncover: __none__\n---\n![[b.png]]\n', '---\ncover: __none__\n---\n', null],
  ] as const) {
    const v = vault(initial);
    const removed = await api.removeNoteImage(v.app, v.note, 'b.png');
    assert.ok(removed);
    // Frontmatter is kept as written; a missing pin just stops matching.
    assert.equal(v.read(), after);
    assert.equal(api.noteImageState(v.app, v.note, v.read()).key, null);
    assert.equal(await api.restoreNoteImage(v.app, v.note, removed), false);
    assert.equal(v.read(), initial);
    assert.equal(api.noteImageState(v.app, v.note, v.read()).key, restoredKey);
    assert.equal(v.files.length, 3);
  }
});

test('Undo of a pinned sole image does not take over a newer image cover', async () => {
  const v = vault('---\ncover: "[[b.png]]"\n---\n![[b.png]]\n');
  const removed = await api.removeNoteImage(v.app, v.note, 'b.png');
  await api.appendNoteImages(v.app, v.note, [{ kind: 'vault', file: v.files[0] }]);
  assert.equal(api.noteImageState(v.app, v.note, v.read()).key, 'a.png');
  const before = v.read();
  await assert.rejects(api.restoreNoteImage(v.app, v.note, removed), /커버가 바뀌어/);
  assert.equal(v.read(), before);

  // An automatic sole image restores beside a newer first image without moving the cover.
  const w = vault('![[b.png]]\n');
  const autoRemoved = await api.removeNoteImage(w.app, w.note, 'b.png');
  await api.appendNoteImages(w.app, w.note, [{ kind: 'vault', file: w.files[0] }]);
  assert.equal(await api.restoreNoteImage(w.app, w.note, autoRemoved), true);
  assert.deepEqual(keysOf(w), ['a.png', 'b.png']);
  assert.equal(api.noteImageState(w.app, w.note, w.read()).key, 'a.png');
});

test('the current cover is protected while another image exists', async () => {
  const v = vault('![[a.png]]\n![[b.png]]\n');
  await assert.rejects(api.removeNoteImage(v.app, v.note, 'a.png'), /현재 커버/);
  // A queued move makes b the automatic cover before its removal is checked.
  const moving = api.moveNoteImage(v.app, v.note, 'b.png', { direction: -1 });
  const removing = api.removeNoteImage(v.app, v.note, 'b.png');
  await moving;
  await assert.rejects(removing, /현재 커버/);
  assert.equal(v.read(), '![[b.png]]\n![[a.png]]\n');
  // Once a queued removal leaves it alone, the cover itself can go.
  const [other, sole] = await Promise.all([
    api.removeNoteImage(v.app, v.note, 'a.png'),
    api.removeNoteImage(v.app, v.note, 'b.png'),
  ]);
  assert.ok(other && sole);
  assert.equal(v.read(), '');

  // A remote cover key is normalized before the protection check.
  const r = vault('![](https://example.com/x.png#frag)\n![[a.png]]\n');
  await assert.rejects(api.removeNoteImage(r.app, r.note, 'https://example.com/x.png#other'), /현재 커버/);
  assert.equal(r.read(), '![](https://example.com/x.png#frag)\n![[a.png]]\n');
});

// Regression from independent review: a read snapshot may report a stale endpoint.
test('relative movement does not trust a stale endpoint read', async () => {
  const v = vault('![[b.png]]\n![[a.png]]\n');
  v.app.vault.read = async () => '![[a.png]]\n![[b.png]]\n';
  assert.deepEqual(await api.moveNoteImage(v.app, v.note, 'a.png', { direction: -1 }), ['a.png', 'b.png']);
  assert.equal(v.read(), '![[a.png]]\n![[b.png]]\n');
});
