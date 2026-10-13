import './extensions.css';
import { featureIcon } from './features/icons';
import type { FeatureBridge, PluginSnapshot as FeatureSnapshot, PluginId as ModuleId, PluginEvent as FeatureEvent, CommandButton } from './plugins/types';
import { renderPages, renderBlock, timelineBlocks, clock, visiblePlugins } from './plugins/renderer';

const api: FeatureBridge=window.petFeatures!;
const card=document.querySelector<HTMLElement>('#feature-card')!;
const capsule=document.querySelector<HTMLElement>('#capsule')!;
const track=document.querySelector<HTMLElement>('#capsule-track')!;
const toast=document.querySelector<HTMLButtonElement>('#event-toast')!;
let state: FeatureSnapshot, selected: ModuleId|null=null, hover=false, pinned=false;
let event: FeatureEvent|null=null, toastTimer=0, previewTimer=0, readTimer=0, busy=false, operationError='', trackSignature='', cardModule: ModuleId|null=null;
let renderedBody='', pageIndex=0;
let contextMenu:HTMLElement|null=null,contextAnchor:HTMLElement|null=null;
let resizeGesture: {edge:string;x:number;y:number;width:number;height:number}|null=null, resizeRevision=0;
const viewed=new Map<string,{pluginId:string;pageId:string;readKey:string}>(), eventQueue: FeatureEvent[]=[];
const hideTimers=new Map<HTMLElement,number>();
const icons: Record<string,string>={
  music:'<path d="M9 18V5l12-2v13M9 8l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="m10 2-1 3-3 1-3-1-2 3 2 2v4l-2 2 2 3 3-1 3 1 1 3h4l1-3 3-1 3 1 2-3-2-2v-4l2-2-2-3-3 1-3-1-1-3z"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',pin:'<path d="m9 3 6 0-1 7 4 4H6l4-4-1-7M12 14v7"/>',
  play:'<path d="m8 4 12 8-12 8z"/>',pause:'<path d="M8 4v16M16 4v16"/>',
  'chevron-left':'<path d="m15 6-6 6 6 6"/>','chevron-right':'<path d="m9 6 6 6-6 6"/>',
  previous:'<path d="M5 4v16m14-16L7 12l12 8z"/>',next:'<path d="M19 4v16M5 4l12 8-12 8z"/>'
};
const svg=(name:string)=>!icons[name]?featureIcon(name):'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[name]+'</svg>';
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const plugin=(id:string|null)=>state?.plugins.find(p=>p.id===id);
const token=(id:string,key:string)=>JSON.stringify([id,key]);
const reduced=()=>state?.settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
card.addEventListener('error',event=>{
  const target=event.target;if(!(target instanceof HTMLImageElement) || !target.dataset.fallbackIcon) return;
  const fallback=document.createElement('div');fallback.className='cover';fallback.innerHTML=featureIcon(target.dataset.fallbackIcon);target.replaceWith(fallback);
},true);
function regions(){
  api.regions([...document.querySelectorAll<HTMLElement>('.surface:not(.hidden):not(.leaving)')].map(element=>{
    const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};
  }));
}
function visible(element:HTMLElement,value:boolean){
  if(value){
    clearTimeout(hideTimers.get(element));hideTimers.delete(element);
    const entering=element.classList.contains('hidden') || element.classList.contains('leaving');
    element.classList.remove('hidden','leaving');
    if(entering) requestAnimationFrame(()=>{if(!element.classList.contains('leaving')) element.classList.add('visible');regions();});
    else element.classList.add('visible');
  }else if(!element.classList.contains('hidden') && !element.classList.contains('leaving')){
    element.classList.remove('visible');element.classList.add('leaving');
    hideTimers.set(element,window.setTimeout(()=>{element.classList.add('hidden');element.classList.remove('leaving');hideTimers.delete(element);regions();},reduced()?0:220));
  }
  requestAnimationFrame(regions);
}
function available():ModuleId[]{return visiblePlugins(state.plugins).map(p=>p.id);}
function pruneEvents(){
  const keep=(item:FeatureEvent)=>{
    const source=plugin(item.pluginId);if(!source?.enabled) return false;
    return !item.readKeys?.length || item.readKeys.some(key=>source.pages.some(p=>p.readKey===key && p.unread) && !viewed.has(token(item.pluginId,key)));
  };
  for(let i=eventQueue.length-1;i>=0;i--) if(!keep(eventQueue[i])) eventQueue.splice(i,1);
  if(event && !keep(event)){event=null;clearTimeout(toastTimer);showNextEvent();}
}
function flushRead(){
  clearTimeout(readTimer);
  const groups=new Map<string,Array<{pageId:string;readKey:string}>>();
  for(const item of viewed.values()){
    if(!plugin(item.pluginId)?.pages.some(p=>p.id===item.pageId && p.readKey===item.readKey)) continue;
    const group=groups.get(item.pluginId)??[];group.push({pageId:item.pageId,readKey:item.readKey});groups.set(item.pluginId,group);
  }
  state={...state,plugins:state.plugins.map(p=>{
    const keys=new Set((groups.get(p.id)??[]).map(item=>item.readKey));
    const pages=p.pages.map(page=>keys.has(page.readKey??'')?{...page,unread:false}:page);
    return {...p,pages,unread:pages.filter(page=>page.unread).length};
  })};
  viewed.clear();pruneEvents();
  for(const [id,items] of groups) void api.acknowledge(id,items).then(result=>{if(!result.ok){operationError=result.error?.message??'已读状态保存失败';render();}}).catch(()=>{operationError='已读状态保存失败';render();});
}
function unselect(){stopPaging();clearTimeout(previewTimer);if(selected) flushRead();selected=null;pinned=false;api.pin(false);render();}
function close(){hover=false;unselect();api.close();}
function open(id:ModuleId,fixed=false){
  if(!state || !available().includes(id)) return;
  if(selected!==id){
    if(selected) flushRead();
    stopPaging();operationError='';renderedBody='';pageIndex=0;clearTimeout(readTimer);
  }
  selected=id;pinned=fixed;api.pin(fixed);render();
  [...track.querySelectorAll<HTMLButtonElement>('[data-module]')].find(button=>button.dataset.module===id)?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
}
function formDrafts(body:HTMLElement):{forms:Map<string,Record<string,string>>;focus:{id:string;name:string;start:number|null;end:number|null}|null}{
  const forms=new Map<string,Record<string,string>>();let focus:{id:string;name:string;start:number|null;end:number|null}|null=null;
  body.querySelectorAll<HTMLFormElement>('[data-command-form]').forEach(form=>{
    const values:Record<string,string>={};form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('[name]').forEach(input=>{
      values[input.name]=input.value;if(input===document.activeElement)focus={id:form.dataset.formId!,name:input.name,start:input.selectionStart,end:input.selectionEnd};
    });forms.set(form.dataset.formId!,values);
  });return {forms,focus};
}
function restoreDrafts(body:HTMLElement,drafts:ReturnType<typeof formDrafts>){
  const focused=drafts.focus;
  body.querySelectorAll<HTMLFormElement>('[data-command-form]').forEach(form=>{const values=drafts.forms.get(form.dataset.formId!);if(!values)return;
    form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('[name]').forEach(input=>{
      if(Object.hasOwn(values,input.name))input.value=values[input.name];
      if(focused&&focused.id===form.dataset.formId&&focused.name===input.name){input.focus();if(focused.start!==null&&focused.end!==null)try{input.setSelectionRange(focused.start,focused.end);}catch{}}
    });
  });
}
function render(){
  if(!state) return;
  document.body.classList.toggle('reduce-motion',state.settings.reducedMotion);
  if(!resizeGesture){
    card.style.width=(state.settings.cardWidth??282)+'px';
    card.style.height=(state.settings.cardHeight??285)+'px';
  }
  const entries=available();
  if(selected && !entries.includes(selected)){stopPaging();clearTimeout(readTimer);selected=null;pinned=false;api.pin(false);}
  const signature=JSON.stringify(entries.map(id=>[id,plugin(id)?.manifest.icon,plugin(id)?.manifest.menuLabel??plugin(id)?.manifest.name]));
  if(signature!==trackSignature){
    trackSignature=signature;const offset=track.scrollLeft;
    track.innerHTML=entries.map(id=>{const p=plugin(id)!;return '<button class="entry" data-module="'+esc(id)+'" aria-label="'+esc(p.manifest.menuLabel??p.manifest.name)+'">'+svg(p.manifest.icon)+'<span class="badge hidden"></span></button>';}).join('');
    track.scrollLeft=offset;
  }
  track.querySelectorAll<HTMLButtonElement>('[data-module]').forEach(button=>{
    button.classList.toggle('active',button.dataset.module===selected);
    button.setAttribute('aria-pressed',String(pinned && button.dataset.module===selected));
    const p=plugin(button.dataset.module!);
    const unread=p?.pages.some(page=>page.unread && !viewed.has(token(p.id,page.readKey??'')));
    button.querySelector('.badge')?.classList.toggle('hidden',!unread);
    button.title=(p?.manifest.menuLabel??p?.manifest.name??'插件')+(unread?' · 有新消息':'');
  });
  capsule.classList.toggle('no-features',!entries.length);
  visible(capsule,hover || Boolean(selected));visible(card,Boolean(selected));
  if(selected){
    if(cardModule!==selected){
      cardModule=selected;renderedBody='';
      card.innerHTML='<header class="card-heading"><div class="heading-label"><span class="heading-icon">'+svg(plugin(selected)!.manifest.icon)+'</span><div><strong>'+esc(plugin(selected)!.manifest.menuLabel??plugin(selected)!.manifest.name)+'</strong><small id="card-mode"></small></div></div><div class="heading-actions"><button class="icon-button" data-pin aria-label="固定卡片">'+svg('pin')+'</button><button class="icon-button" data-close aria-label="关闭卡片">'+svg('close')+'</button></div></header><div id="card-body" class="card-body"></div><footer class="pager-hint"><span>左右翻页</span><nav class="page-navigation" aria-label="页面导航"><button type="button" class="page-arrow" data-page-step="-1" aria-label="上一页" title="上一页">'+svg('chevron-left')+'</button><span id="page-counter" aria-live="polite"></span><button type="button" class="page-arrow" data-page-step="1" aria-label="下一页" title="下一页">'+svg('chevron-right')+'</button></nav></footer>'+
        ['n','s','e','w','ne','nw','se','sw'].map(edge=>'<div class="resize-edge edge-'+edge+'" data-resize="'+edge+'" title="拖动边缘调整面板大小"></div>').join('');
      card.querySelector('#card-body')!.addEventListener('scroll',pageChanged,{passive:true});
    }
    card.querySelector('#card-mode')!.textContent=pinned?'已固定':'悬停预览 · 点击固定';
    card.querySelector('[data-pin]')!.setAttribute('aria-pressed',String(pinned));
    const body=card.querySelector<HTMLElement>('#card-body')!;
    const html=renderPages(plugin(selected)!,busy||plugin(selected)!.runtime!=='active');
    if(renderedBody!==html && !resizeGesture){
      closeContextMenu();
      const pages=[...body.querySelectorAll<HTMLElement>('.feature-page')];
      const oldKey=renderedBody?pages[pageIndex]?.dataset.page:undefined;
      const offsets=new Map(pages.map(p=>[p.dataset.page,p.querySelector('.page-content')?.scrollTop??0]));
      const drafts=formDrafts(body);body.innerHTML=html;renderedBody=html;
      const next=[...body.querySelectorAll<HTMLElement>('.feature-page')];
      const key=oldKey??plugin(selected)?.preferredPageId;
      const found=next.findIndex(p=>p.dataset.page===key);
      pageIndex=found>=0?found:Math.min(pageIndex,Math.max(0,next.length-1));
      next.forEach(p=>{p.querySelector('.page-content')!.scrollTop=offsets.get(p.dataset.page)??0;});
      body.scrollTo({left:pageIndex*body.clientWidth,top:0,behavior:'instant'});
      restoreDrafts(body,drafts);
      pageChanged();
    }
    pageHeading();
    let error=card.querySelector<HTMLElement>('.operation-error');if(!error){error=document.createElement('div');error.className='error operation-error';card.querySelector('.card-heading')!.after(error);}error.textContent=operationError;error.classList.toggle('hidden',!operationError);
  }
  if(!state.settings.subtitles || state.settings.quiet || state.locked || (event && !plugin(event.pluginId)?.enabled)){
    event=null;eventQueue.length=0;clearTimeout(toastTimer);visible(toast,false);
  }
  requestAnimationFrame(regions);requestAnimationFrame(scrollEdges);
}
function scrollEdges(){
  const before=track.scrollLeft>1,after=track.scrollLeft+track.clientWidth<track.scrollWidth-1;
  track.style.maskImage='linear-gradient(to right,'+(before?'transparent,black 12px':'black,black')+','+(after?'black calc(100% - 12px),transparent':'black,black')+')';
}
track.addEventListener('scroll',scrollEdges,{passive:true});

