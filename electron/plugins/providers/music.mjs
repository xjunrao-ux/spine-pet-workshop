const field={type:'string',maxLength:200};
export const manifest={id:'workshop.music',legacyId:'music',name:'音乐控制',menuLabel:'音乐',version:'1.0.0',apiVersion:1,configVersion:1,icon:'music',entryVisibility:'when-available',
  description:'按播放器分页浏览，用左右箭头切换，支持播放、暂停和切歌。',permissions:['media.read','media.control'],settingsSchema:[],
  compatibilityNotes:['网易云音乐：请在设置中开启 SMTC（系统媒体控制）。当前不支持读取网易云时长与播放进度，时间显示为 --:--。','QQ 音乐：播放进度与控制按播放器实际提供的能力显示。'],
  commands:['play','pause','toggle','next','previous'].map(id=>({id,permissions:['media.control'],fields:{sessionId:field}}))};
const text=(value,extra={})=>({type:'text',text:String(value??''),...extra});
export function activate(context) {
  let media={sessions:[],error:null,currentId:null};const coverSlots=new Set();
  const getSnapshot=()=>({available:media.sessions.length>0,status:media.error?'degraded':media.sessions.length?'ready':'waiting',message:media.error??(media.sessions.length?`已检测到 ${media.sessions.length} 个播放器`:'等待播放器'),preferredPageId:media.currentId,
    pages:media.sessions.map(song=>{
      const c=song.capabilities??{},playing=song.status==='Playing',timeline=!/cloudmusic|netease/i.test(song.id) && !song.fallback && Number.isFinite(song.duration) && song.duration>0;
      const button=(commandId,label,enabled,icon,primary=false)=>({type:'button',commandId,label,enabled:Boolean(enabled),icon,primary,payload:{sessionId:song.id}});
      return {id:song.id,title:song.name||song.id,icon:'music',subtitle:playing?'正在播放':'播放器控制',source:{id:song.id,name:song.name||song.id},blocks:[
        {type:'group',layout:'row',appearance:'album',children:[{type:'image',asset:context.assets.put('cover:'+song.id,song.cover),icon:'music',alt:'专辑封面'},
          {type:'group',layout:'column',appearance:'song-info',children:[text(song.title||'等待曲目信息',{strong:true,ellipsis:true}),text(song.artist||song.name||song.id,{tone:'muted',ellipsis:true}),text(song.album,{tone:'muted',ellipsis:true})]}]},
        {type:'group',layout:'row',appearance:'controls',children:[button('previous','上一首',c.previous,'previous'),button('toggle',playing?'暂停':'播放或暂停',song.fallback?(c.play||c.pause):(playing?c.pause:c.play),playing?'pause':'play',true),button('next','下一首',c.next,'next')]},
        {type:'timeline',id:song.id,positionMs:timeline?Math.max(0,Number(song.position)||0)*1000:null,durationMs:timeline?song.duration*1000:null,playing,updatedAt:song.timelineUpdatedAt??null},
        ...(song.fallback?[text(song.fallbackReason==='other-player-active'?'其他播放器活动中，兼容按键暂不可用':'兼容控制 · 曲目与封面暂不可读取',{tone:'muted'})]:[])
      ]};
    })});
  context.capabilities.media.subscribe(state=>{
    media=state;const next=new Set(state.sessions.map(song=>'cover:'+song.id));for(const slot of coverSlots) if(!next.has(slot)) context.assets.remove(slot);coverSlots.clear();for(const slot of next) coverSlots.add(slot);context.publish(getSnapshot());
  });
  return {getSnapshot,execute:async(action,{sessionId},{signal})=>{const accepted=await context.capabilities.media.control(action,sessionId,signal);if(!accepted) throw new Error('Player rejected command');return accepted;},dispose(){media={sessions:[],error:null};}};
}
