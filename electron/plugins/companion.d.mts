export interface CompanionState {theme:string;customTheme:import("./themes.mjs").CustomTheme;opacity:number;reducedMotion:boolean;companion:null|{id:string;epoch:number;name:string;icon:string;hint:string;form:null|{command:string;key:string;maxLength:number;enabled:boolean;pending:boolean;stop:string|null};assistant:null|{id:string;content:string;state:'complete'|'partial'|'streaming'}}}
export function companionState(snapshot:unknown):CompanionState;
export function executeCompanion(service:unknown,id:string,epoch:number,command:string,text?:string):Promise<unknown>;
