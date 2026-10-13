import { validDate } from './contracts.mjs';
const text=(value,max)=>typeof value==='string'?value.slice(0,max):'';
const metric=value=>value&&typeof value==='object'?{
  remaining:Number.isFinite(value.remaining)?Math.max(0,Math.min(100,value.remaining)):null,
  minutes:Number.isFinite(value.minutes)&&value.minutes>0?value.minutes:null,
  resetsAt:validDate(value.resetsAt)?value.resetsAt:null
}:null;
// External subscribers receive documented readonly fields, not raw backend data.
export function codexCapabilityValue(channel,value){
  if(channel==='event'){
    if(!value||typeof value.id!=='string'||!value.id||!validDate(value.createdAt)||typeof value.text!=='string')return null;
    return {id:text(value.id,500),createdAt:value.createdAt,text:text(value.text,1000)};
  }
  return {running:Boolean(value?.running),connected:Boolean(value?.connected),allowed:typeof value?.allowed==='boolean'?value.allowed:null,
    primary:metric(value?.primary),secondary:metric(value?.secondary),updatedAt:validDate(value?.updatedAt)?value.updatedAt:null,
    error:typeof value?.error==='string'?text(value.error,1000):null,taskError:typeof value?.taskError==='string'?text(value.taskError,1000):null,
    tasks:(Array.isArray(value?.tasks)?value.tasks:[]).slice(0,100).filter(task=>task&&typeof task.id==='string').map(task=>({
      id:text(task.id,200),name:text(task.name,500),status:text(task.status,100),turnStatus:text(task.turnStatus,100)
    }))};
}
