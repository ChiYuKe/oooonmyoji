const test = require('node:test');
const assert = require('node:assert/strict');
const { validateWorkflow } = require('../dist-electron/shared/workflow/index.js');

const catalog = { byName: () => ({ inputSchema:{type:'object'}, outputSchema:{type:'object',properties:{value:{type:'string'}}}, parameters:{}, retrySafe:true }), names:()=>['test.echo'] };
const base = (nodes) => ({schema_version:4,id:'pure',version:'4.0.0',resolution:[100,100],root:'root',inputs:{},variables:{},nodes});

test('bool_judge may be standalone pure data node without execution parent', () => {
  const issues = validateWorkflow(base([
    {id:'root',type:'root',children:['run']},
    {id:'run',type:'task',action:'test.echo',params:{}},
    {id:'judge',type:'bool_judge',expression:{eq:[0,0]}},
  ]), catalog);
  assert.deepEqual(issues, []);
});

test('execution graph rejects connecting a pure data node as an execution child', () => {
  const issues = validateWorkflow(base([
    {id:'root',type:'root',children:['run']},
    {id:'run',type:'sequence',children:['judge']},
    {id:'judge',type:'bool_judge',expression:{eq:[0,0]}},
  ]), catalog);
  assert.ok(issues.some((issue) => issue.code === 'data-node-exec-link'), JSON.stringify(issues));
});
