const finite = (v,min,max) => v === null || (Number.isFinite(v) && v >= min && v <= max);
const string = (v,max=100) => typeof v === 'string' && v.length <= max;
const date = v => string(v,50) && Number.isFinite(Date.parse(v));
function validLocation(v) {
  return v && string(v.id) && string(v.name) && v.name.trim() && string(v.region) && string(v.country) && v.latitude !== null && v.longitude !== null && finite(v.latitude,-90,90) && finite(v.longitude,-180,180);
}
function validWeather(v) {
  if (!v || v.schemaVersion !== 1 || v.source !== 'Open-Meteo' || !date(v.fetchedAt) || !string(v.timezone)) return false;
  try { new Intl.DateTimeFormat('en',{timeZone:v.timezone}).format(); } catch { return false; }
  const c=v.current;
  if (!c || !date(c.time) || !finite(c.temperature,-100,70) || !finite(c.feelsLike,-120,90) || !finite(c.humidity,0,100) || !finite(c.wind,0,500) || !finite(c.code,0,99) || !finite(c.isDay,0,1)) return false;
  return Array.isArray(v.hourly) && v.hourly.length > 0 && v.hourly.length <= 24 && v.hourly.every(h => h && date(h.time) && finite(h.temperature,-100,70) && finite(h.rainProbability,0,100) && finite(h.code,0,99)) &&
    Array.isArray(v.daily) && v.daily.length > 0 && v.daily.length <= 7 && v.daily.every(d => d && date(d.time) && finite(d.high,-100,70) && finite(d.low,-100,70) && finite(d.rainProbability,0,100) && finite(d.wind,0,500) && finite(d.code,0,99));
}
const conditions = {0:'晴',1:'晴间多云',2:'多云',3:'阴',45:'雾',48:'冻雾',51:'小毛毛雨',53:'毛毛雨',55:'强毛毛雨',56:'冻毛毛雨',57:'强冻毛毛雨',61:'小雨',63:'中雨',65:'大雨',66:'冻雨',67:'强冻雨',71:'小雪',73:'中雪',75:'大雪',77:'雪粒',80:'小阵雨',81:'阵雨',82:'强阵雨',85:'阵雪',86:'强阵雪',95:'雷雨',96:'雷雨伴冰雹',99:'强雷雨伴冰雹'};
const condition = code => conditions[code] ?? '天气未知';
const txt = (text,tone='normal',strong=false) => ({type:'text',text,tone,strong});
const status = (title,description) => ({type:'status',icon:'cloud',title,description});
const button = (commandId,label,payload={},enabled=true) => ({type:'button',commandId,label,payload,icon:'play',variant:'text',enabled});

