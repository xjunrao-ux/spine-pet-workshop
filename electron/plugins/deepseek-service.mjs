import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { atomicWrite } from './settings-store.mjs';

export const DEEPSEEK_MODELS = ['deepseek-flash', 'deepseek-v4-pro'];
const validId = id => typeof id === 'string' && /^[a-z][a-z0-9.-]{2,99}$/.test(id);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const messageFor = status => ({401:'API Key 无效，请重新配置。',402:'DeepSeek 余额不足，请充值后重试。',403:'当前 API Key 无权访问该模型。',429:'请求过于频繁，请稍后重试。'}[status] ?? (status >= 500 ? 'DeepSeek 服务暂不可用，请稍后重试。' : 'DeepSeek 拒绝了请求，请检查模型和输入。'));

// Credentials never enter plugin storage, page snapshots, logs, or worker RPC.
export class DeepSeekCredentials {
  constructor({userData, encryption}) { this.directory=path.join(userData,'plugins','credentials'); this.encryption=encryption; this.queues=new Map(); }
  file(id) { if(!validId(id))throw new Error('无效插件标识'); return path.join(this.directory,createHash('sha256').update(id).digest('hex')+'.deepseek.json'); }
  async read(id) {
    let data;
    try { data=JSON.parse(await readFile(this.file(id),'utf8')); }
    catch(error) { if(error.code==='ENOENT')return null; throw new Error('密钥记录无法读取，请重新配置。'); }
    if(!plain(data)||data.schemaVersion!==1||typeof data.encrypted!=='string'||data.encrypted.length>16000)throw new Error('密钥记录不兼容，请重新配置。');
    if(!data.encrypted)return null;
    if(!this.encryption?.isEncryptionAvailable())throw new Error('系统加密不可用，无法读取密钥。');
    try { return this.encryption.decryptString(Buffer.from(data.encrypted,'base64')); }
    catch { throw new Error('无法解密 API Key，请在本机重新配置。'); }
  }
  write(id,key,check=()=>{}) {
    const file=this.file(id);
    if(typeof key!=='string'||key.length>512||(key && !/^[\x21-\x7e]+$/.test(key)))throw new Error('API Key 格式无效。');
    const operation=(this.queues.get(id)??Promise.resolve()).then(async()=>{
      check();
      if(key && !this.encryption?.isEncryptionAvailable())throw new Error('系统加密不可用，未保存密钥。');
      const encrypted=key ? this.encryption.encryptString(key).toString('base64') : '';
      check(); await atomicWrite(file,{schemaVersion:1,encrypted});
    });
    this.queues.set(id,operation.catch(()=>{})); return operation;
  }
}

export function validateDeepSeekRequest(input) {
  if(!plain(input)||Object.keys(input).some(k=>!['requestId','model','messages'].includes(k))||typeof input.requestId!=='string'||!/^[a-zA-Z0-9.-]{1,80}$/.test(input.requestId)||!DEEPSEEK_MODELS.includes(input.model)||!Array.isArray(input.messages)||!input.messages.length||input.messages.length>42)throw new Error('无效的对话请求');
  let size=0;
  input.messages.forEach((m,index)=>{
    if(!plain(m)||Object.keys(m).some(k=>!['role','content'].includes(k))||!['system','user','assistant'].includes(m.role)||(m.role==='system'&&index!==0)||typeof m.content!=='string'||!m.content.trim()||m.content.length>16000)throw new Error('无效的对话消息');
    size+=m.content.length;
  });
  if(size>70000||input.messages.at(-1).role!=='user')throw new Error('对话过长，请开启新对话');
  return structuredClone(input);
}

