import './extensions.css';
import { featureIcon } from './features/icons';
import type { FeatureBridge, FeatureSnapshot, ModuleId, FeatureEvent, LimitWindow, MediaSession } from './features/types';

const api: FeatureBridge=window.petFeatures!;
const card=document.querySelector<HTMLElement>('#feature-card')!;
const capsule=document.querySelector<HTMLElement>('#capsule')!;
const track=document.querySelector<HTMLElement>('#capsule-track')!;
const toast=document.querySelector<HTMLButtonElement>('#event-toast')!;
let state: FeatureSnapshot, selected: ModuleId|null=null, hover=false, pinned=false;
let event: FeatureEvent|null=null, toastTimer=0, previewTimer=0, readTimer=0, busy=false, operationError='', trackSignature='', cardModule: ModuleId|null=null;
let renderedBody='', pageIndex=0, wheelActive=false, wheelTarget=0, wheelFrame=0, snapTimer=0, pendingRender=false;
let resizeGesture: {edge:string;x:number;y:number;width:number;height:number}|null=null, resizeRevision=0;
const viewed=new Map<string,string>(), eventQueue: FeatureEvent[]=[];
const hideTimers=new Map<HTMLElement,number>();
const icons: Record<string,string>={
  music:'<path d="M9 18V5l12-2v13M9 8l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="m10 2-1 3-3 1-3-1-2 3 2 2v4l-2 2 2 3 3-1 3 1 1 3h4l1-3 3-1 3 1 2-3-2-2v-4l2-2-2-3-3 1-3-1-1-3z"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',pin:'<path d="m9 3 6 0-1 7 4 4H6l4-4-1-7M12 14v7"/>',
  play:'<path d="m8 4 12 8-12 8z"/>',pause:'<path d="M8 4v16M16 4v16"/>',
  previous:'<path d="M5 4v16m14-16L7 12l12 8z"/>',next:'<path d="M19 4v16M5 4l12 8-12 8z"/>'
};
const svg=(name:string)=>name==='notifications'||name==='codex'?featureIcon(name):'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[name]+'</svg>';
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const names={music:'音乐',notifications:'通知',codex:'Codex'};
const reduced=()=>state?.settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
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
function available():ModuleId[]{
  return [state.settings.music && state.media.sessions.length?'music':null,
    state.settings.notifications?'notifications':null,
    state.settings.codex && state.codex.running?'codex':null].filter(Boolean) as ModuleId[];
}
function pruneEvents(){
  const unread=new Map(state.notifications.items.map(x=>[x.id,x.createdAt]));
  const keep=(item:FeatureEvent)=>!item.noticeIds || item.noticeIds.some(id=>unread.has(id) && viewed.get(id)!==unread.get(id));
  for(let i=eventQueue.length-1;i>=0;i--) if(!keep(eventQueue[i])) eventQueue.splice(i,1);
  if(event && !keep(event)){event=null;clearTimeout(toastTimer);showNextEvent();}
}
function flushRead(){
  clearTimeout(readTimer);
  const read=[...viewed].filter(([id,date])=>state?.notifications.items.some(x=>x.id===id && x.createdAt===date));
  if(!read.length){viewed.clear();return;}
  const ids=new Set(read.map(([id])=>id));
  // Remove only our reminders; no Windows / chat read or delete operations.
  state={...state,notifications:{...state.notifications,items:state.notifications.items.filter(x=>!ids.has(x.id))}};
  viewed.clear();pruneEvents();for(const id of ids) api.dismiss(id);
}
function unselect(){stopPaging();clearTimeout(previewTimer);if(selected==='notifications') flushRead();selected=null;pinned=false;api.pin(false);render();}
function close(){hover=false;unselect();api.close();}
function open(id:ModuleId,fixed=false){
  if(!state || !available().includes(id)) return;
  if(selected!==id){
    if(selected==='notifications') flushRead();
    stopPaging();operationError='';renderedBody='';pageIndex=0;clearTimeout(readTimer);
  }
  selected=id;pinned=fixed;api.pin(fixed);render();
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
  const signature=entries.join(',');
  if(signature!==trackSignature){
    trackSignature=signature;const offset=track.scrollLeft;
    track.innerHTML=entries.map(id=>'<button class="entry" data-module="'+id+'" aria-label="'+names[id]+'">'+svg(id)+(id==='notifications'?'<span class="badge hidden"></span>':'')+'</button>').join('');
    track.scrollLeft=offset;
  }
  track.querySelectorAll<HTMLButtonElement>('[data-module]').forEach(button=>{
    button.classList.toggle('active',button.dataset.module===selected);
    button.setAttribute('aria-pressed',String(pinned && button.dataset.module===selected));
    if(button.dataset.module==='notifications'){
      const unread=state.notifications.items.some(item=>viewed.get(item.id)!==item.createdAt);
      button.querySelector('.badge')?.classList.toggle('hidden',!unread);
      button.title=unread?'通知 · 有新消息':'通知 · 暂无新消息';
    }
  });
  capsule.classList.toggle('no-features',!entries.length);
  visible(capsule,hover || Boolean(selected));visible(card,Boolean(selected));
  if(selected){
    if(cardModule!==selected){
      cardModule=selected;renderedBody='';
      card.innerHTML='<header class="card-heading"><div class="heading-label"><span class="heading-icon">'+svg(selected)+'</span><div><strong>'+names[selected]+'</strong><small id="card-mode"></small></div></div><div class="heading-actions"><button class="icon-button" data-pin aria-label="固定卡片">'+svg('pin')+'</button><button class="icon-button" data-close aria-label="关闭卡片">'+svg('close')+'</button></div></header><div id="card-body" class="card-body"></div><footer class="pager-hint"><span>滚动浏览 · 停下吸附</span><span id="page-counter"></span></footer>'+
        ['n','s','e','w','ne','nw','se','sw'].map(edge=>'<div class="resize-edge edge-'+edge+'" data-resize="'+edge+'" title="拖动边缘调整面板大小"></div>').join('');
      card.querySelector('#card-body')!.addEventListener('scroll',pageChanged,{passive:true});
    }
    card.querySelector('#card-mode')!.textContent=pinned?'已固定':'悬停预览 · 点击固定';
    card.querySelector('[data-pin]')!.setAttribute('aria-pressed',String(pinned));
    const body=card.querySelector<HTMLElement>('#card-body')!;
    const html=selected==='music'?renderMusic():selected==='notifications'?renderNotices():renderCodex();
    if(renderedBody!==html && wheelActive) pendingRender=true;
    if(renderedBody!==html && !resizeGesture && !wheelActive){
      const pages=[...body.querySelectorAll<HTMLElement>('.feature-page')];
      const oldKey=renderedBody?pages[pageIndex]?.dataset.page:undefined;
      const offsets=new Map(pages.map(p=>[p.dataset.page,p.querySelector('.page-content')?.scrollTop??0]));
      body.innerHTML=html;renderedBody=html;
      const next=[...body.querySelectorAll<HTMLElement>('.feature-page')];
      const key=oldKey??(selected==='music'?state.media.currentId:undefined);
      const found=next.findIndex(p=>p.dataset.page===key);
      pageIndex=found>=0?found:Math.min(pageIndex,Math.max(0,next.length-1));
      next.forEach(p=>{p.querySelector('.page-content')!.scrollTop=offsets.get(p.dataset.page)??0;});
      body.scrollTo({top:pageIndex*body.clientHeight,behavior:'instant'});
      pageChanged();
    }
    pageHeading();
  }
  if(!state.settings.subtitles || state.settings.quiet || state.locked || (event && !state.settings[event.module])){
    event=null;eventQueue.length=0;clearTimeout(toastTimer);visible(toast,false);
  }
  requestAnimationFrame(regions);requestAnimationFrame(scrollEdges);
}
function scrollEdges(){
  const before=track.scrollLeft>1,after=track.scrollLeft+track.clientWidth<track.scrollWidth-1;
  track.style.maskImage='linear-gradient(to right,'+(before?'transparent,black 12px':'black,black')+','+(after?'black calc(100% - 12px),transparent':'black,black')+')';
}
track.addEventListener('scroll',scrollEdges,{passive:true});
function page(title:string,key:string,contents:string,icon:string,subtitle='',noticeId=''){
  return '<section class="feature-page" data-page="'+esc(key)+'" data-title="'+esc(title)+'" data-subtitle="'+esc(subtitle)+'" data-icon="'+esc(icon)+'"'+(noticeId?' data-notice="'+esc(noticeId)+'"':'')+'><div class="page-content" tabindex="0">'+contents+'</div></section>';
}
function timeline(song:MediaSession){return !/cloudmusic|netease/i.test(song.id) && !song.fallback && song.duration>0;}
function renderMusic(){
  return state.media.sessions.map(song=>{
    const cover=song.cover?.match(/^data:image\/(png|jpeg|webp|bmp);base64,/)?'<img class="cover" src="'+esc(song.cover)+'" alt="专辑封面" />':'<div class="cover">'+svg('music')+'</div>';
    const c=song.capabilities,canToggle=song.fallback?(c.play||c.pause):(song.status==='Playing'?c.pause:c.play);
    const button=(action:string,label:string,enabled:boolean,icon:string,cls='')=>'<button class="icon-button '+cls+'" data-media="'+action+'" data-session="'+esc(song.id)+'" '+(!enabled||busy?'disabled':'')+' aria-label="'+label+'">'+svg(icon)+'</button>';
    return page(song.name||song.id,song.id,
      '<div class="album">'+cover+'<div class="song-info"><div class="song-title" title="'+esc(song.title)+'">'+esc(song.title||'等待曲目信息')+'</div><div class="muted">'+esc(song.artist||song.name||song.id)+'</div><div class="muted album-title">'+esc(song.album)+'</div></div></div>'+
      '<div class="player-controls">'+button('previous','上一首',c.previous,'previous')+button('toggle',song.status==='Playing'?'暂停':'播放或暂停',canToggle,song.status==='Playing'?'pause':'play','play-button')+button('next','下一首',c.next,'next')+'</div>'+
      '<div class="progress '+(!timeline(song)?'unknown-progress':'')+'" data-progress="'+esc(song.id)+'" style="--progress:'+(timeline(song)?Math.max(0,Math.min(100,song.position/song.duration*100)):0)+'%"><span></span></div><div class="timeline-labels"><span data-position="'+esc(song.id)+'">'+(timeline(song)?time(song.position):'--:--')+'</span><span>'+(timeline(song)?time(song.duration):'--:--')+'</span></div>'+
      (song.fallback?'<p class="compatibility-note">'+(song.fallbackReason==='other-player-active'?'其他播放器活动中，兼容按键暂不可用':'兼容控制 · 曲目与封面暂不可读取')+'</p>':'')+
      (operationError?'<p class="error">'+esc(operationError)+'</p>':''),'music',song.status==='Playing'?'正在播放':'播放器控制');
  }).join('');
}
function time(seconds:number){const n=Math.max(0,Math.floor(seconds||0));return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');}
function renderNotices(){
  if(!state.notifications.items.length){
    const hint=state.notifications.error || (state.notifications.permission==='Allowed'?'收到新消息时会在这里提醒':'请在角色管理器“功能”页授权通知访问');
    return page('通知','empty','<div class="empty-notices">'+svg('notifications')+'<p>暂无新通知</p><small class="muted">'+esc(hint)+'</small></div>','notifications','已启用');
  }
  return state.notifications.items.map(item=>page(item.app,item.id,
    '<article class="notice"><div class="notice-top"><strong>'+esc(state.settings.details?(item.title||'收到一条新消息'):'有一条新消息')+'</strong><button class="icon-button" data-dismiss="'+esc(item.id)+'" aria-label="标记桌宠提醒已查看">'+svg('close')+'</button></div>'+
    (state.settings.details&&item.body?'<p class="notice-body">'+esc(item.body)+'</p>':'<p class="muted">隐私模式 · 不展示消息正文</p>')+'</article>',
    /chatgpt|openai/i.test(item.app+' '+item.appId)?'codex':'notifications',
    new Date(item.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})+' · '+(state.settings.details?'显示模式':'隐私模式'),item.id)).join('');
}
function renderQuota(label:string,value:LimitWindow|null|undefined){
  return '<div class="quota"><div class="quota-heading"><span>'+label+'</span><b>'+(value?value.remaining+'<small>% 剩余</small>':'未知')+'</b></div><div class="progress" style="--progress:'+(value?.remaining??0)+'%"><span></span></div><span class="muted">'+
    (value?.resetsAt?new Date(value.resetsAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})+' 重置 · '+until(value.resetsAt):'等待额度数据')+'</span></div>';
}
function until(date:string){const m=Math.max(0,Math.ceil((Date.parse(date)-Date.now())/60000));return m>=1440?Math.floor(m/1440)+' 天后':m>=60?Math.floor(m/60)+' 小时 '+m%60+' 分后':m+' 分钟后';}
function renderCodex(){
  const c=state.codex,status:Record<string,string>={active:'执行中',idle:'空闲',notLoaded:'未加载',completed:'已完成',failed:'失败',interrupted:'已中断',inProgress:'执行中',systemError:'异常'};
  return page('剩余额度','limits',renderQuota(c.primary?.minutes===300?'5 小时额度':'主额度窗口',c.primary)+renderQuota(c.secondary?.minutes===10080?'周额度':'次额度窗口',c.secondary),'codex',c.connected?(c.allowed===false?'当前额度不可用':'已连接 · 只读'): '正在连接')+
    page('最近消息','tasks',(c.tasks.map(task=>'<div class="task"><span title="'+esc(task.name)+'">'+esc(task.name)+'</span><span class="status-pill">'+(status[task.status==='active'?'active':task.turnStatus??task.status]??'未知')+'</span></div>').join('')||'<p class="muted">等待可读取的任务状态</p>')+
      (c.error?'<p class="error">'+esc(c.error)+'</p>':'')+(c.taskError?'<p class="muted">'+esc(c.taskError)+'</p>':''),'codex',c.updatedAt?'更新于 '+new Date(c.updatedAt).toLocaleTimeString('zh-CN'):'任务状态');
}
function pageHeading(){
  const page=card.querySelectorAll<HTMLElement>('.feature-page')[pageIndex];if(!page) return;
  card.querySelector('.card-heading strong')!.textContent=page.dataset.title??'';
  card.querySelector('.heading-icon')!.innerHTML=svg(page.dataset.icon??'notifications');
  card.querySelector('#card-mode')!.textContent=(selected==='codex'?'Codex · ':'')+(page.dataset.subtitle??'')+' · '+(pinned?'已固定':'悬停预览');
}
function pageChanged(){
  const body=card.querySelector<HTMLElement>('#card-body');if(!body || !selected) return;
  const pages=[...body.querySelectorAll<HTMLElement>('.feature-page')];
  pageIndex=Math.max(0,Math.min(pages.length-1,Math.round(body.scrollTop/Math.max(1,body.clientHeight))));
  const counter=card.querySelector('#page-counter');if(counter) counter.textContent=(pageIndex+1)+' / '+pages.length;
  pageHeading();
  clearTimeout(readTimer);
  const id=pages[pageIndex]?.dataset.notice, item=state.notifications.items.find(x=>x.id===id);
  if(selected==='notifications' && item && !wheelActive){
    const module=selected;
    readTimer=window.setTimeout(()=>{
      if(selected===module && !card.classList.contains('hidden') && !card.classList.contains('leaving')) {viewed.set(item.id,item.createdAt);pruneEvents();render();}
    },650);
  }
}
function stopPaging(){
  clearTimeout(snapTimer);cancelAnimationFrame(wheelFrame);wheelFrame=0;wheelActive=false;pendingRender=false;
  card.querySelector('#card-body')?.classList.remove('scrolling');
}
function animatePaging(body:HTMLElement, settling=false){
  cancelAnimationFrame(wheelFrame);
  let last=performance.now();
  const tick=(now:number)=>{
    const gap=wheelTarget-body.scrollTop;
    const amount=reduced()?1:1-Math.exp(-Math.min(40,now-last)/65);last=now;
    if(Math.abs(gap)<=.8 || reduced()){
      body.scrollTop=wheelTarget;wheelFrame=0;
      if(settling){
        wheelActive=false;body.classList.remove('scrolling');pageChanged();
        if(pendingRender){pendingRender=false;render();}
      }
      return;
    }
    // Some Windows scale factors round scrollTop to whole pixels.
    body.scrollTop+=Math.sign(gap)*Math.min(Math.abs(gap),Math.max(1,Math.abs(gap*amount)));
    wheelFrame=requestAnimationFrame(tick);
  };
  wheelFrame=requestAnimationFrame(tick);
}
card.addEventListener('wheel',e=>{
  const body=card.querySelector<HTMLElement>('#card-body');if(!body || resizeGesture || !(e.target as Element).closest('#card-body')) return;
  e.preventDefault();
  const pages=[...body.querySelectorAll<HTMLElement>('.feature-page')], current=pages[pageIndex];
  const content=current?.querySelector<HTMLElement>('.page-content');if(!content) return;
  let delta=e.deltaY*(e.deltaMode===1?24:e.deltaMode===2?body.clientHeight:1);
  if(!delta) return;
  const max=Math.max(0,content.scrollHeight-content.clientHeight);
  // A long message scrolls first. Only its unused delta flows into page scrolling.
  if(!wheelActive && Math.abs(body.scrollTop-pageIndex*body.clientHeight)<2){
    const before=content.scrollTop;
    content.scrollTop=Math.max(0,Math.min(max,before+delta));
    delta-=content.scrollTop-before;
    if(Math.abs(delta)<1) return;
  }
  if(!wheelActive) wheelTarget=body.scrollTop;
  wheelActive=true;body.classList.add('scrolling');clearTimeout(snapTimer);clearTimeout(readTimer);
  wheelTarget=Math.max(0,Math.min(Math.max(0,(pages.length-1)*body.clientHeight),wheelTarget+delta));
  animatePaging(body);
  snapTimer=window.setTimeout(()=>{
    // All wheel input participates, including rapid notches and trackpad deltas.
    wheelTarget=Math.round(wheelTarget/Math.max(1,body.clientHeight))*body.clientHeight;
    animatePaging(body,true);
  },160);
},{passive:false});
card.addEventListener('keydown',e=>{
  if(!['PageDown','PageUp'].includes(e.key)) return;
  stopPaging();
  e.preventDefault();const body=card.querySelector<HTMLElement>('#card-body')!;
  const count=body.querySelectorAll('.feature-page').length;
  const next=Math.max(0,Math.min(count-1,pageIndex+(e.key==='PageDown'?1:-1)));
  body.scrollTo({top:next*body.clientHeight,behavior:reduced()?'instant':'smooth'});
});
async function applySize(width:number,height:number,save=false,edge=''){
  const revision=++resizeRevision;
  try{
    const size=await api.resize(width,height,save,edge);
    if(revision!==resizeRevision) return;
    card.style.width=size.width+'px';card.style.height=size.height+'px';
    const body=card.querySelector<HTMLElement>('#card-body');body?.scrollTo({top:pageIndex*body.clientHeight,behavior:'instant'});regions();
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
document.addEventListener('click',async e=>{
  const button=(e.target as Element).closest<HTMLButtonElement>('button');if(!button) return;
  clearTimeout(previewTimer);
  if(button.dataset.module){const id=button.dataset.module as ModuleId;open(id,!(pinned && selected===id));}
  if(button.hasAttribute('data-pin') && selected){pinned=!pinned;api.pin(pinned);render();}
  if(button.hasAttribute('data-close')) close();
  if(button.hasAttribute('data-settings')){hover=false;unselect();api.settings();}
  if(button.dataset.dismiss){
    const item=state.notifications.items.find(x=>x.id===button.dataset.dismiss);
    if(item){viewed.set(item.id,item.createdAt);flushRead();render();}
  }
  if(button.dataset.media && !busy){
    const song=state.media.sessions.find(x=>x.id===button.dataset.session);if(!song) return;
    busy=true;operationError='';render();
    try{const result=await api.media(button.dataset.media,song.id);if(!result.ok) operationError=result.error??'播放器未接受操作';}
    catch{operationError='系统服务暂不可用';}
    finally{busy=false;render();}
  }
});
toast.addEventListener('click',()=>{if(event){open(event.module,true);event=null;clearTimeout(toastTimer);visible(toast,false);showNextEvent();}});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){finishResize(true);close();}});
const observer=new ResizeObserver(()=>{regions();const body=card.querySelector<HTMLElement>('#card-body');if(body && !resizeGesture && !wheelActive) body.scrollTo({top:pageIndex*body.clientHeight,behavior:'instant'});});
[card,capsule,toast].forEach(element=>observer.observe(element));
api.onState(value=>{
  if(state && state.settings.details!==value.settings.details){
    stopPaging();
    for(let i=eventQueue.length-1;i>=0;i--) if(eventQueue[i].module==='notifications') eventQueue.splice(i,1);
    if(event?.module==='notifications'){event=null;clearTimeout(toastTimer);visible(toast,false);}
  }
  state=value;pruneEvents();render();
});
api.onHover(value=>{hover=value;if(!value && !pinned){stopPaging();if(selected==='notifications') flushRead();clearTimeout(readTimer);selected=null;}render();});
api.onClose(()=>{finishResize(true);hover=false;unselect();});
function showNextEvent(){
  event=eventQueue.shift()??null;
  if(!event){visible(toast,false);return;}
  document.querySelector('#toast-text')!.textContent=event.text;visible(toast,true);
  toastTimer=window.setTimeout(()=>{event=null;showNextEvent();},4200);
}
api.onEvent(value=>{
  if(!state?.settings.subtitles || state.settings.quiet || state.locked || !state.settings[value.module]) return;
  if(event?.id===value.id || eventQueue.some(item=>item.id===value.id)) return;
  if(eventQueue.length>=4) eventQueue.shift();eventQueue.push(value);if(!event) showNextEvent();
});
setInterval(()=>{
  if(selected!=='music') return;
  for(const song of state.media.sessions){
    if(!timeline(song)) continue;
    let position=song.position;
    if(song.status==='Playing' && song.timelineUpdatedAt) position+=Math.max(0,(Date.now()-Date.parse(song.timelineUpdatedAt))/1000);
    position=Math.min(song.duration,position);
    card.querySelectorAll<HTMLElement>('[data-progress]').forEach(el=>{if(el.dataset.progress===song.id) el.style.setProperty('--progress',position/song.duration*100+'%');});
    card.querySelectorAll<HTMLElement>('[data-position]').forEach(el=>{if(el.dataset.position===song.id) el.textContent=time(position);});
  }
},1000);
void api.snapshot().then(value=>{state=value;render();});