function pageHeading(){
  const page=card.querySelectorAll<HTMLElement>('.feature-page')[pageIndex];if(!page) return;
  card.querySelector('.card-heading strong')!.textContent=page.dataset.title??'';
  card.querySelector('.heading-icon')!.innerHTML=svg(page.dataset.icon??'notifications');
  card.querySelector('#card-mode')!.textContent=(page.dataset.subtitle??'')+' · '+(pinned?'已固定':'悬停预览');
}
function pageChanged(){
  const body=card.querySelector<HTMLElement>('#card-body');if(!body || !selected) return;
  const pages=[...body.querySelectorAll<HTMLElement>('.feature-page')];
  pageIndex=Math.max(0,Math.min(pages.length-1,Math.round(body.scrollLeft/Math.max(1,body.clientWidth))));
  const counter=card.querySelector('#page-counter');if(counter) counter.textContent=(pageIndex+1)+' / '+pages.length;
  pages.forEach((page,i)=>{page.inert=i!==pageIndex;page.setAttribute('aria-hidden',String(i!==pageIndex));});
  card.querySelectorAll<HTMLButtonElement>('[data-page-step]').forEach(button=>{button.disabled=Number(button.dataset.pageStep)<0?pageIndex===0:pageIndex>=pages.length-1;});
  pageHeading();clearTimeout(readTimer);
  const shown=pages[pageIndex],source=plugin(selected),item=source?.pages.find(p=>p.id===shown?.dataset.page && p.readKey===shown?.dataset.readKey);
  if(item?.readKey && item.unread && source){
    const module=selected,epoch=source.epoch,key=item.readKey;
    readTimer=window.setTimeout(()=>{
      if(selected===module && plugin(module)?.epoch===epoch && card.querySelectorAll<HTMLElement>('.feature-page')[pageIndex]?.dataset.page===item.id && !card.classList.contains('hidden') && !card.classList.contains('leaving')){
        viewed.set(token(module,key),{pluginId:module,pageId:item.id,readKey:key});pruneEvents();render();
      }
    },650);
  }
}
function stopPaging(){clearTimeout(readTimer);closeContextMenu();}
function goToPage(index:number){
  const body=card.querySelector<HTMLElement>('#card-body');if(!body)return;
  const count=body.querySelectorAll('.feature-page').length;
  stopPaging();pageIndex=Math.max(0,Math.min(count-1,index));
  body.scrollTo({left:pageIndex*body.clientWidth,top:0,behavior:'instant'});pageChanged();
}
// Wheel input belongs to each page's content. Page changes use buttons/keyboard.
card.addEventListener('keydown',event=>{
  const target=event.target as Element;
  if(target.closest('input,textarea,select,[contenteditable=true],[role=menu]'))return;
  if(!['ArrowLeft','ArrowRight','PageUp','PageDown'].includes(event.key))return;
  event.preventDefault();goToPage(pageIndex+(['ArrowRight','PageDown'].includes(event.key)?1:-1));
});
function closeContextMenu(restoreFocus=false){
  contextMenu?.remove();contextMenu=null;
  if(restoreFocus && contextAnchor?.isConnected)contextAnchor.focus({preventScroll:true});
  contextAnchor=null;
}
function showContextMenu(anchor:HTMLElement,x:number,y:number){
  if(!selected||busy)return;
  closeContextMenu();
  const actions:CommandButton[]=JSON.parse(anchor.dataset.contextActions??'[]');if(!actions.length)return;
  pinned=true;api.pin(true);pageHeading();card.querySelector('[data-pin]')?.setAttribute('aria-pressed','true');contextAnchor=anchor;
  const menu=document.createElement('div');menu.className='plugin-context-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','项目操作');
  menu.innerHTML=actions.map(action=>renderBlock({...action,variant:'text'},plugin(selected)!,busy)).join('');
  menu.querySelectorAll('button').forEach(button=>button.setAttribute('role','menuitem'));
  card.append(menu);contextMenu=menu;
  const box=card.getBoundingClientRect();
  menu.style.left=Math.max(4,Math.min(box.width-menu.offsetWidth-4,x-box.left))+'px';
  menu.style.top=Math.max(4,Math.min(box.height-menu.offsetHeight-4,y-box.top))+'px';
  menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  menu.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeContextMenu(true);return;}
    if(event.key==='Tab'){closeContextMenu(true);return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    const items=[...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const current=items.indexOf(document.activeElement as HTMLButtonElement);
    const index=event.key==='Home'?0:event.key==='End'?items.length-1:(current+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
    items[index]?.focus();
  });
}
card.addEventListener('contextmenu',event=>{
  const anchor=(event.target as Element).closest<HTMLElement>('[data-context-actions]');if(!anchor)return;
  event.preventDefault();showContextMenu(anchor,event.clientX,event.clientY);
});
card.addEventListener('keydown',event=>{
  if(event.key!=='ContextMenu' && !(event.shiftKey&&event.key==='F10'))return;
  const anchor=(event.target as Element).closest<HTMLElement>('[data-context-actions]');if(!anchor)return;
  event.preventDefault();const box=anchor.getBoundingClientRect();showContextMenu(anchor,box.left+box.width/2,box.top+12);
});
document.addEventListener('pointerdown',event=>{
  if(contextMenu && !contextMenu.contains(event.target as Node))closeContextMenu();
},true);
window.addEventListener('blur',()=>closeContextMenu());
async function applySize(width:number,height:number,save=false,edge=''){
  const revision=++resizeRevision;
  try{
    const size=await api.resize(width,height,save,edge);
    if(revision!==resizeRevision) return;
    card.style.width=size.width+'px';card.style.height=size.height+'px';
    const body=card.querySelector<HTMLElement>('#card-body');body?.scrollTo({left:pageIndex*body.clientWidth,top:0,behavior:'instant'});regions();
  }catch{operationError='面板尺寸保存失败';}
}
card.addEventListener('pointerdown',e=>{
  const edge=(e.target as HTMLElement).dataset.resize;if(!edge || e.button!==0) return;
  stopPaging();
  e.preventDefault();pinned=true;api.pin(true);
  const box=card.getBoundingClientRect();
  resizeGesture={edge,x:e.screenX,y:e.screenY,width:box.width,height:box.height};
  (e.target as HTMLElement).setPointerCapture(e.pointerId);card.classList.add('resizing');
});
window.addEventListener('pointermove',e=>{
  const g=resizeGesture;if(!g) return;
  const dx=e.screenX-g.x,dy=e.screenY-g.y;
  const width=Math.max(240,Math.min(560,g.width+(g.edge.includes('e')?dx:g.edge.includes('w')?-dx:0)));
  const height=Math.max(230,Math.min(640,g.height+(g.edge.includes('s')?dy:g.edge.includes('n')?-dy:0)));
  card.style.width=width+'px';card.style.height=height+'px';void applySize(width,height,false,g.edge);
});
function finishResize(cancel=false){
  const g=resizeGesture;if(!g) return;
  const width=cancel?g.width:parseFloat(card.style.width),height=cancel?g.height:parseFloat(card.style.height);
  resizeGesture=null;card.classList.remove('resizing');void applySize(width,height,true,g.edge);
}
window.addEventListener('pointerup',()=>finishResize());
window.addEventListener('pointercancel',()=>finishResize(true));

