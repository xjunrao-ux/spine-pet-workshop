// Independent ZIP module. Its permission-gated context.codex gateway is readonly.
const labels={active:'执行中',idle:'空闲',notLoaded:'未加载',completed:'已完成',failed:'失败',interrupted:'已中断',inProgress:'执行中',systemError:'异常'};
export async function activate(context) {
  let state={running:false,connected:false,tasks:[]},latestReadKey=null;
  const metric=(label,value)=>({type:'metric',label,value:value?.remaining??null,resetsAt:value?.resetsAt??null});
  const getSnapshot=()=>({available:state.running,status:state.error||state.taskError?'degraded':state.connected?'ready':'waiting',message:state.error??(state.connected?'已连接 · 只读':state.running?'正在连接':'等待 Codex 启动'),updatedAt:state.updatedAt??null,
    pages:state.running?[
      {id:'limits',title:'剩余额度',icon:'codex',subtitle:'Codex · '+(state.connected?(state.allowed===false?'当前额度不可用':'已连接 · 只读'):'正在连接'),blocks:[metric(state.primary?.minutes===300?'5 小时额度':'主额度窗口',state.primary),metric(state.secondary?.minutes===10080?'周额度':'次额度窗口',state.secondary),...(state.error?[{type:'text',text:state.error,tone:'error'}]:[])]},
      {id:'tasks',title:'最近消息',icon:'codex',readKey:latestReadKey,subtitle:'Codex · '+(state.updatedAt?'更新于 '+new Date(state.updatedAt).toLocaleTimeString('zh-CN'):'任务状态'),blocks:[
        {type:'list',items:state.tasks.map(task=>({id:task.id,label:task.name,status:labels[task.status==='active'?'active':task.turnStatus??task.status]??'未知'})),emptyText:'等待可读取的任务状态'},
        ...(state.taskError?[{type:'text',text:state.taskError,tone:'muted'}]:[])]}
    ]:[]});
  const release=await context.codex.subscribe(value=>{state=value;context.publish(getSnapshot());},async event=>{
    latestReadKey=event.id;context.publish(getSnapshot());
    await context.emit({id:event.id,dedupeKey:event.id,createdAt:event.createdAt,pageId:'tasks',readKeys:[latestReadKey],summary:{private:'Codex 有一个任务状态更新',details:event.text}});
  });
  let closed=false;const close=()=>{if(closed)return;closed=true;release();state={running:false,connected:false,tasks:[]};};context.onCleanup(close);
  return {getSnapshot,dispose:close};
}
