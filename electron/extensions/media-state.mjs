export const OWN_MEDIA_IDS=['local.spine.desktop.pet.workshop','SpinePetWorkshop.exe','spine-pet-workshop'];
export function normalizeMediaState(media={}) {
  const sessions=(Array.isArray(media.sessions)?media.sessions:[]).filter(session=>session && typeof session.id==='string' &&
    !OWN_MEDIA_IDS.some(id=>id.toLowerCase()===session.id.toLowerCase()) && !/spine[.\s_-]*(?:desktop[.\s_-]*)?pet[.\s_-]*workshop/i.test(session.id))
    .map(session=>({...session,name:/cloudmusic|netease/i.test(session.id)?'网易云音乐':/qqmusic/i.test(session.id)?'QQ 音乐':session.name||session.id}));
  const currentId=sessions.some(session=>session.id===media.currentId)?media.currentId:
    sessions.find(session=>session.status==='Playing')?.id??sessions[0]?.id;
  return {...media,sessions,currentId,error:media.error??null};
}
export function notificationChannels(notices) {
  const running=new Set((notices.runningApps??[]).map(name=>String(name).toLowerCase()));
  const sources=(notices.items??[]).map(item=>String(item.app)+' '+String(item.appId)).join('\n');
  return [
    {id:'qq',name:'QQ',processes:['qq'],pattern:/(?:^|\s)QQ(?:\s|$)|tencent[.\s_-]*qq(?!music)/i},
    {id:'wecom',name:'企业微信',processes:['wxwork'],pattern:/企业微信|wxwork|wecom/i},
    {id:'wechat',name:'微信',processes:['wechat','weixin'],pattern:/^(?!.*企业微信).*(?:微信|wechat|weixin)/im}
  ].map(({id,name,processes,pattern})=>({id,name,running:processes.some(process=>running.has(process)),observed:pattern.test(sources)}));
}
