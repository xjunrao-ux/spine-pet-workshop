// Shared API v1 for trusted builtins and constrained ZIP providers.
export const API_VERSION = 1;
export const PERMISSIONS = new Set(['media.read','media.control','notifications.read','codex.read','ui.reminders','storage.own','weather.read']);
const icons = new Set(['music','notifications','codex','note','clock','cloud','close','play','pause','next','previous','checklist','check','undo','trash','plus','edit']);
const statuses = new Set(['waiting','ready','degraded','error']);
const text = (value, max = 4000) => typeof value === 'string' && value.length <= max;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
export const readKey = (id, version) => JSON.stringify([String(id), String(version)]);
export function validateManifest(input) {
  if (!plain(input) || !/^[a-z][a-z0-9.-]{2,99}$/.test(input.id) || !text(input.name,100) || !input.name || !text(input.version,30)) throw new Error('Invalid plugin manifest');
  if (!Number.isInteger(input.apiVersion) || !Number.isInteger(input.configVersion) || input.configVersion < 1) throw new Error('Invalid plugin version');
  if (!icons.has(input.icon) || !['when-enabled','when-available'].includes(input.entryVisibility)) throw new Error('Invalid plugin presentation');
  if (!Array.isArray(input.permissions) || input.permissions.some(p=>!PERMISSIONS.has(p))) throw new Error('Invalid plugin permissions');
  if(input.description!=null&&!text(input.description,1000)||input.menuLabel!=null&&!text(input.menuLabel,100)) throw new Error('Invalid plugin description');
  if(input.commands!=null&&(!Array.isArray(input.commands)||input.commands.length>40)||input.settingsSchema!=null&&(!Array.isArray(input.settingsSchema)||input.settingsSchema.length>30)) throw new Error('Invalid plugin declarations');
  if(input.compatibilityNotes!=null&&(!Array.isArray(input.compatibilityNotes)||input.compatibilityNotes.length>20||input.compatibilityNotes.some(note=>!text(note,2000)))) throw new Error('Invalid compatibility notes');
  for (const command of input.commands ?? []) {
    if (!plain(command) || !/^[a-zA-Z][a-zA-Z0-9.-]{0,60}$/.test(command.id) || !plain(command.fields ?? {})) throw new Error('Invalid plugin command');
    if ((command.permissions ?? []).some(p=>!input.permissions.includes(p))) throw new Error('Undeclared command permission');
    for(const [key,field] of Object.entries(command.fields??{})) if(!/^[a-zA-Z][a-zA-Z0-9]{0,60}$/.test(key)||['constructor','prototype'].includes(key)||!plain(field)||!['string','number','boolean'].includes(field.type)||(field.enum&&!Array.isArray(field.enum))) throw new Error('Invalid command field');
  }
  if (new Set((input.commands ?? []).map(c=>c.id)).size !== (input.commands ?? []).length) throw new Error('Duplicate plugin command');
  for (const field of input.settingsSchema ?? []) {
    if (!plain(field) || !/^[a-zA-Z][a-zA-Z0-9]{0,60}$/.test(field.key) || !['boolean','number','stringList','enum'].includes(field.type)) throw new Error('Invalid plugin setting');
  }
  return {...structuredClone(input),description:input.description??'',compatibilityNotes:input.compatibilityNotes??[],commands:input.commands??[],settingsSchema:input.settingsSchema??[]};
}
export function validatePayload(command, payload = {}) {
  if (!plain(payload)) throw new Error('Invalid command payload');
  const fields=command.fields ?? {};
  if (Object.keys(payload).some(key=>!Object.hasOwn(fields,key))) throw new Error('Unknown command parameter');
  for (const [key,schema] of Object.entries(fields)) {
    const value=payload[key];
    if (value===undefined && schema.optional) continue;
    if (schema.type==='string' && (!text(value,schema.maxLength ?? 200) || (!schema.allowEmpty && !value))) throw new Error('Invalid string parameter');
    if (schema.type==='boolean' && typeof value!=='boolean') throw new Error('Invalid boolean parameter');
    if (schema.type==='number' && (!Number.isFinite(value) || value<(schema.min ?? -Infinity) || value>(schema.max ?? Infinity))) throw new Error('Invalid numeric parameter');
    if (schema.enum && !schema.enum.includes(value)) throw new Error('Invalid enum parameter');
    if (!['string','number','boolean'].includes(schema.type)) throw new Error('Invalid parameter schema');
  }
  return structuredClone(payload);
}
export function sanitizeConfig(manifest, input = {}, { preserveUnknown = false } = {}) {
  const result=preserveUnknown && plain(input)?structuredClone(input):{};
  for (const field of manifest.settingsSchema ?? []) {
    const value=input?.[field.key];
    if (field.type==='boolean') result[field.key]=typeof value==='boolean'?value:field.default;
    if (field.type==='number') result[field.key]=Number.isFinite(value)?Math.max(field.min ?? -Infinity,Math.min(field.max ?? Infinity,value)):field.default;
    if (field.type==='enum') result[field.key]=(field.options ?? []).includes(value)?value:field.default;
    if (field.type==='stringList') result[field.key]=Array.isArray(value)?[...new Set(value.filter(v=>text(v,150)))].slice(0,100):structuredClone(field.default ?? []);
  }
  return result;
}
const appearances = new Set(['default','album','song-info','controls','notice','notice-top','item','actions']);
function validateBlock(block, depth, assets) {
  if (!plain(block) || depth>8) throw new Error('Invalid page block');
  if (block.appearance && !appearances.has(block.appearance)) throw new Error('Invalid block appearance');
  switch(block.type) {
    case 'text':
      if (!text(block.text) || (block.tone && !['normal','muted','error'].includes(block.tone))) throw new Error('Invalid text block');
      break;
    case 'image':
      if (block.asset && (!text(block.asset,200) || !assets.has(block.asset))) throw new Error('Unknown image asset');
      if (!icons.has(block.icon)) throw new Error('Invalid image fallback');
      break;
    case 'group':
      if (!['row','column'].includes(block.layout) || !Array.isArray(block.children) || block.children.length>50) throw new Error('Invalid group');
      if(block.contextActions!=null){
        if(!Array.isArray(block.contextActions)||block.contextActions.length>10||block.contextActions.some(action=>!plain(action)||action.type!=='button')) throw new Error('Invalid context actions');
        block.contextActions.forEach(action=>validateBlock(action,depth+1,assets));
      }
      block.children.forEach(child=>validateBlock(child,depth+1,assets)); break;
    case 'button':
      if (!icons.has(block.icon) || !text(block.label,100) || !text(block.commandId,100) || !plain(block.payload ?? {}) || typeof block.enabled!=='boolean') throw new Error('Invalid button');
      if(block.variant!=null&&!['icon','text'].includes(block.variant)) throw new Error('Invalid button style');
      break;
    case 'form':
      if(!text(block.id,100)||!block.id||!text(block.commandId,100)||!text(block.submitLabel,100)||!plain(block.payload??{})||!Array.isArray(block.fields)||block.fields.length>12) throw new Error('Invalid form');
      if(new Set(block.fields.map(field=>field.key)).size!==block.fields.length) throw new Error('Duplicate form field');
      for(const field of block.fields) if(!plain(field)||!/^[a-zA-Z][a-zA-Z0-9]{0,60}$/.test(field.key)||['constructor','prototype'].includes(field.key)||!['text','textarea','datetime'].includes(field.type)||!text(field.label,100)||(field.value!=null&&!text(field.value,4000))||(field.maxLength!=null&&(!Number.isInteger(field.maxLength)||field.maxLength<1||field.maxLength>4000))) throw new Error('Invalid form field');
      break;
    case 'timeline':
      if (![block.positionMs,block.durationMs].every(v=>v===null || (Number.isFinite(v) && v>=0))) throw new Error('Invalid timeline');
      if (typeof block.playing!=='boolean' || !text(block.id,200)) throw new Error('Invalid timeline state');
      break;
    case 'metric':
      if (!text(block.label,100) || !(block.value===null || (Number.isFinite(block.value) && block.value>=0 && block.value<=100))) throw new Error('Invalid metric');
      break;
    case 'list':
      if (!Array.isArray(block.items) || block.items.length>100 || block.items.some(item=>!plain(item) || !text(item.label,500) || !text(item.status,100))) throw new Error('Invalid list');
      break;
    case 'status':
      if (!icons.has(block.icon) || !text(block.title,200) || !text(block.description)) throw new Error('Invalid status');
      break;
    case 'time':
      if (!text(block.label,200) || (block.value!==null && !validDate(block.value))) throw new Error('Invalid time');
      break;
    case 'progress':
      if (!(block.value===null || (Number.isFinite(block.value) && block.value>=0 && block.value<=100))) throw new Error('Invalid progress');
      break;
    default: throw new Error('Unknown component');
  }
  for (const key of ['updatedAt','resetsAt']) if (block[key]!=null && !validDate(block[key])) throw new Error('Invalid component time');
}
export const validDate=value=>text(value,50) && Number.isFinite(Date.parse(value));
export function validateSnapshot(input, assets = new Map()) {
  if (!plain(input) || typeof input.available!=='boolean' || !statuses.has(input.status) || !Array.isArray(input.pages) || input.pages.length>100) throw new Error('Invalid plugin snapshot');
  if (input.message!=null && !text(input.message)) throw new Error('Invalid plugin message');
  if (input.updatedAt!=null && !validDate(input.updatedAt)) throw new Error('Invalid update time');
  const ids=new Set();
  for (const page of input.pages) {
    if (!plain(page) || !text(page.id,200) || !page.id || ids.has(page.id) || !text(page.title,200) || !icons.has(page.icon) || !Array.isArray(page.blocks) || page.blocks.length>100) throw new Error('Invalid plugin page');
    if (page.readKey!=null && !text(page.readKey,500)) throw new Error('Invalid page read key');
    if (page.subtitle!=null && !text(page.subtitle,300)) throw new Error('Invalid page subtitle');
    ids.add(page.id);page.blocks.forEach(block=>validateBlock(block,0,assets));
  }
  if (JSON.stringify(input).length>1024*1024) throw new Error('Plugin snapshot too large');
  // Do not allow untrusted snapshots to replace identity, permissions or origin.
  const result={available:input.available,status:input.status,pages:structuredClone(input.pages)};
  for(const key of ['message','updatedAt','preferredPageId']) if(input[key]!=null) result[key]=input[key];
  if(input.preferredPageId!=null&&!text(input.preferredPageId,200)) throw new Error('Invalid preferred page');
  if(input.diagnostics!=null){
    const value=input.diagnostics;if(!plain(value)) throw new Error('Invalid diagnostics');const diagnostics={};
    if(value.permission!=null){if(!text(value.permission,100)) throw new Error('Invalid permission status');diagnostics.permission=value.permission;}
    for(const key of ['sources','channels']) if(value[key]!=null){if(!Array.isArray(value[key])||value[key].length>100||value[key].some(item=>!plain(item)||!text(item.id,200)||!text(item.name,200)||(item.message!=null&&!text(item.message,1000)))) throw new Error('Invalid source diagnostics');diagnostics[key]=value[key].map(item=>({id:item.id,name:item.name,...(item.message!=null?{message:item.message}:{})}));}
    result.diagnostics=diagnostics;
  }
  return result;
}
export function validateEvent(input) {
  if (!plain(input) || !text(input.id,500) || !input.id || !text(input.dedupeKey,500) || !input.dedupeKey || !validDate(input.createdAt)) throw new Error('Invalid plugin event');
  if (!plain(input.summary) || !text(input.summary.private,500) || (input.summary.details!=null && !text(input.summary.details,1000))) throw new Error('Invalid reminder summary');
  if (input.readKeys && (!Array.isArray(input.readKeys) || input.readKeys.length>100 || input.readKeys.some(key=>!text(key,500)))) throw new Error('Invalid reminder read keys');
  if(input.count!=null&&(!Number.isInteger(input.count)||input.count<1||input.count>1000))throw new Error('Invalid reminder count');
  return structuredClone(input);
}
