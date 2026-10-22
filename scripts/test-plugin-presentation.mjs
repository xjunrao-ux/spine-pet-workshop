import test from 'node:test';
import assert from 'node:assert/strict';
import {validateManifest,validateSnapshot} from '../electron/plugins/contracts.mjs';
import {sanitizeGlobals} from '../electron/plugins/settings-store.mjs';
const manifest={id:'test.presentation',name:'呈现验证',version:'1',apiVersion:1,configVersion:1,icon:'deepseek',entryVisibility:'when-enabled',permissions:[]};
test('presentation is bounded and unknown modes cannot bypass host rendering',()=>{
 assert.equal(validateManifest({...manifest,presentation:{panel:'bubble'}}).presentation.panel,'bubble');
 for(const presentation of [{panel:'html'},{panel:'conversation',navigation:'script'},[],true])assert.throws(()=>validateManifest({...manifest,presentation}));
});
test('manager settings pages receive full block validation and do not replace overlay pages',()=>{
 const page={id:'chat',title:'对话',icon:'chat',blocks:[]},settings={id:'configuration',title:'设置',icon:'edit',blocks:[{type:'text',text:'本机资料'}]};
 const state=validateSnapshot({available:true,status:'ready',pages:[page],settingsPages:[settings],origin:'builtin'});
 assert.equal(state.pages.length,1);assert.equal(state.settingsPages[0].id,'configuration');assert.equal(state.origin,undefined);
 assert.throws(()=>validateSnapshot({...state,settingsPages:[{...settings,blocks:[{type:'raw-html',html:'<script/>'}]}]}));
 assert.throws(()=>validateSnapshot({...state,settingsPages:[{...settings,id:'chat'}]}));
 assert.throws(()=>validateSnapshot({...state,settingsPages:Array(21).fill(settings)}));
});
test('AI panel size defaults and persistence cannot alter compact panel sizes',()=>{
 const old=sanitizeGlobals({cardWidth:282,cardHeight:285});
 assert.equal(old.aiCardWidth,420);assert.equal(old.aiCardHeight,500);
 const updated=sanitizeGlobals({...old,aiCardWidth:460,aiCardHeight:520});
 assert.equal(updated.cardWidth,282);assert.equal(updated.cardHeight,285);assert.equal(updated.aiCardWidth,460);
 const bounded=sanitizeGlobals({aiCardWidth:-1,aiCardHeight:Infinity});
 assert.equal(bounded.aiCardWidth,320);assert.equal(bounded.aiCardHeight,500);
});
