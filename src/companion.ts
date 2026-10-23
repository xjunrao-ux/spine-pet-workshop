import './style.css';
import {applyTheme} from './features/themes';
import type {CompanionState} from '../electron/plugins/companion.mjs';
export function initializeComposer(){
 const api=window.petCompanion;
 const form=document.querySelector<HTMLFormElement>('#pet-chat')!,input=document.querySelector<HTMLInputElement>('#pet-chat-text')!,send=document.querySelector<HTMLButtonElement>('#pet-chat-send')!,stop=document.querySelector<HTMLButtonElement>('#pet-chat-stop')!,hint=document.querySelector<HTMLElement>('#pet-chat-hint')!;
 let state:CompanionState|undefined,identity='',held=false,composing=false,sending=false,error='',suppressed=false;
 let drag:{x:number;y:number;id:number}|null=null;
 let resize:{x:number;id:number;edge:'left'|'right'}|null=null;
 const pointerX=(event:PointerEvent)=>event.screenX||window.screenX+event.clientX;
 const pointerY=(event:PointerEvent)=>event.screenY||window.screenY+event.clientY;
 const interacting=()=>!form.classList.contains('hidden')&&(held||form.contains(document.activeElement));
 function render(){
  const c=state?.companion,show=Boolean(c&&!suppressed);
  form.classList.toggle('hidden',!show);
  input.disabled=!c?.form?.enabled;input.maxLength=c?.form?.maxLength??4000;
  send.disabled=sending||!c?.form?.enabled||c.form.pending;send.classList.toggle('hidden',Boolean(c?.form?.pending));
  stop.classList.toggle('hidden',!c?.form?.pending);stop.disabled=sending||!c?.form?.stop;
  hint.textContent=error;hint.classList.toggle('hidden',!error);
  form.style.setProperty('--chat-opacity',String((state?.opacity??86)/100));form.style.setProperty('--chat-blur',(state?.opacity??86)>0?'blur(16px)':'none');
  api?.interaction(interacting());
 }
 function update(value:CompanionState){
  state=value;applyTheme(value.theme,value.customTheme);document.body.classList.toggle('reduce-motion',value.reducedMotion);
  const c=value.companion,key=c?c.id+'|'+c.epoch:'';
  if(key!==identity){identity=key;input.value='';error='';if(!c){input.blur();held=false;}}
  suppressed=false;render();
 }
 async function execute(command:string,text?:string){
  const c=state?.companion;if(!api||!c||sending)return;
  sending=true;error='';render();const draft=input.value,key=identity;
  try{const result=await api.execute(c.id,c.epoch,command,text);if(identity!==key)return;
   if(!result.ok)error=result.error?.message??'发送失败';
   else if((result.data as {resetForm?:boolean}|null)?.resetForm&&input.value===draft)input.value='';
  }catch{if(identity===key)error='聊天暂不可用，请检查插件设置。';}
  finally{sending=false;render();}
 }
 form.addEventListener('submit',event=>{event.preventDefault();const c=state?.companion;if(composing||!c?.form||c.form.pending||!input.value.trim()||!form.reportValidity())return;void execute(c.form.command,input.value);});
 stop.addEventListener('click',()=>{const command=state?.companion?.form?.stop;if(command)void execute(command);});
 input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;});
 input.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.isComposing||composing))event.preventDefault();if(event.key==='Escape'){event.preventDefault();suppressed=true;held=false;input.blur();render();api?.close();}});
 form.addEventListener('pointerenter',()=>{held=true;render();});
 form.addEventListener('pointerleave',()=>{held=false;render();});
 form.addEventListener('focusin',render);form.addEventListener('focusout',()=>setTimeout(render,0));

 window.addEventListener('blur',()=>{input.blur();held=false;render();});
 if(api){api.onState(update);void api.get().then(update).catch(()=>{});}
 const handle=document.querySelector<HTMLButtonElement>('#pet-chat-drag')!;
 handle.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();drag={x:pointerX(event),y:pointerY(event),id:event.pointerId};handle.setPointerCapture(event.pointerId);document.body.classList.add('dragging-composer');void api?.move(0,0,'start');});
 window.addEventListener('pointermove',event=>{if(drag&&event.pointerId===drag.id)void api?.move(pointerX(event)-drag.x,pointerY(event)-drag.y,'move');if(resize&&event.pointerId===resize.id)void api?.resize(pointerX(event)-resize.x,resize.edge,'move');});
 const finish=(event:PointerEvent)=>{if(!drag||event.pointerId!==drag.id)return;const start=drag;drag=null;document.body.classList.remove('dragging-composer');void api?.move(pointerX(event)-start.x,pointerY(event)-start.y,'end').then(result=>{if(!result.ok){error='输入框位置保存失败，请重试。';render();}});};
 window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);
 document.querySelectorAll<HTMLElement>('[data-resize-edge]').forEach(edge=>edge.addEventListener('pointerdown',event=>{
  if(event.button!==0||drag||resize)return;event.preventDefault();
  resize={x:pointerX(event),id:event.pointerId,edge:edge.dataset.resizeEdge as 'left'|'right'};
  edge.setPointerCapture(event.pointerId);held=true;document.body.classList.add('resizing-composer');
  void api?.resize(0,resize.edge,'start');render();
 }));
 const finishResize=(event:PointerEvent)=>{
  if(!resize||event.pointerId!==resize.id)return;const start=resize;resize=null;document.body.classList.remove('resizing-composer');
  void api?.resize(pointerX(event)-start.x,start.edge,'end').then(result=>{if(!result.ok){error='输入框宽度保存失败，请重试。';render();}});
 };
 window.addEventListener('pointerup',finishResize);window.addEventListener('pointercancel',finishResize);
 api?.onClose(()=>{input.blur();held=false;composing=false;suppressed=true;drag=null;resize=null;document.body.classList.remove('dragging-composer','resizing-composer');render();});
}

initializeComposer();
