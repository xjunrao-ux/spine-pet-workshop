import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { atomicWrite } from './settings-store.mjs';

export const LOCAL_SERVICE_LIMITS = Object.freeze({body:65536,response:262144,event:65536,http:4,streams:1,timeout:15000,idle:45000});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const id=value=>typeof value==='string'&&/^[A-Za-z0-9._-]{1,100}$/.test(value);
const pluginId=value=>typeof value==='string'&&/^[a-z][a-z0-9.-]{2,99}$/.test(value);
const fail=code=>{throw new Error(code);};
const keys=(value,names)=>{if(!plain(value)||Object.keys(value).some(key=>!names.includes(key)))fail('INVALID_REQUEST');};
const redact=(value,secret)=>secret?JSON.parse(JSON.stringify(value).split(secret).join('[redacted]')):value;

// No DNS, proxy, cookies, redirect or renderer-controlled absolute URL is involved.
export function validateLocalEndpoint(value) {
  if(typeof value!=='string'||value.length>500||!/^http:\/\/(?:127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}(?:\/[A-Za-z0-9_./-]*)?$/.test(value))fail('INVALID_ENDPOINT');
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash)fail('INVALID_ENDPOINT');
  const rawPath=value.slice(value.indexOf('/',7));
  if(rawPath.startsWith('/')&&(rawPath.includes('//')||rawPath.split('/').some(part=>part==='.'||part==='..')))fail('INVALID_ENDPOINT');
  if(!url.pathname.endsWith('/'))url.pathname+='/';
  return 'http://'+url.hostname+':'+(url.port||'80')+url.pathname;
}

export function localRequestURL(endpoint,relative,query) {
  if(typeof relative!=='string'||relative.length>300||!/^\/[A-Za-z0-9_./-]*$/.test(relative)||relative.includes('//')||relative.split('/').some(part=>part==='.'||part==='..'))fail('INVALID_PATH');
  const base=new URL(validateLocalEndpoint(endpoint)),url=new URL(relative.slice(1),base);
  if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))fail('INVALID_PATH');
  if(query!==undefined){
    if(!plain(query)||Object.keys(query).length>20)fail('INVALID_QUERY');
    for(const [name,value] of Object.entries(query)){
      if(!/^[A-Za-z][A-Za-z0-9_-]{0,49}$/.test(name)||typeof value!=='string'||value.length>500)fail('INVALID_QUERY');
      url.searchParams.set(name,value);
    }
  }
  return url.href;
}

export class LocalConnectionStore {
  constructor({userData,encryption}){this.directory=path.join(userData,'plugins','credentials');this.encryption=encryption;this.queues=new Map();}
  file(owner){if(!pluginId(owner))fail('INVALID_PLUGIN');return path.join(this.directory,createHash('sha256').update(owner).digest('hex')+'.local-service.json');}
  async read(owner){
    let record;try{record=JSON.parse(await readFile(this.file(owner),'utf8'));}catch(error){if(error.code==='ENOENT')return null;fail('CONFIG_UNAVAILABLE');}
    if(record?.schemaVersion!==1||typeof record.encrypted!=='string'||record.encrypted.length>16000)fail('CONFIG_UNAVAILABLE');
    if(!record.encrypted)return null;
    if(!this.encryption?.isEncryptionAvailable())fail('ENCRYPTION_UNAVAILABLE');
    try{const value=JSON.parse(this.encryption.decryptString(Buffer.from(record.encrypted,'base64')));return this.validate(value);}catch{fail('CONFIG_UNAVAILABLE');}
  }
  validate(value){
    keys(value,['endpoint','token']);
    const endpoint=validateLocalEndpoint(value.endpoint);
    if(typeof value.token!=='string'||!/^[A-Za-z0-9._~+/-]{16,512}={0,2}$/.test(value.token))fail('INVALID_TOKEN');
    return {endpoint,token:value.token};
  }
  write(owner,value,check=()=>{}){
    const file=this.file(owner),connection=value===null?null:this.validate(value);
    const operation=(this.queues.get(owner)??Promise.resolve()).then(async()=>{
      check();if(connection&&!this.encryption?.isEncryptionAvailable())fail('ENCRYPTION_UNAVAILABLE');
      const encrypted=connection?this.encryption.encryptString(JSON.stringify(connection)).toString('base64'):'';
      check();await atomicWrite(file,{schemaVersion:1,encrypted});
    });this.queues.set(owner,operation.catch(()=>{}));return operation;
  }
}

