const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('node validation cache is initialized before the editor returns its render handle',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/canvas/editor.ts'),'utf8');
  // Preserve the startup order and the actual production cache functions. Only
  // unrelated factories and DOM wiring are omitted from this small reproduction.
  const declaration=source.match(/  let issuesCache: [^\n]+ = null;/);
  assert(declaration);
  const returned=source.indexOf('  return handle;');
  const functions=source.slice(source.indexOf('  function documentIssues()'),source.indexOf('  /** 参数行的折叠状态'))
    .replace('function documentIssues(): Map<string, any>', 'function documentIssues()')
    .replace('new Map<string, any>()', 'new Map()')
    .replace('function nodeIssueInfo(node: any): { node: any[]; params: Map<string, any[]> } | null', 'function nodeIssueInfo(node)');
  const init='let issuesCache = null;';
  const result='return { nodeIssueInfo };';
  const body=(declaration.index<returned ? init+result : result+init)+functions;
  let validations=0;
  const state={raw:{nodes:[]},docVersion:0};
  const context={state,Map,catalogLike:()=>({}),validateWorkflow:()=>{validations++;return [];},issuesByNode:()=>new Map(),nodeIssues:(map,id)=>map.get(id)||{node:[],params:new Map()}};
  const editor=vm.runInNewContext('(function(){'+body+'})()',context);
  assert.equal(editor.nodeIssueInfo({id:'root'}).node.length,0);
  editor.nodeIssueInfo({id:'child'});
  assert.equal(validations,1,'cache is reused within one document version');
  state.docVersion++;
  editor.nodeIssueInfo({id:'root'});
  assert.equal(validations,2);
  state.raw={nodes:[]};
  editor.nodeIssueInfo({id:'root'});
  assert.equal(validations,3,'loading or undoing a document invalidates the cache');
});