document.querySelector('#capsule-settings')!.innerHTML=svg('settings');
track.addEventListener('wheel',e=>{
  e.preventDefault();const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;
  track.scrollBy({left:delta*(e.deltaMode===1?32:e.deltaMode===2?track.clientWidth:1),behavior:reduced()?'instant':'smooth'});
},{passive:false});
function preview(target:Element|null){
  const button=target?.closest<HTMLButtonElement>('[data-module]');
  if(!button || pinned) return;clearTimeout(previewTimer);
  const id=button.dataset.module as ModuleId;
  previewTimer=window.setTimeout(()=>{if(!pinned) open(id);},180);
}
track.addEventListener('pointerover',e=>preview(e.target as Element));
track.addEventListener('focusin',e=>preview(e.target as Element));
track.addEventListener('pointerleave',()=>clearTimeout(previewTimer));
async function runCommand(command:string,payload:Record<string,unknown>,formId?:string){
  if(!selected||busy)return;const id=selected,epoch=plugin(id)?.epoch;busy=true;operationError='';render();let result;
  try{result=await api.execute(id,command,payload);if(!result.ok&&selected===id&&plugin(id)?.epoch===epoch)operationError=result.error?.message??'操作失败';}
  catch{if(selected===id)operationError='系统服务暂不可用';}finally{busy=false;render();}
  if(!result?.ok||selected!==id||plugin(id)?.epoch!==epoch)return;
  const data=result.data as {navigateTo?:unknown;resetForm?:unknown}|null;
  if(data?.resetForm&&formId)card.querySelectorAll<HTMLFormElement>('[data-command-form]').forEach(form=>{if(form.dataset.formId===formId)form.reset();});
  if(typeof data?.navigateTo==='string'){
    const body=card.querySelector<HTMLElement>('#card-body')!,pages=[...body.querySelectorAll<HTMLElement>('.feature-page')],index=pages.findIndex(page=>page.dataset.page===data.navigateTo);
    if(index>=0){stopPaging();pageIndex=index;body.scrollTo({left:index*body.clientWidth,top:0,behavior:'instant'});pageChanged();}
  }
}
card.addEventListener('focusin',event=>{if((event.target as Element).closest('[data-command-form]')&&selected&&!pinned){pinned=true;api.pin(true);render();}});
card.addEventListener('submit',event=>{
  const form=(event.target as Element).closest<HTMLFormElement>('[data-command-form]');if(!form)return;event.preventDefault();if(!form.reportValidity())return;
  const payload:Record<string,unknown>=JSON.parse(form.dataset.basePayload??'{}');
  for(const input of form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('[name]')){
    const value=input.value;if(input.dataset.fieldType==='datetime'&&value){const date=new Date(value);if(!Number.isFinite(date.getTime())){operationError='截止时间格式无效';render();return;}payload[input.name]=date.toISOString();}else payload[input.name]=value;
  }
  void runCommand(form.dataset.commandForm!,payload,form.dataset.formId);
});
document.addEventListener('click',async e=>{
  const button=(e.target as Element).closest<HTMLButtonElement>('button');if(!button) return;
  clearTimeout(previewTimer);
  if(button.disabled)return;
  if(button.dataset.pageStep){goToPage(pageIndex+Number(button.dataset.pageStep));return;}
  if(button.dataset.module){const id=button.dataset.module as ModuleId;open(id,!(pinned && selected===id));}
  if(button.hasAttribute('data-pin') && selected){pinned=!pinned;api.pin(pinned);render();}
  if(button.hasAttribute('data-close')) close();
  if(button.hasAttribute('data-settings')){hover=false;unselect();api.settings();}
  if(button.dataset.readPage && button.dataset.readKey && selected){
    viewed.set(token(selected,button.dataset.readKey),{pluginId:selected,pageId:button.dataset.readPage,readKey:button.dataset.readKey});flushRead();render();
  }
  if(button.dataset.command && selected && !busy){
    const command=button.dataset.command,payload=JSON.parse(button.dataset.payload??'{}');closeContextMenu();
    await runCommand(command,payload);
  }

});
toast.addEventListener('click',()=>{if(event){open(event.pluginId,true);if(event.pageId){const p=plugin(event.pluginId),index=p?.pages.findIndex(page=>page.id===event!.pageId)??-1;if(index>=0){pageIndex=index;const body=card.querySelector<HTMLElement>('#card-body');body?.scrollTo({left:index*body.clientWidth,top:0,behavior:'instant'});pageChanged();}}event=null;clearTimeout(toastTimer);visible(toast,false);showNextEvent();}});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){if(contextMenu){e.preventDefault();closeContextMenu(true);return;}finishResize(true);close();}});
const observer=new ResizeObserver(()=>{regions();const body=card.querySelector<HTMLElement>('#card-body');if(body && !resizeGesture) body.scrollTo({left:pageIndex*body.clientWidth,top:0,behavior:'instant'});});
[card,capsule,toast].forEach(element=>observer.observe(element));
api.onState(value=>{
  if(state && state.settings.details!==value.settings.details){
    stopPaging();
    eventQueue.length=0;event=null;clearTimeout(toastTimer);visible(toast,false);
  }
  state=value;pruneEvents();render();
});
api.onHover(value=>{hover=value;if(!value && !pinned){stopPaging();if(selected) flushRead();clearTimeout(readTimer);selected=null;}render();});
api.onClose(()=>{finishResize(true);hover=false;unselect();});
function showNextEvent(){
  event=eventQueue.shift()??null;
  if(!event){visible(toast,false);return;}
  document.querySelector('#toast-text')!.textContent=event.text;visible(toast,true);
  toastTimer=window.setTimeout(()=>{event=null;showNextEvent();},4200);
}
api.onEvent(value=>{
  if(!state?.settings.subtitles || state.settings.quiet || state.locked || !plugin(value.pluginId)?.enabled) return;
  if(event?.id===value.id || eventQueue.some(item=>item.id===value.id)) return;
  if(eventQueue.length>=4) eventQueue.shift();eventQueue.push(value);if(!event) showNextEvent();
});
setInterval(()=>{
  const source=plugin(selected);if(!source) return;
  for(const block of source.pages.flatMap(page=>timelineBlocks(page.blocks))){
    if(block.durationMs===null || block.durationMs<=0 || block.positionMs===null) continue;
    let position=block.positionMs;
    if(block.playing && block.updatedAt) position+=Math.max(0,Date.now()-Date.parse(block.updatedAt));
    position=Math.min(block.durationMs,position);
    card.querySelectorAll<HTMLElement>('[data-timeline]').forEach(el=>{if(el.dataset.timeline===block.id) el.style.setProperty('--progress',position/block.durationMs!*100+'%');});
    card.querySelectorAll<HTMLElement>('[data-position]').forEach(el=>{if(el.dataset.position===block.id) el.textContent=clock(position);});
  }
},1000);
void api.snapshot().then(value=>{state=value;render();});
