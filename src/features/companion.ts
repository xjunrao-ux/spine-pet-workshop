import {applyTheme} from './themes';
export function initializeCompanion(speech:(text:string,streaming:boolean)=>void,clearSpeech:()=>void) {
 const api=window.desktopPet?.companion;let identity='',baseline='';
 function update(value:import('../../electron/plugins/companion.mjs').CompanionState){
  applyTheme(value.theme,value.customTheme);document.body.classList.toggle('reduce-motion',value.reducedMotion);
  const c=value.companion,key=c?c.id+'|'+c.epoch:'',last=c?.assistant,signature=last?JSON.stringify(last):'';
  if(key!==identity){identity=key;baseline=signature;clearSpeech();}
  else if(signature!==baseline){baseline=signature;if(last?.content)speech(last.content,last.state==='streaming');else clearSpeech();}
 }
 if(api){api.onState(update);void api.get().then(update).catch(()=>{});}
 window.addEventListener('pointerleave',()=>api?.hover(false));
 window.addEventListener('blur',()=>api?.hover(false));
 return {hover:(value:boolean)=>api?.hover(value),click:()=>api?.click()};
}
