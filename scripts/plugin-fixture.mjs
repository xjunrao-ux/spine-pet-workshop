import { CapabilityBroker } from '../electron/plugins/capabilities.mjs';
import { WindowsAdapter } from '../electron/plugins/windows-adapter.mjs';
import { BUILTIN_PLUGINS } from '../electron/plugins/registry.mjs';
import { activate as activateCodex } from '../examples/codex-plugin/provider.js';
import codexManifest from '../examples/codex-plugin/plugin.json' with {type:'json'};
// Synthetic data only. Never installed in the production registry.
export const testPlugin={manifest:{id:'workshop.test',name:'接口验证',menuLabel:'验证',version:'1.0.0',apiVersion:1,configVersion:1,icon:'clock',entryVisibility:'when-enabled',description:'仅用于自动化测试的第四插件',permissions:[],compatibilityNotes:['此插件仅存在于隔离测试配置。'],settingsSchema:[{key:'enabledText',type:'boolean',label:'显示测试文字',default:true}],commands:[{id:'echo',fields:{value:{type:'string',maxLength:100}}}]},activate(context){let value='第四插件无需修改菜单即可显示';return {getSnapshot:()=>({available:true,status:'ready',message:'统一接口验证',pages:[{id:'sample',title:'第四插件',icon:'clock',blocks:[{type:'text',text:context.getConfig().enabledText?value:'文字已关闭'},{type:'button',commandId:'echo',label:'验证统一操作',icon:'play',enabled:true,payload:{value:'统一命令调用成功'}}]}]}),execute(_id,payload){value=payload.value;return value;},dispose(){}};}};
export function createTestOptions({fourth=false,legacyCodex=false}={}) {
  const windows=new WindowsAdapter({directory:'.',platform:'fixture'});windows.sync=()=>{};windows.calls=[];
  windows.request=async(method,params,signal)=>{if(signal?.aborted) throw new Error('Cancelled');windows.calls.push({method,params});return method==='permission'?'Allowed':true;};
  const broker=new CapabilityBroker({windows,codexFactory:(onState,onEvent)=>({running:false,
    start(){this.running=true;this.push({running:true,connected:true,tasks:[]});},stop(){this.running=false;onState({running:false,connected:false,tasks:[]});},
    push(state){this.running=state.running;onState(state);},emit(event){onEvent(event);}})});
  // Explicit historical fixture only; production and ZIP UI use the actual registry.
  const definitions=legacyCodex?[...BUILTIN_PLUGINS.filter(def=>def.manifest.id!=='example.todo'),{manifest:{...codexManifest,id:'workshop.codex'},activate:context=>activateCodex({...context,codex:context.capabilities.codex})}]:BUILTIN_PLUGINS;
  return {broker,definitions:fourth?[...definitions,testPlugin]:definitions};
}
export function mediaFixture(cover=null) {return {currentId:'QQMusic.exe',error:null,sessions:[
  {id:'QQMusic.exe',name:'QQ 音乐',title:'示例曲目 · 插件界面',artist:'演示数据',album:'专辑封面测试',status:'Paused',position:84,duration:269,cover,capabilities:{play:true,pause:true,next:true,previous:true}},
  {id:'cloudmusic.exe',name:'网易云音乐',title:'SMTC 兼容测试',artist:'演示数据',album:'',status:'Paused',position:84,duration:269,cover:null,capabilities:{play:true,pause:true,next:true,previous:true}},
  {id:'local.spine.desktop.pet.workshop',status:'Playing'}]};}
