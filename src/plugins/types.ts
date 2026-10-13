export type PluginId = string;
export interface GlobalSettings { details:boolean; subtitles:boolean; quiet:boolean; reducedMotion:boolean; hoverDelay:number; cardWidth:number; cardHeight:number }
export interface SettingField { key:string; type:'boolean'|'number'|'enum'|'stringList'; label:string; description?:string; default:unknown; min?:number; max?:number; options?:string[]; optionSource?:string }
export interface PluginManifest { id:PluginId; name:string; menuLabel?:string; version:string; apiVersion:number; configVersion:number; icon:string; description:string; permissions:string[]; entryVisibility:'when-enabled'|'when-available'; compatibilityNotes:string[]; settingsSchema:SettingField[]; commands:Array<{id:string;label?:string;managerOnly?:boolean}> }
export interface CommandButton {type:'button';commandId:string;payload:Record<string,unknown>;label:string;icon:string;enabled:boolean;primary?:boolean;variant?:'icon'|'text'}
export type Block =
  | {type:'text';text:string;tone?:'normal'|'muted'|'error';strong?:boolean;ellipsis?:boolean;multiline?:boolean}
  | {type:'group';layout:'row'|'column';appearance?:string;children:Block[];contextActions?:CommandButton[]}
  | {type:'image';asset?:string|null;icon:string;alt?:string}
  | CommandButton
  | {type:'form';id:string;commandId:string;payload?:Record<string,unknown>;submitLabel:string;enabled?:boolean;fields:Array<{key:string;type:'text'|'textarea'|'datetime';label:string;required?:boolean;maxLength?:number;value?:string}>}
  | {type:'timeline';id:string;positionMs:number|null;durationMs:number|null;playing:boolean;updatedAt?:string|null}
  | {type:'metric';label:string;value:number|null;resetsAt?:string|null}
  | {type:'list';items:Array<{id?:string;label:string;status:string}>;emptyText?:string}
  | {type:'status';icon:string;title:string;description:string}
  | {type:'progress';value:number|null}
  | {type:'time';label:string;value:string|null};
export interface PluginPage {id:string;title:string;subtitle?:string;icon:string;readKey?:string|null;unread:boolean;blocks:Block[]}
export interface PluginState {
  id:PluginId;manifest:PluginManifest;origin:'builtin'|'external';grantedPermissions:string[];enabled:boolean;runtime:'disabled'|'starting'|'active'|'stopping'|'failed'|'incompatible';epoch:number;revision:number;error:string|null;
  config:Record<string,unknown>;available:boolean;status:'waiting'|'ready'|'degraded'|'error';message?:string;updatedAt?:string|null;preferredPageId?:string|null;pages:PluginPage[];unread:number;assets:Record<string,string>;
  diagnostics?:{permission?:string;channels?:Array<{id:string;name:string;message:string}>;sources?:Array<{id:string;name:string}>};
}
export interface PluginSnapshot {settings:GlobalSettings;locked:boolean;settingsError?:string|null;packageError?:string|null;plugins:PluginState[]}
export interface PluginEvent {id:string;pluginId:PluginId;text:string;createdAt:string;readKeys?:string[];pageId?:string}
export interface CommandResult {ok:boolean;data?:unknown;error?:{code:string;message:string;retryable?:boolean}}
export interface SettingsPatch {global?:Partial<GlobalSettings>;plugins?:Record<PluginId,{enabled?:boolean;config?:Record<string,unknown>}>}
export interface FeatureBridge {
  snapshot():Promise<PluginSnapshot>;execute(id:PluginId,command:string,payload:Record<string,unknown>):Promise<CommandResult>;
  acknowledge(id:PluginId,items:Array<{pageId:string;readKey:string}>):Promise<CommandResult>;
  settings():void;regions(regions:Array<{x:number;y:number;width:number;height:number}>):void;pin(value:boolean):void;close():void;
  resize(width:number,height:number,save?:boolean,edge?:string):Promise<{width:number;height:number}>;
  onState(callback:(state:PluginSnapshot)=>void):()=>void;onHover(callback:(value:boolean)=>void):()=>void;onEvent(callback:(event:PluginEvent)=>void):()=>void;onClose(callback:()=>void):()=>void;
}
