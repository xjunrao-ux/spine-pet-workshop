// Read-only compatibility probe. No chat body, song title, task name or credentials
// are printed. A fresh local profile is used; the real app profile is untouched.
import { mkdir,mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExtensionService } from '../electron/extensions/extension-service.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'.local','plugin-probe');await mkdir(directory,{recursive:true});
const userData=await mkdtemp(path.join(directory,'profile-'));
const host=new ExtensionService({directory:path.join(root,'electron','extensions'),userData,onUpdate:()=>{},onEvent:()=>{}});
try {
  await host.start();await new Promise(resolve=>setTimeout(resolve,16000));
  const snapshot=host.snapshot();
  console.log(JSON.stringify({version:'3.2.1',plugins:snapshot.plugins.map(p=>({id:p.id,runtime:p.runtime,status:p.status,available:p.available,error:p.error,pages:p.pages.length,
    ...(p.diagnostics?{permission:p.diagnostics.permission,channels:p.diagnostics.channels}:{}),
    ...(p.id==='workshop.music'?{players:p.pages.map(page=>({id:page.id,hasCover:page.blocks[0]?.children?.some(block=>block.type==='image'&&Boolean(block.asset)),timeline:page.blocks.some(block=>block.type==='timeline'&&block.durationMs!==null)}))}:{}),
    ...(p.id==='io.spine-workshop.codex'?{hasQuota:p.pages[0]?.blocks.some(block=>block.type==='metric'&&block.value!==null)??false}: {})})),sharedBridgeLeases:host.broker.windows.leases.size},null,2));
}finally{await host.stop();}
