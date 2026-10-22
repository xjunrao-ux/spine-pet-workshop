import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {validateManifest,validatePayload,validateSnapshot} from '../electron/plugins/contracts.mjs';
import {localRequestURL} from '../electron/plugins/local-service.mjs';
import {createZip,readZip} from '../electron/plugins/zip.mjs';

// Design data only. This generator neither starts DSH nor sends network requests.
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=path.join(root,'docs/fixtures/pet-dsh-v1');
await mkdir(dir,{recursive:true});
const json=value=>JSON.stringify(value,null,2)+'\n';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const writeJson=async(name,value)=>writeFile(path.join(dir,name),json(value),'utf8');
const field=(type,extras={})=>({type,...extras});
const sessionFields={sessionId:field('string',{maxLength:100}),bindingEpoch:field('number',{min:1,max:Number.MAX_SAFE_INTEGER})};
const activityFields={...sessionFields,activityId:field('string',{maxLength:100})};
const commands=[
  {id:'configure',permissions:['net.local'],fields:{}},
  {id:'configureManager',label:'配置 DSH 连接',managerOnly:true,permissions:['net.local'],fields:{}},
  {id:'connect',permissions:['net.local'],fields:{}},
  {id:'disconnect',permissions:['net.local'],fields:{}},
  {id:'refresh',permissions:['net.local'],fields:sessionFields},
  {id:'loadSessions',permissions:['net.local'],fields:{cursor:field('string',{maxLength:500,optional:true})}},
  {id:'selectSession',fields:sessionFields},
  {id:'confirmSession',permissions:['net.local'],fields:sessionFields},
  {id:'setMode',fields:{...sessionFields,mode:field('string',{enum:['followup','steer']})}},
  {id:'send',permissions:['net.local','storage.own'],fields:{...sessionFields,text:field('string',{maxLength:4000})}},
  {id:'requestCancel',fields:activityFields},
  {id:'confirmCancel',permissions:['net.local','storage.own'],fields:activityFields},
  {id:'lookupRequest',permissions:['net.local'],fields:{wireRequestId:field('string',{maxLength:100})}},
  {id:'savePersona',permissions:['storage.own'],fields:{persona:field('string',{maxLength:2000,allowEmpty:true}),memory:field('string',{maxLength:4000,allowEmpty:true})}},
  {id:'requestClearCache',fields:{}},
  {id:'confirmClearCache',permissions:['storage.own'],fields:{}},
  {id:'dismissConfirmation',fields:{}}
];
const manifest={
  packageType:'spine-pet-plugin',packageVersion:1,id:'io.spine-workshop.dsh-pet',
  name:'DSH 会话伙伴',menuLabel:'DSH 任务',version:'1.0.0',apiVersion:1,configVersion:1,entry:'provider.js',
  icon:'chat',entryVisibility:'when-enabled',
  description:'设计清单：连接已授权且运行中的 DSH 会话，进行对话、查看任务和请求停止；本文件不附带 provider，不能安装。',
  permissions:['net.local','storage.own','ui.reminders'],
  compatibilityNotes:[
    '需桌宠工坊 v4.2.2 的 net.local；业务协议 pet-dsh/1，修订 1.0.0。',
    '连接令牌仅在宿主可信窗口录入，与模型 API Key 不同。',
    '首版不创建或恢复 Agent；当前服务不支持桌宠审批、人格同步和反向日程工具。',
    '本机资料和发送记录为本地明文数据；缓存可关闭，未决凭证查清前保留。',
    '提醒功能默认关闭；当前导入器整体授权清单权限，不支持单项可选权限。'
  ],
  settingsSchema:[
    {key:'autoConnect',type:'boolean',label:'启动插件时连接',default:false},
    {key:'enableSteer',type:'boolean',label:'允许追加指令（需服务能力）',default:false},
    {key:'cacheHistory',type:'boolean',label:'保存少量本机历史缓存',default:true},
    {key:'notify',type:'boolean',label:'任务结束与待审批时提醒',default:false}
  ],commands
};
validateManifest(manifest);
await writeJson('manifest.design.json',manifest);
const bind={sessionId:'session-A',bindingEpoch:3};
const act={...bind,activityId:'activity-A'};
const txt=(text,tone='normal')=>({type:'text',text,tone,multiline:true});
const button=(commandId,label,payload={},enabled=true,icon='play')=>({type:'button',commandId,label,payload,enabled,icon,variant:'text'});
const group=(...children)=>({type:'group',layout:'row',children});
const composer=(enabled,pending=false,stop=false)=>({
  type:'form',variant:'composer',id:'dsh-compose-3',commandId:'send',submitLabel:'发送',
  payload:bind,enabled,pending,
  ...(stop?{stopAction:button('requestCancel','停止当前活动',act,true,'pause')}:{}),
  fields:[{key:'text',type:'text',label:'发送给当前 DSH 会话',required:true,maxLength:4000,value:''}]
});
const committed=[
  {id:'user-01',role:'user',content:'分析仓库测试失败的原因',state:'complete'},
  {id:'assistant-01',role:'assistant',content:'测试入口已经确认，下一步检查失败用例。',state:'complete'}
];
function snapshot(kind){
  const unconfigured=kind==='unconfigured',selecting=kind==='selecting',incompatible=kind==='incompatible';
  const offline=kind==='offline-unknown',running=kind==='running',waiting=kind==='waiting-approval';
  const steer=kind==='steer-running',confirm=kind==='confirm-cancel';
  const active=running||waiting||steer||confirm;
  const bound=!unconfigured&&!selecting&&!incompatible;
  const live=bound&&!offline;
  const writable=live&&!active;
  const labels={
    unconfigured:'尚未配置 DSH 连接',selecting:'已连接，请选择授权会话',ready:'已连接 · 会话已同步',
    running:'DSH 正在执行', 'waiting-approval':'DSH 等待审批',
    'offline-unknown':'连接已断开，远端任务状态未知',incompatible:'服务缺少必需能力 requests.lookup',
    'steer-running':'追加指令模式 · DSH 正在执行','confirm-cancel':'确认停止 activity-A'
  };
  const history=bound?[...committed]:[];
  if(active)history.push({id:'preview-1',role:'assistant',content:'正在检查测试配置…',state:'streaming'});
  const chatBlocks=[
    txt(labels[kind],offline||incompatible?'error':'muted'),
    ...(bound?[txt('会话：仓库检查 · 工作区：spine-pet-workshop','muted')]:[]),
    ...(history.length?[{type:'chat',messages:history}]:[{type:'status',icon:'chat',title:'连接已有 DSH 会话',description:'先配置连接，再明确选择一个授权会话。'}]),
    ...(waiting?[txt('请在 DSH 界面处理审批；当前服务未开放桌宠审批按钮。')]:[]),
    ...(offline?[txt('上次收到的活动状态为 running，仅供参考。断开连接不会停止 DSH。'),button('lookupRequest','查询发送结果',{wireRequestId:'pet.send-01'},false)]:[]),
    ...(steer?[txt('新增内容将在后续步骤边界处理。'),button('requestCancel','停止当前活动',act,true,'pause')]:[]),
    ...(confirm?[txt('停止 activity-A？仅取消这个活动，DSH 进程会继续运行。'),group(button('confirmCancel','确认停止',act,true,'pause'),button('dismissConfirmation','返回',{},true,'close'))]:[])
  ];
  const chatFooter=bound?[composer(writable||steer,active&&!steer,active&&!steer)]:[];
  const taskBlocks=[
    txt(offline?'状态未知，请重新连接。':active?(waiting?'等待 DSH 审批':'活动 activity-A 正在执行'):'暂无正在执行的活动'),
    ...(active?[{type:'progress',value:null},{type:'list',items:[{label:'检查项目配置',status:'进行中'}]}]:[]),
    ...(live&&active?[button('requestCancel','停止当前活动',act,true,'pause')]:[]),
    ...(bound?[button('refresh','重新同步',bind,live,'undo')]:[])
  ];
  const sessionsBlocks=[
    txt('仅展示此次连接获得授权的会话；选择后才会绑定。','muted'),
    group(txt('仓库检查 · spine-pet-workshop · 可用'),button('selectSession','选择',{sessionId:'session-A',bindingEpoch:3},!unconfigured&&!incompatible)),
    group(txt('历史会话 · unavailable'),button('selectSession','只读查看',{sessionId:'session-old',bindingEpoch:3},!unconfigured&&!incompatible)),
    button('loadSessions','刷新会话',{},!unconfigured&&!incompatible,'undo')
  ];
  const connectionBlocks=[
    txt(unconfigured?'尚未配置':'服务地址：http://127.0.0.1:3080/pet-bridge/v1/'),
    button('configure','配置连接',{},true,'edit'),
    group(button('connect','连接',{},!unconfigured),button('disconnect','断开',{},live,'pause')),
    txt('断开只关闭桌宠网络，DSH 中的任务可能继续。'),
    ...(unconfigured?[]:[txt('协议 pet-dsh/1 · 桥 1.0.0 · Harness 0.1.1-rc.2','muted')]),
    txt('人格同步、桌宠审批和日程工具：当前服务未支持。','muted'),
    button('requestClearCache','清理本机显示缓存',{},true,'trash')
  ];
  const personaBlocks=[
    txt('仅本机保存；当前资料不会发送给 DSH，也不会改变 DSH 回答。','muted'),
    {type:'form',id:'dsh-persona-1',commandId:'savePersona',submitLabel:'保存本机资料',payload:{},enabled:true,fields:[
      {key:'persona',type:'textarea',label:'人设',maxLength:2000,value:'说话简洁，喜欢解释代码。'},
      {key:'memory',type:'textarea',label:'手工记忆',maxLength:4000,value:'偏好中文交流。'}
    ]}
  ];
  return {available:true,status:incompatible?'error':offline?'degraded':unconfigured||selecting?'waiting':'ready',
    message:labels[kind],preferredPageId:unconfigured||incompatible?'connection':selecting?'sessions':'chat',
    pages:[
      {id:'chat',title:'DSH 对话',icon:'chat',blocks:chatBlocks,footer:chatFooter},
      {id:'task',title:'当前任务',icon:'checklist',blocks:taskBlocks},
      {id:'sessions',title:'授权会话',icon:'note',blocks:sessionsBlocks},
      {id:'connection',title:'连接与隐私',icon:'edit',blocks:connectionBlocks},
      {id:'persona',title:'本机资料',icon:'note',blocks:personaBlocks}
    ]};
}
const kinds=['unconfigured','selecting','ready','running','waiting-approval','offline-unknown','incompatible','steer-running','confirm-cancel'];
const snapshots={format:'pet-dsh-ui-design/1',notRuntime:true,states:kinds.map(id=>({id,snapshot:snapshot(id)}))};
await writeJson('ui-snapshots.json',snapshots);
let payloadExamples=0;
const commandMap=new Map(commands.map(command=>[command.id,command]));
function checkCommand(id,payload){
  const command=commandMap.get(id);assert.ok(command,'Undeclared command '+id);
  validatePayload(command,payload);payloadExamples++;
}
function walk(block){
  if(block.type==='button')checkCommand(block.commandId,block.payload??{});
  if(block.type==='form'){
    const payload={...(block.payload??{})};
    for(const f of block.fields)payload[f.key]=f.value||(f.required?'示例输入':'');
    checkCommand(block.commandId,payload);
    if(block.stopAction)walk(block.stopAction);
  }
  for(const b of block.children??[])walk(b);
  for(const b of block.contextActions??[])walk(b);
}
for(const state of snapshots.states){
  validateSnapshot(state.snapshot);
  for(const page of state.snapshot.pages)for(const block of [...page.blocks,...page.footer??[]])walk(block);
}
const explicitPayloads={
  configure:{},configureManager:{},connect:{},disconnect:{},refresh:bind,loadSessions:{cursor:'page.2'},
  selectSession:bind,confirmSession:bind,setMode:{...bind,mode:'steer'},send:{...bind,text:'检查仓库'},
  requestCancel:act,confirmCancel:act,lookupRequest:{wireRequestId:'pet.send-01'},
  savePersona:{persona:'',memory:''},requestClearCache:{},confirmClearCache:{},dismissConfirmation:{}
};
for(const [id,payload]of Object.entries(explicitPayloads))checkCommand(id,payload);

