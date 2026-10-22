import {normalizeTheme,sanitizeCustomTheme} from './themes.mjs';
const flatten=blocks=>(blocks??[]).flatMap(block=>block.type==='group'?flatten(block.children):[block]);
// Only the active companion's composer and latest reply reach the pet renderer.
// Configuration pages, memories, credentials and other plugins' content stay out.
export function companionState(snapshot) {
 const result={theme:normalizeTheme(snapshot?.settings?.theme),customTheme:sanitizeCustomTheme(snapshot?.settings?.customTheme),opacity:snapshot?.settings?.companionOpacity??86,reducedMotion:Boolean(snapshot?.settings?.reducedMotion),companion:null};
 if(!snapshot||snapshot.locked)return result;
 const source=snapshot.plugins.find(p=>p.enabled&&p.runtime==='active'&&p.manifest.presentation?.panel==='bubble');
 if(!source)return result;
 const blocks=source.pages.flatMap(p=>flatten(p.blocks));
 const form=source.pages.flatMap(p=>flatten(p.footer)).find(b=>b.type==='form'&&b.variant==='composer'&&b.fields.length===1&&b.fields[0].type==='text');
 const assistant=blocks.filter(b=>b.type==='chat').flatMap(b=>b.messages).filter(m=>m.role==='assistant').at(-1);
 const error=blocks.find(b=>b.type==='text'&&b.tone==='error');
 result.companion={id:source.id,epoch:source.epoch,name:source.manifest.name,icon:source.manifest.icon,
  hint:source.error||error?.text||(source.status==='waiting'?'请到角色管理器 → 扩展配置 API。':source.message||'和桌宠说几句话…'),
  form:form?{command:form.commandId,key:form.fields[0].key,maxLength:Math.min(4000,form.fields[0].maxLength??4000),enabled:form.enabled!==false,pending:Boolean(form.pending),stop:form.stopAction?.enabled?form.stopAction.commandId:null}:null,
  assistant:assistant?{id:assistant.id,content:assistant.content,state:assistant.state}:null};
 return result;
}
export async function executeCompanion(service,id,epoch,command,text) {
 const c=companionState(service.snapshot()).companion;
 const invalid=()=>({ok:false,error:{code:'INVALID_COMPANION',message:'聊天状态已改变，请稍后重试。'}});
 if(!c||c.id!==id||c.epoch!==epoch||!c.form)return invalid();
 if(c.form.pending&&command===c.form.stop)return service.execute(id,command,{});
 if(command!==c.form.command||!c.form.enabled||c.form.pending||typeof text!=='string'||!text.trim()||text.length>c.form.maxLength)return invalid();
 const result=await service.execute(id,command,{[c.form.key]:text});
 return result.ok?{ok:true,data:{resetForm:Boolean(result.data?.resetForm)}}:{ok:false,error:result.error};
}