// Parses SSE across arbitrary UTF-8/line boundaries; requires a settled stream.
export async function consumeDeepSeekStream(response,{signal,onText,maxChars=16000}) {
  if(!response.body)throw new Error('STREAM');
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer='',data=[],text='',done=false,finishReason=null,usage=null;
  const dispatch=()=>{
    if(!data.length)return;
    const raw=data.join('\n');data=[];
    if(raw==='[DONE]'){done=true;return;}
    let value;try{value=JSON.parse(raw);}catch{throw new Error('STREAM');}
    if(value.error)throw new Error('STREAM');
    const choice=value.choices?.[0],part=choice?.delta?.content;
    if(part!=null&&typeof part!=='string')throw new Error('STREAM');
    if(part){if(text.length+part.length>maxChars)throw new Error('OUTPUT_LIMIT');text+=part;onText(text);}
    if(choice?.finish_reason)finishReason=choice.finish_reason;
    if(value.usage&&Number.isSafeInteger(value.usage.total_tokens)&&value.usage.total_tokens>=0)usage=value.usage.total_tokens;
  };
  const line=value=>{if(value==='')dispatch();else if(value.startsWith('data:'))data.push(value.slice(5).replace(/^ /,''));};
  try {
    while(!done){
      if(signal.aborted)throw new Error('ABORTED');
      const chunk=await reader.read();
      buffer+=decoder.decode(chunk.value,{stream:!chunk.done});
      if(buffer.length>128*1024)throw new Error('STREAM');
      let at;
      while((at=buffer.indexOf('\n'))>=0){line(buffer.slice(0,at).replace(/\r$/,''));buffer=buffer.slice(at+1);if(done)break;}
      if(chunk.done){if(buffer)line(buffer.replace(/\r$/,''));dispatch();break;}
    }
    if(!done||!finishReason||!text.trim())throw new Error('STREAM');
    return {text,finishReason,usage};
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}

export class DeepSeekService {
  constructor({credentials,fetchImpl=globalThis.fetch,openSettings,timeoutMs=120000}={}) {
    Object.assign(this,{credentials,fetchImpl,openSettings,timeoutMs});this.listeners=new Map();this.jobs=new Map();
  }
  async status(id) {
    try{return {configured:Boolean(await this.credentials?.read(id)),error:null};}
    catch(error){return {configured:false,error:error.message};}
  }
  subscribe(id,callback) {
    const entries=this.listeners.get(id)??new Set();entries.add(callback);this.listeners.set(id,entries);
    void this.status(id).then(value=>{if(entries.has(callback))callback({type:'connection',...value});});
    return ()=>{entries.delete(callback);if(!entries.size)this.listeners.delete(id);};
  }
  emit(id,value) { for(const callback of this.listeners.get(id)??[])callback(structuredClone(value)); }
  async changed(id) { this.emit(id,{type:'connection',...await this.status(id)}); }
  configure(id,signal) { if(!this.openSettings)throw new Error('连接设置不可用');this.openSettings({id,signal});return {opened:true}; }
  start(id,input) {
    const request=validateDeepSeekRequest(input);
    if(this.jobs.has(id))throw new Error('已有回复正在生成');
    const job={requestId:request.requestId,controller:new AbortController(),cancelled:false,timedOut:false};this.jobs.set(id,job);
    job.promise=this.run(id,request,job);return {requestId:request.requestId};
  }
  cancel(id) { const job=this.jobs.get(id);if(job){job.cancelled=true;job.controller.abort();}return {cancelled:Boolean(job)}; }
  async run(id,request,job) {
    let latest='',lastEmit=0;
    const send=value=>{if(this.jobs.get(id)===job)this.emit(id,{requestId:request.requestId,...value});};
    const timer=setTimeout(()=>{job.timedOut=true;job.controller.abort();},this.timeoutMs);
    try {
      const key=await this.credentials?.read(id);
      if(!key)throw new Error('NO_KEY');
      if(job.controller.signal.aborted)throw new Error('ABORTED');
      const response=await this.fetchImpl('https://api.deepseek.com/chat/completions',{
        method:'POST',redirect:'error',signal:job.controller.signal,
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},
        body:JSON.stringify({model:request.model,messages:request.messages,stream:true,stream_options:{include_usage:true},thinking:{type:'disabled'},max_tokens:2048})
      });
      if(!response.ok){await response.body?.cancel().catch(()=>{});throw new Error('HTTP_'+response.status);}
      const result=await consumeDeepSeekStream(response,{signal:job.controller.signal,onText:text=>{
        latest=text;if(Date.now()-lastEmit>=100){lastEmit=Date.now();send({type:'delta',text});}
      }});
      if(job.controller.signal.aborted)throw new Error('ABORTED');
      send({type:'done',...result});
    } catch(error) {
      const message=job.cancelled?'已停止生成。':job.timedOut?'请求超时，请稍后重试。':error.message==='NO_KEY'?'请先配置 DeepSeek API Key。':error.message?.startsWith('HTTP_')?messageFor(Number(error.message.slice(5))):error.message==='OUTPUT_LIMIT'?'回复达到长度上限，请缩小问题后重试。':error.message==='STREAM'?'回复未完整接收，请检查网络后重试。':'连接失败，请检查网络和 API Key 后重试。';
      send({type:job.cancelled?'cancelled':'error',text:latest,message});
    } finally {clearTimeout(timer);if(this.jobs.get(id)===job)this.jobs.delete(id);}
  }
  stop() {for(const id of this.jobs.keys())this.cancel(id);this.listeners.clear();}
}