const protocol='pet-dsh/1',instanceId='bridge-A',sessionId='session-A';
const baseCaps=['sessions.list','session.snapshot','message.send','events.follow','requests.lookup'];
const info={protocols:[protocol],instanceId,serverVersion:'1.0.0',dshVersion:'0.1.1-rc.2',capabilities:[...baseCaps,'session.cancel'],
  limits:{requestBytes:65536,responseBytes:262144,eventBytes:65536,messageChars:4000,eventsPerSecond:30,heartbeatMs:15000,journalRetentionHours:24,sessionPageSize:20,snapshotMessageLimit:20}};
const sessions={instanceId,items:[
  {sessionId,title:'仓库检查',workspace:'spine-pet-workshop',status:'idle',available:true},
  {sessionId:'session-old',title:'历史会话',workspace:'old-project',status:'unavailable',available:false}
],nextCursor:null};
const snap={instanceId,sessionId,cursor:'bridge-A.100',messages:[{messageId:'user-01',role:'user',text:'之前的讨论',turn:1}],activity:null,pendingInteractions:[],pendingPetCalls:[],truncated:false};
const command={protocol,instanceId,requestId:'pet.send-01',op:'message.send',sessionId,data:{mode:'followup',text:'分析仓库测试失败的原因'}};
const cancel={...command,requestId:'pet.cancel-01',op:'session.cancel',data:{activityId:'activity-A'}};
const receipt=(status,extra={})=>({protocol,instanceId,requestId:command.requestId,ok:true,data:{status,op:'message.send',sessionId,messageId:'user-02',acceptedInstanceId:instanceId,receivedAt:'2026-10-21T08:00:00.000Z',updatedAt:'2026-10-21T08:00:01.000Z',...extra}});
const accepted={protocol,instanceId,requestId:command.requestId,ok:true,data:{status:'accepted',messageId:'user-02'}};
const ended=receipt('ended',{activityId:'activity-A',outcome:'completed',endedAt:'2026-10-21T08:00:02.000Z'});
const error=(code,message,retryable=false)=>({protocol,ok:false,error:{code,message,retryable}});
const event=(cursor,type,data,extra={})=>({protocol,instanceId,sessionId,cursor,type,data,...extra});
const claimed=event('bridge-A.101','message.claimed',{requestId:command.requestId,messageId:'user-02',activityId:'activity-A',turn:2});
const d0=event('bridge-A.105','assistant.delta',{activityId:'activity-A',attemptId:'attempt-A',index:0,text:'已经找到'});
const d1=event('bridge-A.110','assistant.delta',{activityId:'activity-A',attemptId:'attempt-A',index:1,text:'测试入口。'});
const message=event('bridge-A.111','assistant.message',{messageId:'assistant-02',turn:2,text:'已经找到测试入口。',attemptId:'attempt-A'});
const finish=event('bridge-A.112','activity.ended',{activityId:'activity-A',outcome:'completed'});
const waiting=event('bridge-A.114','activity.state',{activityId:'activity-A',status:'waiting-approval'});
const toolStart=event('bridge-A.106','tool.started',{activityId:'activity-A',callId:'call-A',name:'read_file',summary:'读取项目文件'});
const toolFinish=event('bridge-A.109','tool.finished',{activityId:'activity-A',callId:'call-A',summary:'工具返回结果',status:'completed'});
const call=(kind,args)=>({direction:'pet-to-host',kind,args});
const response=(requestId,status,data)=>({direction:'host-to-pet',event:{type:'response',requestId,status,ok:status>=200&&status<300,data}});
const sse=(data,overrides={})=>({direction:'host-to-pet',event:{type:'stream.event',streamId:'sse.1',event:'bridge',data:JSON.stringify(data),lastEventId:data.cursor,...overrides}});
const hostEvent=event=>({direction:'host-to-pet',event});
const note=text=>({direction:'local',note:text});
const send=call('request',{requestId:'http.send-1',method:'POST',path:'/commands',body:command});
const open=call('stream',{streamId:'sse.1',path:'/events',query:{sessionId},lastEventId:snap.cursor});
const requestLookup=call('request',{requestId:'http.lookup-1',method:'GET',path:'/requests',query:{requestId:command.requestId}});
const scenarios=[
  {id:'normal',covers:['C05','C10','C12'],steps:[
    call('request',{requestId:'http.info-1',method:'GET',path:'/info'}),response('http.info-1',200,info),
    call('request',{requestId:'http.sessions-1',method:'GET',path:'/sessions'}),response('http.sessions-1',200,sessions),
    note('用户明确选择 session-A，递增绑定版本'),
    call('request',{requestId:'http.snapshot-1',method:'GET',path:'/snapshot',query:{sessionId}}),response('http.snapshot-1',200,snap),
    open,hostEvent({type:'stream.open',streamId:'sse.1'}),note('先持久化发送意图'),send,
    response('http.send-1',202,accepted),sse(claimed),sse(d0),sse(toolStart),sse(toolFinish),sse(d1),sse(message),sse(finish)
  ],expected:['stream.open 前不可写','cursor 数字间隔合法','authoritative assistant-02 只有一条','结束状态 completed']},
  {id:'late-http',covers:['C07'],precondition:'ready，意图已持久化',steps:[send,sse(claimed),sse(message),sse(finish),response('http.send-1',202,accepted)],
    expected:['先到的 ended 保持，迟到 accepted 不得回退','单次发送锁与业务完成状态分开']},
  {id:'timeout-after-send',covers:['C06','C08'],precondition:'ready，意图已持久化',steps:[
    send,hostEvent({type:'request.error',requestId:'http.send-1',code:'TIMEOUT'}),requestLookup,response('http.lookup-1',200,ended)
  ],expected:['超时进入 unknown，只查回执','没有第二个 POST','查清后 completed']},
  {id:'unknown-receipt',covers:['C09'],steps:[requestLookup,response('http.lookup-1',404,error('REQUEST_UNKNOWN','没有台账记录或已超出保留期'))],
    expected:['保留原文和 unknown','不得据此认定未执行','不创建新 requestId']},
  {id:'result-unknown',covers:['C09'],steps:[requestLookup,response('http.lookup-1',200,receipt('unknown',{error:{code:'RESULT_UNKNOWN',message:'无法证明执行结果',retryable:false}}))],
    expected:['日志 unknown，禁止自动重发']},
  {id:'delta-replay-and-gap',covers:['C11','C12'],steps:[sse(d0),sse(d0),sse(event('bridge-A.115','assistant.delta',{activityId:'activity-A',attemptId:'attempt-A',index:3,text:'缺口后的内容'}))],
    expected:['重复 cursor 不追加两次','同 attempt 的 index 缺口触发快照恢复，不能从 cursor 数值猜缺口']},
  {id:'sse-id-mismatch',covers:['C12'],negative:true,steps:[sse(d0,{lastEventId:'bridge-A.other'})],
    expected:['SSE id 与 JSON cursor 不同，停止应用并有界重同步']},
  {id:'session-change-resync',covers:['C13','C27'],steps:[sse(event('bridge-A.120','session.changed',{status:'input'})),note('150ms 合并，取消并等待当前流终态，再 snapshot 后新订阅')],
    expected:['原生前端输入通过快照同步','不将会话活动认作本机请求成功','不覆盖新投影后继续旧流']},
  {id:'switch-and-late-event',covers:['C14','C28'],steps:[note('选择 session-B，selectionEpoch 递增，旧流被取消'),sse(finish)],
    expected:['旧 sse.1 回调仅清理资源，不更新 session-B，也不发提醒']},
  {id:'network-disconnect',covers:['C15','C23'],steps:[call('cancel',{streamId:'sse.1'}),hostEvent({type:'stream.error',streamId:'sse.1',code:'CANCELLED'})],
    expected:['只停止网络，无 session.cancel POST','远端活动标 unknown','退订不代替取消传输']},
  {id:'cancel-confirmed',covers:['C15','C16'],precondition:'当前活动仍为 activity-A，确认卡绑定版本匹配',steps:[
    call('request',{requestId:'http.cancel-1',method:'POST',path:'/commands',body:cancel}),
    response('http.cancel-1',200,{protocol,instanceId,requestId:cancel.requestId,ok:true,data:{status:'cancelling',activityId:'activity-A'}}),
    sse(event('bridge-A.116','activity.ended',{activityId:'activity-A',outcome:'cancelled'}))
  ],expected:['受理仅表示取消请求','ended/cancelled 才确认停止','如果活动已换为 B，旧确认不得发 POST']},
  {id:'new-instance-old-receipt',covers:['C17'],steps:[
    response('http.info-2',200,{...info,instanceId:'bridge-B'}),
    response('http.lookup-2',200,{...ended,instanceId:'bridge-B'})
  ],expected:['新实例重建快照和订阅','回执 acceptedInstanceId 仍是 bridge-A','不把旧回执当作新活动']},
  {id:'approval-not-supported',covers:['C18'],steps:[sse(waiting)],
    expected:['显示等待审批和去 DSH 界面处理','无允许或拒绝按钮','不发 interaction.answer']},
  {id:'capabilities-and-501',covers:['C03','C19','C26'],steps:[
    response('http.info-3',200,{...info,capabilities:baseCaps}),
    response('http.optional-1',501,error('UNSUPPORTED_CAPABILITY','当前能力未实现'))
  ],expected:['不启用 cancel/steer/人格同步/反向工具','本机人设仍可保存，明确未同步','501 不转为 message.send']},
  {id:'auth-and-backoff',covers:['C22'],steps:[
    response('http.info-4',401,error('UNAUTHORIZED','连接令牌无效')),
    hostEvent({type:'stream.error',streamId:'sse.1',code:'HTTP_401'})
  ],expected:['停止自动重连，需要重新授权','429 只对读操作退避；变更不重投']},
  {id:'storage-failed',covers:['C20'],steps:[note('写前日志 storage.set 拒绝')],
    expected:['不发任何 POST','输入保留，不 resetForm','不静默清除旧 unknown 记录']}
];
const fixture={format:'pet-dsh-wire-design/1',notExecutedClientTests:true,protocol,revision:'1.0.0',
  notes:['所有凭据和会话身份均为虚构示例','正常 DTO 来自当前服务实现形态','negative:true 仅表示客户端必须拒绝该语义，不代表 Schema 包络必然不合法','expected 为待实现客户端的验收断言，生成器不模拟领域状态机'],
  scenarios};
