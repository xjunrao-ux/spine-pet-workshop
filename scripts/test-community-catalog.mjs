import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {validateEntry,readEntries,verifyArchive,renderTable,renderCatalogDocument,catalog} from './community-catalog.mjs';
import {createZip} from '../electron/plugins/zip.mjs';

const entry=JSON.parse(await readFile(new URL('../community/plugins/com.example.hello-counter.json',import.meta.url),'utf8'));
test('catalog and generated download table agree',async()=>{
  const result=await catalog();assert.equal(result.ok,true);assert.ok(result.entries>=3);
  const entries=await readEntries();assert.ok(entries.some(e=>e.id==='io.spine-workshop.codex'));
});
test('catalog rejects unsafe links, unknown permissions, invalid metadata and reserved identities',()=>{
  for(const patch of [
    {downloadUrl:'https://evil.example/plugin.zip'},
    {downloadUrl:entry.downloadUrl.replace('/download/v3.2.3/','/latest/download/')},
    {downloadUrl:entry.downloadUrl+'?token=secret'},
    {sourceUrl:'https://user:secret@github.com/owner/repo'},
    {permissions:['media.read']},{permissions:['storage.own','storage.own']},
    {apiVersion:2},{sha256:'0'},{id:'workshop.fake'},{version:'01.0.0'},
    {author:'../other'},{sourceUrl:null},{unexpected:true}
  ])assert.throws(()=>validateEntry({...entry,...patch}),JSON.stringify(patch));
});
test('catalog checks filename identity and never treats ZIP files as metadata',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'pet-catalog-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(path.join(directory,'wrong.json'),JSON.stringify(entry));await assert.rejects(readEntries(directory),/filename/);
  await rm(path.join(directory,'wrong.json'));await writeFile(path.join(directory,entry.id+'.json'),JSON.stringify(entry));
  assert.equal((await readEntries(directory)).length,1);
  await writeFile(path.join(directory,'untrusted.zip'),'not executed');await assert.rejects(readEntries(directory),/Unexpected/);
});
test('local archive verification checks full ZIP digest, identity and permissions without executing code',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../examples/hello-counter-plugin/plugin.json',import.meta.url),'utf8'));
  const code='throw new Error("This code must never run during catalog checks");';
  const bytes=createZip({'plugin.json':JSON.stringify(manifest),[manifest.entry]:code});
  const valid={...entry,sha256:createHash('sha256').update(bytes).digest('hex')};
  assert.doesNotThrow(()=>verifyArchive(valid,bytes));
  assert.throws(()=>verifyArchive({...valid,sha256:'0'.repeat(64)},bytes),/SHA-256/);
  assert.throws(()=>verifyArchive({...valid,id:'com.example.other'},bytes),/id mismatch/);
  assert.throws(()=>verifyArchive({...valid,permissions:['storage.own']},bytes),/permissions/);
});
test('table escapes author-controlled Markdown and cannot inject extra rows',()=>{
  const output=renderTable([{...entry,name:'[bad]|name',description:'line1\nline2'}]);
  assert.equal(output.split('\n').length,3);assert.ok(output.includes('\\[bad\\]\\|name'));assert.ok(output.includes('line1 line2'));
});

test('generated catalog handles Windows CRLF checkouts and requires one marker pair',()=>{
  const source='# Catalog\n\n<!-- catalog:start -->\nold table\n<!-- catalog:end -->\n';
  assert.equal(renderCatalogDocument(source.replaceAll('\n','\r\n'),[entry]),renderCatalogDocument(source,[entry]));
  assert.throws(()=>renderCatalogDocument('no markers',[entry]),/exactly one/);
  assert.throws(()=>renderCatalogDocument(source+source,[entry]),/exactly one/);
});

test('community, quickstart and usage documentation link to actual repository files',async()=>{
  for(const file of ['../community/README.md','../community/CONTRIBUTING.md','../docs/PLUGIN_QUICKSTART.md','../docs/PLUGIN_USAGE.md','../CONTRIBUTING.md']){
    const url=new URL(file,import.meta.url),source=await readFile(url,'utf8');
    for(const match of source.matchAll(/\[[^\]]+\]\(([^\s)]+)\)/g)){
      const target=match[1];if(target.startsWith('#')||/^[a-z]+:/i.test(target))continue;
      await access(path.resolve(path.dirname(fileURLToPath(url)),target.split('#')[0]));
    }
  }
});
