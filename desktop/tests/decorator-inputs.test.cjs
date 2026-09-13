const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/legacy/workflow-editor.js'),'utf8');
function harness(){
  const ctx=vm.createContext({state:{raw:{inputs:{},variables:{}}},clone:v=>JSON.parse(JSON.stringify(v)),
    VariableSystem:require('../public/legacy/variable-system.js'),valueBindingMenu:()=>({label:'绑定'}),
    isBindingValue:v=>!!v&&typeof v.ref==='string',mutate:fn=>fn(),toast:()=>{},
    el:(_tag,className='',textContent='')=>({className,textContent,children:[],appendChild(v){this.children.push(v);},prepend(v){this.children.unshift(v);},querySelector(selector){return this.children.find(v=>'.'+v.className===selector);}}),UI:{button:v=>v},
    allRefs:()=>[],referenceLabel:v=>v,selectInput:()=>({setAttribute(){}})});
  vm.runInContext(source.slice(source.indexOf('  const decoratorLiteralCache'),source.indexOf('  function renderDecorator(')),ctx);
  const start=source.indexOf('  function decoratorField(');
  vm.runInContext(source.slice(start,source.indexOf('\n  }',start)+4),ctx);
  const vectorStart=source.indexOf('  function decoratorVectorField(');
  vm.runInContext(source.slice(vectorStart,source.indexOf('\n  }',vectorStart)+4),ctx);
  return ctx;
}
for(const [type,key,value] of [['condition','expression',false],['condition','expression',{eq:[1,1]}],['cooldown','seconds',2],['timeout','seconds',10],['retry','attempts',3],['retry','delay_seconds',0],['do_once','reset_on_failure',false]]){
  test(`${type}.${key} exposes and restores its default`,()=>{
    const ctx=harness(),node={id:'task_1'},decorator={type,[key]:value};
    ctx.exposeDecoratorParameter(node,decorator,key);
    const name=decorator[key].ref.slice(7);
    assert.deepEqual(ctx.state.raw.inputs[name].default,value);
    ctx.exposeDecoratorParameter(node,decorator,key);
    assert.equal(Object.keys(ctx.state.raw.inputs).length,1);
    const control=ctx.decoratorParameterControl(node,decorator,key,{});
    assert.equal(control.children[0].children[0].label,'已公开');
    control.children[0].children[1].onClick();
    assert.deepEqual(decorator[key],value);
    assert.equal(Object.keys(ctx.state.raw.inputs).length,1);
  });
}
test('public parameter names avoid both inputs and variables',()=>{
  const ctx=harness(),decorator={type:'retry',attempts:2};
  ctx.state.raw.inputs.n_retry_attempts={type:'integer',default:4};
  ctx.state.raw.variables.n_retry_attempts_2={type:'integer',default:5};
  ctx.exposeDecoratorParameter({id:'n'},decorator,'attempts');
  assert.equal(decorator.attempts.ref,'inputs.n_retry_attempts_3');
});

test('single-field public actions live in the heading without an empty parameter row',()=>{
  const ctx=harness(),head=ctx.el('div'),input={value:8},decorator={type:'timeout',seconds:8};
  const control=ctx.decoratorParameterControl({id:'n'},decorator,'seconds',input,head);
  assert.equal(control.children.length,1);assert.equal(control.children[0],input);
  assert.equal(head.children[0].children[0].label,'公开');
  head.children[0].children[0].onClick();
  assert.equal(ctx.state.raw.inputs.n_timeout_seconds.default,8);
});

test('retry field label and public button share the same row',()=>{
  const ctx=harness(),input={value:0};
  const control=ctx.decoratorParameterControl({id:'n'},{type:'retry',delay_seconds:0},'delay_seconds',input);
  const field=ctx.decoratorField('间隔（秒）',control);
  assert.equal(field.children.length,1);
  assert.equal(control.children[0].children[0].textContent,'间隔（秒）');
  assert.equal(control.children[0].children[1].label,'公开');
  assert.equal(control.children[1],input);
});

test('vector components preserve matching rows with mixed literal and public values',()=>{
  const ctx=harness(),node={id:'n'},decorator={type:'retry',attempts:3,delay_seconds:0};
  ctx.exposeDecoratorParameter(node,decorator,'delay_seconds');
  const numeric={value:3,setAttribute(){}},unused={setAttribute(){}};
  const left=ctx.decoratorVectorField('次数',ctx.decoratorParameterControl(node,decorator,'attempts',numeric));
  const right=ctx.decoratorVectorField('间隔·秒',ctx.decoratorParameterControl(node,decorator,'delay_seconds',unused));
  assert.equal(left.children.length,1);assert.equal(right.children.length,1);
  assert.equal(left.children[0].children[1],numeric);
  ctx.retryPublicActions(node,decorator).children.find(item=>item.label==='固定值').onClick();
  assert.equal(decorator.delay_seconds,0);assert.equal(decorator.attempts,3);
  const css=fs.readFileSync(require('node:path').join(__dirname,'../public/legacy/inspector.css'),'utf8');
  assert.match(css,/\.decorator-vector\s*\{[^}]*grid-template-rows: 28px/);
});

test('one retry public action publishes both defaults and is idempotent',()=>{
  const ctx=harness(),node={id:'n'},decorator={type:'retry',attempts:4,delay_seconds:0};
  const actions=ctx.retryPublicActions(node,decorator);
  assert.equal(actions.children.filter(item=>item.label==='公开').length,1);assert.equal(actions.children[0].label,'公开');
  actions.children[0].onClick();
  const config=Object.values(ctx.state.raw.inputs)[0];
  assert.deepEqual(config.default,{attempts:4,delay_seconds:0});
  assert.equal(config.type,'object');
  actions.children[0].onClick();assert.equal(Object.keys(ctx.state.raw.inputs).length,1);
  const published=ctx.retryPublicActions(node,decorator);
  assert.equal(published.children[0].label,'已公开');assert.equal(published.children[0].disabled,true);
  published.children.find(item=>item.label==='固定值').onClick();assert.equal(decorator.attempts,4);assert.equal(decorator.delay_seconds,0);
});

test('group public action preserves existing references and publishes only the literal component',()=>{
  const ctx=harness(),node={id:'n'},ref={ref:'variables.tries'},decorator={type:'retry',attempts:ref,delay_seconds:.5};
  ctx.retryPublicActions(node,decorator).children[0].onClick();
  assert.equal(decorator.attempts,ref);assert.equal(Object.keys(ctx.state.raw.inputs).length,1);
  assert.equal(ctx.state.raw.inputs.n_retry_delay_seconds.default,.5);
});