await writeJson('wire-scenarios.json',fixture);

const ajvFolder=(await readdir(path.join(root,'node_modules/.pnpm'))).find(name=>/^ajv@8\./.test(name));
assert.ok(ajvFolder,'Existing Ajv 8 package required; do not install dependencies for design checks');
const {default:Ajv}=await import(pathToFileURL(path.join(root,'node_modules/.pnpm',ajvFolder,'node_modules/ajv/dist/2020.js')).href);
const ajv=new Ajv({allErrors:true});
ajv.addFormat('date-time',value=>typeof value==='string'&&Number.isFinite(Date.parse(value)));
const schemaBytes=await readFile(path.join(root,'docs/schemas/dsh-bridge-v1.schema.json'));
const validateWire=ajv.compile(JSON.parse(schemaBytes));
let coreWireExamples=0,dtoExamples=0,transportCalls=0,semanticNegativeCases=0;
const ident=value=>typeof value==='string'&&/^[A-Za-z0-9._-]{1,100}$/.test(value);
function validateDto(dto){
  assert.ok(ident(dto.instanceId));
  if(Array.isArray(dto.items)){
    for(const item of dto.items){assert.ok(ident(item.sessionId));assert.equal(typeof item.title,'string');assert.equal(typeof item.workspace,'string');assert.equal(typeof item.available,'boolean');assert.ok(['idle','running','unavailable'].includes(item.status));}
    assert.ok(dto.nextCursor===null||typeof dto.nextCursor==='string');
  }else if(Array.isArray(dto.messages)){
    assert.ok(ident(dto.sessionId));assert.equal(typeof dto.cursor,'string');
    for(const m of dto.messages){assert.ok(ident(m.messageId));assert.ok(['user','assistant'].includes(m.role));assert.equal(typeof m.text,'string');assert.ok(Number.isInteger(m.turn));}
    assert.ok(dto.activity===null||ident(dto.activity.activityId));
    assert.ok(Array.isArray(dto.pendingInteractions));assert.ok(Array.isArray(dto.pendingPetCalls));assert.equal(typeof dto.truncated,'boolean');
  }else assert.fail('Unknown DTO fixture');
  dtoExamples++;
}
for(const scenario of scenarios){
  for(const step of scenario.steps){
    if(step.direction==='pet-to-host'){
      transportCalls++;
      const args=step.args;
      if(step.kind!=='cancel'){
        const uri=localRequestURL('http://127.0.0.1:3080/pet-bridge/v1/',args.path,args.query);
        assert.ok(uri.startsWith('http://127.0.0.1:3080/pet-bridge/v1/'));
      }
      if(args.body){assert.equal(validateWire(args.body),true,json(validateWire.errors));assert.ok(Buffer.byteLength(json(args.body))<=65536);coreWireExamples++;}
    }
    if(step.direction==='host-to-pet'){
      const e=step.event;
      if(e.type==='response'){
        assert.equal(e.ok,e.status>=200&&e.status<300);
        if(e.data.protocol||e.data.protocols){assert.equal(validateWire(e.data),true,json(validateWire.errors));coreWireExamples++;
          if(e.data.ok===true&&e.data.data?.receivedAt){
            for(const key of ['receivedAt','updatedAt','endedAt'])if(e.data.data[key]!==undefined){
              assert.equal(typeof e.data.data[key],'string');assert.ok(Number.isFinite(Date.parse(e.data.data[key])));
            }
          }
        }
        else validateDto(e.data);
      }
      if(e.type==='stream.event'){
        const wire=JSON.parse(e.data);
        assert.equal(validateWire(wire),true,json(validateWire.errors));coreWireExamples++;
        if(scenario.negative){assert.notEqual(e.lastEventId,wire.cursor);semanticNegativeCases++;}
        else assert.equal(e.lastEventId,wire.cursor);
        assert.ok(Buffer.byteLength(e.data)<=65536);
      }
    }
  }
}
const negativeWireCases=[
  {...command,protocol:'pet-dsh/2'},
  {...command,op:'shell.exec'},
  {...command,data:{mode:'followup',text:''}},
  {...command,data:{mode:'followup',text:'x'.repeat(4001)}},
  {...command,data:{...command.data,url:'http://example.invalid/'}},
  {...cancel,data:{activityId:'../bad'}},
  {...d0,data:{...d0.data,index:-1}},
  {...accepted,data:undefined}
];
for(const bad of negativeWireCases)assert.equal(validateWire(bad),false,'Expected invalid wire input');
const negativePayloadCases=[
  ['send',{...bind,text:'x',url:'bad'}],
  ['send',{...bind,text:'x'.repeat(4001)}],
  ['send',{sessionId:'session-A',text:'x'}],
  ['confirmCancel',{...bind}],
  ['setMode',{...bind,mode:'automatic'}]
];
for(const [id,payload]of negativePayloadCases)assert.throws(()=>validatePayload(commandMap.get(id),payload));
const invalidSnapshot=structuredClone(snapshots.states[0].snapshot);invalidSnapshot.status='offline';
assert.throws(()=>validateSnapshot(invalidSnapshot));

