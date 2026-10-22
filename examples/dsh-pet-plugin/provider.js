// pet-dsh/1 client. Single sandbox entry: no Node, fetch, DOM or external imports.
const PROTOCOL='pet-dsh/1';
const REQUIRED=['sessions.list','session.snapshot','message.send','events.follow','requests.lookup'];
const ACTIVE=['running','waiting-approval','waiting-input','cancelling'];
const OUTCOMES=['completed','failed','cancelled','interrupted'];
const TERMINAL=['ended','rejected'];
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9._-]{1,100}$/.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const string=(value,max=4000)=>typeof value==='string'&&value.length<=max;
const cursor=value=>typeof value==='string'&&/^[\x20-\x7e]{1,200}$/.test(value);
const int=value=>Number.isSafeInteger(value)&&value>=0;
const bytes=value=>new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)).length;
const clone=value=>JSON.parse(JSON.stringify(value));
const cut=(value,max=4000)=>{let text=String(value??'').slice(0,max);if(/[\uD800-\uDBFF]$/.test(text))text=text.slice(0,-1);return text;};
const problem=(code,status=0)=>Object.assign(new Error(code),{code,status});
const ensure=(condition,code='INVALID_RESPONSE')=>{if(!condition)throw problem(code);};
const uuid=()=>{ensure(globalThis.crypto?.getRandomValues,'RANDOM_UNAVAILABLE');const a=new Uint8Array(16);globalThis.crypto.getRandomValues(a);return 'pet.'+Array.from(a,x=>x.toString(16).padStart(2,'0')).join('');};
const labels={running:'执行中','waiting-approval':'等待 DSH 审批','waiting-input':'等待输入',cancelling:'请求停止中',unknown:'状态未知',completed:'已完成',failed:'失败',cancelled:'已取消',interrupted:'执行中断',prepared:'已保存发送意图',submitting:'正在提交',received:'DSH 已记录',accepted:'DSH 已接收',ended:'已结束',rejected:'已拒绝'};
const errorText=code=>({
  NOT_CONFIGURED:'请先配置 DSH 服务地址和连接令牌。',
  UNAUTHORIZED:'连接令牌无效或已撤销，请重新配置授权。',HTTP_401:'连接令牌无效或已撤销，请重新配置授权。',
  FORBIDDEN:'当前连接没有访问此会话或操作的权限。',HTTP_403:'当前连接没有访问权限，请检查 DSH 授权。',
  SESSION_NOT_FOUND:'会话没有活跃 Agent，请先在 DSH 中打开会话。',
  SESSION_BUSY:'DSH 正在执行，请等待结束或使用已授权的追加指令。',
  INSTANCE_CHANGED:'DSH 服务实例已变化，正在重新同步。',
  UNSUPPORTED_CAPABILITY:'服务未开放这个能力。',INCOMPATIBLE:'服务协议或必需能力不兼容。',
  INVALID_RESPONSE:'服务数据不符合 pet-dsh/1，请检查双方版本。',
  INVALID_EVENT:'收到不合法的会话事件，正在重新同步。',
  REQUEST_CONFLICT:'请求号与服务记录冲突，请检查发送记录。',
  REQUEST_UNKNOWN:'未查到发送记录，结果仍未知，请在 DSH 中确认。',
  RESULT_UNKNOWN:'服务无法证明执行结果，请在 DSH 中确认。',
  EXPIRED:'目标活动已结束或改变，请重新同步。',
  OVERLOADED:'服务繁忙，请稍后手动操作。',BODY_TOO_LARGE:'消息超过服务长度或字节限制。',
  STORAGE_ERROR:'本机记录保存失败，已禁止新发送；请检查存储后重启插件。',
  STORAGE_FULL:'未决记录或本机数据已满，请先查清结果或清理缓存。',
  STORAGE_VERSION:'本机记录无法安全读取，原数据已保留。',STALE:'页面绑定已变化，请使用更新后的页面。',
  NOT_READY:'请先选择可用会话并等待实时连接就绪。',
  UNRESOLVED:'这条会话仍有未查清的桌宠提交，请先查询结果。',
  INPUT_EMPTY:'请输入消息。',BUSY:'本地通道忙，请稍后重试。',
  TIMEOUT:'等待回执超时，远端可能仍在执行。',NETWORK_ERROR:'连接中断，远端任务可能仍在执行。',
  STEER_DISABLED:'追加指令需要用户设置与服务能力同时启用。',
  RANDOM_UNAVAILABLE:'安全随机数不可用，无法创建发送身份。'
}[code]??'操作未完成，请检查连接或在 DSH 中确认结果。');

