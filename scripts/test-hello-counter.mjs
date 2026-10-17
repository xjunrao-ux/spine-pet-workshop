import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {activate} from '../examples/hello-counter-plugin/provider.js';
import {validateManifest,validateSnapshot,validatePayload} from '../electron/plugins/contracts.mjs';

test('counter commands produce valid snapshots, stop safely and reset on a new activation',async()=>{
  const manifest=validateManifest(JSON.parse(await readFile(new URL('../examples/hello-counter-plugin/plugin.json',import.meta.url),'utf8')));
  const controller=new AbortController(),instance=activate({signal:controller.signal});
  const text=()=>validateSnapshot(instance.getSnapshot()).pages[0].blocks[0].text;
  assert.deepEqual(manifest.permissions,[]);assert.equal(text(),'你已经点击了 0 次。');
  for(const block of instance.getSnapshot().pages[0].blocks.filter(block=>block.type==='button')){
    const command=manifest.commands.find(item=>item.id===block.commandId);assert.ok(command);validatePayload(command,block.payload);
  }
  instance.execute('increment');instance.execute('increment');assert.equal(text(),'你已经点击了 2 次。');
  instance.execute('reset');assert.equal(text(),'你已经点击了 0 次。');
  assert.throws(()=>instance.execute('unknown'));
  controller.abort();assert.throws(()=>instance.execute('increment'));instance.dispose();instance.dispose();
  const restarted=activate({signal:new AbortController().signal});assert.equal(restarted.getSnapshot().pages[0].blocks[0].text,'你已经点击了 0 次。');
  restarted.dispose();assert.throws(()=>restarted.execute('increment'));
});
