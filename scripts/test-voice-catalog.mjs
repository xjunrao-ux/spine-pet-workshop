import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {VoiceCatalog,VoiceDownloads} from '../electron/voice-catalog.mjs';

const source=JSON.parse(await readFile(new URL('../electron/data/ark-voice-catalog.json',import.meta.url),'utf8'));
const hash=b=>createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const root=path.resolve('.local/voice-catalog-tests');await mkdir(root,{recursive:true});
function fixture({bytes=Buffer.from('OggS voice fixture')}={}){
  const ids=['char_002_amiya','char_002_amiya_epoque#4','char_1001_amiya2'];
  const files=ids.flatMap(characterId=>['JP','CN'].map(language=>({key:`${language==='JP'?'voice':'voice_cn'}/${characterId}.ogg`,characterId,language,file:{name:`${characterId}.ogg`,size:bytes.length,sha:hash(bytes)}})));
  const voiceData={data:Object.fromEntries(ids.map(id=>[id,{variations:Object.fromEntries(['JP','CN'].map(l=>[l,{size:bytes.length,duration:8,clips:[{name:'CN_001',start:0},{name:'CN_002',start:4}]}]))}]))};
  const subtitles={charWords:Object.fromEntries(ids.flatMap(id=>['CN_001','CN_002'].map((n,i)=>[`${id}_${n}`,{voiceText:`台词 ${i+1}`,voiceTitle:`语音 ${i+1}`}])))};
  const data={...source,entries:files};
  return {catalog:new VoiceCatalog(data,voiceData,subtitles),data,voiceData,subtitles,bytes};
}

test('voice snapshot indexes all 1,407 source audio files without bundling audio',()=>{
  const c=new VoiceCatalog(source,{data:{}},{charWords:{}});
  assert.equal(c.entries.size,1407);
  assert.equal(c.options({key:'enemy/x',id:'1000_gopro',category:'enemy'}).length,0);
});

test('voice options prefer an exact skin and otherwise share only the same operator form',()=>{
  const f=fixture();
  const exact=f.catalog.options({key:'models/002_amiya_epoque#4',id:'002_amiya_epoque#4',category:'operator'});
  assert.equal(exact.length,2);assert.ok(exact.every(v=>v.skin&&!v.shared&&v.characterId==='char_002_amiya_epoque#4'));
  const shared=f.catalog.options({key:'models/002_amiya_winter#1',id:'002_amiya_winter#1',category:'operator'});
  assert.equal(shared.length,2);assert.ok(shared.every(v=>v.shared&&v.characterId==='char_002_amiya'));
  const form=f.catalog.options({key:'models/1001_amiya2',id:'1001_amiya2',category:'operator'});
  assert.ok(form.length&&form.every(v=>v.characterId==='char_1001_amiya2'));
  assert.deepEqual(f.catalog.options({key:'models/1037_amiya3',id:'1037_amiya3',category:'operator'}),[]);
  const illust=f.catalog.options({key:'models_illust/dyn_illust_002_amiya_epoque#4',id:'dyn_illust_002_amiya_epoque#4',category:'illustration'});
  assert.deepEqual(illust,exact);
});

test('missing timelines, wrong file sizes, unavailable languages and missing Chinese subtitles are not offered',()=>{
  const f=fixture();
  assert.throws(()=>f.catalog.get('voice_en/char_002_amiya.ogg'),/未收录/);
  f.voiceData.data.char_002_amiya.variations.JP.size++;
  assert.throws(()=>f.catalog.get('voice/char_002_amiya.ogg'),/不匹配/);
  const missing=new VoiceCatalog(f.data,f.voiceData,{charWords:{}});
  assert.deepEqual(missing.options({key:'models/002_amiya',id:'002_amiya',category:'operator'}),[]);
  assert.throws(()=>missing.get('voice_cn/char_002_amiya.ogg'),/中文字幕/);
});

test('voice URLs encode skin names and arbitrary destinations cannot be requested',()=>{
  const f=fixture(),key='voice/char_002_amiya_epoque#4.ogg';
  const url=new URL(f.catalog.pageUrl(key));assert.equal(url.hash,'');assert.match(url.pathname,/%234\.ogg$/);
  assert.match(f.catalog.fileUrl(f.catalog.get(key),f.catalog.get(key).file),/raw\.githubusercontent\.com\/isHarryh\/Ark-Voice\/[a-f0-9]{40}\//);
  assert.throws(()=>f.catalog.get('../../outside.ogg'));
  const bad=structuredClone(f.data);bad.entries[0].file.name='../outside.ogg';assert.throws(()=>new VoiceCatalog(bad,f.voiceData,f.subtitles));
});

test('voice download verifies bytes and returns the exact character, language and subtitle count for import',async()=>{
  const f=fixture(),directory=await mkdtemp(path.join(root,'voice-'));let requests=0;
  const d=new VoiceDownloads({catalog:f.catalog,directory,fetch:async()=>{requests++;return new Response(f.bytes);}});
  const result=await d.download('voice_cn/char_002_amiya.ogg');
  assert.equal(result.characterId,'char_002_amiya');assert.equal(result.language,'CN');assert.equal(result.clipCount,2);
  assert.equal(result.name,'char_002_amiya.ogg');assert.deepEqual(await readFile(result.path),f.bytes);
  assert.equal((await d.download('voice_cn/char_002_amiya.ogg')).cached,true);assert.equal(requests,1);
});

test('invalid OGG data is not filled into import and leaves no partial cache',async()=>{
  const f=fixture({bytes:Buffer.from('invalid OGG fixture')}),directory=await mkdtemp(path.join(root,'invalid-'));
  const d=new VoiceDownloads({catalog:f.catalog,directory,fetch:async()=>new Response(f.bytes)});
  await assert.rejects(d.download('voice/char_002_amiya.ogg'),/不是有效的 OGG/);
  assert.deepEqual(await readdir(path.join(directory,f.catalog.revision,'JP')),[]);
});