export function validateInfo(value){
  ensure(object(value)&&Array.isArray(value.protocols)&&value.protocols.includes(PROTOCOL),'INCOMPATIBLE');
  ensure(identifier(value.instanceId)&&string(value.serverVersion,100)&&string(value.dshVersion,100));
  ensure(Array.isArray(value.capabilities)&&value.capabilities.length<=100&&value.capabilities.every(x=>string(x,100)));
  ensure(REQUIRED.every(x=>value.capabilities.includes(x)),'INCOMPATIBLE');
  ensure(object(value.limits));
  for(const key of ['requestBytes','responseBytes','eventBytes','messageChars'])ensure(Number.isSafeInteger(value.limits[key])&&value.limits[key]>0);
  return value;
}
export function validateSessions(value,instance){
  ensure(object(value)&&value.instanceId===instance&&Array.isArray(value.items)&&value.items.length<=100);
  ensure(value.nextCursor===null||string(value.nextCursor,500));
  const seen=new Set();
  for(const s of value.items){
    ensure(object(s)&&identifier(s.sessionId)&&!seen.has(s.sessionId));seen.add(s.sessionId);
    ensure((s.title===null||string(s.title,1000))&&(s.workspace===null||string(s.workspace,1000)));
    ensure(typeof s.available==='boolean'&&['idle','running','unavailable'].includes(s.status));
  }
  return value;
}
export function validateSnapshot(value,instance,session){
  ensure(object(value)&&value.instanceId===instance&&value.sessionId===session&&cursor(value.cursor));
  ensure(Array.isArray(value.messages)&&value.messages.length<=200);
  const seen=new Set();
  for(const m of value.messages){ensure(object(m)&&identifier(m.messageId)&&!seen.has(m.messageId)&&['user','assistant'].includes(m.role)&&string(m.text,32000)&&Number.isSafeInteger(m.turn));seen.add(m.messageId);}
  ensure(value.activity===null||(object(value.activity)&&identifier(value.activity.activityId)&&ACTIVE.includes(value.activity.status)));
  ensure(Array.isArray(value.pendingInteractions)&&Array.isArray(value.pendingPetCalls)&&typeof value.truncated==='boolean');
  return value;
}
export function validateEnvelope(value,requestId){
  ensure(object(value)&&value.protocol===PROTOCOL&&typeof value.ok==='boolean');
  if(value.requestId!==undefined)ensure(value.requestId===requestId);
  if(value.ok)ensure(identifier(value.instanceId)&&value.requestId===requestId&&Object.hasOwn(value,'data')&&!Object.hasOwn(value,'error'));
  else ensure(object(value.error)&&/^[A-Z][A-Z0-9_]{1,79}$/.test(value.error.code)&&string(value.error.message,1000)&&typeof value.error.retryable==='boolean'&&!Object.hasOwn(value,'data'));
  return value;
}
export function validateEvent(value,lastEventId){
  ensure(object(value)&&value.protocol===PROTOCOL&&identifier(value.instanceId)&&identifier(value.sessionId)&&cursor(value.cursor)&&value.cursor===lastEventId&&object(value.data),'INVALID_EVENT');
  if(value.requestId!==undefined)ensure(identifier(value.requestId),'INVALID_EVENT');
  const d=value.data;
  const id=(...keys)=>keys.forEach(key=>ensure(identifier(d[key]),'INVALID_EVENT'));
  const text=(key,max=16000)=>ensure(string(d[key],max),'INVALID_EVENT');
  switch(value.type){
    case 'message.claimed':id('requestId','messageId','activityId');ensure(int(d.turn),'INVALID_EVENT');break;
    case 'assistant.delta':id('activityId','attemptId');text('text',32000);ensure(int(d.index),'INVALID_EVENT');break;
    case 'assistant.message':id('messageId');text('text',32000);ensure(Number.isSafeInteger(d.turn),'INVALID_EVENT');if(d.attemptId!==undefined)id('attemptId');break;
    case 'tool.started':id('activityId','callId');text('name',100);text('summary',1000);break;
    case 'tool.finished':id('activityId','callId');text('summary',1000);ensure(['completed','failed'].includes(d.status),'INVALID_EVENT');break;
    case 'activity.state':id('activityId');ensure(ACTIVE.includes(d.status),'INVALID_EVENT');break;
    case 'activity.ended':id('activityId');ensure(OUTCOMES.includes(d.outcome),'INVALID_EVENT');break;
    case 'session.changed':text('status',100);break;
    case 'resync.required':text('reason',1000);break;
    // Optional commands have no UI in this client. Receiving undeclared business events is a protocol error.
    default:throw problem('INVALID_EVENT');
  }
  return value;
}
function validateState(value){
  ensure(object(value)&&value.schemaVersion===1&&identifier(value.profileId)&&string(value.endpoint,500)&&string(value.lastSelected,100),'STORAGE_VERSION');
  ensure(object(value.persona)&&string(value.persona.text,2000)&&string(value.persona.memory,4000)&&int(value.persona.revision),'STORAGE_VERSION');
  ensure(Array.isArray(value.outbox)&&value.outbox.length<=40&&Array.isArray(value.cache)&&value.cache.length<=2&&Array.isArray(value.notificationKeys)&&value.notificationKeys.length<=64,'STORAGE_VERSION');
  const seen=new Set();
  for(const r of value.outbox){
    ensure(object(r)&&identifier(r.id)&&!seen.has(r.id)&&identifier(r.sessionId)&&['message.send','session.cancel'].includes(r.op)&&string(r.endpoint,500)&&string(r.text??'',4000)&&string(r.createdAt,50)&&string(r.updatedAt,50)&&['prepared','submitting','received','accepted','running','ended','rejected','unknown'].includes(r.status),'STORAGE_VERSION');
    if(r.activityId!==undefined)ensure(identifier(r.activityId),'STORAGE_VERSION');
    if(r.messageId!==undefined)ensure(identifier(r.messageId),'STORAGE_VERSION');
    if(r.outcome!==undefined)ensure(OUTCOMES.includes(r.outcome),'STORAGE_VERSION');
    seen.add(r.id);
  }
  for(const c of value.cache){ensure(object(c)&&identifier(c.sessionId)&&identifier(c.instanceId)&&Array.isArray(c.messages)&&string(c.capturedAt,50),'STORAGE_VERSION');for(const m of c.messages)ensure(object(m)&&identifier(m.messageId)&&['user','assistant'].includes(m.role)&&string(m.text,16000),'STORAGE_VERSION');}
  ensure(value.notificationKeys.every(x=>string(x,500))&&bytes(value)<=384*1024,'STORAGE_VERSION');
  return value;
}
function trimState(value){
  value.outbox=[...value.outbox.filter(r=>!TERMINAL.includes(r.status)),...value.outbox.filter(r=>TERMINAL.includes(r.status)).slice(-32)].slice(0,40);
  value.cache=value.cache.slice(-2);
  while(value.cache.length&&bytes(value.cache)>160*1024)value.cache.shift();
  while(bytes(value)>384*1024&&value.cache.length)value.cache.shift();
  while(bytes(value)>384*1024&&value.outbox.some(r=>TERMINAL.includes(r.status)))value.outbox.splice(value.outbox.findIndex(r=>TERMINAL.includes(r.status)),1);
  ensure(bytes(value)<=384*1024,'STORAGE_FULL');return value;
}
const txt=(text,tone='normal')=>({type:'text',text:cut(text),tone,multiline:true});
const btn=(commandId,label,payload={},enabled=true,icon='play')=>({type:'button',commandId,label,payload,enabled,icon,variant:'text'});
const row=(...children)=>({type:'group',layout:'row',children});

