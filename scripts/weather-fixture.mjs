import {WeatherAdapter} from '../electron/plugins/weather-adapter.mjs';
export const rawWeather=()=>({timezone:'Asia/Shanghai',current:{time:1791784800,temperature_2m:22,apparent_temperature:21,relative_humidity_2m:65,weather_code:3,wind_speed_10m:10,is_day:1},hourly:{time:[1791784800,1791788400],temperature_2m:[22,null],precipitation_probability:[20,80],weather_code:[3,61]},daily:{time:[1791734400,1791820800],temperature_2m_max:[25,24],temperature_2m_min:[18,16],precipitation_probability_max:[30,80],wind_speed_10m_max:[15,25],weather_code:[3,61]}});
export const city={id:'123',name:'上海',region:'上海',country:'中国',latitude:31.23,longitude:121.47};
const response=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
export function fakeWeatherAdapter() {return new WeatherAdapter({fetchImpl:async url=>response(url.hostname.startsWith('geocoding') ? {results:[{...city,id:123,admin1:city.region}]} : rawWeather())});}