const sourcePaths=[
  'package.json','docs/DSH_BRIDGE_PROTOCOL.md','docs/LOCAL_SERVICE_API.md','docs/schemas/dsh-bridge-v1.schema.json',
  'electron/plugins/contracts.mjs','electron/plugins/local-service.mjs','src/plugins/renderer.ts',
  'dsh-pet-bridge/package.json','dsh-pet-bridge/COMPATIBILITY.md','dsh-pet-bridge/TEST_REPORT.md',
  ...['index','http-server','auth','config','dsh-adapter','event-hub','request-journal','session-projection','wire'].map(name=>'dsh-pet-bridge/src/'+name+'.js')
];
const sources=[];
for(const file of sourcePaths){const bytes=await readFile(path.join(root,file));sources.push({path:file,bytes:bytes.length,sha256:hash(bytes)});}
const rootProtocol=await readFile(path.join(root,'docs/DSH_BRIDGE_PROTOCOL.md'));
const backendProtocol=await readFile(path.join(root,'dsh-pet-bridge/protocol/DSH_BRIDGE_PROTOCOL.md'));
const backendSchema=await readFile(path.join(root,'dsh-pet-bridge/protocol/schemas/dsh-bridge-v1.schema.json'));
const alignment={protocolBytesEqual:rootProtocol.equals(backendProtocol),schemaBytesEqual:schemaBytes.equals(backendSchema)};
assert.ok(alignment.protocolBytesEqual&&alignment.schemaBytesEqual,'Shared protocol drift: resolve before handoff');
const baseline={format:'pet-dsh-design-baseline/1',createdOn:'2026-10-21',designVersion:'1.0.0',
  petHost:JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version,pluginApi:1,
  bridgePackage:JSON.parse(await readFile(path.join(root,'dsh-pet-bridge/package.json'),'utf8')).version,
  protocol,protocolRevision:'1.0.0',alignment,
  currentServiceCapabilities:{required:baseCaps,defaultOptional:['session.cancel'],optIn:['message.steer'],notImplemented:['interaction.answer','persona.update','pet.tools']},
  evidenceNote:'服务版本及能力依据仓库源码。DSH TEST_REPORT 是既有报告；本生成器不运行其测试、不连接真实服务、不调用模型。',sources};
