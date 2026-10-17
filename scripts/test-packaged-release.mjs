import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {inspectPluginZip} from '../electron/plugins/packages.mjs';
const require=createRequire(import.meta.url),deps=createRequire(require.resolve('electron-builder')),asar=deps('@electron/asar');
const sourcePackage=JSON.parse(await readFile('package.json','utf8')),directory=path.resolve('release/v'+sourcePackage.version),archive=path.join(directory,'win-unpacked/resources/app.asar');
const packaged=JSON.parse(asar.extractFile(archive,'package.json').toString('utf8'));assert.equal(packaged.version,sourcePackage.version);
const checks=[];
for(const file of ['electron/plugins/contracts.mjs','electron/plugins/packages.mjs','electron/plugins/sandbox-runtime.mjs','electron/plugins/weather-adapter.mjs','electron/plugins/runtime/worker-code.mjs','electron/plugins/runtime/runner.mjs','electron/plugins/runtime/preload.cjs','plugins/todo/provider.js','plugins/todo/plugin.json','electron/extensions/codex-service.mjs','dist/settings.html','dist/extensions.html']){assert.deepEqual(asar.extractFile(archive,path.normalize(file)),await readFile(file),file);checks.push(file);}
const files=asar.listPackage(archive).map(file=>file.replaceAll('\\','/'));assert.ok(!files.some(file=>/^\/(?:\.local|v3|scripts|examples|\.git)\//.test(file)));assert.ok(files.includes('/dist/models/amiya/build_char_002_amiya.skel'));
const todo=JSON.parse(asar.extractFile(archive,path.normalize('plugins/todo/plugin.json')).toString('utf8'));assert.equal(todo.id,'example.todo');assert.equal(todo.version,'1.2.0');
const plugins=[];for(const [name,id] of [['Weather-Plugin-v1.1.0.zip','local.spine-weather'],['Codex-Plugin-v1.1.0.zip','io.spine-workshop.codex'],['Hello-Counter-v1.0.0.zip','com.example.hello-counter']]){const bundle=inspectPluginZip(await readFile(path.join('release/plugins',name)));assert.equal(bundle.manifest.id,id);plugins.push({file:name,id,version:bundle.manifest.version,icon:bundle.manifest.icon});}
const result={ok:true,version:packaged.version,todoVersion:todo.version,packagedSourceMatches:checks.length,noDevelopmentOrUserFiles:true,builtinModelPresent:true,plugins};await mkdir('.local/release-v'+sourcePackage.version+'-validation',{recursive:true});await writeFile('.local/release-v'+sourcePackage.version+'-validation/packaged-contents.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