// SSE framing only. Domain payloads remain opaque to the host.
// CR, LF, CRLF, UTF-8 chunks, comments, multiline data and persistent IDs follow HTML SSE rules.
export class LocalSSEParser {
  constructor(){this.decoder=new TextDecoder();this.buffer='';this.data=[];this.event='';this.lastEventId='';this.retry=null;this.bytes=0;this.skipLF=false;}
  push(bytes){
    const events=[];let text=this.decoder.decode(bytes,{stream:true});
    if(this.skipLF&&text.length){this.skipLF=false;if(text.startsWith('\n'))text=text.slice(1);}
    this.buffer+=text;
    let match;
    while((match=/[\r\n]/.exec(this.buffer))){
      const line=this.buffer.slice(0,match.index),ending=this.buffer[match.index];this.buffer=this.buffer.slice(match.index+1);
      if(ending==='\r'){if(this.buffer.startsWith('\n'))this.buffer=this.buffer.slice(1);else if(!this.buffer)this.skipLF=true;}
      if(Buffer.byteLength(line)>LOCAL_SERVICE_LIMITS.event)fail('EVENT_LIMIT');
      if(line===''){
        if(this.data.length)events.push({event:this.event||'message',data:this.data.join('\n'),lastEventId:this.lastEventId,...(this.retry===null?{}:{retry:this.retry})});
        this.data=[];this.event='';this.bytes=0;continue;
      }
      if(line.startsWith(':'))continue;
      const at=line.indexOf(':'),field=at<0?line:line.slice(0,at);let value=at<0?'':line.slice(at+1);if(value.startsWith(' '))value=value.slice(1);
      this.bytes+=Buffer.byteLength(line);if(this.bytes>LOCAL_SERVICE_LIMITS.event)fail('EVENT_LIMIT');
      if(field==='data')this.data.push(value);
      else if(field==='event'){if(value.length>100)fail('EVENT_LIMIT');this.event=value;}
      else if(field==='id'&&!value.includes('\0')){if(value.length>200)fail('EVENT_LIMIT');this.lastEventId=value;}
      else if(field==='retry'&&/^[0-9]+$/.test(value)&&Number(value)<=300000)this.retry=Number(value);
    }
    if(Buffer.byteLength(this.buffer)+this.bytes>LOCAL_SERVICE_LIMITS.event)fail('EVENT_LIMIT');
    return events;
  }
  // An unterminated event is deliberately not delivered at EOF.
}

async function readJSON(response){
  if(response.status===204)return null;
  if(response.headers.get('content-type')?.split(';')[0].trim()!=='application/json')fail('INVALID_CONTENT_TYPE');
  const declared=Number(response.headers.get('content-length'));if(declared>LOCAL_SERVICE_LIMITS.response)fail('RESPONSE_LIMIT');
  if(!response.body)fail('INVALID_RESPONSE');
  const reader=response.body.getReader(),parts=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>LOCAL_SERVICE_LIMITS.response)fail('RESPONSE_LIMIT');parts.push(value);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
  catch(error){if(['RESPONSE_LIMIT'].includes(error.message))throw error;fail('INVALID_RESPONSE');}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

// node:http connects to a numeric loopback directly; environment/global fetch proxies are bypassed.
export function directLocalFetch(url,options){
  return new Promise((resolve,reject)=>{
    const request=httpRequest(url,{method:options.method,headers:options.headers,signal:options.signal,agent:false},response=>{
      if(response.statusCode>=300&&response.statusCode<400){response.resume();reject(new Error('REDIRECT_DENIED'));return;}
      try{
        const empty=[204,205,304].includes(response.statusCode);
        if(empty)response.resume();
        resolve(new Response(empty?null:Readable.toWeb(response),{status:response.statusCode,headers:response.headers}));
      }catch(error){response.destroy();reject(error);}
    });request.on('error',reject);request.end(options.body);
  });
}