export async function activate(context){
  const local=context.localService;
  let db={schemaVersion:1,profileId:uuid(),endpoint:'',lastSelected:'',persona:{text:'',memory:'',revision:0},outbox:[],cache:[],notificationKeys:[]};
  let closed=false,storageFault='',phase='unconfigured',configured=false,endpoint='',info=null,selected='',sessionMeta=null;
  let epoch=0,bindingEpoch=1,formEpoch=1,transportSequence=0,stream=null,release=()=>{},saveQueue=Promise.resolve();
  let messages=[],activity=null,preview=null,tools=[],watermark='',truncated=false,lastCode='',notice='',confirmation=null,mode='followup';
  let sessions=[],nextCursor=null,pageCursor='',pageOffset=0,previousPages=[],retryCount=0,retryTimer=null,resyncTimer=null,stableTimer=null,publishTimer=null,selectionBusy=false;
  const pending=new Map(),draining=new Map(),timers=new Map(),seenCursors=new Set(),attempts=new Map(),retiredAttempts=new Set(),localLocks=new Set(),notificationInFlight=new Set();
  const live=()=>!closed&&!context.signal.aborted;
  const cfg=()=>context.getConfig();
  const isCurrent=n=>live()&&n===epoch;
  const schedule=(fn,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);if(live())fn();},ms);timers.set(timer,null);return timer;};
  const clear=timer=>{if(timer){clearTimeout(timer);const done=timers.get(timer);timers.delete(timer);done?.();}};
  const pause=ms=>new Promise(resolve=>{const timer=schedule(resolve,ms);timers.set(timer,resolve);});
  const background=promise=>{Promise.resolve(promise).catch(error=>{if(live()&&error.code!=='STALE'){lastCode=error.code??'NETWORK_ERROR';publish();}});};
  const stamp=()=>new Date().toISOString();
  const findRecord=id=>db.outbox.find(r=>r.id===id);
  const trustedRecord=r=>r.endpoint===endpoint&&!r.quarantined;
  const unresolved=()=>db.outbox.some(r=>r.sessionId===selected&&trustedRecord(r)&&r.op==='message.send'&&!TERMINAL.includes(r.status));
  const canWrite=()=>phase==='ready'&&sessionMeta?.available&&!storageFault;
  const allowedSteer=()=>Boolean(cfg().enableSteer&&info?.capabilities.includes('message.steer'));
  const bind=()=>({sessionId:selected,bindingEpoch});
  const cancelPayload=()=>({...bind(),activityId:activity?.activityId});
  const permission=name=>!context.getPermissions||context.getPermissions().includes(name);
  function publish(immediate=true){
    if(!live())return;
    if(immediate){clear(publishTimer);publishTimer=null;context.publish(getSnapshot());}
    else if(!publishTimer)publishTimer=schedule(()=>{publishTimer=null;context.publish(getSnapshot());},150);
  }
  function persist(change){
    const operation=saveQueue.then(async()=>{
      ensure(live(),'STALE');ensure(!storageFault,'STORAGE_ERROR');
      const next=clone(db);change(next);trimState(next);
      try{await context.storage.set('state',next);}catch{storageFault='STORAGE_ERROR';throw problem('STORAGE_ERROR');}
      if(live())db=next;
    });
    saveQueue=operation.catch(()=>{});return operation;
  }
  function saveBackground(change){background(persist(change).catch(error=>{if(live()){storageFault=error.code??'STORAGE_ERROR';lastCode=storageFault;publish();}}));}
  function patchRecord(id,patch){
    return persist(next=>{
      const r=next.outbox.find(x=>x.id===id);if(!r)return;
      if(TERMINAL.includes(r.status)&&!TERMINAL.includes(patch.status))return;
      const rank={prepared:0,submitting:1,received:2,accepted:3,running:4};
      const merged={...patch};if(rank[r.status]>rank[patch.status])delete merged.status;
      Object.assign(r,merged,{updatedAt:stamp()});
      if(TERMINAL.includes(r.status))delete r.text;
    }).then(()=>{publish();});
  }
  function cacheSnapshot(){
    if(!cfg().cacheHistory||!selected||!info)return;
    const value={instanceId:info.instanceId,sessionId:selected,messages:messages.map(m=>({...m,text:cut(m.text,16000)})),activity:activity?clone(activity):null,capturedAt:stamp()};
    saveBackground(next=>{next.cache=next.cache.filter(c=>c.sessionId!==value.sessionId);next.cache.push(value);});
  }
  function beginCall(args,n=epoch){
    ensure(isCurrent(n),'STALE');ensure(pending.size<3,'BUSY');
    const requestId='http.'+(++transportSequence);
    let resolve,reject;
    const result=new Promise((a,b)=>{resolve=a;reject=b;});result.catch(()=>{});
    const timer=schedule(()=>{const p=pending.get(requestId);if(p){pending.delete(requestId);reject(problem('TIMEOUT'));background(local.cancel({requestId}));}},18000);
    pending.set(requestId,{resolve,reject,timer,epoch:n});
    const accepted=Promise.resolve().then(()=>{ensure(isCurrent(n),'STALE');return local.request({requestId,...args});}).catch(error=>{
      const p=pending.get(requestId);if(p){pending.delete(requestId);clear(timer);reject(problem(error.code??'NETWORK_ERROR'));}
      throw error;
    });
    accepted.catch(()=>{});return {result,accepted};
  }
  async function call(args,n=epoch){const job=beginCall(args,n);await job.accepted;return job.result;}
  function checked(response){
    if(!response.ok){
      const env=validateEnvelope(response.data,response.data?.requestId);
      throw problem(env.error.code,response.status);
    }
    return response.data;
  }
  async function stopStream(){
    const old=stream;stream=null;
    if(!old)return;
    let finish;const ended=new Promise(resolve=>{finish=resolve;});
    draining.set(old.id,finish);
    try{await local.cancel({streamId:old.id});await Promise.race([ended,pause(500)]);}catch{}
    draining.delete(old.id);
  }
  function cutConnection(){
    ++epoch;++bindingEpoch;confirmation=null;clear(retryTimer);retryTimer=null;clear(resyncTimer);resyncTimer=null;clear(stableTimer);stableTimer=null;
    for(const [id,p]of pending){clear(p.timer);p.reject(problem('STALE'));background(local.cancel({requestId:id}));}pending.clear();
    preview=null;seenCursors.clear();attempts.clear();retiredAttempts.clear();watermark='';
    return epoch;
  }
  function authFailure(code){return ['HTTP_401','HTTP_403','UNAUTHORIZED','FORBIDDEN'].includes(code);}
  function connectionFailed(error,n){
    if(!isCurrent(n))return;
    lastCode=error.code??'NETWORK_ERROR';phase=authFailure(lastCode)?'auth-required':lastCode==='INCOMPATIBLE'?'incompatible':'reconnecting';
    clear(stableTimer);stableTimer=null;
    if(activity&&ACTIVE.includes(activity.status))activity={...activity,status:'unknown'};
    preview=null;publish();
    if(phase!=='reconnecting')return;
    if(retryCount>=5){phase='disconnected';notice='多次连接失败，请手动重连。';publish();return;}
    const delay=[1000,2000,4000,8000,30000][retryCount++];
    retryTimer=schedule(()=>{retryTimer=null;background(connect(false));},delay+Math.floor(Math.random()*200));
  }
  async function loadSessionPage(cursorValue='',n=epoch){
    const data=validateSessions(checked(await call({method:'GET',path:'/sessions',...(cursorValue?{query:{cursor:cursorValue}}:{})},n)),info.instanceId);
    ensure(isCurrent(n),'STALE');sessions=data.items;nextCursor=data.nextCursor;pageCursor=cursorValue;pageOffset=0;publish();
  }
  async function lookUp(id,n=epoch){
    const r=findRecord(id);ensure(r&&trustedRecord(r),'STALE');
    const response=await call({method:'GET',path:'/requests',query:{requestId:id}},n);ensure(isCurrent(n),'STALE');
    const env=validateEnvelope(response.data,id);
    if(!response.ok||!env.ok){
      const code=env.error?.code??'INVALID_RESPONSE';
      if(authFailure(code))throw problem(code,response.status);
      if(code==='REQUEST_UNKNOWN'||code==='RESULT_UNKNOWN'){await patchRecord(id,{status:'unknown',errorCode:code});return;}
      throw problem(code,response.status);
    }
    const d=env.data;
    ensure(object(d)&&['received','accepted','running','ended','rejected','unknown'].includes(d.status)&&d.sessionId===r.sessionId&&d.op===r.op);
    for(const key of ['messageId','activityId','acceptedInstanceId'])if(d[key]!==undefined)ensure(identifier(d[key]));
    if(d.outcome!==undefined)ensure(OUTCOMES.includes(d.outcome));
    if(env.instanceId!==info.instanceId)scheduleResync();
    if(d.error!==undefined)ensure(object(d.error)&&string(d.error.code,80));
    await patchRecord(id,{status:d.status,...(d.messageId?{messageId:d.messageId}:{}),...(d.activityId?{activityId:d.activityId}:{}),
      ...(d.acceptedInstanceId?{acceptedInstanceId:d.acceptedInstanceId}:{}),...(d.outcome?{outcome:d.outcome}:{}),...(d.error?{errorCode:d.error.code}:{})});
  }
  async function reconcile(n){
    for(const r of [...db.outbox].filter(x=>trustedRecord(x)&&!TERMINAL.includes(x.status))){
      if(!isCurrent(n))return;
      try{await lookUp(r.id,n);}catch(error){if(authFailure(error.code))throw error;if(error.code==='STALE')return;}
    }
  }
  async function follow(n){
    ensure(isCurrent(n),'STALE');phase='syncing';publish();
    const data=validateSnapshot(checked(await call({method:'GET',path:'/snapshot',query:{sessionId:selected}},n)),info.instanceId,selected);
    ensure(isCurrent(n),'STALE');
    messages=data.messages.slice(-20).map(m=>({...m,text:cut(m.text,16000)}));activity=data.activity;preview=null;tools=[];watermark=data.cursor;
    truncated=data.truncated||data.messages.length>20||data.messages.some(m=>m.text.length>16000);
    seenCursors.clear();seenCursors.add(watermark);
    cacheSnapshot();phase='subscribing';publish();
    const id='sse.'+(++transportSequence);stream={id,epoch:n,sessionId:selected};
    await local.stream({streamId:id,path:'/events',query:{sessionId:selected},lastEventId:watermark});
    ensure(isCurrent(n),'STALE');await reconcile(n);
  }
  async function connect(manual=true,refreshOnly=false){
    if(!live()||storageFault)return;
    if(manual)retryCount=0;
    const keepSelected=selected,n=cutConnection();phase='handshaking';lastCode='';notice='';publish();
    await stopStream();if(!isCurrent(n))return;
    try{
      const status=await local.status();ensure(isCurrent(n),'STALE');configured=Boolean(status.configured);endpoint=status.endpoint??'';
      if(!configured){phase='unconfigured';lastCode=status.error??'';publish();return;}
      info=validateInfo(checked(await call({method:'GET',path:'/info'},n)));
      ensure(isCurrent(n),'STALE');
      await loadSessionPage(refreshOnly?pageCursor:'',n);
      const candidate=keepSelected||(db.endpoint===endpoint?db.lastSelected:'');
      sessionMeta=sessions.find(s=>s.sessionId===candidate&&s.available)??null;
      selected=sessionMeta?.sessionId??'';
      if(!selected){messages=[];activity=null;phase='selecting';publish();return;}
      await follow(n);
    }catch(error){if(error.code==='SESSION_NOT_FOUND'){selected='';sessionMeta=null;messages=[];activity=null;phase='selecting';lastCode=error.code;publish();}else connectionFailed(error,n);}
  }
  function scheduleResync(){
    if(resyncTimer||!live()||['auth-required','incompatible','disconnected'].includes(phase))return;
    phase='syncing';publish();
    resyncTimer=schedule(()=>{resyncTimer=null;background(connect(false,true));},150);
  }
  function notify(activityId,kind){
    if(!cfg().notify||!permission('ui.reminders')||!identifier(activityId))return;
    const notificationEpoch=epoch;
    const key=[db.profileId,info.instanceId,selected,activityId,kind].join('.');
    if(db.notificationKeys.includes(key)||notificationInFlight.has(key))return;
    notificationInFlight.add(key);
    background(persist(next=>{next.notificationKeys=[...next.notificationKeys.filter(x=>x!==key),key].slice(-64);}).then(()=>{
      if(isCurrent(notificationEpoch)&&cfg().notify)return context.emit({id:key,dedupeKey:key,createdAt:stamp(),pageId:'chat',summary:{private:kind==='approval'?'DSH 会话需要审批':'DSH 会话任务已结束',details:kind==='approval'?'请在 DSH 界面处理审批。':'点击查看会话的执行结果。'}});
    }).finally(()=>notificationInFlight.delete(key)));
  }
  function applyEvent(env){
    const d=env.data;
    switch(env.type){
      case 'message.claimed':{
        const r=findRecord(d.requestId);
        if(r&&trustedRecord(r)&&r.sessionId===selected){
          if(r.text&&!messages.some(m=>m.messageId===d.messageId)){messages.push({messageId:d.messageId,role:'user',text:r.text,turn:d.turn});messages=messages.slice(-20);}
          background(patchRecord(r.id,{status:'running',messageId:d.messageId,activityId:d.activityId,acceptedInstanceId:info.instanceId}));
        }
        activity={activityId:d.activityId,status:'running'};
        break;
      }
      case 'assistant.delta':{
        const key=d.activityId+'.'+d.attemptId;
        if(retiredAttempts.has(key))return;
        const old=attempts.get(key);
        if(old&&d.index<old.index)return;
        if(old)ensure(d.index===old.index,'INVALID_EVENT');
        // A fresh snapshot may cut through an existing attempt; its next delta can start above zero.
        const partial=old?.partial??d.index>0;
        if(preview&&preview.key!==key){retiredAttempts.add(preview.key);if(retiredAttempts.size>64)retiredAttempts.delete(retiredAttempts.values().next().value);}
        ensure((old?.text.length??0)+d.text.length<=32000,'INVALID_EVENT');
        const value={key,activityId:d.activityId,attemptId:d.attemptId,index:d.index+1,partial,text:(old?.text??'')+d.text};
        attempts.set(key,value);preview=value;
        if(attempts.size>8)attempts.delete(attempts.keys().next().value);
        break;
      }
      case 'assistant.message':
        if(preview&&(!d.attemptId||d.attemptId===preview.attemptId)){retiredAttempts.add(preview.key);attempts.delete(preview.key);preview=null;}
        messages=messages.filter(m=>m.messageId!==d.messageId);messages.push({messageId:d.messageId,role:'assistant',text:cut(d.text,16000),turn:d.turn});messages=messages.slice(-20);
        if(d.text.length>16000)truncated=true;
        cacheSnapshot();break;
      case 'tool.started':case 'tool.finished':{
        const old=tools.find(t=>t.callId===d.callId);tools=tools.filter(t=>t.callId!==d.callId);
        tools.push({...old,...d,status:env.type==='tool.started'?'running':d.status});tools=tools.slice(-5);break;
      }
      case 'activity.state':{
        activity={activityId:d.activityId,status:d.status};
        if(d.status==='waiting-approval')notify(d.activityId,'approval');break;
      }
      case 'activity.ended':{
        if(!activity||activity.activityId===d.activityId)activity={activityId:d.activityId,status:d.outcome};
        if(preview?.activityId===d.activityId){retiredAttempts.add(preview.key);preview=null;}
        const targetSession=selected,targetEndpoint=endpoint;
        saveBackground(next=>{for(const r of next.outbox)if(r.endpoint===targetEndpoint&&!r.quarantined&&r.sessionId===targetSession&&r.op==='message.send'&&r.activityId===d.activityId&&!TERMINAL.includes(r.status)){r.status='ended';r.outcome=d.outcome;r.updatedAt=stamp();delete r.text;}});
        notify(d.activityId,'ended');cacheSnapshot();break;
      }
      case 'session.changed':scheduleResync();break;
      case 'resync.required':scheduleResync();break;
    }
  }
  function onTransport(event){
    if(!live()||!object(event))return;
    if(event.type==='configuration.changed'){
      const wasSelected=selected;
      cutConnection();++formEpoch;background(stopStream());configured=Boolean(event.configured);endpoint=event.endpoint??'';phase=configured?'disconnected':'unconfigured';
      info=null;selected='';sessionMeta=null;messages=[];activity=null;tools=[];
      notice='连接配置已变化，请连接并重新选择授权会话。';
      saveBackground(next=>{next.lastSelected='';next.endpoint='';next.cache=[];for(const r of next.outbox)if(!TERMINAL.includes(r.status)){r.quarantined=true;r.status='unknown';}});
      if(wasSelected)notice+='旧的未决记录已隔离，不会自动提交。';
      publish();return;
    }
    if(event.type==='response'||event.type==='request.error'){
      const p=pending.get(event.requestId);if(!p)return;
      pending.delete(event.requestId);clear(p.timer);
      if(!isCurrent(p.epoch)){p.reject(problem('STALE'));return;}
      if(event.type==='request.error')p.reject(problem(event.code??'NETWORK_ERROR'));
      else p.resolve(event);
      return;
    }
    if(event.type==='stream.end'||event.type==='stream.error'){const done=draining.get(event.streamId);if(done){done();return;}}
    if(!stream||stream.id!==event.streamId||!isCurrent(stream.epoch))return;
    if(event.type==='stream.open'){phase='ready';const n=epoch;clear(stableTimer);stableTimer=schedule(()=>{stableTimer=null;if(isCurrent(n)&&phase==='ready')retryCount=0;},30000);publish();return;}
    if(event.type==='stream.end'||event.type==='stream.error'){
      const n=epoch;stream=null;connectionFailed(problem(event.code??'NETWORK_ERROR'),n);return;
    }
    if(event.type!=='stream.event'||event.event!=='bridge')return;
    try{
      const env=validateEvent(JSON.parse(event.data),event.lastEventId);
      if(env.instanceId!==info.instanceId){lastCode='INSTANCE_CHANGED';scheduleResync();return;}
      if(env.sessionId!==selected)return;
      ensure(bytes(event.data)<=Math.min(65536,info.limits.eventBytes),'INVALID_EVENT');
      if(seenCursors.has(env.cursor))return;
      applyEvent(env);watermark=env.cursor;seenCursors.add(env.cursor);if(seenCursors.size>256)seenCursors.delete(seenCursors.values().next().value);
      publish(!['assistant.delta'].includes(env.type));
    }catch{lastCode='INVALID_EVENT';scheduleResync();}
  }


  function getSnapshot(){
    const ready=phase==='ready',bound=Boolean(selected);
    const online=['ready','syncing','subscribing'].includes(phase);
    const busy=activity&&ACTIVE.includes(activity.status);
    const title=sessionMeta?.title||selected||'未选择会话';
    const statusText=({unconfigured:'尚未配置连接',disconnected:'已断开',handshaking:'正在连接 DSH',selecting:'请选择授权会话',syncing:'正在同步会话',subscribing:'正在建立实时连接',ready:'实时连接就绪',reconnecting:'连接中断，正在重连','auth-required':'需要重新授权',incompatible:'协议不兼容'}[phase]??phase);
    const chatBlocks=[txt(statusText,'muted')];
    if(bound)chatBlocks.push({type:'group',layout:'column',appearance:'session-heading',children:[{...txt(cut(title,300)),strong:true},txt('工作区 · '+cut(sessionMeta?.workspace??'未提供',300),'muted')]});
    if(lastCode)chatBlocks.push(txt(errorText(lastCode)+' ['+cut(lastCode,80)+']','error'));
    if(notice)chatBlocks.push(txt(notice,'muted'));
    if(!online&&messages.length)chatBlocks.push(txt('以下是上次显示的内容，当前尚未同步。','muted'));
    const history=messages.slice(-20).map(m=>({id:m.messageId,role:m.role,content:cut(m.text,16000),state:'complete'}));
    if(preview)history.push({id:'preview.local',role:'assistant',content:cut((preview.partial?'（仅展示同步后的增量）\n':'')+preview.text,16000)||'正在等待输出…',state:'streaming'});
    if(history.length)chatBlocks.push({type:'chat',messages:history});
    else chatBlocks.push({type:'status',icon:'chat',title:bound?'可以向当前 DSH 会话发送任务':'连接已有 DSH 会话',description:bound?'消息交由 DSH 执行，使用它现有的工作目录、工具与审批。':'先通过宿主窗口保存连接，再明确选择一个授权会话。'});
    if(truncated)chatBlocks.push(txt('这里只显示近期或截断后的内容，完整记录请在 DSH 中查看。','muted'));
    if(activity?.status==='waiting-approval')chatBlocks.push(txt('请在 DSH 界面处理审批；当前桥接服务没有桌宠审批回答通道。'));
    if(bound&&allowedSteer())chatBlocks.push(row(btn('setMode','普通任务',{...bind(),mode:'followup'},ready,'chat'),btn('setMode','追加指令',{...bind(),mode:'steer'},ready,'plus')),txt(mode==='steer'?'追加指令模式：在 DSH 后续步骤边界处理，不会立即中断。':'普通任务模式：执行中不排队提交。','muted'));
    const sessionRecords=db.outbox.filter(r=>r.sessionId===selected);
    const records=[...sessionRecords.filter(r=>!TERMINAL.includes(r.status)).reverse(),...sessionRecords.filter(r=>TERMINAL.includes(r.status)).reverse()].slice(0,8);
    for(const r of records){
      chatBlocks.push(txt('发送记录 · '+(labels[r.outcome??r.status]??r.status)+(r.quarantined?' · 旧授权已隔离':'')+(r.errorCode?' · '+errorText(r.errorCode):'')+(r.text?'\n'+cut(r.text,2000):''),'muted'));
      if(!TERMINAL.includes(r.status))chatBlocks.push(btn('lookupRequest','查询发送结果',{wireRequestId:r.id},ready&&trustedRecord(r),'undo'));
    }
    if(confirmation?.kind==='switch')chatBlocks.push(txt('切换会话后，未发送的输入可能丢失，当前 DSH 任务会继续。'),row(btn('confirmSession','确认切换',{sessionId:confirmation.sessionId,bindingEpoch},!selectionBusy),btn('dismissConfirmation','返回',{},true,'close')));
    if(confirmation?.kind==='cancel')chatBlocks.push(txt('停止活动 '+confirmation.activityId+'？已完成的代码或文件修改不会撤销。'),row(btn('confirmCancel','确认停止',{...bind(),activityId:confirmation.activityId},ready,'pause'),btn('dismissConfirmation','返回',{},true,'close')));
    const footer=[];
    const latestTool=tools.at(-1);
    const recentTask=db.outbox.filter(r=>r.sessionId===selected&&r.op==='message.send'&&r.status==='ended').at(-1);
    const taskLine=(activity?'任务 · '+(labels[activity.status]??activity.status):recentTask?'最近任务 · '+(labels[recentTask.outcome]??'已结束'):'任务 · 等待新指令')+(latestTool?'　｜　'+(latestTool.name??'工具')+' · '+latestTool.summary:'');
    footer.push({type:'group',layout:'row',appearance:'task-strip',children:[txt(taskLine,'muted')]});
    if(bound){
      const pendingSend=localLocks.has('send')||unresolved();
      const canSend=canWrite()&&!pendingSend&&(mode==='steer'?allowedSteer():!busy);
      const stop=ready&&busy&&info.capabilities.includes('session.cancel');
      footer.push({type:'form',variant:'composer',id:'dsh-compose-'+formEpoch,commandId:'send',payload:bind(),submitLabel:mode==='steer'?'追加':'发送',
        enabled:ready,pending:!canSend,...(stop&&mode==='followup'?{stopAction:btn('requestCancel','停止当前活动',cancelPayload(),true,'pause')}:{}),
        fields:[{key:'text',type:'text',label:'发送给当前 DSH 会话',required:true,maxLength:Math.min(4000,info?.limits.messageChars??4000),value:''}]});
      if(stop&&mode==='steer')footer.push(btn('requestCancel','停止当前活动',cancelPayload(),true,'pause'));
    }
    const sessionBlocks=[{...txt('选择一个项目会话'),strong:true},txt('沿用 DSH 的工作目录、模型与工具。','muted')];
    if(!info)sessionBlocks.push(txt('请先在角色管理器 → 扩展 → DSH 会话伙伴中保存连接。','muted'),btn('connect','连接 DSH',{},Boolean(configured)));
    for(const s of sessions.slice(pageOffset,pageOffset+20))sessionBlocks.push({type:'group',layout:'row',appearance:'session-card',children:[{type:'group',layout:'column',appearance:'session-heading',children:[{...txt(cut(s.title||s.sessionId,300)),strong:true},txt(cut(s.workspace??'工作区未提供',300),'muted'),txt(s.available?(s.status==='running'?'正在执行':'可连接'):'无活跃 Agent','muted')]},btn('selectSession',s.available?(s.sessionId===selected?'当前会话':'进入会话'):'不可用',{sessionId:s.sessionId,bindingEpoch},Boolean(s.available&&info&&!selectionBusy&&['ready','selecting'].includes(phase)),'chat')]});
    if(!sessions.length)sessionBlocks.push(txt('没有可展示的授权会话。请在 DSH 中打开会话，并检查连接令牌的会话授权。'));
    sessionBlocks.push(row(btn('loadSessions','刷新列表',{},Boolean(info&&['ready','selecting'].includes(phase)),'undo'),btn('previousSessions','上一页',{},Boolean(pageOffset>0||previousPages.length),'previous'),btn('nextSessions','下一页',{},Boolean(pageOffset+20<sessions.length||nextCursor),'next')));
    if(confirmation?.kind==='switch')sessionBlocks.push(txt('确认离开当前会话？未发送草稿可能丢失，远端任务会继续。'),row(btn('confirmSession','确认切换',{sessionId:confirmation.sessionId,bindingEpoch},!selectionBusy),btn('dismissConfirmation','返回',{},true,'close')));
    const connectionBlocks=[
      txt(configured?'服务地址：'+endpoint:'尚未配置 DSH 服务地址与连接令牌。'),
      btn('configure','配置 / 移除连接',{},Boolean(local),'edit'),
      row(btn('connect','连接',{},Boolean(local&&configured&&!storageFault)),btn('disconnect','断开',{},Boolean(info),'pause')),
      txt('根地址须包含 /pet-bridge/v1/；连接令牌由 DSH 签发，只在宿主可信窗口中填写。'),
      txt('断开只关闭桌宠网络，已经提交的 DSH 任务可能继续。','muted'),
      ...(info?[txt('协议 '+PROTOCOL+' · 桥 '+info.serverVersion+' · DSH '+info.dshVersion+'\n实例 '+info.instanceId,'muted'),txt('能力：'+info.capabilities.join('、'),'muted')]:[]),
      ...(lastCode?[txt(errorText(lastCode)+' ['+lastCode+']','error')]:[]),
      txt('当前不提供桌宠内审批、人格同步、日程创建或跨插件工具。'),
      txt('历史缓存、本机资料和未决发送记录是本机明文数据。清理缓存不会删除 DSH 历史、令牌或未决发送凭证。','muted'),
      btn('requestClearCache','清理本机显示缓存',{},!storageFault,'trash'),
      ...db.outbox.filter(r=>r.quarantined&&!TERMINAL.includes(r.status)).slice(-4).map(r=>txt('旧授权未决记录 '+r.id+'：已隔离，请在原 DSH 会话核对。','muted'))
    ];
    if(confirmation?.kind==='clear')connectionBlocks.push(txt('清理本机显示缓存与已结束记录？未决记录和本机资料会保留。'),row(btn('confirmClearCache','确认清理',{},true,'trash'),btn('dismissConfirmation','返回',{},true,'close')));
    const personaBlocks=[
      txt('仅本机保存。当前 DSH 桥未实现 persona.update，这份资料不会被发送，也不会影响 DSH 回答。','muted'),
      {type:'form',id:'dsh-persona-'+db.persona.revision,commandId:'savePersona',payload:{},submitLabel:'保存本机资料',enabled:!storageFault,fields:[
        {key:'persona',type:'textarea',label:'人设（最多 2000 字符）',maxLength:2000,value:db.persona.text},
        {key:'memory',type:'textarea',label:'手工记忆（最多 4000 字符）',maxLength:4000,value:db.persona.memory}
      ]},txt('一份手工资料，不会自动提取记忆或跟随角色切换；保存空白可清除。','muted')
    ];
    return {available:true,status:storageFault||phase==='incompatible'?'error':ready?'ready':['disconnected','reconnecting','auth-required'].includes(phase)?'degraded':'waiting',
      message:cut(storageFault?errorText(storageFault):statusText,4000),preferredPageId:!configured||phase==='selecting'?'sessions':'chat',
      pages:[{id:'chat',title:'DSH 对话',icon:'deepseek',blocks:chatBlocks,footer},
        {id:'sessions',title:'授权会话',icon:'note',blocks:sessionBlocks}],settingsPages:[{id:'connection',title:'连接与隐私',icon:'edit',blocks:connectionBlocks},
        {id:'persona',title:'本机资料',icon:'note',blocks:personaBlocks}]};
  }
  function checkBinding(payload){ensure(payload.bindingEpoch===bindingEpoch&&payload.sessionId===selected,'STALE');}
  async function submit(op,data){
    const key=op==='message.send'?'send':'cancel';
    ensure(!localLocks.has(key),'UNRESOLVED');localLocks.add(key);
    const n=epoch,sessionId=selected,instanceId=info.instanceId,endpointAtSend=endpoint;
    let id,recorded=false;
    try{
      ensure(canWrite(),'NOT_READY');
      ensure(db.outbox.filter(r=>!TERMINAL.includes(r.status)).length<8,'STORAGE_FULL');
      id=uuid();
      ensure(bytes({protocol:PROTOCOL,instanceId,requestId:id,op,sessionId,data})<=Math.min(65536,info.limits.requestBytes),'BODY_TOO_LARGE');
      const now=stamp();
      await persist(next=>next.outbox.push({id,op,sessionId,endpoint:endpointAtSend,status:'prepared',createdAt:now,updatedAt:now,
        ...(op==='message.send'?{text:data.text}:{activityId:data.activityId})}));
      recorded=true;
      ensure(isCurrent(n)&&selected===sessionId,'STALE');
      await patchRecord(id,{status:'submitting'});
      ensure(isCurrent(n),'STALE');
      const body={protocol:PROTOCOL,instanceId,requestId:id,op,sessionId,data};
      ensure(bytes(body)<=Math.min(65536,info.limits.requestBytes),'BODY_TOO_LARGE');
      const job=beginCall({method:'POST',path:'/commands',body},n);
      background((async()=>{
        try{
          const response=await job.result;
          const env=validateEnvelope(response.data,id);
          if(!response.ok||!env.ok)throw problem(env.error?.code??'INVALID_RESPONSE',response.status);
          ensure(env.instanceId===instanceId,'INSTANCE_CHANGED');
          const d=env.data;
          if(op==='message.send'){ensure(object(d)&&d.status==='accepted'&&identifier(d.messageId));await patchRecord(id,{status:'accepted',messageId:d.messageId,acceptedInstanceId:instanceId});}
          else {ensure(object(d)&&d.status==='cancelling'&&d.activityId===data.activityId);await patchRecord(id,{status:'accepted',activityId:d.activityId,acceptedInstanceId:instanceId});}
        }catch(error){
          const code=error.code??'NETWORK_ERROR';
          const definitelyRejected=error.status>=400&&!['RESULT_UNKNOWN','REQUEST_UNKNOWN','REQUEST_CONFLICT'].includes(code);
          await patchRecord(id,{status:definitelyRejected?'rejected':'unknown',errorCode:code});
          if(isCurrent(n)){lastCode=code;if(code==='UNSUPPORTED_CAPABILITY'){
              if(op==='message.send'&&data.mode==='followup'){phase='incompatible';cutConnection();await stopStream();}
              else info.capabilities=info.capabilities.filter(x=>x!==(op==='session.cancel'?'session.cancel':'message.steer'));
              mode='followup';
            }
            if(authFailure(code)){phase='auth-required';cutConnection();await stopStream();}}
        }finally{localLocks.delete(key);publish();}
      })());
      await job.accepted;publish();return {resetForm:op==='message.send'};
    }catch(error){
      if(id&&recorded)await patchRecord(id,{status:'unknown',errorCode:error.code??'NETWORK_ERROR'}).catch(()=>{storageFault='STORAGE_ERROR';});
      localLocks.delete(key);throw error;
    }
  }
  let commandQueue=Promise.resolve();
  async function executeInner(command,payload={}){
    ensure(live(),'STALE');lastCode='';notice='';
    if(command==='configure'||command==='configureManager'){ensure(local,'NOT_CONFIGURED');await local.configure();notice='宿主配置窗口已打开，保存连接后再点击连接。';publish();return {};}
    if(command==='connect'){background(connect());return {};}
    if(command==='disconnect'){
      cutConnection();phase='disconnected';preview=null;if(activity)activity={...activity,status:'unknown'};
      background(stopStream());notice='已断开桌宠连接。DSH 中的任务可能继续执行。';publish();return {};
    }
    if(command==='dismissConfirmation'){confirmation=null;publish();return {};}
    if(command==='loadSessions'||command==='nextSessions'||command==='previousSessions'){
      ensure(info&&['ready','selecting'].includes(phase),'NOT_READY');
      if(command==='nextSessions'&&pageOffset+20<sessions.length)pageOffset+=20;
      else if(command==='previousSessions'&&pageOffset>0)pageOffset-=20;
      else{
        let target='';
        if(command==='nextSessions'){ensure(nextCursor,'STALE');previousPages.push(pageCursor);target=nextCursor;}
        if(command==='previousSessions'){ensure(previousPages.length,'STALE');target=previousPages.pop();}
        if(command==='loadSessions')previousPages=[];
        const n=epoch;background(loadSessionPage(target,n).catch(error=>{if(isCurrent(n)){if(authFailure(error.code))connectionFailed(error,n);else {lastCode=error.code??'NETWORK_ERROR';publish();}}}));
      }
      publish();return {};
    }
    if(command==='selectSession'){
      ensure(payload.bindingEpoch===bindingEpoch&&sessions.some(s=>s.sessionId===payload.sessionId&&s.available)&&['ready','selecting'].includes(phase),'STALE');
      confirmation={kind:'switch',sessionId:payload.sessionId,epoch};publish();return {};
    }
    if(command==='confirmSession'){
      const card=confirmation;
      ensure(card?.kind==='switch'&&card.epoch===epoch&&card.sessionId===payload.sessionId&&payload.bindingEpoch===bindingEpoch&&!selectionBusy,'STALE');
      const target=sessions.find(s=>s.sessionId===payload.sessionId&&s.available);ensure(target,'STALE');
      const n=cutConnection();++formEpoch;selectionBusy=true;selected=target.sessionId;sessionMeta=target;messages=[];activity=null;tools=[];mode='followup';phase='syncing';publish();
      background((async()=>{
        try{await stopStream();ensure(isCurrent(n),'STALE');await persist(next=>{next.lastSelected=selected;next.endpoint=endpoint;});ensure(isCurrent(n),'STALE');await follow(n);}
        catch(error){connectionFailed(error,n);}
        finally{selectionBusy=false;publish();}
      })());return {navigateTo:'chat'};
    }
    if(command==='refresh'){checkBinding(payload);background(connect(true,true));return {};}
    if(command==='setMode'){checkBinding(payload);ensure(['followup','steer'].includes(payload.mode),'STALE');if(payload.mode==='steer')ensure(allowedSteer(),'STEER_DISABLED');mode=payload.mode;publish();return {};}
    if(command==='send'){
      checkBinding(payload);ensure(canWrite(),'NOT_READY');ensure(!unresolved(),'UNRESOLVED');
      ensure(string(payload.text,Math.min(4000,info.limits.messageChars)),'BODY_TOO_LARGE');ensure(payload.text.trim().length>0,'INPUT_EMPTY');
      if(mode==='steer')ensure(allowedSteer(),'STEER_DISABLED');else ensure(!activity||!ACTIVE.includes(activity.status),'SESSION_BUSY');
      return submit('message.send',{mode,text:payload.text});
    }
    if(command==='requestCancel'||command==='confirmCancel'){
      checkBinding(payload);ensure(phase==='ready'&&info.capabilities.includes('session.cancel')&&activity&&ACTIVE.includes(activity.status)&&activity.activityId===payload.activityId,'EXPIRED');
      if(command==='requestCancel'){confirmation={kind:'cancel',activityId:activity.activityId,epoch};publish();return {navigateTo:'chat'};}
      ensure(confirmation?.kind==='cancel'&&confirmation.activityId===payload.activityId&&confirmation.epoch===epoch,'STALE');confirmation=null;
      return submit('session.cancel',{activityId:payload.activityId});
    }
    if(command==='lookupRequest'){
      const r=findRecord(payload.wireRequestId);ensure(r&&trustedRecord(r)&&phase==='ready','STALE');
      const n=epoch;background(lookUp(r.id,n).catch(error=>{if(isCurrent(n)){lastCode=error.code??'NETWORK_ERROR';if(authFailure(lastCode))connectionFailed(error,n);publish();}}));return {};
    }
    if(command==='savePersona'){
      ensure(string(payload.persona,2000)&&string(payload.memory,4000),'BODY_TOO_LARGE');
      await persist(next=>{next.persona={text:payload.persona,memory:payload.memory,revision:next.persona.revision+1};});
      notice='本机资料已保存，未发送给 DSH。';publish();return {};
    }
    if(command==='requestClearCache'){confirmation={kind:'clear'};publish();return {};}
    if(command==='confirmClearCache'){
      ensure(confirmation?.kind==='clear','STALE');
      await persist(next=>{next.cache=[];next.outbox=next.outbox.filter(r=>!TERMINAL.includes(r.status));});
      confirmation=null;notice='已清理本机缓存；未决凭证、资料与 DSH 历史保留。';publish();return {};
    }
    throw problem('STALE');
  }
  function execute(command,payload){
    const operation=commandQueue.then(()=>executeInner(command,payload)).catch(error=>{
      if(live()){lastCode=error.code??'NETWORK_ERROR';if(['STORAGE_ERROR','STORAGE_VERSION'].includes(error.code))storageFault=error.code;publish();}
      return {};
    });
    commandQueue=operation.then(()=>{},()=>{});return operation;
  }
  function dispose(){
    if(closed)return;closed=true;++epoch;
    for(const [timer,done]of timers){clearTimeout(timer);done?.();}timers.clear();
    for(const [id,p]of pending){p.reject(problem('STALE'));try{Promise.resolve(local?.cancel({requestId:id})).catch(()=>{});}catch{}}pending.clear();
    if(stream){try{Promise.resolve(local?.cancel({streamId:stream.id})).catch(()=>{});}catch{}stream=null;}
    for(const done of draining.values())done();draining.clear();release();preview=null;localLocks.clear();
  }
  context.onCleanup(dispose);
  try{
    const saved=await context.storage.get('state');
    if(saved!==null)db=validateState(saved);
    if(!local){phase='unconfigured';lastCode='NOT_CONFIGURED';}
    else{
      release=await local.subscribe(onTransport);
      const status=await local.status();configured=Boolean(status.configured);endpoint=status.endpoint??'';phase=configured?'disconnected':'unconfigured';lastCode=status.error??'';
      if(configured&&cfg().autoConnect)background(connect());
    }
  }catch(error){storageFault=error.code??'STORAGE_ERROR';lastCode=storageFault;phase='disconnected';}
  return {getSnapshot,execute,onSettingsChanged(){
    if(!allowedSteer())mode='followup';
    if(!cfg().cacheHistory&&!storageFault)saveBackground(next=>{next.cache=[];});
    publish();
  },dispose};
}
