import {readFile} from 'node:fs/promises';
import {inspectPluginZip} from '../electron/plugins/packages.mjs';
const file=process.argv[2];
if(!file)throw new Error('Provide a plugin ZIP path');
const {manifest}=inspectPluginZip(await readFile(file));
console.log(JSON.stringify({file,id:manifest.id,version:manifest.version,permissions:manifest.permissions}));
