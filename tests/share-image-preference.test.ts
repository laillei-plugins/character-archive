import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/settings.ts'], bundle: true, write: false,
  format: 'esm', platform: 'node',
});
const settingsApi = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0]!.text).toString('base64'));
const share = (includeNoteImages?: unknown) => ({
  url: 'https://example.com/g/test1234', id: 'test1234', manageKey: 'test-key',
  at: '2026-09-27T00:00:00Z', htmlVersion: 13, includeNoteImages,
});

test('published image choice survives save/restart and stays scoped to its gallery', () => {
  let settings = settingsApi.migrateSettings({});
  settingsApi.setWebShareForPage(settings, 'Gallery A.md', share(true));
  settingsApi.setWebShareForPage(settings, 'Gallery B.md', share(false));
  settings = settingsApi.migrateSettings(JSON.parse(JSON.stringify(settings)));
  assert.equal(settingsApi.getWebShareForPage(settings, 'Gallery A.md').includeNoteImages, true);
  assert.equal(settingsApi.getWebShareForPage(settings, 'Gallery B.md').includeNoteImages, false);
  assert.equal(settingsApi.getWebShareForPage(settings, 'Gallery C.md'), null);
  assert.equal(settingsApi.getWebShareForPage(settings, 'Gallery A.md').manageKey, 'test-key');
});

test('legacy and malformed preferences never opt users into publishing note images', () => {
  for (const value of [undefined, null, false, 'true', 1]) {
    const settings = settingsApi.migrateSettings({ webShareByPage: { 'Gallery.md': share(value) } });
    assert.equal(settingsApi.getWebShareForPage(settings, 'Gallery.md').includeNoteImages, false);
  }
});

test('turning images off survives restart without affecting another shared link', () => {
  let settings = settingsApi.migrateSettings({ webShareByPage: {
    'Gallery.md': share(true), '@character/Rin.md': share(true),
  } });
  settingsApi.setWebShareForPage(settings, 'Gallery.md', share(false));
  settings = settingsApi.migrateSettings(JSON.parse(JSON.stringify(settings)));
  assert.equal(settingsApi.getWebShareForPage(settings, 'Gallery.md').includeNoteImages, false);
  assert.equal(settingsApi.getWebShareForPage(settings, '@character/Rin.md').includeNoteImages, true);
});
