const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../public/legacy/variable-system.js');

test('stable IDs preserve refs and old keys through display renames', () => {
  const raw = {variables:{legacy:{type:'integer',default:6}},nodes:[{id:'a',params:{value:{ref:'variables.legacy'}}}]};
  V.rename(raw,'variables','legacy','次数');
  assert.equal(raw.nodes[0].params.value.ref,'variables.legacy');
  const id = V.create(raw,'variables','次数2',{type:'integer',owner:'a',initial_from:'other'},0);
  assert.match(id,/^v_/); assert.equal(raw.variables[id].default,0);
  assert.equal(raw.variables[id].owner,undefined); assert.equal(raw.variables[id].initial_from,undefined);
  assert.throws(()=>V.rename(raw,'variables',id,'次数'));
});
test('public initializer is idempotent and independent of the variable', () => {
  const raw = {variables:{v:{...V.copy(V.presets.retry),owner:'seq'}},nodes:[]};
  const id = V.expose(raw,'v');
  assert.equal(V.expose(raw,'v'),id);
  assert.equal(raw.inputs[id].owner,undefined);
  raw.variables.v.default.attempts=9;
  assert.equal(raw.inputs[id].default.attempts,2);
  assert.equal(V.references(raw,'inputs',id).length,1);
  assert.equal(V.defaultAt(raw,`inputs.${id}.delay_seconds`),0);
});
test('references include nested members across read bindings', () => {
  const raw={nodes:[{id:'read',params:{value:{ref:'variables.v.x'}}},{id:'read2',params:{value:{ref:'variables.v'}}}]};
  assert.equal(V.references(raw,'variables','v').length,2);
  assert.equal(V.containsBinding({x:[{ref:'inputs.a'}]}),true);
});
test('local visibility follows descendants and tolerates cycles', () => {
  const raw={nodes:[{id:'a',children:['b']},{id:'b',children:['a']},{id:'c'}]};
  assert.equal(V.visible(raw,'a','b'),true);
  assert.equal(V.visible(raw,'a','c'),false);
  assert.equal(V.visible(raw,null,'c'),true);
});

test('released automatic inputs are removed only after their last reference',()=>{
  const before={inputs:{auto:{type:'object',_autoPublished:true,default:{attempts:2,delay_seconds:0}},manual:{type:'integer'}},nodes:[{id:'a',params:{a:{ref:'inputs.auto.attempts'},b:{ref:'inputs.auto.delay_seconds'},c:{ref:'inputs.manual'}}}]};
  const raw=V.copy(before);raw.nodes[0].params.a=2;
  assert.deepEqual(V.cleanupReleased(raw,before),[]);
  raw.nodes[0].params.b=0;raw.nodes[0].params.c=0;
  assert.deepEqual(V.cleanupReleased(raw,before),['auto']);
  assert.ok(raw.inputs.manual);
  assert.equal(raw.nodes[0].params.a,2);assert.equal(raw.nodes[0].params.b,0);
});
test('shared refs, initializer links and Get cards protect automatic inputs',()=>{
  const before={inputs:{a:{_autoPublished:true}},variables:{v:{initial_from:'a'}},nodes:[{id:'n',params:{ref:'inputs.a'}}]};
  const raw=V.copy(before);raw.nodes=[];
  assert.deepEqual(V.cleanupReleased(raw,before),[]);
  delete raw.variables.v.initial_from;raw._variableCards={card:{scope:'inputs',name:'a'}};
  assert.deepEqual(V.cleanupReleased(raw,before),[]);
  delete raw._variableCards;
  assert.deepEqual(V.cleanupReleased(raw,before),['a']);
});

test('editor mutation cleans the complete vector atomically and undo keeps its input',()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const source=fs.readFileSync(require('node:path').join(__dirname,'../public/legacy/workflow-editor.js'),'utf8');
  const start=source.indexOf('  function mutate(');
  const raw={inputs:{a:{_autoPublished:true,default:{attempts:2,delay_seconds:0}}},nodes:[{id:'n',decorators:[{attempts:{ref:'inputs.a.attempts'},delay_seconds:{ref:'inputs.a.delay_seconds'}}]}]};
  const state={raw,undo:[],redo:[]};
  const ctx=vm.createContext({state,VariableSystem:V,snapshot:()=>JSON.stringify(state.raw),setDirty(){},render(){}});
  vm.runInContext(source.slice(start,source.indexOf('\n  }',start)+4),ctx);
  ctx.mutate(()=>{const d=raw.nodes[0].decorators[0];d.attempts=V.defaultAt(raw,d.attempts.ref);d.delay_seconds=V.defaultAt(raw,d.delay_seconds.ref);});
  assert.equal(raw.inputs.a,undefined);
  assert.deepEqual(raw.nodes[0].decorators[0],{attempts:2,delay_seconds:0});
  assert.ok(JSON.parse(state.undo[0]).inputs.a);
});
