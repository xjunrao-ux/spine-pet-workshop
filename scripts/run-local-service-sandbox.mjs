import {spawnSync} from 'node:child_process';
import electron from 'electron';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const result=spawnSync(electron,['scripts/test-local-service-sandbox.mjs'],{stdio:'inherit',windowsHide:true,env});
if(result.error){console.error(result.error.message);process.exit(1);}
process.exit(result.status??1);