export async function activate(context) {
  if (!context.weather?.search || !context.weather?.forecast) throw new Error('Host weather.read capability required');
  const stored=await context.storage.get('state');
  if (stored !== null && (!stored || stored.schemaVersion !== 1 || !Number.isSafeInteger(stored.sequence) || stored.sequence < 0 || (stored.location !== null && !validLocation(stored.location)) || (stored.weather !== null && (!stored.location || !validWeather(stored.weather))))) throw new Error('Unsupported or damaged weather data; original data retained');
  let state=stored ?? {schemaVersion:1,location:null,weather:null,sequence:0};
  let closed=false, queue=Promise.resolve(), generation=0, timer, pendingTimer, fetching=null, searching=false, candidates=[], searched=false, searchName='', searchError='', weatherError='', lastAttempt=0;
  const live=()=>!closed && !context.signal.aborted;
  const check=()=>{if(!live()) throw new Error('Weather plugin stopped');};
  const serialize=fn=>{const result=queue.then(()=>{check();return fn();});queue=result.catch(()=>{});return result;};
  const publish=()=>{if(live()) context.publish(getSnapshot());};
  async function save(next) {check();await context.storage.set('state',next);check();state=next;}
  const config=()=>context.getConfig();
  const interval=()=>Math.max(15,Math.min(180,Number(config().refreshMinutes)||30))*60000;
  const temperature=v=>v === null ? '未知' : (config().unit === '℉' ? (v*9/5+32).toFixed(1)+' ℉' : v.toFixed(1)+' ℃');
  const value=(v,unit)=>v === null ? '未知' : v+unit;
  const format=(time,options)=>new Intl.DateTimeFormat('zh-CN',{...options,timeZone:state.weather?.timezone ?? 'UTC',hour12:false}).format(new Date(time));
  const stale=()=>state.weather && Date.now()-Date.parse(state.weather.fetchedAt) > interval();

  function getSnapshot() {
    const w=state.weather, c=w?.current, loc=state.location;
    const loading=fetching !== null, expired=Boolean(stale()), notice=weatherError || (expired ? '缓存已过期，请刷新后再参考。' : '');
    const currentBlocks=[txt(loc ? [...new Set([loc.name,loc.region,loc.country].filter(Boolean))].join(' · ') : '先选择要查看的城市','normal')];
    if(c) currentBlocks.push(txt(temperature(c.temperature)+' · '+condition(c.code),'normal',true),txt('体感 '+temperature(c.feelsLike)+'　湿度 '+value(c.humidity,'%')),txt('风速 '+value(c.wind,' km/h')+'　'+(c.isDay === null ? '昼夜未知' : c.isDay ? '白天' : '夜间')),{type:'time',label:'天气数据时间',value:c.time},{type:'time',label:'获取时间',value:w.fetchedAt});
    else currentBlocks.push(status(loc ? '等待天气数据' : '尚未设置城市',loc ? '点击刷新查询天气；离线时可稍后重试。' : '用右下角箭头打开“城市设置”，搜索城市或输入经纬度。'));
    if(notice) currentBlocks.push(txt(notice,'error'));
    if(loading) currentBlocks.push(txt('正在查询天气…','muted'));
    currentBlocks.push(button('refresh',loading ? '查询中…' : '刷新天气',{},Boolean(loc)&&!loading),txt('Open-Meteo · 当前天气为模型估算；预报随模型更新。','muted'));
    const empty=()=>[status('暂无预报',loc ? '成功获取天气后显示预报。' : '请先在城市设置页选择城市。')];
    const dailyBlocks=w ? [{type:'list',items:w.daily.map(d=>({label:format(d.time,{month:'2-digit',day:'2-digit',weekday:'short'})+' · '+condition(d.code),status:temperature(d.low)+' ~ '+temperature(d.high)}))},{type:'list',items:w.daily.map(d=>({label:format(d.time,{month:'2-digit',day:'2-digit'})+' 降水概率 '+value(d.rainProbability,'%'),status:'最大风速 '+value(d.wind,' km/h')}))}] : empty();
    const hourlyBlocks=w ? [{type:'list',items:w.hourly.map(h=>({label:format(h.time,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})+' '+condition(h.code),status:temperature(h.temperature)+' · 降水 '+value(h.rainProbability,'%')}))}] : empty();
    if(notice) {dailyBlocks.unshift(txt(notice,'error'));hourlyBlocks.unshift(txt(notice,'error'));}
    const setupBlocks=[{type:'form',id:'city-search',commandId:'searchCity',payload:{},submitLabel:'搜索城市',enabled:!searching,fields:[{key:'name',type:'text',label:'城市名（至少 2 个字符；也可用拼音/英文）',required:true,maxLength:100,value:searchName}]}];
    if(searching) setupBlocks.push(txt('正在搜索城市…','muted'));
    if(searchError) setupBlocks.push(txt(searchError,'error'));
    if(searched && !searching && !searchError && !candidates.length) setupBlocks.push(status('没有找到城市','试试拼音/英文，或在下方输入经纬度。'));
    for(const item of candidates) setupBlocks.push(txt([item.name,item.region,item.country].filter(Boolean).join(' · ')),button('selectCity','选择 '+item.name,{id:item.id}));
    setupBlocks.push(txt('坐标方式：输入 WGS84 经纬度；无需设备定位权限。','muted'),{type:'form',id:'coordinates-'+state.sequence,commandId:'setCoordinates',payload:{},submitLabel:'保存地点并查询',fields:[
      {key:'name',type:'text',label:'地点名称',required:true,maxLength:100,value:loc?.name ?? ''},
      {key:'latitude',type:'text',label:'纬度（-90 至 90）',required:true,maxLength:30,value:loc ? String(loc.latitude) : ''},
      {key:'longitude',type:'text',label:'经度（-180 至 180）',required:true,maxLength:30,value:loc ? String(loc.longitude) : ''}
    ]},txt('查询将把输入的城市或坐标发送给 Open-Meteo。免费服务用于非商业用途；城市资料来自 GeoNames。','muted'));
    return {available:true,status:weatherError || expired ? 'degraded' : w ? 'ready' : 'waiting',message:weatherError || (loc ? loc.name+(loading ? ' · 查询中' : expired ? ' · 缓存过期' : ' · 天气') : '请选择城市'),...(w ? {updatedAt:w.fetchedAt} : {}),preferredPageId:loc ? 'current' : 'location',pages:[
      {id:'current',title:'当前天气',icon:'cloud',subtitle:loc?.name ?? '等待设置',blocks:currentBlocks},
      {id:'hourly',title:'未来 24 小时',icon:'cloud',subtitle:loc?.name ?? '等待设置',blocks:hourlyBlocks},
      {id:'daily',title:'7 天天气预报',icon:'cloud',subtitle:loc?.name ?? '等待设置',blocks:dailyBlocks},
      {id:'location',title:'城市设置',icon:'edit',blocks:setupBlocks}
    ]};
  }
  function requestRefresh() {
    if(!live() || !state.location || fetching === generation) return;
    clearTimeout(pendingTimer); pendingTimer=setTimeout(()=>{pendingTimer=null;void refresh();},0);
  }
  async function refresh() {
    if(!live() || !state.location || fetching === generation) return;
    const token=generation, location=structuredClone(state.location); fetching=token;lastAttempt=Date.now();weatherError='';publish();
    try {
      const weather=await context.weather.forecast({latitude:location.latitude,longitude:location.longitude});
      if(!validWeather(weather)) throw new Error('Invalid forecast');
      await serialize(async()=>{if(token !== generation) return;await save({...state,weather});weatherError='';});
    } catch {
      if(live() && token === generation) weatherError=state.weather ? '天气更新失败，正在显示已保存的缓存。检查网络后重试。' : '天气查询失败。请检查网络和天气权限，稍后点击刷新。';
    } finally {if(token === fetching) fetching=null;if(live()) publish();}
  }
  async function choose(location) {
    if(!validLocation(location)) throw new Error('Invalid location');
    if(!Number.isSafeInteger(state.sequence+1)) throw new Error('Weather state sequence exhausted');
    await save({schemaVersion:1,sequence:state.sequence+1,location,weather:null});
    ++generation;fetching=null;weatherError='';lastAttempt=0;publish();requestRefresh();return {navigateTo:'current'};
  }
  function close() {if(closed) return;closed=true;++generation;clearInterval(timer);clearTimeout(pendingTimer);}
  context.onCleanup(close);
  timer=setInterval(()=>{if(!live()) return;publish();if(config().autoRefresh && state.location && Date.now()-lastAttempt >= interval() && (!state.weather || stale())) requestRefresh();},60000);
  if(config().autoRefresh && state.location && (!state.weather || stale())) requestRefresh();
  return {getSnapshot,
    execute(commandId,payload={}) {
      // Network work is scheduled separately so command/activation deadlines remain short.
      return serialize(async()=>{
        if(commandId === 'searchCity') {
          if(typeof payload.name !== 'string' || payload.name.trim().length < 2 || payload.name.length > 100) throw new Error('请输入至少 2 个字符的城市名称');
          if(searching) return {};
          searching=true;searched=false;candidates=[];searchError='';searchName=payload.name.trim();publish();
          void context.weather.search({name:searchName}).then(items=>{
            if(!live()) return;if(!Array.isArray(items) || items.length > 5 || !items.every(validLocation)) throw new Error('Invalid cities');candidates=items;
          }).catch(()=>{if(live()) searchError='城市搜索失败，请检查网络或改用经纬度。';}).finally(()=>{if(live()){searching=false;searched=true;publish();}});
          return {navigateTo:'location'};
        }
        if(commandId === 'selectCity') {const item=candidates.find(c=>c.id === payload.id);if(!item) throw new Error('重新搜索后选择城市');return choose(item);}
        if(commandId === 'setCoordinates') {
          if(typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 100 || ![payload.latitude,payload.longitude].every(v=>typeof v === 'string' && /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v.trim()) && v.length <= 30)) throw new Error('无效地点或坐标');
          return choose({id:'coordinates',name:payload.name.trim(),region:'',country:'',latitude:Number(payload.latitude),longitude:Number(payload.longitude)});
        }
        if(commandId === 'refresh') {if(!state.location) throw new Error('请先选择城市');if(Date.now()-lastAttempt >= 2000) requestRefresh();return {navigateTo:'current'};}
        throw new Error('Unknown weather command');
      });
    },
    onSettingsChanged(){publish();if(config().autoRefresh && state.location && (!state.weather || stale()) && Date.now()-lastAttempt >= interval()) requestRefresh();},
    onRead(){publish();},dispose:close
  };
}
