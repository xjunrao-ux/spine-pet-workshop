import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createZip,safeZipPath } from '../electron/plugins/zip.mjs';
import { inspectPluginZip } from '../electron/plugins/packages.mjs';
const source=path.resolve(process.argv[2]??'examples/codex-plugin'),manifest=JSON.parse(await readFile(path.join(source,'plugin.json'),'utf8'));
safeZipPath(manifest.entry);
const files={'plugin.json':await readFile(path.join(source,'plugin.json')),[manifest.entry]:await readFile(path.join(source,manifest.entry))};
try{files['README.md']=await readFile(path.join(source,'README.md'));}catch(error){if(error.code!=='ENOENT')throw error;}
const zip=createZip(files);inspectPluginZip(zip);
const output=path.resolve(process.argv[3]??path.join('release','plugins','Codex-Plugin-v'+manifest.version+'.zip'));await mkdir(path.dirname(output),{recursive:true});await writeFile(output,zip);console.log(JSON.stringify({output,id:manifest.id,version:manifest.version,bytes:zip.length}));
