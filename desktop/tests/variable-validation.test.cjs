// Run via npm test (builds the desktop validator first).
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateWorkflow,buildWorkflowSchema,parseWorkflow}=require('../dist-electron/main/core/workflow.js');
const Ajv=require('ajv/dist/2020');
const spec={name:'core.capture',parameters:{},retrySafe:true,inputSchema:{type:'object'},outputSchema:{type:'object'}};
const catalog={byName:()=>spec,names:()=>['core.capture']};
function fixture(){return {schema_version:4,id:'test',version:'1',resolution:[1920,1080],root:'root',inputs:{n:{type:'integer',default:2}},variables:{v:{type:'integer',default:0,initial_from:'n'}},nodes:[{id:'root',type:'root',children:['run']},{id:'run',type:'task',action:'core.capture',params:{},decorators:[{type:'retry',attempts:{ref:'inputs.n'},delay_seconds:0}]}]};}
test('desktop validator and generated schema accept scalar bindings',()=>{
 const raw=fixture();assert.deepEqual(validateWorkflow(raw,catalog),[]);
 const validate=new Ajv({strict:false}).compile(buildWorkflowSchema(parseWorkflow(raw),catalog));
 assert.equal(validate(raw),true,JSON.stringify(validate.errors));
});
test('desktop rejects missing initializer',()=>{
 const raw=fixture();raw.variables.v.initial_from='missing';
 assert.ok(validateWorkflow(raw,catalog).some(x=>x.code==='variable-initializer'));
});
