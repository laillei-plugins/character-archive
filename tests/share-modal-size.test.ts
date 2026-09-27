import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

// Keep the real modal buildHtml path and size validation. Replace only payload
// generation and vault scope lookups so the test does not need an Obsidian app.
const result = await build({
  stdin:{contents:'export {ShareGalleryModal} from "./src/ui/ShareGalleryModal.ts";export {DEFAULT_SETTINGS} from "./src/settings.ts";',resolveDir:process.cwd()},
  bundle:true,write:false,format:'esm',platform:'node',
  plugins:[{name:'share-modal-adapter',setup(b){
    b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'test'}));
    b.onResolve({filter:/\/share\/webShare$/},()=>({path:'webShare',namespace:'test'}));
    b.onResolve({filter:/\/page\/galleryPage$/},()=>({path:'galleryPage',namespace:'test'}));
    b.onLoad({filter:/.*/,namespace:'test'},args=>({contents:args.path==='obsidian'?`
      export class Modal{} export class Notice{} export class App{} export class TFile{} export class TFolder{}
      export class Component{} export class MarkdownRenderer{} export const setIcon=()=>{};
      export const requestUrl=()=>{};export const normalizePath=p=>p;export const parseYaml=()=>({});export const getFrontMatterInfo=()=>({exists:false});
    `:args.path==='webShare'?`
      export const SHARE_HTML_VERSION=14;export const buildSharePayload=async()=>({});export const renderShareHtml=()=>globalThis.modalHtml;
      export const collectPanelHeaders=()=>[];export const groupPanelHeaders=()=>[];
    `:`
      export const readGalleryScope=()=>({library:'Example'});export const getFilterAxisForPage=()=>({propertyId:'status',options:[]});
      export const copyTextToClipboard=()=>{};export const galleryPagePath=()=>'';
    `}));
  }}],
});
const api=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0]!.text).toString('base64'));
test('share window accepts 11–20 MB pages and rejects above 20 MB in UTF-8',async()=>{
  const modal=Object.create(api.ShareGalleryModal.prototype);
  Object.assign(modal,{app:{workspace:{getActiveFile:()=>null}},plugin:{settings:api.DEFAULT_SETTINGS},selectedArchives:new Set(),panelHeaders:new Set(),selectedRecords:()=>[],shareTitle:()=> 'Example'});
  (globalThis as any).modalHtml='한'.repeat(6_666_666)+'aa';
  assert.equal(await modal.buildHtml(),(globalThis as any).modalHtml);
  (globalThis as any).modalHtml+='a';
  await assert.rejects(modal.buildHtml(),/20MB/);
  delete (globalThis as any).modalHtml;
});