export class LocalService {
  constructor({connections,fetchImpl=directLocalFetch,openSettings,timeoutMs=LOCAL_SERVICE_LIMITS.timeout,idleMs=LOCAL_SERVICE_LIMITS.idle}={}){
    Object.assign(this,{connections,fetchImpl,openSettings,timeoutMs,idleMs});this.listeners=new Map();this.jobs=new Map();this.configuring=new Set();
  }
  async status(owner){try{const config=await this.connections.read(owner);return {configured:Boolean(config),endpoint:config?.endpoint??null,error:null};}catch{return {configured:false,endpoint:null,error:'CONFIG_UNAVAILABLE'};}}
  subscribe(owner,callback){const listeners=this.listeners.get(owner)??new Set();listeners.add(callback);this.listeners.set(owner,listeners);return ()=>{listeners.delete(callback);if(!listeners.size)this.listeners.delete(owner);};}
  emit(owner,event){for(const callback of this.listeners.get(owner)??[])try{callback(structuredClone(event));}catch{/* a subscriber cannot break transport teardown */}}
  configure(owner,signal){if(!this.openSettings)fail('SETTINGS_UNAVAILABLE');this.openSettings({id:owner,signal});return {opened:true};}
  async save(owner,value,check=()=>{}){
    if(this.configuring.has(owner))fail('CONFIG_BUSY');this.configuring.add(owner);this.cancelAll(owner);
    try{await this.connections.write(owner,value,check);check();this.emit(owner,{type:'configuration.changed',...await this.status(owner)});}finally{this.configuring.delete(owner);}
  }
  launch(owner,input,{signal,stream=false}={}){
    keys(input,stream?['streamId','path','query','lastEventId']:['requestId','method','path','query','body']);
    const operationId=stream?input.streamId:input.requestId;if(!id(operationId))fail('INVALID_REQUEST');
    localRequestURL('http://127.0.0.1:1/',input.path,input.query);
    if(!stream&&!['GET','POST','PUT','PATCH','DELETE'].includes(input.method))fail('INVALID_METHOD');
    if(!stream&&input.method==='GET'&&input.body!==undefined)fail('INVALID_REQUEST');
    let body;if(input.body!==undefined){try{body=JSON.stringify(input.body);}catch{fail('INVALID_REQUEST');}if(body===undefined||Buffer.byteLength(body)>LOCAL_SERVICE_LIMITS.body)fail('BODY_LIMIT');}
    if(stream&&input.lastEventId!==undefined&&(typeof input.lastEventId!=='string'||input.lastEventId.length>200||/[^\x20-\x7e]/.test(input.lastEventId)))fail('INVALID_CURSOR');
    if(signal?.aborted)fail('REVOKED');if(this.configuring.has(owner))fail('CONFIG_BUSY');
    const jobs=this.jobs.get(owner)??new Map(),key=(stream?'s:':'r:')+operationId;
    if(jobs.has(key))fail('DUPLICATE_OPERATION');
    if([...jobs.values()].filter(job=>job.stream===stream).length>=(stream?LOCAL_SERVICE_LIMITS.streams:LOCAL_SERVICE_LIMITS.http))fail('BUSY');
    const job={id:operationId,stream,controller:new AbortController(),reason:null,active:true};
    const abort=()=>{job.reason='REVOKED';job.active=false;job.controller.abort();};signal?.addEventListener('abort',abort,{once:true});
    jobs.set(key,job);this.jobs.set(owner,jobs);
    job.promise=this.run(owner,input,body,job).finally(()=>{signal?.removeEventListener('abort',abort);if(jobs.get(key)===job)jobs.delete(key);if(!jobs.size&&this.jobs.get(owner)===jobs)this.jobs.delete(owner);});
    return stream?{streamId:operationId,accepted:true}:{requestId:operationId,accepted:true};
  }
  request(owner,input,options){return this.launch(owner,input,options);}
  stream(owner,input,options){return this.launch(owner,input,{...options,stream:true});}
  cancel(owner,{requestId,streamId}={}){
    if((requestId===undefined)===(streamId===undefined)||!id(requestId??streamId))fail('INVALID_REQUEST');
    const job=this.jobs.get(owner)?.get((streamId===undefined?'r:':'s:')+(requestId??streamId));
    if(job){job.reason='CANCELLED';job.controller.abort();}return {cancelled:Boolean(job)};
  }
  cancelAll(owner){for(const job of this.jobs.get(owner)?.values()??[]){job.active=false;job.reason='REVOKED';job.controller.abort();}}
  async run(owner,input,body,job){
    const identity=job.stream?{streamId:job.id}:{requestId:job.id};
    const send=event=>{if(job.active&&!job.controller.signal.aborted)this.emit(owner,{...identity,...event});};
    let timer,reader,response,secret='';
    const arm=duration=>{clearTimeout(timer);timer=setTimeout(()=>{job.reason='TIMEOUT';job.controller.abort();},duration);};
    arm(this.timeoutMs);
    try{
      const config=await this.connections.read(owner);if(!config)fail('NOT_CONFIGURED');if(job.controller.signal.aborted)fail('REVOKED');secret=config.token;
      const headers={Accept:job.stream?'text/event-stream':'application/json',Authorization:'Bearer '+secret};
      if(body!==undefined)headers['Content-Type']='application/json';
      if(job.stream&&input.lastEventId)headers['Last-Event-ID']=input.lastEventId;
      response=await this.fetchImpl(localRequestURL(config.endpoint,input.path,input.query),{method:job.stream?'GET':input.method,headers,body,redirect:'error',credentials:'omit',cache:'no-store',signal:job.controller.signal});
      if(job.controller.signal.aborted){await response.body?.cancel().catch(()=>{});fail('REVOKED');}
      if(!job.stream){
        const data=await readJSON(response);if(job.controller.signal.aborted)fail('CANCELLED');send({type:'response',status:response.status,ok:response.ok,data:redact(data,secret)});return;
      }
      if(response.status!==200||response.headers.get('content-type')?.split(';')[0].trim()!=='text/event-stream'){
        await response.body?.cancel().catch(()=>{});fail(response.status===401||response.status===403?'HTTP_'+response.status:'INVALID_EVENT_STREAM');
      }
      if(!response.body)fail('INVALID_EVENT_STREAM');
      reader=response.body.getReader();const parser=new LocalSSEParser();let period=Date.now(),count=0,bytes=0;
      send({type:'stream.open'});arm(this.idleMs);
      while(true){
        const chunk=await reader.read();if(chunk.done)break;if(job.controller.signal.aborted)break;arm(this.idleMs);
        if(Date.now()-period>=1000){period=Date.now();count=0;bytes=0;}bytes+=chunk.value.byteLength;if(bytes>1024*1024)fail('RATE_LIMIT');
        for(const event of parser.push(chunk.value)){if(++count>120)fail('RATE_LIMIT');send({type:'stream.event',...redact(event,secret)});}
      }
      if(job.controller.signal.aborted)fail('CANCELLED');send({type:'stream.end'});
    }catch(error){
      const known=['NOT_CONFIGURED','CONFIG_UNAVAILABLE','ENCRYPTION_UNAVAILABLE','HTTP_401','HTTP_403','INVALID_CONTENT_TYPE','INVALID_RESPONSE','RESPONSE_LIMIT','INVALID_EVENT_STREAM','EVENT_LIMIT','RATE_LIMIT'];
      const code=job.reason??(known.includes(error.message)?error.message:'NETWORK_ERROR');
      if(job.active)this.emit(owner,{...identity,type:job.stream?'stream.error':'request.error',code});
    }finally{clearTimeout(timer);if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();}else await response?.body?.cancel().catch(()=>{});}
  }
  stop(){for(const owner of this.jobs.keys())this.cancelAll(owner);this.listeners.clear();}
}
