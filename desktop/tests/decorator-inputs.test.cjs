// Run via npm test (builds the renderer test output first).
// 装饰器参数公开/恢复：直接调用编译产物的工厂实例。
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {harness}=require('./helpers/composite-harness.cjs');

for(const [type,key,value] of [['cooldown','seconds',2],['timeout','seconds',10],['retry','attempts',3],['retry','delay_seconds',0],['do_once','reset_on_failure',false]]){
  test(`${type}.${key} exposes and restores its default`,()=>{
    const h=harness(),node={id:'task_1'},decorator={type,[key]:value};
    h.inspector.exposeDecoratorParameter(node,decorator,key);
    const name=decorator[key].ref.slice(7);
    assert.deepEqual(h.state.raw.inputs[name].default,value);
    h.inspector.exposeDecoratorParameter(node,decorator,key);
    assert.equal(Object.keys(h.state.raw.inputs).length,1);
    const control=h.inspector.decoratorParameterControl(node,decorator,key,{});
    assert.equal(control.children[0].children[0].label,'已公开');
    control.children[0].children[1].onClick();
    assert.deepEqual(decorator[key],value);
    assert.equal(Object.keys(h.state.raw.inputs).length,1);
  });
}
test('public parameter names avoid both inputs and variables',()=>{
  const h=harness(),decorator={type:'retry',attempts:2};
  h.state.raw.inputs.n_retry_attempts={type:'integer',default:4};
  h.state.raw.variables.n_retry_attempts_2={type:'integer',default:5};
  h.inspector.exposeDecoratorParameter({id:'n'},decorator,'attempts');
  assert.equal(decorator.attempts.ref,'inputs.n_retry_attempts_3');
});

test('single-field public actions live in the heading without an empty parameter row',()=>{
  const h=harness(),head=h.el('div'),input={value:8},decorator={type:'timeout',seconds:8};
  const control=h.inspector.decoratorParameterControl({id:'n'},decorator,'seconds',input,head);
  assert.equal(control.children.length,1);assert.equal(control.children[0],input);
  assert.equal(head.children[0].children[0].label,'公开');
  head.children[0].children[0].onClick();
  assert.equal(h.state.raw.inputs.n_timeout_seconds.default,8);
});

test('retry field label and public button share the same row',()=>{
  const h=harness(),input={value:0};
  const control=h.inspector.decoratorParameterControl({id:'n'},{type:'retry',delay_seconds:0},'delay_seconds',input);
  const field=h.inspector.decoratorField('间隔（秒）',control);
  assert.equal(field.children.length,1);
  assert.equal(control.children[0].children[0].textContent,'间隔（秒）');
  assert.equal(control.children[0].children[1].label,'公开');
  assert.equal(control.children[1],input);
});

test('vector components preserve matching rows with mixed literal and public values',()=>{
  const h=harness(),node={id:'n'},decorator={type:'retry',attempts:3,delay_seconds:0};
  h.inspector.exposeDecoratorParameter(node,decorator,'delay_seconds');
  const numeric={value:3,setAttribute(){}},unused={setAttribute(){}};
  const left=h.inspector.decoratorVectorField('次数',h.inspector.decoratorParameterControl(node,decorator,'attempts',numeric));
  const right=h.inspector.decoratorVectorField('间隔·秒',h.inspector.decoratorParameterControl(node,decorator,'delay_seconds',unused));
  assert.equal(left.children.length,1);assert.equal(right.children.length,1);
  assert.equal(left.children[0].children[1],numeric);
  h.inspector.retryPublicActions(node,decorator).children.find(item=>item.label==='固定值').onClick();
  assert.equal(decorator.delay_seconds,0);assert.equal(decorator.attempts,3);
  const css=fs.readFileSync(path.join(__dirname,'../public/legacy/inspector.css'),'utf8');
  assert.match(css,/\.decorator-vector\s*\{[^}]*grid-template-rows: 28px/);
});

