// Domain-specific bridge. Plugins never supply URLs, headers, keys or request bodies.
const MAX_BYTES = 256 * 1024;
const CURRENT = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'weather_code', 'wind_speed_10m', 'is_day'];
const HOURLY = ['temperature_2m', 'precipitation_probability', 'weather_code'];
const DAILY = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max', 'wind_speed_10m_max'];
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const bounded = (v, min, max) => v === null || (Number.isFinite(v) && v >= min && v <= max);
const text = (v, max = 100) => typeof v === 'string' && v.length <= max;
function paramsOnly(params, keys) {
  if (!object(params) || Object.keys(params).length !== keys.length || keys.some(key => !Object.hasOwn(params, key))) throw new Error('Invalid weather parameters');
}
function coordinates(params) {
  paramsOnly(params, ['latitude', 'longitude']);
  if (params.latitude === null || params.longitude === null || !bounded(params.latitude, -90, 90) || !bounded(params.longitude, -180, 180)) throw new Error('Invalid coordinates');
}
function timestamp(value) {
  if (!Number.isFinite(value) || value < 0 || value > 4102444800) throw new Error('Invalid weather timestamp');
  return new Date(value * 1000).toISOString();
}
function number(value, min, max) {
  if (!bounded(value, min, max)) throw new Error('Invalid weather value');
  return value;
}
function location(value) {
  if (!object(value) || !Number.isSafeInteger(value.id) || !text(value.name) || !value.name) throw new Error('Invalid location');
  coordinates({latitude:value.latitude, longitude:value.longitude});
  return {id:String(value.id), name:value.name, region:text(value.admin1) ? value.admin1 : '', country:text(value.country) ? value.country : '', latitude:value.latitude, longitude:value.longitude};
}
function series(value, fields, max) {
  if (!object(value) || !Array.isArray(value.time) || value.time.length < 1 || value.time.length > max || fields.some(key => !Array.isArray(value[key]) || value[key].length !== value.time.length)) throw new Error('Invalid weather series');
  value.time.forEach(timestamp);
  if (value.time.some((t,i) => i > 0 && t <= value.time[i-1])) throw new Error('Unordered weather series');
}
function normalize(data, fetchedAt) {
  if (!object(data) || !object(data.current) || !text(data.timezone)) throw new Error('Invalid weather response');
  new Intl.DateTimeFormat('en', {timeZone:data.timezone}).format();
  series(data.hourly, HOURLY, 24); series(data.daily, DAILY, 7);
  const c = data.current, h = data.hourly, d = data.daily;
  return {schemaVersion:1, source:'Open-Meteo', fetchedAt, timezone:data.timezone,
    current:{time:timestamp(c.time), temperature:number(c.temperature_2m,-100,70), feelsLike:number(c.apparent_temperature,-120,90), humidity:number(c.relative_humidity_2m,0,100), code:number(c.weather_code,0,99), wind:number(c.wind_speed_10m,0,500), isDay:number(c.is_day,0,1)},
    hourly:h.time.map((time,i) => ({time:timestamp(time), temperature:number(h.temperature_2m[i],-100,70), rainProbability:number(h.precipitation_probability[i],0,100), code:number(h.weather_code[i],0,99)})),
    daily:d.time.map((time,i) => ({time:timestamp(time), high:number(d.temperature_2m_max[i],-100,70), low:number(d.temperature_2m_min[i],-100,70), rainProbability:number(d.precipitation_probability_max[i],0,100), wind:number(d.wind_speed_10m_max[i],0,500), code:number(d.weather_code[i],0,99)}))};
}
export class WeatherAdapter {
  constructor({fetchImpl=globalThis.fetch, now=Date.now, timeoutMs=5000}={}) {
    this.fetch=fetchImpl; this.now=now; this.timeoutMs=timeoutMs; this.cache=new Map(); this.active=0; this.recent=[];
  }
  async request(url, signal) {
    signal?.throwIfAborted();
    const now=this.now(); this.recent=this.recent.filter(t => now-t < 60000);
    if (this.active >= 4 || this.recent.length >= 30) throw new Error('Weather request budget exceeded');
    ++this.active; this.recent.push(now);
    const controller=new AbortController(), abort=()=>controller.abort();
    signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,this.timeoutMs);
    let reader;
    try {
      const response=await this.fetch(url,{method:'GET',redirect:'error',credentials:'omit',headers:{Accept:'application/json'},signal:controller.signal});
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Weather service unavailable');
      const length=response.headers.get('content-length');
      if (length !== null && Number(length) > MAX_BYTES) throw new Error('Weather response too large');
      reader=response.body?.getReader(); if (!reader) throw new Error('Missing weather response');
      const chunks=[]; let size=0;
      while (true) {
        const {done,value}=await reader.read(); if(done) break;
        size+=value.byteLength; if(size > MAX_BYTES) throw new Error('Weather response too large'); chunks.push(value);
      }
      controller.signal.throwIfAborted();
      const bytes=new Uint8Array(size); let offset=0;
      for(const chunk of chunks) {bytes.set(chunk,offset); offset+=chunk.byteLength;}
      return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort',abort); --this.active;
      if(reader) {try {await reader.cancel();} catch {}}
    }
  }
  async cached(key, ttl, signal, load) {
    signal?.throwIfAborted();
    const entry=this.cache.get(key);
    if(entry && this.now()-entry.at < ttl) return structuredClone(entry.value);
    const value=await load(); signal?.throwIfAborted();
    if(this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key,{at:this.now(),value}); return structuredClone(value);
  }
  search(params, signal) {
    paramsOnly(params,['name']);
    if(!text(params.name,100) || params.name.trim().length < 2 || /[\u0000-\u001f]/.test(params.name)) throw new Error('Invalid city name');
    const name=params.name.trim();
    return this.cached('search:'+name,300000,signal,async()=>{
      const url=new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.search=new URLSearchParams({name,count:'5',language:'zh',format:'json'}).toString();
      const data=await this.request(url,signal);
      if(!object(data) || data.error || (data.results !== undefined && (!Array.isArray(data.results) || data.results.length > 5))) throw new Error('Invalid location response');
      return (data.results ?? []).map(location);
    });
  }
  forecast(params, signal) {
    coordinates(params);
    return this.cached('forecast:'+params.latitude+','+params.longitude,600000,signal,async()=>{
      const url=new URL('https://api.open-meteo.com/v1/forecast');
      url.search=new URLSearchParams({latitude:String(params.latitude),longitude:String(params.longitude),current:CURRENT.join(','),hourly:HOURLY.join(','),daily:DAILY.join(','),forecast_days:'7',forecast_hours:'24',timezone:'auto',timeformat:'unixtime',temperature_unit:'celsius',wind_speed_unit:'kmh',precipitation_unit:'mm'}).toString();
      return normalize(await this.request(url,signal),new Date(this.now()).toISOString());
    });
  }
}
