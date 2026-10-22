import {spawnSync} from 'node:child_process';import electron from 'electron';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const r=spawnSync(electron,['scripts/capture-readme.mjs'],{stdio:'inherit',windowsHide:true,env});if(r.error)console.error(r.error);process.exit(r.status??1);
