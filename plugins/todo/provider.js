// Builtin Todo provider. Keep the former ZIP identity and its persistent storage.
export async function activate(context){
  const stored=await context.storage.get('state');
  if(stored&&(stored.schemaVersion!==1||!Array.isArray(stored.items)||!Array.isArray(stored.trash)||stored.items.length>80))throw new Error('Unsupported todo data');
  let state=stored??{schemaVersion:1,items:[],trash:[],sequence:0,latestReminder:null},editing=null,timer,closed=false,queue=Promise.resolve();
  const clone=value=>JSON.parse(JSON.stringify(value));
  const text=(value,extra={})=>({type:'text',text:String(value??''),...extra});
  const button=(commandId,label,icon,payload={},variant='icon')=>({type:'button',commandId,label,icon,payload,variant,enabled:true});
  const date=value=>{if(!value)return null;const time=Date.parse(value);if(!Number.isFinite(time))throw new Error('Invalid due date');return new Date(time).toISOString();};
  const overdue=item=>!item.done&&item.dueAt&&Date.parse(item.dueAt)<=Date.now();
  const save=()=>context.storage.set('state',clone(state));
  const enqueue=operation=>{const result=queue.then(()=>{if(closed)throw new Error('Plugin stopped');return operation();});queue=result.catch(()=>{});return result;};
  const pendingItems=()=>state.items.filter(item=>!item.done).sort((a,b)=>(a.dueAt?Date.parse(a.dueAt):Infinity)-(b.dueAt?Date.parse(b.dueAt):Infinity)||b.createdAt.localeCompare(a.createdAt));
  function itemBlock(item){return {type:'group',layout:'row',appearance:'task-row',contextActions:[button('edit','编辑','edit',{id:item.id},'text'),button('delete','删除（可撤销）','trash',{id:item.id},'text'),...(!item.done&&overdue(item)?[button('snooze','10 分钟后提醒','clock',{id:item.id},'text')]:[])],children:[
    {...button(item.done?'reopen':'complete',item.done?'撤回完成':'标记完成',item.done?'undo':'check',{id:item.id}),appearance:'task-toggle'},
    {type:'group',layout:'column',appearance:'task-content',children:[text(item.title,{strong:true}),...(item.notes?[text(item.notes,{tone:'muted',ellipsis:true})]:[]),...(item.dueAt?[{type:'time',label:overdue(item)?'已到期':'截止',value:item.dueAt}]:[])]},
    {type:'group',layout:'row',appearance:'task-actions',children:[button('edit','编辑','edit',{id:item.id}),button('delete','删除（可撤销）','close',{id:item.id})]}
  ]};}
  function getSnapshot(){
    const pending=pendingItems(),completed=state.items.filter(item=>item.done).sort((a,b)=>(b.completedAt??b.createdAt).localeCompare(a.completedAt??a.createdAt)),item=state.items.find(item=>item.id===editing);
    const total=state.items.length,progress=total?Math.round(completed.length/total*100):0;
    const progressBlocks=[{type:'group',layout:'row',appearance:'task-progress',children:[text('任务进度 '+completed.length+'/'+total,{strong:true}),text(progress+'%',{tone:'muted'})]},{type:'progress',value:progress}];
    const createFooter=[{...button('cancelEdit','新增待办','plus',{},'text'),appearance:'task-create'}];
    const latest=state.latestReminder,readKey=latest&&pending.some(task=>latest.taskIds.includes(task.id)&&overdue(task))?latest.id:null;
    return {available:true,status:'ready',message:`${pending.length} 项待办 · ${completed.length} 项已完成`,pages:[
      {id:'pending',title:'待办事项',icon:'checklist',subtitle:`${pending.length} 项待完成`,readKey,blocks:[...progressBlocks,
        ...(state.trash.length?[button('undoDelete','撤销删除','undo',{},'text')]:[]),
        ...(pending.length?pending.map(itemBlock):[{type:'status',icon:'checklist',title:'暂时没有待办',description:'点击“新增待办”，开始记录今天的事情。'}])],footer:createFooter},
      {id:'completed',title:'已完成',icon:'check',subtitle:`${completed.length} 项 · 可以恢复`,blocks:[...progressBlocks,...(completed.length?completed.map(itemBlock):[{type:'status',icon:'check',title:'还没有已完成事项',description:'标记完成后会出现在这里。'}])],footer:createFooter},
      {id:'compose',navigationHidden:true,title:item?'编辑待办':'新增待办',icon:item?'edit':'plus',subtitle:'本机保存 · 截止时间可选',blocks:[
        text(state.items.length>=80&&!item?'已达到 80 项上限，请先删除旧任务。':'填写标题即可，备注与截止时间可选。',{tone:'muted'}),
        {type:'form',id:item?'edit-'+item.id:'add-task',commandId:item?'save':'add',payload:item?{id:item.id}:{},submitLabel:item?'保存修改':'添加待办',enabled:Boolean(item)||state.items.length<80,fields:[
          {key:'title',type:'text',label:'事项标题',required:true,maxLength:160,value:item?.title??''},
          {key:'notes',type:'textarea',label:'备注',maxLength:1000,value:item?.notes??''},
          {key:'dueAt',type:'datetime',label:'截止时间（本机时区）',value:item?.dueAt??''}]},
        ...(item?[button('cancelEdit','取消编辑 / 新增','plus',{},'text')]:[])]}
    ]};
  }
  const publish=()=>{if(!closed)context.publish(getSnapshot());};
  async function checkDue(){
    if(!context.getConfig().reminders)return;
    const due=state.items.filter(item=>overdue(item)&&item.remindedFor!==item.dueAt);
    if(due.length){
      state.sequence=(state.sequence??0)+1;const id='todo-due:'+state.sequence;
      for(const item of due)item.remindedFor=item.dueAt;
      state.latestReminder={id,taskIds:due.map(item=>item.id),createdAt:new Date().toISOString(),count:due.length,title:due[0].title,delivered:false};await save();publish();
    }
    const latest=state.latestReminder;
    if(latest&&!latest.delivered){
      await context.emit({id:latest.id,dedupeKey:latest.id,createdAt:latest.createdAt,count:latest.count,pageId:'pending',readKeys:[latest.id],summary:{private:`有 ${latest.count} 项待办到期`,details:`待办 · ${latest.count} 项到期\n${latest.title}`}});
      latest.delivered=true;await save();
    }
  }
  function configureTimer(){clearInterval(timer);const seconds=Math.max(5,Math.min(120,Number(context.getConfig().intervalSeconds)||15));timer=setInterval(()=>void enqueue(checkDue).catch(()=>{}),seconds*1000);}
  context.onCleanup(()=>{closed=true;clearInterval(timer);});
  await checkDue();
  configureTimer();
  return {getSnapshot,
    execute(command,payload){return enqueue(async()=>{
      let item=state.items.find(item=>item.id===payload.id),result=null;
      if(command==='add'){
        const title=String(payload.title??'').trim();if(!title||title.length>160||state.items.length>=80)throw new Error('Invalid title or task limit');
        state.items.unshift({id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10),title,notes:String(payload.notes??'').slice(0,1000),dueAt:date(payload.dueAt),done:false,createdAt:new Date().toISOString(),remindedFor:null});editing=null;result={navigateTo:'pending',resetForm:true};
      }else if(command==='undoDelete'){
        if(!state.trash.length||state.items.length>=80)throw new Error('No deletion to undo');state.items.push(state.trash.pop());
      }else if(command==='cancelEdit'){editing=null;publish();return {navigateTo:'compose'};}
      else{
        if(!item)throw new Error('Task no longer exists');
        if(command==='edit'){editing=item.id;publish();return {navigateTo:'compose'};}
        if(command==='save'){const title=String(payload.title??'').trim();if(!title||title.length>160)throw new Error('Invalid title');const dueAt=date(payload.dueAt);if(dueAt!==item.dueAt)item.remindedFor=null;Object.assign(item,{title,notes:String(payload.notes??'').slice(0,1000),dueAt});editing=null;result={navigateTo:'pending'};}
        else if(command==='complete'){item.done=true;item.completedAt=new Date().toISOString();}
        else if(command==='reopen'){item.done=false;item.remindedFor=null;}
        else if(command==='snooze'){item.dueAt=new Date(Date.now()+600000).toISOString();item.remindedFor=null;}
        else if(command==='delete'){state.items=state.items.filter(task=>task.id!==item.id);state.trash.push(item);state.trash=state.trash.slice(-20);if(editing===item.id)editing=null;}
        else throw new Error('Unknown command');
      }
      await save();await checkDue();publish();return result;
    });},
    onSettingsChanged(){configureTimer();return enqueue(async()=>{await checkDue();publish();});},
    dispose(){closed=true;clearInterval(timer);}
  };
}