test('one retry public action publishes both defaults and is idempotent',()=>{
  const h=harness(),node={id:'n'},decorator={type:'retry',attempts:4,delay_seconds:0};
  const actions=h.inspector.retryPublicActions(node,decorator);
  assert.equal(actions.children.filter(item=>item.label==='公开').length,1);assert.equal(actions.children[0].label,'公开');
  actions.children[0].onClick();
  const config=Object.values(h.state.raw.inputs)[0];
  assert.deepEqual(config.default,{attempts:4,delay_seconds:0});
  assert.equal(config.type,'object');
  actions.children[0].onClick();assert.equal(Object.keys(h.state.raw.inputs).length,1);
  const published=h.inspector.retryPublicActions(node,decorator);
  assert.equal(published.children[0].label,'已公开');assert.equal(published.children[0].disabled,true);
  published.children.find(item=>item.label==='固定值').onClick();assert.equal(decorator.attempts,4);assert.equal(decorator.delay_seconds,0);
});

test('group public action preserves existing references and publishes only the literal component',()=>{
  const h=harness(),node={id:'n'},ref={ref:'variables.tries'},decorator={type:'retry',attempts:ref,delay_seconds:.5};
  h.inspector.retryPublicActions(node,decorator).children[0].onClick();
  assert.equal(decorator.attempts,ref);assert.equal(Object.keys(h.state.raw.inputs).length,1);
  assert.equal(h.state.raw.inputs.n_retry_delay_seconds.default,.5);
});

test('judgement node renders its condition editor and true/false slots',()=>{
  const h=harness(),node={id:'judge',type:'condition',expression:{eq:[1,1]},children:['act'],ports:['true'],
    };
  h.inspector.renderCompositeInspector(h.body,node);
  assert.equal(h.body.children[0].className.split(' ')[0],'description');
  assert.equal(h.body.children[1].label,'布尔输入');
  assert.equal(h.body.children[1].children[0].className,'condition-input-readonly','条件只能由左侧布尔端口连线写入，面板不再维护第二份表达式');
  assert.equal(h.body.children[2].className,'condition-readback','条件回读整句');
  assert.equal(h.body.children[3].textContent,'分支');
  const slots=h.body.children.slice(4);
  assert.equal(slots.length,2,'真 / 假两个槽位');
  assert.equal(slots[0].children[0].className,'condition-slot-title condition-slot-true');
  assert.equal(slots[1].children[0].className,'condition-slot-title condition-slot-false');
  assert.equal(slots[0].children[1].textContent,'节点 act','真口显示接上的子节点');
  assert.equal(slots[1].children[1].className,'condition-slot-empty','假口空着时说明这条路径失败');
  // 断开真口：使用统一的断开图标按钮，并走注入的 disconnect。
  assert.equal(slots[0].children[2].className,'icon-button danger condition-slot-remove');
  assert.equal(slots[0].children[2].tip,'断开真口上的分支');
  assert.equal(slots[0].children[2].textContent,'trash');
  slots[0].children[2].fire('click');
  assert.deepEqual(h.deps.disconnected,['judge','act']);

  // 没有 expression 的旧文档：面板同样只给只读入口（条件由左侧布尔端口接线写入），
  // 也不替用户往文档里塞一个默认表达式。
  const legacy={id:'judge2',type:'condition'};
  const legacyBody=h.el('div');
  h.inspector.renderCompositeInspector(legacyBody,legacy);
  assert.equal(legacyBody.children[1].children[0].className,'condition-input-readonly');
  assert.equal(legacy.expression,undefined);
});

test('decorator list no longer offers the removed condition decorator',()=>{
  const h=harness(),node={id:'n',type:'sequence',children:[],decorators:[]};
  h.inspector.renderDecorators(h.body,node);
  const add=h.body.children.find(item=>item.className.includes('decorator-add'));
  assert.deepEqual(add.options.map(option=>option.value),['','cooldown','timeout','retry','repeat','do_once']);
  // 老文档里的 condition 装饰器不会再被"添加"出来：未知类型直接忽略。
  add.onChange('condition');
  assert.deepEqual(node.decorators,[]);
  add.onChange('retry');
  assert.deepEqual(node.decorators,[{type:'retry',attempts:2,delay_seconds:0}]);
});
