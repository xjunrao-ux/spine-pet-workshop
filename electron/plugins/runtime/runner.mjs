import {workerMain} from './worker-code.mjs';
const worker=new Worker(URL.createObjectURL(new Blob(['('+workerMain.toString()+')()'],{type:'text/javascript'})));
const api=window.pluginRuntime;
worker.onmessage=async event=>{
  if(typeof event.data!=='string'||event.data.length>1024*1024){worker.terminate();await api.message(JSON.stringify({kind:'failed'}));return;}
  let message;try{message=JSON.parse(event.data);}catch{return;}
  try{const result=await api.message(event.data);if(message.kind==='rpc')worker.postMessage(JSON.stringify({kind:'rpcReply',id:message.id,ok:result.ok===true,data:result.data}));}
  catch{if(message.kind==='rpc')worker.postMessage(JSON.stringify({kind:'rpcReply',id:message.id,ok:false}));}
};
worker.onerror=()=>{worker.terminate();void api.message(JSON.stringify({kind:'failed'})).catch(()=>{});};
api.onRequest(request=>worker.postMessage(JSON.stringify({kind:'request',...request})));
const initial=await api.initialize();worker.postMessage(JSON.stringify({kind:'initialize',...initial}));
