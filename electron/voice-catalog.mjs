import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {AssetDownloads} from './model-catalog.mjs';
import {parseArkVoiceBundle} from './voice-bundle.mjs';

const ROOTS={JP:'voice',CN:'voice_cn',EN:'voice_en',KR:'voice_kr',CUSTOM:'voice_custom'};
const LABELS={JP:'日语',CN:'普通话',EN:'英语',KR:'韩语',CUSTOM:'个性化语音'};
const encodePath=value=>value.split('/').map(encodeURIComponent).join('/');

export class VoiceCatalog {
  constructor(data,voiceData,subtitles) {
    if(data?.schemaVersion!==1 || data.repository!=='isHarryh/Ark-Voice' || !/^[a-f0-9]{40}$/.test(data.revision) || !Array.isArray(data.entries)) throw new Error('语音检索数据损坏');
    this.revision=data.revision;this.voiceData=voiceData;this.subtitles=subtitles;
    this.entries=new Map();this.optionsCache=new Map();
    for(const item of data.entries){
      const root=ROOTS[item.language],file=item.file;
      if(!root || !/^char_\d+_[a-z0-9]+(?:_[a-z0-9]+)?(?:#\d+)?$/i.test(item.characterId) || item.key!==`${root}/${item.characterId}.ogg` || file?.name!==`${item.characterId}.ogg` || !Number.isSafeInteger(file.size) || file.size<=0 || file.size>32*1024*1024 || !/^[a-f0-9]{40}$/.test(file.sha) || this.entries.has(item.key)) throw new Error('语音文件记录无效');
      this.entries.set(item.key,{...item,id:item.characterId,files:[file],bytes:file.size});
    }
  }

  get(key) {
    const entry=typeof key==='string' && this.entries.get(key);
    if(!entry)throw new Error('语音库未收录这个语种或角色');
    const variation=this.voiceData?.data?.[entry.characterId]?.variations?.[entry.language];
    if(variation?.size!==entry.bytes)throw new Error('语音时间轴与下载版本不匹配');
    const lines=parseArkVoiceBundle(this.voiceData,this.subtitles,entry.characterId,entry.language,entry.file.name);
    return {...entry,clipCount:lines.length};
  }

  options(model) {
    if(model.category==='enemy')return [];
    if(this.optionsCache.has(model.key))return this.optionsCache.get(model.key);
    const id=model.id.replace(/^dyn_illust_/,'');
    const exact=`char_${id}`,base=`char_${id.split('_').slice(0,2).join('_')}`;
    const options=[];
    for(const [language,root]of Object.entries(ROOTS)){
      // Only fall back within the same operator form, never to a different alter character.
      for(const characterId of [...new Set([exact,base])]){
        const key=`${root}/${characterId}.ogg`;
        if(!this.entries.has(key))continue;
        try{
          const entry=this.get(key);
          options.push({key,characterId,language,label:LABELS[language],bytes:entry.bytes,clipCount:entry.clipCount,
            shared:exact!==base && characterId===base,skin:characterId!==base});
          break;
        }catch{/* No matching timeline/subtitles: do not offer a non-importable voice. */}
      }
    }
    this.optionsCache.set(model.key,options);return options;
  }

  fileUrl(entry,file){return `https://raw.githubusercontent.com/isHarryh/Ark-Voice/${this.revision}/${encodePath(`${ROOTS[entry.language]}/${file.name}`)}`;}
  pageUrl(key){return `https://github.com/isHarryh/Ark-Voice/blob/${this.revision}/${encodePath(this.get(key).key)}`;}
}

export class VoiceDownloads extends AssetDownloads {
  constructor(options){
    super({...options,directoryFor:entry=>entry.language,prepare:async(folder,entry)=>{
      const file=path.join(folder,entry.file.name);
      const bytes=await readFile(file);
      if(bytes.subarray(0,4).toString('ascii')!=='OggS')throw new Error('下载文件不是有效的 OGG 语音');
      return {canceled:false,path:file,name:entry.file.name,characterId:entry.characterId,language:entry.language,clipCount:entry.clipCount};
    }});
  }
}
