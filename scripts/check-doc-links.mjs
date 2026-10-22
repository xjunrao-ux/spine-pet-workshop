import {execFileSync} from 'node:child_process';import fs from 'node:fs';import path from 'node:path';
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(f=>f.endsWith('.md')&&fs.existsSync(f)&&!f.startsWith('v3/')&&!f.startsWith('dsh-pet-bridge/legacy-stage0/'));
// Protocol copies retain the checksum-identical canonical document and its relative link base.
const missing=[];
for(const file of new Set(files)){
 const source=fs.readFileSync(file,'utf8').replace(/```[\s\S]*?```/g,'');
 for(const match of source.matchAll(/\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g)){
  const target=match[1]??match[2];if(/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(target))continue;
  const local=decodeURIComponent(target.split('#')[0]);if(!local)continue;
  if(!fs.existsSync(path.resolve(file==='dsh-pet-bridge/protocol/DSH_BRIDGE_PROTOCOL.md'?'docs':path.dirname(file),local)))missing.push({file,target});
 }
}
if(missing.length){console.error(JSON.stringify(missing,null,2));process.exit(1);}console.log('PASS local documentation links:',files.length,'Markdown files');
