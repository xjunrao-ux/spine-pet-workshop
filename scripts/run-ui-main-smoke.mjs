import {spawnSync} from 'node:child_process';import electron from 'electron';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const r=spawnSync(electron,['scripts/test-ui-main-smoke.mjs'],{stdio:'inherit',env,windowsHide:true});process.exit(r.status??1);
