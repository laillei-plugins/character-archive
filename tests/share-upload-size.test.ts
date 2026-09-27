import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { maxBytes } from '../share-host/functions/_lib/share.ts';

const bundle = await build({
  stdin: { contents: 'export * from "./src/share/hostedShare.ts";', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'request-adapter', setup(b) {
    b.onResolve({filter:/^obsidian$/}, () => ({path:'obsidian',namespace:'test'}));
    b.onLoad({filter:/.*/,namespace:'test'}, () => ({contents: `
      export async function requestUrl() { globalThis.shareRequests++; return {status:200,json:{ok:true,url:'https://share.example/g/abc',id:'abc'},text:''}; }
    `}));
  }}],
});
const api = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0]!.text).toString('base64'));

test('create and update enforce the 20 MB UTF-8 limit before sending', async () => {
  (globalThis as any).shareRequests = 0;
  const opts = {baseUrl:'https://share.example',manageKey:'test-only',id:'abc'};
  const exact = '한'.repeat(6_666_666)+'aa';
  assert.equal(new TextEncoder().encode(exact).byteLength,20_000_000);
  await api.uploadToHostedShare(exact,opts);
  await api.updateHostedShare(exact,opts);
  assert.equal((globalThis as any).shareRequests,2);
  await assert.rejects(api.uploadToHostedShare(exact+'a',opts),/20MB/);
  await assert.rejects(api.updateHostedShare(exact+'a',opts),/20MB/);
  assert.equal((globalThis as any).shareRequests,2);
});

test('host default agrees with client and configured limits cannot exceed storage budget', () => {
  assert.equal(maxBytes({} as any),api.MAX_SHARE_HTML_BYTES);
  assert.equal(maxBytes({MAX_BYTES:'30000000'} as any),20_000_000);
  assert.equal(maxBytes({MAX_BYTES:'10000000'} as any),10_000_000);
  assert.equal(maxBytes({MAX_BYTES:'invalid'} as any),20_000_000);
});