await writeJson('baseline.json',baseline);
const report={format:'pet-dsh-design-static-validation/1',ok:true,createdOn:'2026-10-21',
  checked:{manifest:1,declaredCommands:commands.length,uiSnapshots:snapshots.states.length,payloadExamples,transportCalls,
    coreWireExamples,rawDtoExamples:dtoExamples,negativeWireCases:negativeWireCases.length,negativePayloadCases:negativePayloadCases.length,
    negativeSnapshotCases:1,semanticNegativeExamples:semanticNegativeCases,documentedWireScenarios:scenarios.length,sourceHashes:sources.length,sharedProtocolAligned:true},
  notChecked:['桌宠客户端实现：尚未编写','HTTP/SSE 实际运行联调','Electron 沙盒导入与撤权','真实 DSH 或真实模型调用','场景 expected 的运行时状态机断言']};
await writeJson('validation-report.json',report);
const fixtureReadme='# 桌宠 DSH 设计附件\n\n主文档：[PET_DSH_PLUGIN_DESIGN.md](../../PET_DSH_PLUGIN_DESIGN.md)。设计版本 1.0.0，协议 pet-dsh/1，宿主 v4.2.2。\n\n- manifest.design.json：满足宿主清单格式的设计样例；没有 provider.js，不能安装。实际插件应采用 plugin.json 文件名。\n- ui-snapshots.json：9 个状态的标准组件快照；不是截图或运行结果。\n- wire-scenarios.json：16 个双端交互场景，含传输调用、宿主回调、wire 包络和待实现断言。\n- baseline.json：源码与协议哈希；后续服务改动后重新核对。\n- validation-report.json：本次静态检查结果，明确列出未验证范围。\n\n当前导入器整体授权 manifest.permissions，提醒功能可关闭但不是单独可选授权项。服务当前不支持 interaction.answer、persona.update、pet.tools，界面不得声称可用。\n\n在仓库根目录运行 node scripts/build-pet-dsh-design.mjs，可重建附件并校验清单、快照、参数、wire 样例和打包完整性。使用已有 Ajv 8 依赖，不访问网络、不启动 DSH、不发送任务。不能把静态检查当作客户端实现与端到端验收。\n';
await writeFile(path.join(dir,'README.md'),fixtureReadme,'utf8');

