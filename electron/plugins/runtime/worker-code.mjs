export function workerMain(){
  const stringify=JSON.stringify.bind(JSON),parse=JSON.parse.bind(JSON),post=self.postMessage.bind(self),pending=new Map(),subscriptions=new Map(),cleanups=[],controller=new AbortController();let sequence=0,instance,inputs;
  // Child workers cannot be used to evade this worker's heartbeat or teardown.
  const deny=(target,name)=>{for(let current=target;current;current=Object.getPrototypeOf(current)){if(current===target||Object.hasOwn(current,name))try{Object.defineProperty(current,name,{value:undefined,writable:false,configurable:false});}catch{}}};
  for(const name of ['Worker','SharedWorker','indexedDB','caches','OffscreenCanvas'])deny(globalThis,name);
  deny(navigator,'storage');
  const send=value=>post(stringify(value));
  const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});send({kind:'rpc',id,method,...params});});
  const clone=value=>parse(stringify(value));
  const update=value=>{inputs=value;};
  const subscribeCodex=async(onState,onEvent=()=>{})=>{
    if(typeof onState!=='function'||typeof onEvent!=='function')throw new Error('Invalid subscriber');
    const id='codex-'+(++sequence);subscriptions.set(id,{state:onState,event:onEvent});
    try{await rpc('codex.subscribe',{subscriptionId:id});}catch(error){subscriptions.delete(id);throw error;}
    let active=true;return ()=>{if(!active)return;active=false;subscriptions.delete(id);void rpc('codex.unsubscribe',{subscriptionId:id}).catch(()=>{});};
  };
  self.onmessage=async event=>{
    let request;try{request=parse(event.data);}catch{return;}
    if(request.kind==='rpcReply'){const item=pending.get(request.id);if(!item)return;pending.delete(request.id);request.ok?item.resolve(request.data):item.reject(new Error('插件能力请求失败或未授权'));return;}
    try{
      if(request.kind==='initialize'){
        update(request.inputs);
        const context=Object.freeze({signal:controller.signal,startedAt:inputs.startedAt,getConfig:()=>clone(inputs.config),getPreferences:()=>clone(inputs.preferences),isRead:key=>inputs.readKeys.includes(key),
          weather:Object.freeze({search:params=>rpc('weather.search',{params}),forecast:params=>rpc('weather.forecast',{params})}),
          ...(inputs.permissions.includes('codex.read')?{codex:Object.freeze({subscribe:subscribeCodex})}:{}),
          storage:Object.freeze({get:key=>rpc('storage.get',{key}),set:(key,value)=>rpc('storage.set',{key,value})}),
          publish:snapshot=>send({kind:'publish',snapshot}),emit:event=>rpc('emit',{event}),onCleanup:callback=>cleanups.push(callback)});
        const module=await import(URL.createObjectURL(new Blob([request.code],{type:'text/javascript'})));
        if(typeof module.activate!=='function')throw new Error('Missing activate');instance=await module.activate(context);
        if(typeof instance?.getSnapshot!=='function'||typeof instance?.dispose!=='function')throw new Error('Invalid lifecycle');
        send({kind:'ready',snapshot:await instance.getSnapshot()});return;
      }
      if(request.kind!=='request')return;
      if(request.method==='capability'){
        const callback=subscriptions.get(request.subscriptionId)?.[request.channel];if(callback)try{await callback(request.value);}catch{send({kind:'failed'});}return;
      }
      if(request.method==='dispose'){controller.abort();for(const cleanup of cleanups.splice(0))try{cleanup();}catch{}await instance?.dispose?.();return;}
      if(request.method==='heartbeat'){send({kind:'reply',id:request.id,ok:true});return;}
      if(!instance)throw new Error('Plugin not ready');let data=null;
      if(request.method==='execute')data=await instance.execute(request.commandId,request.payload);
      else if(request.method==='settings'){update(request.inputs);await instance.onSettingsChanged?.(clone(inputs.config));}
      else if(request.method==='read'){update(request.inputs);await instance.onRead?.();}
      else throw new Error('Unsupported runtime request');
      send({kind:'reply',id:request.id,ok:true,data,snapshot:await instance.getSnapshot()});
    }catch{
      if(request.kind==='initialize')send({kind:'failed'});else send({kind:'reply',id:request.id,ok:false});
    }
  };
}
