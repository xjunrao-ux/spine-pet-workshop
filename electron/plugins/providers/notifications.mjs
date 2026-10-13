import { readKey } from '../contracts.mjs';
import { notificationChannels } from '../../extensions/media-state.mjs';
import { createHash } from 'node:crypto';
export const manifest={id:'workshop.notifications',legacyId:'notifications',name:'系统通知',menuLabel:'通知',version:'1.0.0',apiVersion:1,configVersion:1,icon:'notifications',entryVisibility:'when-enabled',
  description:'接收 QQ、手机连接等实际进入 Windows 通知中心的消息。',permissions:['notifications.read','ui.reminders'],
  settingsSchema:[{key:'blockedApps',type:'stringList',label:'屏蔽的通知来源 ID',description:'一行一个来源 ID；功能页也可按收到的应用选择。',optionSource:'sources',default:[]}],
  compatibilityNotes:['微信与企业微信：当前验证的客户端不走 Windows 系统通知，暂不支持聊天提醒，等待官方开放可用接口。','托盘红点不代表系统通知。QQ、手机连接等来源按实际进入系统通道的结果显示。'],
  commands:[{id:'requestPermission',label:'请求通知访问',permissions:['notifications.read'],fields:{},managerOnly:true}]};
export function activate(context) {
  let notices={permission:'Unknown',items:[],error:null},baseline=false;const seen=new Map(),suppressed=new Set();
  const visible=()=>notices.items.filter(item=>!suppressed.has(readKey(item.id,item.createdAt)) && !context.isRead(readKey(item.id,item.createdAt)) && !context.getConfig().blockedApps.includes(item.appId));
  const getSnapshot=()=>{
    const items=visible(),details=context.getPreferences().details;
    return {available:true,status:notices.error?'degraded':notices.permission==='Allowed'?'ready':'waiting',message:notices.error??(notices.permission==='Allowed'?`已连接 · ${items.length} 条通知`:'需要通知访问权限'),
      diagnostics:{permission:notices.permission,channels:notificationChannels(notices).map(channel=>({...channel,message:channel.id==='wechat'||channel.id==='wecom'?'暂不支持 · 当前客户端不走系统通知':channel.observed?'已检测到系统通知':channel.running?'正在运行，尚未检测到系统通知':'未运行且暂无系统通知'})),sources:[...new Map(notices.items.map(item=>[item.appId,{id:item.appId,name:item.app}])).values()]},
      pages:items.length?items.map(item=>({id:item.id,readKey:readKey(item.id,item.createdAt),title:item.app,icon:/chatgpt|openai/i.test(item.app+' '+item.appId)?'codex':'notifications',source:{id:item.appId,name:item.app},
        subtitle:new Date(item.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})+' · '+(details?'显示模式':'隐私模式'),blocks:[
          {type:'group',layout:'column',appearance:'notice',children:[{type:'group',layout:'row',appearance:'notice-top',children:[{type:'text',text:details?(item.title||'收到一条新消息'):'有一条新消息',strong:true}]},
            {type:'text',text:details?(item.body||'暂无正文'):'隐私模式 · 不展示消息正文',tone:details?'normal':'muted',multiline:true}]}]
      })): [{id:'empty',title:'通知',icon:'notifications',subtitle:'已启用',blocks:[{type:'status',icon:'notifications',title:'暂无新通知',description:notices.error||(notices.permission==='Allowed'?'收到新消息时会在这里提醒':'请在角色管理器授权通知访问')}]}]};
  };
  context.capabilities.notifications.subscribe(input=>{
    const details=context.getPreferences().details;
    notices={...input,items:(input.items??[]).filter(x=>typeof x.id==='string').map(item=>({...item,app:String(item.app||'系统通知'),appId:String(item.appId||'windows.system'),createdAt:Number.isFinite(Date.parse(item.createdAt))?item.createdAt:new Date().toISOString(),title:details?String(item.title??'').slice(0,4000):'',body:details?String(item.body??'').slice(0,4000):''})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100)};
    const groups=new Map();
    for(const item of notices.items) {
      const key=readKey(item.id,item.createdAt),fresh=seen.get(item.id)!==item.createdAt,afterStart=Date.parse(item.createdAt)>=context.startedAt;
      if(!baseline && !afterStart && /chatgpt|openai/i.test(item.app+' '+item.appId)) suppressed.add(key);
      if((baseline||afterStart) && fresh && !suppressed.has(key) && !context.isRead(key) && !context.getConfig().blockedApps.includes(item.appId)) {const group=groups.get(item.appId)??[];group.push(item);groups.set(item.appId,group);}
      seen.set(item.id,item.createdAt);
    }
    if(notices.permission==='Allowed') baseline=true;context.publish(getSnapshot());
    for(const items of groups.values()) {
      const latest=items[0],summary=[latest.title,latest.body].filter(Boolean).join(' · ').replace(/\s+/g,' ').slice(0,160),keys=items.map(item=>readKey(item.id,item.createdAt)),id=createHash('sha256').update(keys.join('|')).digest('hex');
      context.emit({id,dedupeKey:id,createdAt:latest.createdAt,pageId:latest.id,readKeys:keys,
        summary:{private:`${latest.app} 收到 ${items.length} 条新消息`,details:summary?`${latest.app} · ${items.length} 条新消息\n${summary}`:undefined}});
    }
    if(seen.size>1000) {seen.clear();for(const item of notices.items) seen.set(item.id,item.createdAt);}
    if(suppressed.size>1000) {const current=new Set(notices.items.map(item=>readKey(item.id,item.createdAt)));for(const key of suppressed) if(!current.has(key)) suppressed.delete(key);}
  });
  return {getSnapshot,onSettingsChanged(){if(!context.getPreferences().details) notices={...notices,items:notices.items.map(item=>({...item,title:'',body:''}))};},
    execute:(_command,_payload,{signal})=>context.capabilities.notifications.requestPermission(signal),dispose(){notices={permission:'Disabled',items:[],error:null};seen.clear();suppressed.clear();}};
}