// Check all direct JSON examples in the design document as well.
const design=await readFile(path.join(root,'docs/PET_DSH_PLUGIN_DESIGN.md'),'utf8');
let documentJsonExamples=0;
for(const match of design.matchAll(/(?:~~~|\x60{3})json\r?\n([\s\S]*?)\r?\n(?:~~~|\x60{3})/g)){
  const value=JSON.parse(match[1]);assert.equal(validateWire(value),true,json(validateWire.errors));documentJsonExamples++;
}
assert.ok(documentJsonExamples>=1,'Document JSON example missing');
report.checked.documentJsonExamples=documentJsonExamples;
await writeJson('validation-report.json',report);
assert.ok(design.includes('characterId、revision、persona、memory'));
assert.ok(!design.includes('petId、revision'));
const files={
  'README.md':Buffer.from('# 桌宠 DSH 插件设计交接包\n\n从 [完整设计](docs/PET_DSH_PLUGIN_DESIGN.md) 开始阅读，再用 docs/fixtures/pet-dsh-v1 下的清单、界面快照和交互场景实现客户端。\n\n本包是设计资料，不是可安装插件，没有 provider.js。当前 DSH 桥 1.0.0 支持会话、消息、事件与查询；人格同步、桌宠审批和反向工具尚未实现。DSH 既有兼容/测试报告位于 dsh-reference，仅供核对，不能代替桌宠端联调。\n\n保留 docs 目录结构可使用主文档相对链接。引用仓库源码的路径需在原项目内查看；baseline.json 提供其哈希。重建脚本需原仓库及既有 Node 依赖，不是独立运行客户端。\n'),
  'docs/PET_DSH_PLUGIN_DESIGN.md':Buffer.from(design),
  'docs/DSH_BRIDGE_PROTOCOL.md':rootProtocol,
  'docs/LOCAL_SERVICE_API.md':await readFile(path.join(root,'docs/LOCAL_SERVICE_API.md')),
  'docs/schemas/dsh-bridge-v1.schema.json':schemaBytes,
  'scripts/build-pet-dsh-design.mjs':await readFile(fileURLToPath(import.meta.url)),
  'dsh-reference/COMPATIBILITY.md':await readFile(path.join(root,'dsh-pet-bridge/COMPATIBILITY.md')),
  'dsh-reference/TEST_REPORT.md':await readFile(path.join(root,'dsh-pet-bridge/TEST_REPORT.md'))
};
for(const name of ['manifest.design.json','ui-snapshots.json','wire-scenarios.json','baseline.json','validation-report.json','README.md']){
  files['docs/fixtures/pet-dsh-v1/'+name]=await readFile(path.join(dir,name));
}
const archiveManifest={format:'pet-dsh-design-handoff/1',designVersion:'1.0.0',createdOn:'2026-10-21',installablePlugin:false,
  protocol,petHost:baseline.petHost,bridgePackage:baseline.bridgePackage,
  files:Object.entries(files).map(([name,bytes])=>({name,bytes:bytes.length,sha256:hash(bytes)}))};
files['MANIFEST.json']=Buffer.from(json(archiveManifest));
const archive=createZip(files);
const extracted=readZip(archive);
assert.equal(extracted.size,Object.keys(files).length);
for(const file of archiveManifest.files)assert.equal(hash(extracted.get(file.name)),file.sha256);
const output=path.join(root,'release/handoffs/Pet-DSH-Plugin-Design-v1.0.0.zip');
await mkdir(path.dirname(output),{recursive:true});
await writeFile(output,archive);
console.log(json({...report,documentJsonExamples,archive:{path:output,bytes:archive.length,files:extracted.size,sha256:hash(archive)}}));
