const api=window.deepseekSettings,key=document.querySelector('#api-key'),status=document.querySelector('#status');
async function update(){const state=await api.status();key.placeholder=state.configured?'已保存 · 输入新密钥可替换':'输入 API Key';status.textContent=state.error??(state.configured?'已保存密钥，可以返回桌宠开始对话。':'尚未保存 API Key。');}
async function run(action){document.querySelectorAll('button').forEach(button=>button.disabled=true);try{const result=await action();if(result.ok)await update();status.textContent=result.message??(result.ok?'操作完成。':result.message);}catch{status.textContent='连接设置暂不可用，请重新打开。';}finally{document.querySelectorAll('button').forEach(button=>button.disabled=false);}}
document.querySelector('#key-form').addEventListener('submit',event=>{event.preventDefault();const value=key.value;key.value='';void run(async()=>{const result=await api.save(value);return {...result,message:result.ok?'密钥已加密保存，可以返回桌宠开始对话。':result.message};});});
document.querySelector('#test').addEventListener('click',()=>void run(()=>api.test()));
document.querySelector('#clear').addEventListener('click',()=>{key.value='';void run(()=>api.clear());});
void update().catch(()=>{status.textContent='无法读取密钥状态，请重新打开。';});
